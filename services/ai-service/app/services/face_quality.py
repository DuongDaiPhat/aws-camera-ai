"""Local YuNet + SFace/ArcFace quality gate, independent of face_provider."""

import io
import logging
import math
import threading
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings
from app.models.face import BoundingBox, FaceAssessResponse, FaceQualityMetrics
from app.services.embedding_codec import encode
from app.services.face_arcface import ArcFaceOnnxRecognizer

LOGGER = logging.getLogger(__name__)
_MAX_DETECT_DIM = 640.0
_SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}


class FaceQualityAssessor:
    """Assess single-face crop quality using local YuNet + SFace/ArcFace models."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._detector: cv2.FaceDetectorYN | None = None
        self._recognizer: Any = None
        self._warmed = False

    def _model_version(self) -> str:
        return self.settings.face_gate_model_version.strip() or self.settings.face_model_version

    def _resolve_embedder_config(self) -> tuple[str, str]:
        gate_path = self.settings.face_gate_embedder_path.strip()
        embedder_path = gate_path or self.settings.face_embedder_path
        backend = self.settings.face_gate_embedder_backend
        if backend == "auto":
            name = Path(embedder_path).name.lower()
            if gate_path:
                backend = "sface" if "sface" in name else "arcface_onnx"
            elif any(token in name for token in ("w600k", "arcface", "glint")):
                backend = "arcface_onnx"
            else:
                backend = "sface"
        return embedder_path, backend

    def _create_recognizer(self, embedder_path: str, backend: str) -> Any:
        if backend == "arcface_onnx":
            return ArcFaceOnnxRecognizer(
                embedder_path,
                expected_sha256=self.settings.face_gate_embedder_sha256,
                cpu_threads=self.settings.face_cpu_threads,
            )
        if not Path(embedder_path).is_file():
            raise FileNotFoundError("Face embedder model not configured")
        return cv2.FaceRecognizerSF.create(embedder_path, "")

    def warmup(self) -> bool:
        """Prime model execution before the first live face consumes its deadline."""
        if not self.settings.face_quality_gate_enabled:
            return True
        try:
            with self._lock:
                if not self._warmed:
                    self._load()
                    self._detect_faces(np.zeros((320, 320, 3), dtype=np.uint8))
                    assert self._recognizer is not None
                    self._recognizer.feature(np.zeros((112, 112, 3), dtype=np.uint8))
                    self._warmed = True
            return True
        except (FileNotFoundError, cv2.error, OSError):
            LOGGER.warning("Face quality warmup unavailable; gate remains fail-closed")
            return False

    def _load(self, *, require_recognizer: bool = True) -> None:
        # Load local ONNX models regardless of settings.face_provider so the
        # edge quality gate remains active even when FACE_PROVIDER=rekognition.
        embedder_path, backend = self._resolve_embedder_config()
        if self._detector is None:
            if not all(
                Path(path).is_file() for path in (self.settings.face_detector_path, embedder_path)
            ):
                raise FileNotFoundError("Face quality models not configured")
            score_threshold = max(
                0.05, min(0.5, float(self.settings.face_gate_min_detection_score))
            )
            self._detector = cv2.FaceDetectorYN.create(
                self.settings.face_detector_path,
                "",
                (320, 320),
                score_threshold,
            )
            self._recognizer = self._create_recognizer(embedder_path, backend)
        elif require_recognizer and self._recognizer is None:
            self._recognizer = self._create_recognizer(embedder_path, backend)

    def _decode_image(self, data: bytes) -> np.ndarray:
        if not data or len(data) > self.settings.face_max_image_bytes:
            raise ValueError("Image size out of bounds")
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in _SUPPORTED_FORMATS:
                raise ValueError("Unsupported image format")
            if source.width * source.height > self.settings.face_max_pixels:
                raise ValueError("Image exceeds max pixels")
            image = ImageOps.exif_transpose(source).convert("RGB")
            return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)

    def _detect_faces(self, image: np.ndarray) -> list[np.ndarray]:
        assert self._detector is not None
        height, width = image.shape[:2]
        scale = 1.0
        det_image = image
        if max(width, height) > _MAX_DETECT_DIM:
            scale = _MAX_DETECT_DIM / max(width, height)
            det_w = max(1, int(round(width * scale)))
            det_h = max(1, int(round(height * scale)))
            det_image = cv2.resize(image, (det_w, det_h))

        det_height, det_width = det_image.shape[:2]
        self._detector.setInputSize((det_width, det_height))
        _, detected = self._detector.detect(det_image)

        faces: list[np.ndarray] = []
        if detected is not None:
            for raw_face in detected:
                face = np.array(raw_face, dtype=np.float32, copy=True)
                if scale != 1.0:
                    face[:14] = face[:14] / scale
                faces.append(face)
            faces.sort(key=lambda item: (float(item[1]), float(item[0])))
        return faces

    @staticmethod
    def _compute_sharpness(image: np.ndarray, face: np.ndarray) -> float:
        height, width = image.shape[:2]
        raw_w = max(0.0, float(face[2]))
        raw_h = max(0.0, float(face[3]))
        x1 = max(0, int(math.floor(float(face[0]))))
        y1 = max(0, int(math.floor(float(face[1]))))
        x2 = min(width, int(math.ceil(float(face[0]) + raw_w)))
        y2 = min(height, int(math.ceil(float(face[1]) + raw_h)))
        if x2 <= x1 or y2 <= y1:
            return 0.0
        roi = image[y1:y2, x1:x2]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    @staticmethod
    def _compute_normalized_sharpness(image: np.ndarray, face: np.ndarray) -> float:
        """Compare face detail at a fixed scale with pixel/JPEG noise attenuated."""
        height, width = image.shape[:2]
        x, y, w, h = (float(v) for v in face[:4])
        roi = image[
            max(0, math.floor(y)) : min(height, math.ceil(y + h)),
            max(0, math.floor(x)) : min(width, math.ceil(x + w)),
        ]
        if roi.size == 0:
            return 0.0
        interpolation = cv2.INTER_AREA if min(roi.shape[:2]) >= 112 else cv2.INTER_LINEAR
        gray = cv2.cvtColor(
            cv2.resize(roi, (112, 112), interpolation=interpolation), cv2.COLOR_BGR2GRAY
        )
        gray = cv2.GaussianBlur(gray, (3, 3), 0.8)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    @staticmethod
    def _compute_pose_ratios(face: np.ndarray) -> tuple[float, float]:
        if len(face) < 14:
            return 1.0, 1.0
        raw_w = max(0.0, float(face[2]))
        raw_h = max(0.0, float(face[3]))
        rx, ry = float(face[4]), float(face[5])
        lx, ly = float(face[6]), float(face[7])
        nx, ny = float(face[8]), float(face[9])
        rmx, rmy = float(face[10]), float(face[11])
        lmx, lmy = float(face[12]), float(face[13])

        eye_dx = lx - rx
        eye_dy = ly - ry
        eye_dist = math.hypot(eye_dx, eye_dy)
        eye_mid_x = (rx + lx) / 2.0
        eye_mid_y = (ry + ly) / 2.0
        mouth_mid_x = (rmx + lmx) / 2.0
        mouth_mid_y = (rmy + lmy) / 2.0

        if eye_dist < max(1.0, 0.05 * raw_w):
            yaw_ratio = 1.0
        else:
            eye_ux, eye_uy = eye_dx / eye_dist, eye_dy / eye_dist
            yaw_offset = abs((nx - eye_mid_x) * eye_ux + (ny - eye_mid_y) * eye_uy)
            yaw_ratio = yaw_offset / eye_dist

        em_dx = mouth_mid_x - eye_mid_x
        em_dy = mouth_mid_y - eye_mid_y
        em_dist = math.hypot(em_dx, em_dy)
        if em_dist < max(1.0, 0.05 * raw_h):
            pitch_ratio = 1.0
        else:
            down_ux, down_uy = em_dx / em_dist, em_dy / em_dist
            t = ((nx - eye_mid_x) * down_ux + (ny - eye_mid_y) * down_uy) / em_dist
            pitch_ratio = abs(t - 0.5)

        return float(yaw_ratio), float(pitch_ratio)

    def _compute_quality_score(self, metrics: FaceQualityMetrics) -> float:
        det_score = float(np.clip(metrics.detection_score, 0.0, 1.0))
        target_px = max(float(self.settings.face_gate_min_face_px) * 2.0, 160.0)
        size_score = float(
            np.clip(min(metrics.face_width_px, metrics.face_height_px) / target_px, 0.0, 1.0)
        )
        # Smooth response instead of saturating on hair, glasses or JPEG edges.
        detail = metrics.normalized_sharpness
        sharp_score = detail / (detail + 30.0)

        yaw_scale = max(float(self.settings.face_gate_max_yaw_ratio) * 1.5, 1e-6)
        pitch_scale = max(float(self.settings.face_gate_max_pitch_ratio) * 1.5, 1e-6)
        yaw_score = float(np.clip(1.0 - metrics.pose_yaw_ratio / yaw_scale, 0.0, 1.0))
        pitch_score = float(np.clip(1.0 - metrics.pose_pitch_ratio / pitch_scale, 0.0, 1.0))
        pose_score = 0.5 * (yaw_score + pitch_score)

        composite = (0.15 * det_score + 0.40 * sharp_score + 0.45 * pose_score) * math.sqrt(
            size_score
        )
        return round(float(np.clip(composite, 0.0, 1.0)), 4)

    def _evaluate_checks(self, metrics: FaceQualityMetrics) -> str | None:
        if (
            metrics.face_width_px < self.settings.face_gate_min_face_px
            or metrics.face_height_px < self.settings.face_gate_min_face_px
        ):
            return "FACE_TOO_SMALL"
        if metrics.detection_score < self.settings.face_gate_min_detection_score:
            return "LOW_DETECTION_SCORE"
        if metrics.sharpness < self.settings.face_gate_min_sharpness:
            return "BLURRY"
        if metrics.normalized_sharpness < self.settings.face_gate_min_normalized_sharpness:
            return "BLURRY_NORMALIZED"
        if (
            metrics.pose_yaw_ratio > self.settings.face_gate_max_yaw_ratio
            or metrics.pose_pitch_ratio > self.settings.face_gate_max_pitch_ratio
        ):
            return "EXTREME_POSE"
        return None

    @staticmethod
    def _bounding_box(face: np.ndarray, width: int, height: int) -> BoundingBox:
        bx = max(0.0, min(1.0, float(face[0]) / width))
        by = max(0.0, min(1.0, float(face[1]) / height))
        bw = max(0.0, min(1.0 - bx, max(0.0, float(face[2])) / width))
        bh = max(0.0, min(1.0 - by, max(0.0, float(face[3])) / height))
        return BoundingBox(x=bx, y=by, width=bw, height=bh)

    def _assess_image(self, image: np.ndarray, include_embedding: bool) -> FaceAssessResponse:
        model_version = self._model_version()
        faces = self._detect_faces(image)
        face_count = len(faces)
        if face_count == 0:
            return FaceAssessResponse(
                passed=False,
                quality_score=0.0,
                face_count=0,
                rejection_reason="NO_FACE_DETECTED",
                model_version=model_version,
                gate_status="READY",
            )
        if face_count > 1:
            return FaceAssessResponse(
                passed=False,
                quality_score=0.0,
                face_count=face_count,
                rejection_reason="MULTIPLE_FACES",
                model_version=model_version,
                gate_status="READY",
            )

        face = faces[0]
        height, width = image.shape[:2]
        face_width_px = int(round(max(0.0, float(face[2]))))
        face_height_px = int(round(max(0.0, float(face[3]))))
        detection_score = float(np.clip(float(face[14]), 0.0, 1.0)) if len(face) > 14 else 0.0
        sharpness = self._compute_sharpness(image, face)
        yaw_ratio, pitch_ratio = self._compute_pose_ratios(face)

        metrics = FaceQualityMetrics(
            face_width_px=face_width_px,
            face_height_px=face_height_px,
            detection_score=round(detection_score, 4),
            sharpness=round(sharpness, 4),
            normalized_sharpness=round(self._compute_normalized_sharpness(image, face), 4),
            pose_yaw_ratio=round(yaw_ratio, 4),
            pose_pitch_ratio=round(pitch_ratio, 4),
        )
        quality_score = self._compute_quality_score(metrics)
        bounding_box = self._bounding_box(face, width, height)
        rejection_reason = self._evaluate_checks(metrics)

        if rejection_reason is not None:
            return FaceAssessResponse(
                passed=False,
                quality_score=quality_score,
                face_count=1,
                rejection_reason=rejection_reason,
                metrics=metrics,
                bounding_box=bounding_box,
                model_version=model_version,
                gate_status="READY",
            )

        embedding_base64: str | None = None
        embedding_dim: int | None = None
        if include_embedding:
            assert self._recognizer is not None
            if hasattr(self._recognizer, "align_crop"):
                aligned = self._recognizer.align_crop(image, face)
            else:
                aligned = self._recognizer.alignCrop(image, face)
            vector = np.asarray(self._recognizer.feature(aligned).flatten(), dtype=np.float32)
            try:
                embedding_base64 = encode(vector)
                embedding_dim = len(vector)
            except ValueError:
                LOGGER.warning("Face embedder returned invalid embedding vector")

        return FaceAssessResponse(
            passed=True,
            quality_score=quality_score,
            face_count=1,
            rejection_reason=None,
            metrics=metrics,
            bounding_box=bounding_box,
            embedding_base64=embedding_base64,
            embedding_dim=embedding_dim,
            model_version=model_version,
            gate_status="READY",
        )

    def assess(self, data: bytes, include_embedding: bool = True) -> FaceAssessResponse:
        """Evaluate face quality metrics and optionally extract a face embedding."""
        model_version = self._model_version()
        if not self.settings.face_quality_gate_enabled:
            return FaceAssessResponse(
                passed=True,
                quality_score=0.0,
                face_count=0,
                rejection_reason=None,
                model_version=model_version,
                gate_status="DISABLED",
            )
        try:
            image = self._decode_image(data)
        except (ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            return FaceAssessResponse(
                passed=False,
                quality_score=0.0,
                face_count=0,
                rejection_reason="IMAGE_DECODE_FAILED",
                model_version=model_version,
                gate_status="READY",
            )
        try:
            with self._lock:
                self._load(require_recognizer=include_embedding)
                return self._assess_image(image, include_embedding)
        except (FileNotFoundError, cv2.error, OSError):
            return FaceAssessResponse(
                passed=False,
                quality_score=0.0,
                face_count=0,
                rejection_reason="MODEL_UNAVAILABLE",
                model_version=model_version,
                gate_status="UNAVAILABLE",
            )
