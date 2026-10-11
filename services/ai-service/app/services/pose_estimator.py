"""Pose Estimator wrapper cho Google MediaPipe Tasks Pose Landmarker.

Chay tren CPU theo che do RunningMode.IMAGE, ap dung cho crop nguoi
nhung transform 33 landmarks nguoc ve he toa do pixel cua anh goc.
"""

from __future__ import annotations

import logging
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
                candidate = base / resolved_path
                if candidate.exists():
                    resolved_path = candidate
                    break
                alt_candidate = base / "models" / resolved_path.name
                if alt_candidate.exists():
                    resolved_path = alt_candidate
                    break

        if not resolved_path.exists():
            raise FileNotFoundError(
                f"Pose model khong ton tai tai {resolved_path}. "
                "Hay chay fetch_models.py de tai ve truoc."
            )

        self._model_path = str(resolved_path)
        self._min_visibility = settings.pose_min_visibility
        self._padding_ratio = settings.pose_roi_padding_ratio
        self._infer_lock = threading.Lock()

        base_options = mp_python.BaseOptions(model_asset_path=self._model_path)
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
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

        # Neu co bbox, crop voi padding 10%
        if person_bbox is not None:
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
                return None, None, False, "DEGENERATE_BBOX"

            crop_bgr = image_bgr[y_min:y_max, x_min:x_max]
            effective_bbox_w = bw
            effective_bbox_h = bh
        else:
            x_min, y_min = 0, 0
            crop_w, crop_h = img_w, img_h
            crop_bgr = image_bgr
            effective_bbox_w = 1.0
            effective_bbox_h = 1.0

        # Chuyen BGR sang RGB cho MediaPipe Image
        crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=crop_rgb)

        with self._infer_lock:
            result = self._landmarker.detect(mp_image)

        if not result.pose_landmarks or len(result.pose_landmarks) == 0:
            if person_bbox is not None:
                # Fallback: bbox quá hẹp, thử lại trên toàn bộ ảnh
                full_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
                mp_full = mp.Image(image_format=mp.ImageFormat.SRGB, data=full_rgb)
                with self._infer_lock:
                    result = self._landmarker.detect(mp_full)
                if not result.pose_landmarks or len(result.pose_landmarks) == 0:
                    return None, None, False, "NO_POSE"
                x_min, y_min = 0, 0
                crop_w, crop_h = img_w, img_h
            else:
                return None, None, False, "NO_POSE"

        raw_landmarks = result.pose_landmarks[0]
        if len(raw_landmarks) < 33:
            return None, None, False, "INCOMPLETE_KEYPOINTS"

        # Transform landmarks tu crop ve full-frame normalized coordinates
        full_keypoints: list[NormalizedKeypoint] = []
        for lm in raw_landmarks:
            px_in_crop = lm.x * crop_w
            py_in_crop = lm.y * crop_h
            px_in_full = px_in_crop + x_min
            py_in_full = py_in_crop + y_min

            norm_x = px_in_full / float(img_w)
            norm_y = py_in_full / float(img_h)
            visibility = float(getattr(lm, "visibility", 1.0) or 1.0)

            full_keypoints.append(
                NormalizedKeypoint(
                    x=norm_x,
                    y=norm_y,
                    z=float(lm.z),
                    visibility=visibility,
                )
            )

        # Tinh toan dac trung hinh hoc tren he toa do anh goc
        geometry = calculate_pose_geometry(
            keypoints=full_keypoints,
            image_width=img_w,
            image_height=img_h,
            bbox_width=effective_bbox_w,
            bbox_height=effective_bbox_h,
            min_visibility=self._min_visibility,
        )

        if geometry is None and person_bbox is not None and (crop_w != img_w or crop_h != img_h):
            # Fallback 2: crop bị mất hông/vai, thử lại trên toàn ảnh
            full_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            mp_full = mp.Image(image_format=mp.ImageFormat.SRGB, data=full_rgb)
            with self._infer_lock:
                full_res = self._landmarker.detect(mp_full)
            if full_res.pose_landmarks and len(full_res.pose_landmarks) > 0 and len(full_res.pose_landmarks[0]) >= 33:
                fallback_kps = [
                    NormalizedKeypoint(
                        x=float(lm.x),
                        y=float(lm.y),
                        z=float(lm.z),
                        visibility=float(getattr(lm, "visibility", 1.0) or 1.0),
                    )
                    for lm in full_res.pose_landmarks[0]
                ]
                fallback_geom = calculate_pose_geometry(
                    keypoints=fallback_kps,
                    image_width=img_w,
                    image_height=img_h,
                    bbox_width=effective_bbox_w,
                    bbox_height=effective_bbox_h,
                    min_visibility=self._min_visibility,
                )
                if fallback_geom is not None:
                    return fallback_kps, fallback_geom, True, "NORMAL_POSTURE"

        if geometry is None:
            return full_keypoints, None, False, "LOW_VISIBILITY"

        return full_keypoints, geometry, True, "NORMAL_POSTURE"
