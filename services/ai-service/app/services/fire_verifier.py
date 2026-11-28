"""Stage-2 local ONNX context classifier to reject non-fire lights, glare, and screens."""

import hashlib
import logging
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
import onnxruntime as ort

from app.config import Settings
from app.models.fire import FireBoundingBox, FireDetection
from app.services.fire_detector import FireDetectorError

LOGGER = logging.getLogger(__name__)
VERIFIER_INPUT_SIZE = 224
MIN_CONTEXT_SIDE_PX = 64
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)


def extract_context_crop(
    image: np.ndarray,
    box: FireBoundingBox,
    context_scale: float = 2.5,
    output_size: int = VERIFIER_INPUT_SIZE,
) -> np.ndarray:
    """Crop a square region expanded around the detection box to preserve scene context.

    Expanding by ~2.5x exposes surrounding cues such as smartphone bezels, hands,
    window frames, ceiling fixtures, or neon tubes without distorting aspect ratio.
    """
    height, width = image.shape[:2]
    cx = (box.x + box.width * 0.5) * width
    cy = (box.y + box.height * 0.5) * height
    side = max(box.width * width, box.height * height) * context_scale
    side = max(side, float(MIN_CONTEXT_SIDE_PX))
    half = side * 0.5

    x1 = int(np.floor(cx - half))
    y1 = int(np.floor(cy - half))
    x2 = int(np.ceil(cx + half))
    y2 = int(np.ceil(cy + half))

    pad_left = max(0, -x1)
    pad_top = max(0, -y1)
    pad_right = max(0, x2 - width)
    pad_bottom = max(0, y2 - height)

    crop = image[max(0, y1) : min(height, y2), max(0, x1) : min(width, x2)]
    if pad_left or pad_top or pad_right or pad_bottom:
        crop = cv2.copyMakeBorder(
            crop,
            pad_top,
            pad_bottom,
            pad_left,
            pad_right,
            cv2.BORDER_CONSTANT,
            value=(114, 114, 114),
        )
    if crop.size == 0:
        return np.full((output_size, output_size, 3), 114, dtype=np.uint8)
    return cv2.resize(crop, (output_size, output_size), interpolation=cv2.INTER_LINEAR)


def preprocess_crop(crop_bgr: np.ndarray) -> np.ndarray:
    """Convert 224x224 BGR crop to ImageNet-normalized NCHW FP32 tensor."""
    rgb = crop_bgr[:, :, ::-1].astype(np.float32) / 255.0
    chw = np.ascontiguousarray(rgb.transpose(2, 0, 1))
    normalized: np.ndarray = np.asarray((chw - IMAGENET_MEAN) / IMAGENET_STD, dtype=np.float32)
    return np.ascontiguousarray(normalized[None], dtype=np.float32)


def softmax_fire_probability(logits: np.ndarray) -> float:
    """Convert `[1, 2]` binary logits `[false_alarm, real_fire]` to `P(real_fire)`."""
    if logits.shape != (1, 2) or not np.isfinite(logits).all():
        raise ValueError("Invalid fire verifier output layout")
    shifted = logits[0] - float(np.max(logits[0]))
    exps = np.exp(shifted)
    probs = exps / float(np.sum(exps))
    return float(probs[1])


class FireVerifier:
    """Checksum-verified local ONNX binary verifier for Stage-1 YOLO26 fire candidates."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._session: ort.InferenceSession | None = None
        self._load_lock = Lock()

    @property
    def is_enabled(self) -> bool:
        return self.settings.fire_verifier_enabled

    @property
    def is_loaded(self) -> bool:
        return self._session is not None

    def _load(self) -> ort.InferenceSession:
        with self._load_lock:
            if self._session is not None:
                return self._session
            path = Path(self.settings.fire_verifier_model_path)
            try:
                expected = self.settings.fire_verifier_model_sha256.lower()
                if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
                    raise ValueError("A valid FIRE_VERIFIER_MODEL_SHA256 is required")
                with path.open("rb") as stream:
                    actual = hashlib.file_digest(stream, "sha256").hexdigest()
                if actual != expected:
                    raise ValueError("Fire verifier checksum mismatch")
                options = ort.SessionOptions()
                options.intra_op_num_threads = self.settings.fire_cpu_threads
                options.inter_op_num_threads = 1
                session = ort.InferenceSession(
                    str(path), sess_options=options, providers=["CPUExecutionProvider"]
                )
                self._validate_session(session)
            except Exception as error:
                LOGGER.error("Fire verifier unavailable: %s", type(error).__name__)
                raise FireDetectorError(
                    "MODEL_NOT_LOADED", "Fire verifier model is unavailable."
                ) from error
            self._session = session
            return session

    def _validate_session(self, session: ort.InferenceSession) -> None:
        inputs, outputs = session.get_inputs(), session.get_outputs()
        if len(inputs) != 1 or len(outputs) != 1:
            raise ValueError("Expected one ONNX input and output for fire verifier")
        if inputs[0].shape != [1, 3, VERIFIER_INPUT_SIZE, VERIFIER_INPUT_SIZE]:
            raise ValueError("Unexpected fire verifier input shape")
        if outputs[0].shape != [1, 2]:
            raise ValueError("Unexpected fire verifier output shape")
        if inputs[0].type != "tensor(float)" or outputs[0].type != "tensor(float)":
            raise ValueError("Expected FP32 fire verifier input and output")

    def score_box(self, image: np.ndarray, box: FireBoundingBox) -> float:
        """Return `P(real_fire)` for a single detection box using its expanded context crop."""
        session = self._load()
        try:
            crop = extract_context_crop(
                image, box, context_scale=self.settings.fire_verifier_context_scale
            )
            tensor = preprocess_crop(crop)
            logits = session.run(None, {session.get_inputs()[0].name: tensor})[0]
            return softmax_fire_probability(logits)
        except FireDetectorError:
            raise
        except Exception as error:
            raise FireDetectorError(
                "FIRE_INFERENCE_FAILED", "Fire verifier inference failed."
            ) from error

    def filter_detections(
        self, image: np.ndarray | None, detections: list[FireDetection]
    ) -> list[FireDetection]:
        """Verify qualifying fire detections and suppress non-fire glare/lights/screens."""
        if not self.is_enabled or image is None or not detections:
            return detections
        threshold = self.settings.fire_confidence_threshold
        verifier_threshold = self.settings.fire_verifier_confidence_threshold
        verified: list[FireDetection] = []
        for detection in detections:
            if detection.label != "fire" or detection.confidence < threshold:
                verified.append(detection)
                continue
            try:
                probability = self.score_box(image, detection.bounding_box)
            except FireDetectorError:
                if self.settings.fire_verifier_fail_open:
                    LOGGER.warning(
                        "Fire verifier failed; keeping Stage-1 detection (fail-open enabled)"
                    )
                    verified.append(detection)
                    continue
                raise
            if probability >= verifier_threshold:
                verified.append(detection)
            else:
                LOGGER.debug(
                    "Fire verifier suppressed candidate stage1=%.3f verifier=%.3f threshold=%.3f",
                    detection.confidence,
                    probability,
                    verifier_threshold,
                )
        return verified
