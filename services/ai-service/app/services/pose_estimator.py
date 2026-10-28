"""Pose Estimator wrapper cho Google MediaPipe Tasks Pose Landmarker.

Chay tren CPU theo che do RunningMode.IMAGE, ap dung cho crop nguoi
nhung transform 33 landmarks nguoc ve he toa do pixel cua anh goc.
"""

from __future__ import annotations

import logging
import math
import threading
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.config import get_settings
from app.services.pose_geometry import (
    NormalizedKeypoint,
    PoseGeometry,
    calculate_pose_geometry,
)

logger = logging.getLogger(__name__)


class PoseEstimator:
    """Wrapper quan ly instance PoseLandmarker cua MediaPipe Tasks."""

    _instance: PoseEstimator | None = None
    _lock = threading.Lock()

    def __init__(self, model_path: str | Path | None = None) -> None:
        settings = get_settings()
        resolved_path = Path(model_path or settings.pose_model_path)
        if not resolved_path.is_absolute():
            # Tim tu project root hoac thu muc services/ai-service hoac cac thu muc cha
            for base in [Path.cwd(), *Path(__file__).resolve().parents]:
                candidates = [
                    base / resolved_path,
                    base / "models" / resolved_path.name,
                    base / "artifacts" / "models" / resolved_path.name,
                    base / "artifacts" / "ci-models" / resolved_path.name,
                    base / "ci-models" / resolved_path.name,
                ]
                found = next((c for c in candidates if c.exists()), None)
                if found:
                    resolved_path = found
                    break

        if not resolved_path.exists():
            raise FileNotFoundError(
                f"Pose model khong ton tai tai {resolved_path}. "
                "Hay chay fetch_models.py de tai ve truoc."
            )

        self._model_path = str(resolved_path)
        self._min_visibility = settings.pose_min_visibility
        self._padding_ratio = settings.pose_roi_padding_ratio
        self._min_association_iou = settings.pose_min_association_iou
        self._infer_lock = threading.Lock()

        base_options = mp_python.BaseOptions(model_asset_path=self._model_path)
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_poses=2,
            min_pose_detection_confidence=0.3,
            min_pose_presence_confidence=0.3,
            min_tracking_confidence=0.3,
            output_segmentation_masks=False,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        logger.info("PoseLandmarker khoi tao thanh cong voi model %s", self._model_path)

    @classmethod
    def get_instance(cls) -> PoseEstimator:
        """Singleton instance cho PoseEstimator."""
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton (phuc vu testing/re-init)."""
        with cls._lock:
            if cls._instance is not None:
                cls._instance.close()
                cls._instance = None

    def close(self) -> None:
        """Giai phong tai nguyen MediaPipe Landmarker."""
        if hasattr(self, "_landmarker") and self._landmarker:
            try:
                self._landmarker.close()
            except Exception as e:
                logger.warning("Loi khi dong PoseLandmarker: %s", e)

    def _crop_roi(
        self,
        image_bgr: np.ndarray,
        person_bbox: dict[str, float] | None,
        img_w: int,
        img_h: int,
    ) -> tuple[np.ndarray, int, int, int, int, float, float] | None:
        """Crop vung ROI nguoi voi padding 10%."""
        if person_bbox is None:
            return image_bgr, img_w, img_h, 0, 0, 1.0, 1.0

        bx = person_bbox.get("x", 0.0)
        by = person_bbox.get("y", 0.0)
        bw = person_bbox.get("width", 1.0)
        bh = person_bbox.get("height", 1.0)

        pad_w = bw * self._padding_ratio
        pad_h = bh * self._padding_ratio

        x_min = max(0, int((bx - pad_w) * img_w))
        y_min = max(0, int((by - pad_h) * img_h))
        x_max = min(img_w, int((bx + bw + pad_w) * img_w))
        y_max = min(img_h, int((by + bh + pad_h) * img_h))

        crop_w = x_max - x_min
        crop_h = y_max - y_min
        if crop_w <= 0 or crop_h <= 0:
            return None

        crop_bgr = image_bgr[y_min:y_max, x_min:x_max]
        return crop_bgr, crop_w, crop_h, x_min, y_min, bw, bh

    def _fallback_full_frame(
        self,
        image_bgr: np.ndarray,
        img_w: int,
        img_h: int,
        effective_bbox_w: float,
        effective_bbox_h: float,
        person_bbox: dict[str, float],
    ) -> tuple[list[NormalizedKeypoint], PoseGeometry] | None:
        """Fallback nhan dien tren toan bo anh neu crop ROI bi hut keypoints."""
        full_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        mp_full = mp.Image(image_format=mp.ImageFormat.SRGB, data=full_rgb)
        with self._infer_lock:
            full_res = self._landmarker.detect(mp_full)
        fallback_kps, _reason = self._select_pose(
            full_res.pose_landmarks, person_bbox, img_w, img_h, img_w, img_h, 0, 0
        )
        if fallback_kps is None:
            return None
        fallback_geom = calculate_pose_geometry(
            keypoints=fallback_kps,
            image_width=img_w,
            image_height=img_h,
            bbox_width=effective_bbox_w,
            bbox_height=effective_bbox_h,
            min_visibility=self._min_visibility,
        )
        if fallback_geom is None:
            return None
        return fallback_kps, fallback_geom

    def _select_pose(
        self,
        poses: list,
        person_bbox: dict[str, float] | None,
        img_w: int,
        img_h: int,
        crop_w: int,
        crop_h: int,
        x_min: int,
        y_min: int,
    ) -> tuple[list[NormalizedKeypoint] | None, str]:
        """Reject ambiguous assignments, clipped vital joints and unrelated full-frame poses."""
        if not poses:
            return None, "NO_POSE"
        if person_bbox is None and len(poses) != 1:
            return None, "AMBIGUOUS_POSE"
        matches = []
        reason = "POSE_ASSOCIATION_FAILED"
        for landmarks in poses:
            if len(landmarks) < 33:
                reason = "INCOMPLETE_KEYPOINTS"
                continue
            vital = [landmarks[i] for i in (11, 12, 23, 24)]
            if any(not all(math.isfinite(v) for v in (lm.x, lm.y, lm.visibility)) for lm in vital):
                reason = "LOW_VISIBILITY"
                continue

            has_left_pair = (
                landmarks[11].visibility >= self._min_visibility
                and landmarks[23].visibility >= self._min_visibility
            )
            has_right_pair = (
                landmarks[12].visibility >= self._min_visibility
                and landmarks[24].visibility >= self._min_visibility
            )
            has_both_shoulders = (
                landmarks[11].visibility >= self._min_visibility
                and landmarks[12].visibility >= self._min_visibility
            )
            has_both_hips = (
                landmarks[23].visibility >= self._min_visibility
                and landmarks[24].visibility >= self._min_visibility
            )

            if not (
                (has_left_pair or has_right_pair)
                or (
                    has_both_shoulders
                    and (
                        landmarks[23].visibility >= self._min_visibility
                        or landmarks[24].visibility >= self._min_visibility
                    )
                )
                or (
                    has_both_hips
                    and (
                        landmarks[11].visibility >= self._min_visibility
                        or landmarks[12].visibility >= self._min_visibility
                    )
                )
            ):
                reason = "LOW_VISIBILITY"
                continue
            kps = [
                NormalizedKeypoint(
                    x=(lm.x * crop_w + x_min) / img_w,
                    y=(lm.y * crop_h + y_min) / img_h,
                    z=float(lm.z),
                    visibility=float(lm.visibility),
                )
                for lm in landmarks
            ]
            if person_bbox is not None:
                visible = [
                    kp
                    for kp in kps
                    if math.isfinite(kp.x)
                    and math.isfinite(kp.y)
                    and math.isfinite(kp.visibility)
                    and kp.visibility >= self._min_visibility
                ]
                x1 = max(0.0, min(kp.x for kp in visible))
                y1 = max(0.0, min(kp.y for kp in visible))
                x2 = min(1.0, max(kp.x for kp in visible))
                y2 = min(1.0, max(kp.y for kp in visible))
                bx, by = person_bbox["x"], person_bbox["y"]
                bw, bh = person_bbox["width"], person_bbox["height"]
                intersection = max(0.0, min(x2, bx + bw) - max(x1, bx)) * max(
                    0.0, min(y2, by + bh) - max(y1, by)
                )
                union = max(0.0, x2 - x1) * max(0.0, y2 - y1) + bw * bh - intersection
                if union <= 0 or intersection / union < self._min_association_iou:
                    continue
            matches.append(kps)
        if len(matches) > 1:
            return None, "AMBIGUOUS_POSE"
        return (matches[0], "NORMAL_POSTURE") if matches else (None, reason)

    def estimate(
        self,
        image_bgr: np.ndarray,
        person_bbox: dict[str, float] | None = None,
    ) -> tuple[list[NormalizedKeypoint] | None, PoseGeometry | None, bool, str]:
        """Uoc luong pose nguoi tu anh BGR goc.

        Args:
            image_bgr: Anh camera goc dang BGR numpy array.
            person_bbox: Dictionary {'x': float, 'y': float, 'width': float, 'height': float}
                         chuan hoa trong khoang [0, 1].

        Returns:
            Tuple (keypoints, geometry, pose_available, reason)
        """
        img_h, img_w = image_bgr.shape[:2]
        if img_h == 0 or img_w == 0:
            return None, None, False, "EMPTY_IMAGE"

        crop_info = self._crop_roi(image_bgr, person_bbox, img_w, img_h)
        if crop_info is None:
            return None, None, False, "DEGENERATE_BBOX"

        crop_bgr, crop_w, crop_h, x_min, y_min, eff_w, eff_h = crop_info

        crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=crop_rgb)

        with self._infer_lock:
            result = self._landmarker.detect(mp_image)

        full_keypoints, reason = self._select_pose(
            result.pose_landmarks, person_bbox, img_w, img_h, crop_w, crop_h, x_min, y_min
        )
        if full_keypoints is None:
            if person_bbox is not None and reason != "AMBIGUOUS_POSE":
                fallback = self._fallback_full_frame(
                    image_bgr, img_w, img_h, eff_w, eff_h, person_bbox
                )
                if fallback is not None:
                    kps, geom = fallback
                    return kps, geom, True, "NORMAL_POSTURE"
            return None, None, False, reason

        geometry = calculate_pose_geometry(
            keypoints=full_keypoints,
            image_width=img_w,
            image_height=img_h,
            bbox_width=eff_w,
            bbox_height=eff_h,
            min_visibility=self._min_visibility,
        )

        if geometry is None and person_bbox is not None and (crop_w != img_w or crop_h != img_h):
            fallback = self._fallback_full_frame(image_bgr, img_w, img_h, eff_w, eff_h, person_bbox)
            if fallback is not None:
                kps, geom = fallback
                return kps, geom, True, "NORMAL_POSTURE"

        if geometry is None:
            return full_keypoints, None, False, "LOW_VISIBILITY"

        return full_keypoints, geometry, True, "NORMAL_POSTURE"
