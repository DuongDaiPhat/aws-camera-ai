"""Bounded camera hazard sequences, spatial tracking, and temporal flicker checks."""

import json
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock
from uuid import NAMESPACE_URL, uuid5

import cv2
import numpy as np

from app.config import Settings
from app.models.fire import (
    FireBoundingBox,
    FireDetection,
    FireFrame,
    FireInferenceError,
    FireReason,
    FireResponse,
)

REPLAY_CACHE_SIZE = 256
MOTION_THUMB_SIZE = (160, 120)
MOTION_BLUR_KERNEL = (3, 3)


def canonical_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def expanded_box_iou(first: FireBoundingBox, second: FireBoundingBox, padding: float) -> float:
    """Compute IoU after padding both normalized boxes so small swaying flames still match."""
    ax1 = max(0.0, first.x - padding)
    ay1 = max(0.0, first.y - padding)
    ax2 = min(1.0, first.x + first.width + padding)
    ay2 = min(1.0, first.y + first.height + padding)

    bx1 = max(0.0, second.x - padding)
    by1 = max(0.0, second.y - padding)
    bx2 = min(1.0, second.x + second.width + padding)
    by2 = min(1.0, second.y + second.height + padding)

    inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = inter_w * inter_h
    if intersection <= 0.0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - intersection
    return intersection / union if union > 0.0 else 0.0


def build_motion_thumbnail(image: np.ndarray | None) -> np.ndarray | None:
    """Downscale BGR frame to a tiny blurred grayscale grid for flicker estimation."""
    if image is None or image.size == 0:
        return None
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    resized = cv2.resize(gray, MOTION_THUMB_SIZE, interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(resized, MOTION_BLUR_KERNEL, 0)


def compute_region_temporal_motion(
    thumbs: list[np.ndarray], boxes: list[FireBoundingBox]
) -> float | None:
    """Measure normalized frame-to-frame luminance change inside the union fire ROI."""
    if len(thumbs) < 2 or not boxes:
        return None
    width, height = MOTION_THUMB_SIZE
    x1 = max(0, int(min(box.x for box in boxes) * width))
    y1 = max(0, int(min(box.y for box in boxes) * height))
    x2 = min(width, max(x1 + 1, int(np.ceil(max(box.x + box.width for box in boxes) * width))))
    y2 = min(height, max(y1 + 1, int(np.ceil(max(box.y + box.height for box in boxes) * height))))

    diffs: list[float] = []
    for previous, current in zip(thumbs, thumbs[1:], strict=False):
        prev_roi = previous[y1:y2, x1:x2].astype(np.float32)
        curr_roi = current[y1:y2, x1:x2].astype(np.float32)
        diffs.append(float(np.mean(np.abs(curr_roi - prev_roi))) / 255.0)
    return sum(diffs) / len(diffs) if diffs else None


@dataclass
class QualifiedFrame:
    frame: FireFrame
    score: float
    boxes: list[FireBoundingBox] = field(default_factory=list)
    motion_thumb: np.ndarray | None = None


@dataclass
class CameraState:
    session: str
    last_observed: datetime | None = None
    candidates: list[QualifiedFrame] = field(default_factory=list)
    confirmed: FireResponse | None = None
    negative_since: datetime | None = None
    retired_sessions: deque[str] = field(default_factory=lambda: deque(maxlen=32))
    responses: OrderedDict[str, FireResponse] = field(default_factory=OrderedDict)


class FireTracker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.states: dict[str, CameraState] = {}
        self.lock = RLock()

    def response(
        self, frame: FireFrame, now: datetime, reason: FireReason, **values: object
    ) -> FireResponse:
        return FireResponse.model_validate(
            {
                **frame.model_dump(),
                "model_version": self.settings.fire_model_version,
                "processed_at": now,
                "required_frames": self.settings.fire_min_consecutive_frames,
                "window_seconds": self.settings.fire_confirmation_window_seconds,
                "max_frame_gap_seconds": self.settings.fire_max_frame_gap_seconds,
                "threshold_used": self.settings.fire_confidence_threshold,
                "reason": reason,
                **values,
            }
        )

    def preflight(self, frame: FireFrame, now: datetime) -> FireResponse | None:
        """Do not infer/count duplicates, old timestamps or retired source sessions."""
        with self.lock:
            state = self.states.get(frame.camera_slug)
            if (
                state
                and state.session == frame.source_session_id
                and frame.frame_id in state.responses
            ):
                cached = state.responses[frame.frame_id]
                if cached.observed_at != frame.observed_at:
                    return self.response(frame, now, "OUT_OF_ORDER")
                return cached.model_copy(deep=True, update={"is_replay": True, "reason": "REPLAY"})
            age = (now - frame.observed_at).total_seconds()
            if (
                age > self.settings.fire_frame_max_age_seconds
                or age < -self.settings.fire_frame_future_tolerance_seconds
            ):
                return self.response(frame, now, "STALE_FRAME")
            if state and (
                frame.source_session_id in state.retired_sessions
                or (state.last_observed is not None and frame.observed_at <= state.last_observed)
            ):
                return self.response(frame, now, "OUT_OF_ORDER")
            return None

    def reset(self, camera_slug: str) -> None:
        with self.lock:
            if state := self.states.get(camera_slug):
                state.candidates.clear()
                state.negative_since = None

    def sweep(self, now: datetime) -> None:
        """Silence expires evidence; it never confirms or clears an active episode."""
        with self.lock:
            for state in self.states.values():
                if (
                    state.last_observed
                    and (now - state.last_observed).total_seconds()
                    > self.settings.fire_max_frame_gap_seconds
                ):
                    state.candidates.clear()
                    state.negative_since = None

    def failure(self, frame: FireFrame, now: datetime, error: FireInferenceError) -> FireResponse:
        with self.lock:
            self.reset(frame.camera_slug)
            state = self._state(frame)
            if state and (state.last_observed is None or frame.observed_at > state.last_observed):
                state.last_observed = frame.observed_at
            return self.response(frame, now, "INFERENCE_ERROR", error=error)

    def _state(self, frame: FireFrame) -> CameraState | None:
        state = self.states.get(frame.camera_slug)
        if state is None:
            if len(self.states) >= self.settings.fire_max_cameras:
                return None
            state = CameraState(session=frame.source_session_id)
            self.states[frame.camera_slug] = state
        elif state.session != frame.source_session_id:
            retired = state.retired_sessions
            retired.append(state.session)
            state = CameraState(session=frame.source_session_id, retired_sessions=retired)
            self.states[frame.camera_slug] = state
        return state

    def evaluate(
        self,
        frame: FireFrame,
        detections: list[FireDetection],
        now: datetime,
        image: np.ndarray | None = None,
    ) -> FireResponse:
        # Ignore legacy/non-fire predictions even when an adapter bypasses model validation.
        detections = [item for item in detections if item.label == "fire"]
        with self.lock:
            if early := self.preflight(frame, now):
                return early
            state = self._state(frame)
            if state is None:
                return self.failure(
                    frame,
                    now,
                    FireInferenceError(
                        code="PROVIDER_UNAVAILABLE", message="Fire camera state capacity reached."
                    ),
                )
            score = max((item.confidence for item in detections), default=None)
            gap = (
                state.last_observed is not None
                and (frame.observed_at - state.last_observed).total_seconds()
                > self.settings.fire_max_frame_gap_seconds
            )
            if gap:
                state.candidates.clear()
                state.negative_since = None
            state.last_observed = frame.observed_at
            if score is None or score < self.settings.fire_confidence_threshold:
                response = self._negative(state, frame, now, detections, score)
            else:
                response = self._positive(state, frame, now, detections, score, gap, image)
            state.responses[frame.frame_id] = response.model_copy(deep=True)
            if len(state.responses) > REPLAY_CACHE_SIZE:
                state.responses.popitem(last=False)
            return response

    def _negative(
        self,
        state: CameraState,
        frame: FireFrame,
        now: datetime,
        detections: list[FireDetection],
        score: float | None,
    ) -> FireResponse:
        state.candidates.clear()
        if state.confirmed:
            state.negative_since = state.negative_since or frame.observed_at
            if (
                frame.observed_at - state.negative_since
            ).total_seconds() >= self.settings.fire_clear_seconds:
                state.confirmed = None
                state.negative_since = None
        return self.response(
            frame,
            now,
            "NEGATIVE" if score is None else "BELOW_THRESHOLD",
            detections=detections,
            max_confidence=score,
        )

    def _matches_previous_region(
        self, previous_boxes: list[FireBoundingBox], current_boxes: list[FireBoundingBox]
    ) -> bool:
        min_iou = self.settings.fire_min_association_iou
        if min_iou <= 0.0 or not previous_boxes or not current_boxes:
            return True
        padding = self.settings.fire_association_box_padding
        return any(
            expanded_box_iou(prev_box, curr_box, padding) >= min_iou
            for prev_box in previous_boxes
            for curr_box in current_boxes
        )

    def _passes_confirmation_gates(self, evidence: list[QualifiedFrame]) -> bool:
        if len(evidence) < self.settings.fire_min_consecutive_frames:
            return False
        effective_peak = max(
            self.settings.fire_confidence_threshold,
            self.settings.fire_peak_confidence_threshold,
        )
        peak_score = max(item.score for item in evidence)
        if peak_score < effective_peak:
            return False
        return self._passes_static_suppression(evidence, peak_score)

    def _passes_static_suppression(self, evidence: list[QualifiedFrame], peak_score: float) -> bool:
        if (
            not self.settings.fire_static_suppression_enabled
            or self.settings.fire_min_temporal_motion <= 0.0
            or peak_score >= self.settings.fire_static_bypass_confidence
        ):
            return True
        thumbs = [item.motion_thumb for item in evidence if item.motion_thumb is not None]
        if len(thumbs) != len(evidence):
            return True
        boxes = [box for item in evidence for box in item.boxes]
        motion = compute_region_temporal_motion(thumbs, boxes)
        if motion is None:
            return True
        return motion >= self.settings.fire_min_temporal_motion

    def _active_episode_response(
        self,
        state: CameraState,
        frame: FireFrame,
        now: datetime,
        detections: list[FireDetection],
        score: float,
    ) -> FireResponse:
        assert state.confirmed is not None
        frozen_evidence = state.confirmed.model_dump(
            exclude={
                "camera_slug",
                "source_session_id",
                "frame_id",
                "observed_at",
                "processed_at",
                "reason",
                "detections",
                "max_confidence",
                "model_version",
                "required_frames",
                "window_seconds",
                "max_frame_gap_seconds",
                "threshold_used",
            }
        )
        return self.response(
            frame,
            now,
            "ACTIVE_EPISODE",
            **frozen_evidence,
            detections=detections,
            max_confidence=score,
        )

    def _positive(
        self,
        state: CameraState,
        frame: FireFrame,
        now: datetime,
        detections: list[FireDetection],
        score: float,
        gap: bool,
        image: np.ndarray | None,
    ) -> FireResponse:
        state.negative_since = None
        if state.confirmed:
            return self._active_episode_response(state, frame, now, detections, score)

        before = len(state.candidates)
        state.candidates = [
            item
            for item in state.candidates
            if (frame.observed_at - item.frame.observed_at).total_seconds()
            <= self.settings.fire_confirmation_window_seconds
        ]
        reason: FireReason = "FRAME_GAP" if gap else "INSUFFICIENT_FRAMES"
        if len(state.candidates) < before:
            reason = "WINDOW_EXPIRED"

        qualifying_boxes = [
            item.bounding_box
            for item in detections
            if item.confidence >= self.settings.fire_confidence_threshold
        ]
        if state.candidates and not self._matches_previous_region(
            state.candidates[-1].boxes, qualifying_boxes
        ):
            state.candidates.clear()

        thumb = (
            build_motion_thumbnail(image) if self.settings.fire_static_suppression_enabled else None
        )
        state.candidates.append(
            QualifiedFrame(
                frame=frame,
                score=score,
                boxes=qualifying_boxes,
                motion_thumb=thumb,
            )
        )
        evidence = state.candidates[-self.settings.fire_min_consecutive_frames :]
        confirmed = self._passes_confirmation_gates(evidence)
        first_at = evidence[0].frame.observed_at
        identity = json.dumps(
            [frame.camera_slug, frame.source_session_id, canonical_timestamp(first_at)],
            separators=(",", ":"),
            ensure_ascii=False,
        )
        response = self.response(
            frame,
            now,
            "CONFIRMED" if confirmed else reason,
            detections=detections,
            max_confidence=score,
            confirmed=confirmed,
            consecutive_frames=len(evidence),
            episode_id=uuid5(NAMESPACE_URL, identity),
            first_qualified_at=first_at,
            confirmed_at=frame.observed_at if confirmed else None,
            qualifying_frame_ids=[item.frame.frame_id for item in evidence],
            qualifying_frame_timestamps=[item.frame.observed_at for item in evidence],
            incident_confidence=min(item.score for item in evidence) if confirmed else None,
        )
        if confirmed:
            state.confirmed = response.model_copy(deep=True)
            state.candidates.clear()
        return response
