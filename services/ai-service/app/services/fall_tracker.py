"""State machine va temporal tracking cho te nga (M2a - US-16 / US-17).

Quan ly state per (cameraSlug, sourceSessionId, trackId):
- MONITORING -> CANDIDATE -> CONFIRMED / CANCELLED.
- Ring buffer 10 frame hop le truoc frame hien tai.
- Tinh centerDropRatio va torsoAngleDeg < 30 do.
- 5 giay grace period khi mat pose (AC16-3).
- Dung day (torsoAngleDeg >= 60 do) -> CANCELLED (RECOVERED).
- episodeId on dinh sinh bang UUIDv5.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from statistics import median

from app.config import get_settings
from app.services.pose_geometry import (
    NormalizedKeypoint,
    PoseGeometry,
    calculate_center_drop_ratio,
    calculate_motion_score,
)

logger = logging.getLogger(__name__)

# UUIDv5 URL namespace chuan RFC 4122
NAMESPACE_URL = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")


@dataclass
class PoseObservation:
    """Ban ghi mot quan sat pose hop le."""

    frame_id: str | None
    observed_at: datetime
    geometry: PoseGeometry
    keypoints: Sequence[NormalizedKeypoint]


class FallTracker:
    """State machine theo doi pose cua mot track theo thoi gian."""

    def __init__(
        self,
        camera_slug: str,
        source_session_id: str,
        track_id: str,
    ) -> None:
        self.camera_slug = camera_slug
        self.source_session_id = source_session_id
        self.track_id = track_id

        self.settings = get_settings()

        # State machine
        self.state: str = "MONITORING"
        self.reason: str = "NORMAL_POSTURE"

        # History buffer: luu cac frame hop le trong khoang thoi gian fall_history_max_seconds
        self.history: deque[PoseObservation] = deque(
            maxlen=max(50, self.settings.fall_history_frame_count * 5)
        )

        # Baseline dong bang khi tao candidate
        self.baseline_scale_px: float = 0.0
        self.baseline_center_y_px: float = 0.0
        self.baseline_torso_length_px: float = 0.0

        # Candidate identity & timestamps
        self.episode_id: str | None = None
        self.candidate_started_at: datetime | None = None
        self.confirmed_at: datetime | None = None
        self.last_valid_pose_at: datetime | None = None

        # Tracking timers
        self.immobile_seconds: float = 0.0
        self.missing_pose_seconds: float = 0.0
        self.last_observation: PoseObservation | None = None
        self.last_frame_at: datetime | None = None
        self.seen_frame_ids: deque[str] = deque(maxlen=256)
        self._lock = threading.RLock()

    def _generate_episode_id(self, candidate_time: datetime) -> str:
        """Tao episodeId on dinh bang UUIDv5 theo contract."""
        iso_str = candidate_time.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        name_array = [self.camera_slug, self.source_session_id, self.track_id, iso_str]
        name_json = json.dumps(name_array, separators=(",", ":"))
        return str(uuid.uuid5(NAMESPACE_URL, name_json))

    def evaluate_frame(
        self,
        observed_at: datetime,
        frame_id: str | None,
        keypoints: Sequence[NormalizedKeypoint] | None,
        geometry: PoseGeometry | None,
        pose_available: bool,
        reason: str,
        in_rest_area: bool = False,
    ) -> dict:
        """Xu ly mot frame moi va cap nhat state machine."""
        with self._lock:
            return self._evaluate_frame(
                observed_at, frame_id, keypoints, geometry, pose_available, reason, in_rest_area
            )

    def _evaluate_frame(
        self,
        observed_at: datetime,
        frame_id: str | None,
        keypoints: Sequence[NormalizedKeypoint] | None,
        geometry: PoseGeometry | None,
        pose_available: bool,
        reason: str,
        in_rest_area: bool,
    ) -> dict:
        # Reject replays before any state, history or recovery mutation.
        if (self.last_frame_at is not None and observed_at <= self.last_frame_at) or (
            frame_id is not None and frame_id in self.seen_frame_ids
        ):
            return self._build_result(
                observed_at, frame_id, geometry, pose_available, self.reason, is_replay=True
            )
        self.last_frame_at = observed_at
        if frame_id is not None:
            self.seen_frame_ids.append(frame_id)

        if in_rest_area:
            return self._handle_in_rest_area(observed_at, frame_id, geometry, pose_available)

        if self.state == "CONFIRMED":
            return self._handle_confirmed_state(observed_at, frame_id, geometry, pose_available)

        if not pose_available or geometry is None or keypoints is None:
            return self._handle_missing_pose(observed_at, frame_id, reason)

        return self._handle_valid_pose(observed_at, frame_id, keypoints, geometry)

    def _handle_in_rest_area(
        self,
        observed_at: datetime,
        frame_id: str | None,
        geometry: PoseGeometry | None,
        pose_available: bool,
    ) -> dict:
        self.history.clear()
        self.last_observation = None
        if self.state == "CANDIDATE":
            logger.info("Track %s entered REST_AREA -> cancel candidate", self.track_id)
            self.state = "CANCELLED"
            self.reason = "REST_AREA"
            self.immobile_seconds = 0.0
        return self._build_result(
            observed_at=observed_at,
            frame_id=frame_id,
            geometry=geometry,
            pose_available=pose_available,
            reason="REST_AREA",
            is_replay=False,
        )

    def _handle_confirmed_state(
        self,
        observed_at: datetime,
        frame_id: str | None,
        geometry: PoseGeometry | None,
        pose_available: bool,
    ) -> dict:
        if (
            pose_available
            and geometry
            and geometry.torso_angle_deg >= self.settings.fall_recovery_angle_deg
        ):
            logger.info(
                "Track %s recovered from confirmed fall -> re-arm MONITORING", self.track_id
            )
            self.state = "MONITORING"
            self.reason = "RECOVERED"
            self.episode_id = None
            self.candidate_started_at = None
            self.confirmed_at = None
            self.immobile_seconds = 0.0
            self.history.clear()
            return self._build_result(
                observed_at=observed_at,
                frame_id=frame_id,
                geometry=geometry,
                pose_available=True,
                reason="RECOVERED",
                is_replay=False,
            )

        return self._build_result(
            observed_at=observed_at,
            frame_id=frame_id,
            geometry=geometry,
            pose_available=pose_available,
            reason="IMMOBILE_CONFIRMED",
            is_replay=True,
        )

    def _handle_missing_pose(
        self,
        observed_at: datetime,
        frame_id: str | None,
        reason: str,
    ) -> dict:
        # A missing observation always breaks the continuous immobility interval.
        self.immobile_seconds = 0.0
        self.last_observation = None
        # History contains valid observations, not a count of consecutive requests.
        # Preserve a short quality dropout; age and gap limits still invalidate old
        # baselines on the next valid frame. Never preserve the immobility timer.
        self.reason = reason or "NO_POSE"
        if self.state == "CANDIDATE":
            if self.last_valid_pose_at:
                elapsed = (observed_at - self.last_valid_pose_at).total_seconds()
                self.missing_pose_seconds = max(0.0, elapsed)
            else:
                self.missing_pose_seconds = 0.0

            if self.missing_pose_seconds >= self.settings.fall_missing_pose_grace_seconds:
                logger.info(
                    "Track %s missing pose > %ss -> CANCELLED",
                    self.track_id,
                    self.settings.fall_missing_pose_grace_seconds,
                )
                self.state = "CANCELLED"
                self.reason = "MISSING_TIMEOUT"
                self.immobile_seconds = 0.0
            else:
                self.reason = reason or "NO_POSE"

        return self._build_result(
            observed_at=observed_at,
            frame_id=frame_id,
            geometry=None,
            pose_available=False,
            reason=self.reason,
            is_replay=False,
        )

    def _handle_valid_pose(
        self,
        observed_at: datetime,
        frame_id: str | None,
        keypoints: Sequence[NormalizedKeypoint],
        geometry: PoseGeometry,
    ) -> dict:
        dt_seconds = 0.0
        if self.last_valid_pose_at:
            dt_seconds = max(0.0, (observed_at - self.last_valid_pose_at).total_seconds())

        if dt_seconds > self.settings.fall_max_valid_frame_gap_seconds:
            logger.debug(
                "[POSE_CONTINUITY_RESET] camera=%s track=%s gap=%.3fs max=%.3fs",
                self.camera_slug,
                self.track_id,
                dt_seconds,
                self.settings.fall_max_valid_frame_gap_seconds,
            )
            self.immobile_seconds = 0.0
            self.last_observation = None
            if dt_seconds > self.settings.fall_history_max_seconds:
                self.history.clear()
        if (
            self.state == "CANDIDATE"
            and dt_seconds >= self.settings.fall_missing_pose_grace_seconds
        ):
            self.state = "CANCELLED"
            self.reason = "MISSING_TIMEOUT"
            return self._build_result(
                observed_at, frame_id, geometry, True, self.reason, is_replay=False
            )

        self.last_valid_pose_at = observed_at
        self.missing_pose_seconds = 0.0

        current_obs = PoseObservation(
            frame_id=frame_id,
            observed_at=observed_at,
            geometry=geometry,
            keypoints=keypoints,
        )

        if self.state == "CANCELLED":
            self.state = "MONITORING"
            self.reason = "NORMAL_POSTURE"
            self.immobile_seconds = 0.0
            self.history.clear()

        if self.state == "CANDIDATE":
            return self._step_candidate_state(
                observed_at, frame_id, keypoints, geometry, current_obs, dt_seconds
            )

        return self._step_monitoring_state(observed_at, frame_id, geometry, current_obs)

    def _step_candidate_state(
        self,
        observed_at: datetime,
        frame_id: str | None,
        keypoints: Sequence[NormalizedKeypoint],
        geometry: PoseGeometry,
        current_obs: PoseObservation,
        dt_seconds: float,
    ) -> dict:
        effective_angle = (
            min(geometry.torso_angle_deg, geometry.torso_angle_3d_deg)
            if geometry.torso_angle_3d_deg is not None
            else geometry.torso_angle_deg
        )
        if effective_angle >= self.settings.fall_recovery_angle_deg:
            logger.info(
                "Track %s stood up (angle=%.1f, angle_3d=%.1f) -> CANCELLED (RECOVERED)",
                self.track_id,
                geometry.torso_angle_deg,
                geometry.torso_angle_3d_deg if geometry.torso_angle_3d_deg is not None else 0.0,
            )
            self.state = "CANCELLED"
            self.reason = "RECOVERED"
            self.immobile_seconds = 0.0
            return self._build_result(
                observed_at=observed_at,
                frame_id=frame_id,
                geometry=geometry,
                pose_available=True,
                reason=self.reason,
                is_replay=False,
            )

        motion_score: float | None = None
        frozen_drop = (
            (geometry.center_y_px - self.baseline_center_y_px) / self.baseline_scale_px
            if self.baseline_scale_px > 0
            else 0.0
        )
        torso_shrink = (
            geometry.torso_length_px / max(10.0, self.baseline_torso_length_px)
            if self.baseline_torso_length_px > 0
            else 1.0
        )
        is_abnormal = (
            min(geometry.torso_angle_deg, geometry.torso_angle_3d_deg)
            < self.settings.fall_torso_angle_threshold_deg
            or torso_shrink < self.settings.fall_torso_shrink_ratio
            or geometry.aspect_ratio < self.settings.fall_aspect_ratio_threshold
        ) and frozen_drop >= self.settings.fall_center_drop_ratio
        if is_abnormal and self.last_observation is not None:
            prev_obs = self.last_observation
            prev_shrink = (
                prev_obs.geometry.torso_length_px / max(10.0, self.baseline_torso_length_px)
                if self.baseline_torso_length_px > 0
                else 1.0
            )
            prev_abnormal = (
                min(prev_obs.geometry.torso_angle_deg, prev_obs.geometry.torso_angle_3d_deg)
                < self.settings.fall_torso_angle_threshold_deg
                or prev_shrink < self.settings.fall_torso_shrink_ratio
                or prev_obs.geometry.aspect_ratio < self.settings.fall_aspect_ratio_threshold
            ) and (
                prev_obs.geometry.center_y_px - self.baseline_center_y_px
            ) / self.baseline_scale_px >= self.settings.fall_center_drop_ratio
            if prev_abnormal:
                motion_score = calculate_motion_score(
                    current_keypoints=keypoints,
                    previous_keypoints=prev_obs.keypoints,
                    image_width=geometry.image_width,
                    image_height=geometry.image_height,
                    dt_seconds=dt_seconds,
                    baseline_scale_px=self.baseline_scale_px,
                    min_visibility=self.settings.pose_min_visibility,
                    max_gap_seconds=self.settings.fall_max_valid_frame_gap_seconds,
                )

            if (
                motion_score is not None
                and motion_score < self.settings.fall_motion_speed_threshold
            ):
                self.immobile_seconds = round(self.immobile_seconds + dt_seconds, 6)
                logger.debug(
                    "Track %s CANDIDATE: immobile=%.1fs / %.1fs (angle=%.1f)",
                    self.track_id,
                    self.immobile_seconds,
                    self.settings.fall_immobility_seconds,
                    geometry.torso_angle_deg,
                )
                if self.immobile_seconds > self.settings.fall_immobility_seconds:
                    self.state = "CONFIRMED"
                    self.reason = "IMMOBILE_CONFIRMED"
                    self.confirmed_at = observed_at
                    logger.info(
                        "Track %s fall CONFIRMED (>%ss immobile)",
                        self.track_id,
                        self.settings.fall_immobility_seconds,
                    )
                else:
                    self.reason = "FALL_CANDIDATE"
            else:
                self.immobile_seconds = 0.0
                self.reason = "FALL_CANDIDATE"
        else:
            self.immobile_seconds = 0.0
            self.reason = "FALL_CANDIDATE"

        # Max candidate duration guard (AC17-2)
        if self.candidate_started_at:
            cand_dur = (observed_at - self.candidate_started_at).total_seconds()
            if cand_dur > self.settings.fall_candidate_max_seconds:
                logger.info(
                    "Track %s candidate timed out (>%ss)",
                    self.track_id,
                    self.settings.fall_candidate_max_seconds,
                )
                self.state = "CANCELLED"
                self.reason = "CANDIDATE_TIMEOUT"
                self.immobile_seconds = 0.0

        self.last_observation = current_obs
        return self._build_result(
            observed_at=observed_at,
            frame_id=frame_id,
            geometry=geometry,
            pose_available=True,
            reason=self.reason,
            is_replay=False,
            motion_score=motion_score,
        )

    def _step_monitoring_state(
        self,
        observed_at: datetime,
        frame_id: str | None,
        geometry: PoseGeometry,
        current_obs: PoseObservation,
    ) -> dict:
        center_drop_ratio = 0.0
        while (
            self.history
            and (observed_at - self.history[0].observed_at).total_seconds()
            > self.settings.fall_history_max_seconds
        ):
            self.history.popleft()
        if len(self.history) >= self.settings.fall_history_frame_count:
            history_centers = [obs.geometry.center_y_px for obs in self.history]
            history_heights = [obs.geometry.bbox_height_px for obs in self.history]
            history_torso_lens = [obs.geometry.torso_length_px for obs in self.history]
            scale_prev = median(history_heights)
            prev_torso_len = median(history_torso_lens) if history_torso_lens else 0.0

            center_drop_ratio = calculate_center_drop_ratio(
                current_center_y_px=geometry.center_y_px,
                history_center_y_px=history_centers,
                baseline_bbox_height_px=scale_prev,
            )

            torso_shrink_ratio = (
                geometry.torso_length_px / max(10.0, prev_torso_len) if prev_torso_len > 0 else 1.0
            )

            # Dieu kien A: Nga ngang hoac goc 3D (giu nguyen chuan AC16-2 < 30 do va drop >= 0.20)
            is_angle_fall = (
                min(geometry.torso_angle_deg, geometry.torso_angle_3d_deg)
                < self.settings.fall_torso_angle_threshold_deg
                and center_drop_ratio >= self.settings.fall_center_drop_ratio
            )

            # Dieu kien B: Nga doc camera (than co ngan > 45% hoac bbox bep va co roi trong tam)
            is_axial_fall = (
                torso_shrink_ratio < self.settings.fall_torso_shrink_ratio
                or geometry.aspect_ratio < self.settings.fall_aspect_ratio_threshold
            ) and center_drop_ratio >= self.settings.fall_center_drop_ratio

            if is_angle_fall or is_axial_fall:
                self.state = "CANDIDATE"
                self.reason = "FALL_CANDIDATE" if is_angle_fall else "AXIAL_FALL_CANDIDATE"
                self.candidate_started_at = observed_at
                self.baseline_scale_px = max(10.0, scale_prev)
                self.baseline_center_y_px = median(history_centers)
                self.baseline_torso_length_px = max(10.0, prev_torso_len)
                self.episode_id = self._generate_episode_id(observed_at)
                self.immobile_seconds = 0.0
                logger.info(
                    "Track %s entered CANDIDATE (%s): angle=%.1f, angle_3d=%.1f, drop=%.2f, shrink=%.2f",
                    self.track_id,
                    self.reason,
                    geometry.torso_angle_deg,
                    geometry.torso_angle_3d_deg,
                    center_drop_ratio,
                    torso_shrink_ratio,
                )
            else:
                self.reason = "NORMAL_POSTURE"
        else:
            self.reason = "HISTORY_INSUFFICIENT"

        self.history.append(current_obs)
        self.last_observation = current_obs

        return self._build_result(
            observed_at=observed_at,
            frame_id=frame_id,
            geometry=geometry,
            pose_available=True,
            reason=self.reason,
            is_replay=False,
            center_drop_ratio=center_drop_ratio
            if len(self.history) >= self.settings.fall_history_frame_count
            else 0.0,
        )

    def _build_result(
        self,
        observed_at: datetime,
        frame_id: str | None,
        geometry: PoseGeometry | None,
        pose_available: bool,
        reason: str,
        is_replay: bool,
        center_drop_ratio: float | None = None,
        motion_score: float | None = None,
    ) -> dict:
        now_utc = datetime.now(UTC).isoformat()

        drop_val = center_drop_ratio
        if (
            drop_val is None
            and self.state in ("CANDIDATE", "CONFIRMED")
            and geometry
            and self.baseline_scale_px > 0
        ):
            drop_val = round(
                (geometry.center_y_px - self.baseline_center_y_px) / self.baseline_scale_px, 4
            )

        confidence_val: float | None = 1.0 if self.state == "CONFIRMED" else None

        logger.debug(
            "[POSE_TRACK] camera=%s track=%s frame=%s time=%s state=%s reason=%s "
            "history=%d/%d pose=%s angle=%s drop=%s motion=%s immobile=%.3fs",
            self.camera_slug,
            self.track_id,
            frame_id,
            observed_at.isoformat(),
            self.state,
            reason,
            len(self.history),
            self.settings.fall_history_frame_count,
            pose_available,
            geometry.torso_angle_deg if geometry else None,
            drop_val,
            motion_score,
            self.immobile_seconds,
        )

        return {
            "trackId": self.track_id,
            "cameraSlug": self.camera_slug,
            "sourceSessionId": self.source_session_id,
            "frameId": frame_id,
            "observedAt": observed_at.isoformat(),
            "state": self.state,
            "poseAvailable": pose_available,
            "reason": reason,
            "isReplay": is_replay,
            "episodeId": self.episode_id,
            "candidateStartedAt": self.candidate_started_at.isoformat()
            if self.candidate_started_at
            else None,
            "confirmedAt": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "confidence": confidence_val,
            "confidencePolicyVersion": "fall-rule-evidence-v1",
            "torsoAngleDeg": (
                min(geometry.torso_angle_deg, geometry.torso_angle_3d_deg)
                if geometry and geometry.torso_angle_3d_deg is not None
                else (geometry.torso_angle_deg if geometry else None)
            ),
            "aspectRatio": geometry.aspect_ratio if geometry else None,
            "centerHeight": geometry.center_height if geometry else None,
            "centerDropRatio": drop_val,
            "motionScore": motion_score,
            "immobileSeconds": round(self.immobile_seconds, 6),
            "thresholdSeconds": int(self.settings.fall_immobility_seconds),
            "missingPoseSeconds": round(self.missing_pose_seconds, 2),
            "keypointsDetected": geometry.keypoints_detected if geometry else 0,
            "boundingBox": {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0} if geometry else None,
            "modelVersion": self.settings.pose_model_version,
            "processedAt": now_utc,
            "error": None,
        }

    def sweep(self, now: datetime) -> bool:
        with self._lock:
            return self._sweep(now)

    def _sweep(self, now: datetime) -> bool:
        if self.state == "CANDIDATE":
            if self.last_valid_pose_at:
                elapsed = (now - self.last_valid_pose_at).total_seconds()
                if elapsed >= self.settings.fall_missing_pose_grace_seconds:
                    logger.info(
                        "Track %s swept: missing pose > %ss -> CANCELLED",
                        self.track_id,
                        self.settings.fall_missing_pose_grace_seconds,
                    )
                    self.state = "CANCELLED"
                    self.reason = "MISSING_TIMEOUT"
                    self.immobile_seconds = 0.0

            if self.candidate_started_at:
                cand_elapsed = (now - self.candidate_started_at).total_seconds()
                if cand_elapsed > self.settings.fall_candidate_max_seconds:
                    self.state = "CANCELLED"
                    self.reason = "CANDIDATE_TIMEOUT"
                    self.immobile_seconds = 0.0

        if self.last_valid_pose_at:
            idle_seconds = (now - self.last_valid_pose_at).total_seconds()
            if idle_seconds > self.settings.pose_track_ttl_seconds:
                return True

        return False
