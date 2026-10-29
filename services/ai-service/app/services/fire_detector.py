"""Checksum-verified YOLO26 CPU inference with final xyxy/score/class rows."""

import ast
import hashlib
import io
import logging
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, UnidentifiedImageError

from app.config import Settings
from app.models.fire import FireBoundingBox, FireDetection, FireErrorCode
from app.models.fire_model_contract import FireModelContract

LOGGER = logging.getLogger(__name__)
INPUT_SIZE = 640
MAX_DETECTIONS = 100
CLASS_LABELS = {0: "fire", 1: "smoke"}
FIRE_CLASS_ID = 0


class FireDetectorError(Exception):
    def __init__(self, code: FireErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


class FireImageTooLargeError(ValueError):
    """Reject excessive encoded bytes or decoded pixels before inference."""


class FireDetector:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._session: ort.InferenceSession | None = None
        self._load_lock = Lock()

    @property
    def is_loaded(self) -> bool:
        return self._session is not None

    def _load(self) -> ort.InferenceSession:
        with self._load_lock:
            if self._session is not None:
                return self._session
            path = Path(self.settings.fire_model_path)
            try:
                expected = self.settings.fire_model_sha256.lower()
                if len(expected) != 64 or any(
                    value not in "0123456789abcdef" for value in expected
                ):
                    raise ValueError("A valid FIRE_MODEL_SHA256 is required")
                with path.open("rb") as stream:
                    actual = hashlib.file_digest(stream, "sha256").hexdigest()
                if actual != expected:
                    raise ValueError("Model checksum mismatch")
                options = ort.SessionOptions()
                options.intra_op_num_threads = self.settings.fire_cpu_threads
                options.inter_op_num_threads = 1
                session = ort.InferenceSession(
                    str(path), sess_options=options, providers=["CPUExecutionProvider"]
                )
                self._validate_session(session)
            except Exception as error:
                LOGGER.error("Fire model unavailable: %s", type(error).__name__)
                raise FireDetectorError("MODEL_NOT_LOADED", "Fire model is unavailable.") from error
            self._session = session
            return session

    def _validate_session(self, session: ort.InferenceSession) -> None:
        inputs, outputs = session.get_inputs(), session.get_outputs()
        if len(inputs) != 1 or len(outputs) != 1:
            raise ValueError("Expected one ONNX input and output")
        if inputs[0].shape != [1, 3, INPUT_SIZE, INPUT_SIZE] or outputs[0].shape != [1, 300, 6]:
            raise ValueError("Unexpected YOLO26 final-detection model layout")
        if inputs[0].type != "tensor(float)" or outputs[0].type != "tensor(float)":
            raise ValueError("Expected FP32 input and output")
        metadata = session.get_modelmeta().custom_metadata_map
        names = ast.literal_eval(metadata.get("names", "{}"))
        if names != CLASS_LABELS:
            raise ValueError("Unexpected fire/smoke class map")
        self._validate_model_contract(metadata)

    def _validate_model_contract(self, metadata: dict[str, str]) -> None:
        end_to_end = metadata.get("end2end")
        if end_to_end not in {"True", "False"}:
            raise ValueError("Missing or invalid ONNX prediction mode")
        path = Path(self.settings.fire_model_path).with_suffix(".contract.json")
        if not path.exists():
            if end_to_end == "False":
                raise ValueError("Embedded-NMS model requires a deployment contract")
            return  # Historical NMS-free exports do not filter by confidence in the graph.
        contract = FireModelContract.model_validate_json(path.read_text(encoding="utf-8"))
        if contract.model_sha256 != self.settings.fire_model_sha256.lower():
            raise ValueError("Deployment contract belongs to a different model")
        expected_mode = (
            "nms-free-one-to-one" if end_to_end == "True" else "one-to-many-embedded-nms"
        )
        if contract.prediction_mode != expected_mode:
            raise ValueError("Deployment contract disagrees with ONNX prediction mode")
        if self.settings.fire_output_confidence_floor < contract.output_confidence_floor:
            raise ValueError("FIRE_OUTPUT_CONFIDENCE_FLOOR is below the embedded graph floor")

    def decode(self, data: bytes) -> np.ndarray:
        if len(data) > self.settings.fire_max_image_bytes:
            raise FireImageTooLargeError("Encoded image exceeds FIRE_MAX_IMAGE_BYTES")
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > self.settings.fire_max_image_pixels:
                    raise FireImageTooLargeError("Image exceeds FIRE_MAX_IMAGE_PIXELS")
                if image.format not in {"JPEG", "PNG"}:
                    raise ValueError("Expected JPEG or PNG")
            decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
            if decoded is None:
                raise ValueError("Cannot decode frame")
            return decoded
        except Image.DecompressionBombError as error:
            raise FireImageTooLargeError("Image exceeds decoder pixel safety limit") from error
        except (UnidentifiedImageError, ValueError, OSError, cv2.error) as error:
            if isinstance(error, FireImageTooLargeError):
                raise
            raise FireDetectorError("IMAGE_DECODE_FAILED", "Cannot decode camera frame.") from error

    @staticmethod
    def preprocess(image: np.ndarray) -> tuple[np.ndarray, float, int, int]:
        height, width = image.shape[:2]
        gain = min(INPUT_SIZE / height, INPUT_SIZE / width)
        resized = (round(width * gain), round(height * gain))
        left = round((INPUT_SIZE - resized[0]) / 2 - 0.1)
        top = round((INPUT_SIZE - resized[1]) / 2 - 0.1)
        image = cv2.resize(image, resized, interpolation=cv2.INTER_LINEAR)
        padded = cv2.copyMakeBorder(
            image,
            top,
            INPUT_SIZE - resized[1] - top,
            left,
            INPUT_SIZE - resized[0] - left,
            cv2.BORDER_CONSTANT,
            value=(114, 114, 114),
        )
        batch = (
            np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32)
            / 255.0
        )
        return batch, gain, left, top

    def detect(self, data: bytes) -> list[FireDetection]:
        image = self.decode(data)
        session = self._load()
        try:
            tensor, gain, left, top = self.preprocess(image)
            rows = session.run(None, {session.get_inputs()[0].name: tensor})[0]
            return self._postprocess(rows, image.shape[1], image.shape[0], gain, left, top)
        except Exception as error:
            raise FireDetectorError("FIRE_INFERENCE_FAILED", "Fire inference failed.") from error

    def _postprocess(
        self, rows: np.ndarray, width: int, height: int, gain: float, left: int, top: int
    ) -> list[FireDetection]:
        if rows.shape != (1, 300, 6) or not np.isfinite(rows).all():
            raise ValueError("Invalid inference output")
        detections = []
        for row in sorted(rows[0], key=lambda value: float(value[4]), reverse=True):
            x1, y1, x2, y2, score, class_id = (float(value) for value in row)
            if score < self.settings.fire_output_confidence_floor:
                continue
            if not 0 <= score <= 1 or class_id not in CLASS_LABELS:
                raise ValueError("Invalid inference score or class")
            # Preserve the checkpoint's verified class map, but expose only fire.
            # Discard other classes before the detection limit and temporal scoring.
            if class_id != FIRE_CLASS_ID:
                continue
            x1, x2 = np.clip([(x1 - left) / gain, (x2 - left) / gain], 0, width)
            y1, y2 = np.clip([(y1 - top) / gain, (y2 - top) / gain], 0, height)
            if x2 <= x1 or y2 <= y1:
                continue
            detections.append(
                FireDetection(
                    label="fire",
                    confidence=score,
                    bounding_box=FireBoundingBox(
                        x=x1 / width,
                        y=y1 / height,
                        width=(x2 - x1) / width,
                        height=(y2 - y1) / height,
                    ),
                )
            )
            if len(detections) == MAX_DETECTIONS:
                break
        return detections
