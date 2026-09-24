"""YuNet/SFace: chỉ xử lý ảnh trong RAM, không tải model trong request."""

import io
import threading
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings
from app.models.face import BoundingBox, EmbedResponse, InferenceError
from app.services.embedding_codec import encode


class FaceEmbedder:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._detector: cv2.FaceDetectorYN | None = None
        self._recognizer: cv2.FaceRecognizerSF | None = None

    def _load(self) -> None:
        if self._detector is not None:
            return
        if not all(
            Path(path).is_file()
            for path in (self.settings.face_detector_path, self.settings.face_embedder_path)
        ):
            raise FileNotFoundError("Chưa cấu hình model khuôn mặt")
        self._detector = cv2.FaceDetectorYN.create(
            self.settings.face_detector_path,
            "",
            (320, 320),
            self.settings.face_detection_threshold,
        )
        self._recognizer = cv2.FaceRecognizerSF.create(self.settings.face_embedder_path, "")

    def _image(self, data: bytes) -> np.ndarray:
        if len(data) > self.settings.face_max_image_bytes:
            raise ValueError("Ảnh quá lớn")
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Định dạng ảnh không hỗ trợ")
            if source.width * source.height > self.settings.face_max_pixels:
                raise ValueError("Ảnh vượt giới hạn pixel")
            image = ImageOps.exif_transpose(source).convert("RGB")
            return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)

    def embed(self, data: bytes, selected: int | None) -> EmbedResponse:
        response = EmbedResponse(model_version=self.settings.face_model_version)
        try:
            image = self._image(data)
            if self.settings.face_provider != "local":
                raise FileNotFoundError("Provider chưa sẵn sàng")
            with self._lock:
                self._load()
                return self._extract(image, selected, response)
        except (ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            response.error = InferenceError(code="IMAGE_DECODE_FAILED", message="Ảnh không hợp lệ")
        except FileNotFoundError:
            response.error = InferenceError(code="MODEL_NOT_LOADED", message="Model chưa sẵn sàng")
        except (cv2.error, OSError):
            response.error = InferenceError(
                code="PROVIDER_UNAVAILABLE", message="Không xử lý được ảnh"
            )
        return response

    def _extract(
        self, image: np.ndarray, selected: int | None, response: EmbedResponse
    ) -> EmbedResponse:
        assert self._detector is not None and self._recognizer is not None
        height, width = image.shape[:2]
        scale = 1.0
        det_image = image
        max_dim = 640.0
        if max(width, height) > max_dim:
            scale = max_dim / max(width, height)
            det_image = cv2.resize(image, (int(width * scale), int(height * scale)))

        det_height, det_width = det_image.shape[:2]
        self._detector.setInputSize((det_width, det_height))
        _, detected = self._detector.detect(det_image)

        faces = []
        if detected is not None:
            for face in detected:
                if scale != 1.0:
                    face[:14] = face[:14] / scale
                faces.append(face)
            faces = sorted(faces, key=lambda face: (face[1], face[0]))

        response.faces = [self._box(face, width, height) for face in faces]
        code = None
        if not faces:
            code = "NO_FACE_DETECTED"
        elif selected is not None and not 0 <= selected < len(faces):
            code = "INVALID_FACE_SELECTION"
        elif selected is None and len(faces) > 1:
            code = "MULTIPLE_FACES"
        if code:
            response.error = InferenceError(code=code, message="Hãy kiểm tra và chọn khuôn mặt")
            return response
        index = 0 if selected is None else selected
        aligned = self._recognizer.alignCrop(image, faces[index])
        vector = np.asarray(self._recognizer.feature(aligned).flatten(), dtype=np.float32)
        response.embedding_base64 = encode(vector)
        response.embedding_dim = len(vector)
        response.selected_face_index = index
        return response

    @staticmethod
    def _box(face: np.ndarray, width: int, height: int) -> BoundingBox:
        x, y = max(0.0, float(face[0]) / width), max(0.0, float(face[1]) / height)
        x, y = min(1.0, x), min(1.0, y)
        return BoundingBox(
            x=x,
            y=y,
            width=max(0.0, min(1 - x, float(face[2]) / width)),
            height=max(0.0, min(1 - y, float(face[3]) / height)),
        )
