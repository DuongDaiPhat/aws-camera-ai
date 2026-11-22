"""Lightweight ByteTrack-inspired two-stage track stabilizer per camera."""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from typing import Any


@dataclass
class _TrackState:
    canonical_id: str
    raw_id: str
    box: list[float]
    score: float
    last_seen: float
    vx: float = 0.0
    vy: float = 0.0


@dataclass
class _CameraTracks:
    active: dict[str, _TrackState]
    lost: dict[str, _TrackState]
    last_frame_time: float | None = None


def _normalize_xy(box: list[float]) -> tuple[float, float, float, float]:
    a0, a1, a2, a3 = float(box[0]), float(box[1]), float(box[2]), float(box[3])
    return min(a0, a2), min(a1, a3), max(a0, a2), max(a1, a3)


def _box_iou(box_a: list[float], box_b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = _normalize_xy(box_a)
    bx1, by1, bx2, by2 = _normalize_xy(box_b)
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area <= 0.0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    return inter_area / union if union > 0.0 else 0.0


def _box_geometry(box: list[float]) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = _normalize_xy(box)
    w = max(0.0, x2 - x1)
    h = max(0.0, y2 - y1)
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0, math.hypot(w, h), w * h


def _predict_box(track: _TrackState, frame_time: float) -> list[float]:
    dt = max(0.0, min(3.0, frame_time - track.last_seen))
    dx = track.vx * dt
    dy = track.vy * dt
    return [track.box[0] + dx, track.box[1] + dy, track.box[2] + dx, track.box[3] + dy]


def _greedy_match(candidates: list[tuple[float, int, str]]) -> dict[int, str]:
    matches: dict[int, str] = {}
    used_dets: set[int] = set()
    used_lost: set[str] = set()
    for _, det_idx, lost_id in sorted(candidates, key=lambda item: item[0], reverse=True):
        if det_idx in used_dets or lost_id in used_lost:
            continue
        matches[det_idx] = lost_id
        used_dets.add(det_idx)
        used_lost.add(lost_id)
    return matches


class TrackStabilizer:
    """Re-associate briefly dropped/switched Frigate person tracks per camera."""

    def __init__(
        self,
        *,
        max_lost_seconds: float = 15.0,
        high_score_threshold: float = 0.70,
        high_iou_threshold: float = 0.30,
        low_iou_threshold: float = 0.15,
        max_center_distance_ratio: float = 0.60,
        min_area_ratio: float = 0.35,
        max_lost_tracks_per_camera: int = 64,
        max_cameras: int = 64,
    ) -> None:
        self.max_lost_seconds = max_lost_seconds
        self.high_score_threshold = high_score_threshold
        self.high_iou_threshold = high_iou_threshold
        self.low_iou_threshold = low_iou_threshold
        self.max_center_distance_ratio = max_center_distance_ratio
        self.min_area_ratio = min_area_ratio
        self.max_lost_tracks_per_camera = max_lost_tracks_per_camera
        self.max_cameras = max_cameras
        self._lock = threading.Lock()
        self._cameras: dict[str, _CameraTracks] = {}

    def reset(self, camera: str | None = None) -> None:
        with self._lock:
            if camera is None:
                self._cameras.clear()
            else:
                self._cameras.pop(camera, None)

    def _get_camera_state(self, camera: str, frame_time: float) -> _CameraTracks:
        state = self._cameras.get(camera)
        if state is None:
            if len(self._cameras) >= self.max_cameras:
                oldest_cam = next(iter(self._cameras))
                del self._cameras[oldest_cam]
            state = _CameraTracks(active={}, lost={}, last_frame_time=frame_time)
            self._cameras[camera] = state
            return state
        if state.last_frame_time is not None and frame_time < state.last_frame_time - 60.0:
            state.active.clear()
            state.lost.clear()
        state.last_frame_time = frame_time
        expired = [
            key
            for key, track in state.lost.items()
            if (frame_time - track.last_seen) > self.max_lost_seconds
        ]
        for key in expired:
            del state.lost[key]
        return state

    @staticmethod
    def _update_track(
        prev: _TrackState, raw_id: str, box: list[float], score: float, frame_time: float
    ) -> _TrackState:
        dt = frame_time - prev.last_seen
        vx, vy = prev.vx, prev.vy
        if 0.0 < dt <= 2.0:
            prev_cx, prev_cy, _, _ = _box_geometry(prev.box)
            cur_cx, cur_cy, _, _ = _box_geometry(box)
            inst_vx = (cur_cx - prev_cx) / dt
            inst_vy = (cur_cy - prev_cy) / dt
            vx = 0.5 * prev.vx + 0.5 * inst_vx
            vy = 0.5 * prev.vy + 0.5 * inst_vy
        return _TrackState(
            canonical_id=prev.canonical_id,
            raw_id=raw_id,
            box=list(box),
            score=score,
            last_seen=frame_time,
            vx=vx,
            vy=vy,
        )

    def _stage1_high_iou(
        self,
        indices: list[int],
        detections: list[dict[str, Any]],
        lost: dict[str, _TrackState],
        frame_time: float,
    ) -> dict[int, str]:
        candidates: list[tuple[float, int, str]] = []
        for idx in indices:
            det = detections[idx]
            if float(det.get("score", 0.0)) < self.high_score_threshold:
                continue
            det_box = [float(v) for v in det["box"][:4]]
            for lost_id, track in lost.items():
                iou = max(
                    _box_iou(det_box, track.box),
                    _box_iou(det_box, _predict_box(track, frame_time)),
                )
                if iou >= self.high_iou_threshold:
                    candidates.append((iou, idx, lost_id))
        return _greedy_match(candidates)

    def _stage2_secondary(
        self,
        indices: list[int],
        detections: list[dict[str, Any]],
        lost: dict[str, _TrackState],
        frame_time: float,
    ) -> dict[int, str]:
        candidates: list[tuple[float, int, str]] = []
        for idx in indices:
            det_box = [float(v) for v in detections[idx]["box"][:4]]
            det_cx, det_cy, det_diag, det_area = _box_geometry(det_box)
            for lost_id, track in lost.items():
                pred_box = _predict_box(track, frame_time)
                iou = max(_box_iou(det_box, track.box), _box_iou(det_box, pred_box))
                pred_cx, pred_cy, lost_diag, lost_area = _box_geometry(pred_box)
                max_area = max(det_area, lost_area)
                area_ratio = (min(det_area, lost_area) / max_area) if max_area > 0.0 else 0.0
                max_diag = max(det_diag, lost_diag)
                dist = math.hypot(det_cx - pred_cx, det_cy - pred_cy)
                dist_ratio = (dist / max_diag) if max_diag > 0.0 else float("inf")
                if iou >= self.low_iou_threshold or (
                    area_ratio >= self.min_area_ratio
                    and dist_ratio <= self.max_center_distance_ratio
                ):
                    rank = iou + max(0.0, 1.0 - dist_ratio) * 0.25
                    candidates.append((rank, idx, lost_id))
        return _greedy_match(candidates)

    def _apply_matches(
        self,
        matches: dict[int, str],
        detections: list[dict[str, Any]],
        lost: dict[str, _TrackState],
        next_active: dict[str, _TrackState],
        assigned: dict[int, str],
        frame_time: float,
    ) -> None:
        for idx, lost_id in matches.items():
            track = lost.pop(lost_id)
            det = detections[idx]
            raw_id = str(det["id"])
            box = [float(v) for v in det["box"][:4]]
            score = float(det.get("score", 0.0))
            next_active[raw_id] = self._update_track(track, raw_id, box, score, frame_time)
            assigned[idx] = track.canonical_id

    def update(self, camera: str, frame_time: float, detections: list[dict[str, Any]]) -> list[str]:
        """Return canonicalTrackId for each detection in order."""
        with self._lock:
            state = self._get_camera_state(camera, frame_time)
            next_active: dict[str, _TrackState] = {}
            assigned: dict[int, str] = {}
            unmatched: list[int] = []

            for idx, det in enumerate(detections):
                raw_id = str(det["id"])
                box = [float(v) for v in det["box"][:4]]
                score = float(det.get("score", 0.0))
                if raw_id in state.active:
                    prev = state.active[raw_id]
                    next_active[raw_id] = self._update_track(prev, raw_id, box, score, frame_time)
                    assigned[idx] = prev.canonical_id
                elif raw_id in state.lost:
                    prev = state.lost.pop(raw_id)
                    next_active[raw_id] = self._update_track(prev, raw_id, box, score, frame_time)
                    assigned[idx] = prev.canonical_id
                else:
                    unmatched.append(idx)

            for raw_id, prev in state.active.items():
                if raw_id not in next_active:
                    state.lost[raw_id] = prev

            if unmatched and state.lost:
                stage1 = self._stage1_high_iou(unmatched, detections, state.lost, frame_time)
                self._apply_matches(
                    stage1, detections, state.lost, next_active, assigned, frame_time
                )
                unmatched = [idx for idx in unmatched if idx not in assigned]

            if unmatched and state.lost:
                stage2 = self._stage2_secondary(unmatched, detections, state.lost, frame_time)
                self._apply_matches(
                    stage2, detections, state.lost, next_active, assigned, frame_time
                )
                unmatched = [idx for idx in unmatched if idx not in assigned]

            for idx in unmatched:
                det = detections[idx]
                raw_id = str(det["id"])
                box = [float(v) for v in det["box"][:4]]
                score = float(det.get("score", 0.0))
                next_active[raw_id] = _TrackState(
                    canonical_id=raw_id,
                    raw_id=raw_id,
                    box=box,
                    score=score,
                    last_seen=frame_time,
                )
                assigned[idx] = raw_id

            if len(state.lost) > self.max_lost_tracks_per_camera:
                by_age = sorted(state.lost.items(), key=lambda kv: kv[1].last_seen)
                excess = len(state.lost) - self.max_lost_tracks_per_camera
                for key, _ in by_age[:excess]:
                    del state.lost[key]

            state.active = next_active
            return [assigned[idx] for idx in range(len(detections))]
