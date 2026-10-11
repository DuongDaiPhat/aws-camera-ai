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
import uuid
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

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

        # History buffer: toi da 10 frame hop le truoc do
        self.history: deque[PoseObservation] = deque(maxlen=self.settings.fall_history_frame_count)

        # Baseline dong bang khi tao candidate
        self.baseline_scale_px: float = 0.0
        self.baseline_center_y_px: float = 0.0

        # Candidate identity & timestamps
        self.episode_id: str | None = None
        self.candidate_started_at: datetime | None = None
        self.confirmed_at: datetime | None = None
        self.last_valid_pose_at: datetime | None = None

        # Tracking timers
        self.immobile_seconds: float = 0.0
        self.missing_pose_seconds: float = 0.0
        self.last_observation: PoseObservation | None = None

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
        if self.state == "CANDIDATE":
            if self.last_valid_pose_at:
                elapsed = (observed_at - self.last_valid_pose_at).total_seconds()
                self.missing_pose_seconds = max(0.0, elapsed)
            else:
                self.missing_pose_seconds = 0.0

            if self.missing_pose_seconds > self.settings.fall_missing_pose_grace_seconds:
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
        if geometry.torso_angle_deg >= self.settings.fall_recovery_angle_deg:
            logger.info(
                "Track %s stood up (angle=%.1f) -> CANCELLED (RECOVERED)",
                self.track_id,
                geometry.torso_angle_deg,
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

        if geometry.torso_angle_deg < self.settings.fall_torso_angle_threshold_deg:
            motion_score: float | None = None
            if self.last_observation:
                img_w = (
                    int(geometry.bbox_width_px / geometry.aspect_ratio)
                    if geometry.aspect_ratio > 0
                    else 1920
                )
                motion_score = calculate_motion_score(
                    current_keypoints=keypoints,
                    previous_keypoints=self.last_observation.keypoints,
                    image_width=img_w,
                    image_height=int(geometry.bbox_height_px),
                    dt_seconds=dt_seconds,
                    baseline_scale_px=self.baseline_scale_px,
                    min_visibility=self.settings.pose_min_visibility,
                    max_gap_seconds=self.settings.fall_max_valid_frame_gap_seconds,
                )

            is_moving = False
            if motion_score is not None:
                is_moving = motion_score >= self.settings.fall_motion_speed_threshold
            elif self.last_observation and dt_seconds > 0 and self.baseline_scale_px > 0:
                center_disp = abs(geometry.center_y_px - self.last_observation.geometry.center_y_px)
                center_speed = center_disp / (self.baseline_scale_px * dt_seconds)
                is_moving = center_speed >= self.settings.fall_motion_speed_threshold

            if not is_moving:
                self.immobile_seconds += dt_seconds
                logger.info(
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
                self.immobile_seconds = max(0.0, self.immobile_seconds - dt_seconds * 2)
                self.reason = "FALL_CANDIDATE"
        else:
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
        if len(self.history) >= self.settings.fall_history_frame_count:
            history_centers = [obs.geometry.center_y_px for obs in self.history]
            history_heights = [obs.geometry.bbox_height_px for obs in self.history]
            sorted_h = sorted(history_heights)
            scale_prev = sorted_h[len(sorted_h) // 2]

            center_drop_ratio = calculate_center_drop_ratio(
                current_center_y_px=geometry.center_y_px,
                history_center_y_px=history_centers,
                baseline_bbox_height_px=scale_prev,
            )

            is_sudden_drop = (
                geometry.torso_angle_deg < self.settings.fall_torso_angle_threshold_deg
                and center_drop_ratio >= self.settings.fall_center_drop_ratio
            )

            recent_history = list(self.history)[-self.settings.fall_prone_consecutive_frames :]
            recent_prone_count = sum(
                1
                for obs in recent_history
                if obs.geometry.torso_angle_deg < self.settings.fall_torso_angle_threshold_deg
            )
            is_persistent_prone = (
                recent_prone_count >= self.settings.fall_prone_consecutive_frames
                and geometry.torso_angle_deg < self.settings.fall_torso_angle_threshold_deg
            )

            if is_sudden_drop or is_persistent_prone:
                self.state = "CANDIDATE"
                self.reason = "FALL_CANDIDATE" if is_sudden_drop else "PRONE_CANDIDATE"
                self.candidate_started_at = observed_at
                self.baseline_scale_px = max(10.0, scale_prev)
                self.baseline_center_y_px = sorted(history_centers)[len(history_centers) // 2]
                self.episode_id = self._generate_episode_id(observed_at)
                self.immobile_seconds = 0.0
                logger.info(
                    "Track %s entered CANDIDATE (%s): angle=%.1f, drop=%.2f",
                    self.track_id,
                    self.reason,
                    geometry.torso_angle_deg,
                    center_drop_ratio,
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
            "torsoAngleDeg": geometry.torso_angle_deg if geometry else None,
            "aspectRatio": geometry.aspect_ratio if geometry else None,
            "centerHeight": geometry.center_height if geometry else None,
            "centerDropRatio": drop_val,
            "motionScore": motion_score,
            "immobileSeconds": round(self.immobile_seconds, 2),
            "thresholdSeconds": int(self.settings.fall_immobility_seconds),
            "missingPoseSeconds": round(self.missing_pose_seconds, 2),
            "keypointsDetected": geometry.keypoints_detected if geometry else 0,
            "boundingBox": {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0} if geometry else None,
            "modelVersion": self.settings.pose_model_version,
            "processedAt": now_utc,
            "error": None,
        }

    def sweep(self, now: datetime) -> bool:
        if self.state == "CANDIDATE":
            if self.last_valid_pose_at:
                elapsed = (now - self.last_valid_pose_at).total_seconds()
                if elapsed > self.settings.fall_missing_pose_grace_seconds:
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
