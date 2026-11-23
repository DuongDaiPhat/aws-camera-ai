"""ArcFace ONNX Runtime recognizer with 5-point Umeyama similarity alignment."""

import hashlib
import importlib
from pathlib import Path
from typing import Any, cast

import cv2
import numpy as np

# Standard 112x112 InsightFace/ArcFace template landmarks (right-eye, left-eye, nose, mouth corners).
ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float64,
)


def umeyama_similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray | None:
    """Compute exact 2D similarity matrix (2x3) mapping 5 source landmarks to template."""
    if src.shape != (5, 2) or dst.shape != (5, 2):
        return None
    src_f = src.astype(np.float64)
    dst_f = dst.astype(np.float64)
    src_mean = src_f.mean(axis=0)
    dst_mean = dst_f.mean(axis=0)
    src_c = src_f - src_mean
    dst_c = dst_f - dst_mean
    src_var = float(np.sum(src_c**2)) / src_f.shape[0]
    if not np.isfinite(src_var) or src_var <= 1e-12:
        return None
    cov = (dst_c.T @ src_c) / src_f.shape[0]
    u_mat, singular, vt_mat = np.linalg.svd(cov)
    sign = np.ones(2, dtype=np.float64)
    if np.linalg.det(cov) < 0:
        sign[1] = -1.0
    rot = u_mat @ np.diag(sign) @ vt_mat
    scale = float(np.sum(singular * sign) / src_var)
    if not np.isfinite(scale) or scale <= 0:
        return None
    matrix = np.zeros((2, 3), dtype=np.float64)
    matrix[:, :2] = scale * rot
    matrix[:, 2] = dst_mean - scale * (rot @ src_mean)
    return matrix


def _verify_sha256(path: Path, expected_sha256: str) -> None:
    expected = expected_sha256.strip().lower()
    if not expected:
        return
    if len(expected) != 64 or any(ch not in "0123456789abcdef" for ch in expected):
        raise OSError("Invalid FACE_GATE_EMBEDDER_SHA256 format")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise OSError("Face gate embedder checksum mismatch")


class ArcFaceOnnxRecognizer:
    """ONNX Runtime CPU embedder for 112x112 RGB ArcFace models (e.g. w600k_r50)."""

    def __init__(
        self,
        model_path: str,
        *,
        expected_sha256: str = "",
        cpu_threads: int = 2,
    ) -> None:
        path = Path(model_path)
        if not path.is_file():
            raise FileNotFoundError(f"ArcFace embedder model not found: {model_path}")
        _verify_sha256(path, expected_sha256)
        try:
            ort: Any = importlib.import_module("onnxruntime")
        except ImportError as error:
            raise FileNotFoundError("onnxruntime is unavailable for ArcFace embedder") from error

        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, int(cpu_threads))
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        try:
            session = ort.InferenceSession(
                str(path), sess_options=options, providers=["CPUExecutionProvider"]
            )
        except Exception as error:
            raise OSError(f"Failed to load ArcFace ONNX model: {type(error).__name__}") from error

        inputs = session.get_inputs()
        outputs = session.get_outputs()
        if len(inputs) != 1 or len(outputs) != 1:
            raise OSError("Unexpected ArcFace ONNX input/output count")
        input_shape = inputs[0].shape
        output_shape = outputs[0].shape
        if len(input_shape) != 4 or list(input_shape[1:]) != [3, 112, 112]:
            raise OSError(f"Unexpected ArcFace ONNX input shape: {input_shape}")
        if len(output_shape) != 2 or not isinstance(output_shape[1], int) or output_shape[1] < 128:
            raise OSError(f"Unexpected ArcFace ONNX output shape: {output_shape}")

        self._session = session
        self._input_name = str(inputs[0].name)
        self._output_name = str(outputs[0].name)
        self.embedding_dim = int(output_shape[1])

    def align_crop(self, image: np.ndarray, face: np.ndarray) -> np.ndarray:
        """Align a BGR image to 112x112 using YuNet 5-point landmarks."""
        if len(face) >= 14:
            matrix = umeyama_similarity(face[4:14].reshape(5, 2), ARCFACE_DST)
            if matrix is not None:
                warped = cv2.warpAffine(
                    cast(Any, image),
                    cast(Any, matrix),
                    (112, 112),
                    borderValue=(0.0, 0.0, 0.0),
                )
                return np.asarray(warped, dtype=np.uint8)
        x1 = max(0, int(round(float(face[0]))))
        y1 = max(0, int(round(float(face[1]))))
        x2 = min(image.shape[1], int(round(float(face[0]) + max(1.0, float(face[2])))))
        y2 = min(image.shape[0], int(round(float(face[1]) + max(1.0, float(face[3])))))
        roi = image[y1:y2, x1:x2]
        if roi.size == 0:
            return np.zeros((112, 112, 3), dtype=np.uint8)
        return cv2.resize(roi, (112, 112), interpolation=cv2.INTER_LINEAR)

    def feature(self, aligned: np.ndarray) -> np.ndarray:
        """Extract L2-normalized (1, D) float32 embedding from an aligned 112x112 BGR crop."""
        if aligned.ndim != 3 or aligned.shape[2] != 3:
            raise OSError("Aligned face crop must be HxWx3 BGR")
        crop = (
            aligned
            if aligned.shape[:2] == (112, 112)
            else cv2.resize(aligned, (112, 112), interpolation=cv2.INTER_LINEAR)
        )
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        blob = (rgb.astype(np.float32) - 127.5) / 127.5
        tensor = np.ascontiguousarray(np.transpose(blob, (2, 0, 1))[None, ...], dtype=np.float32)
        try:
            output = self._session.run([self._output_name], {self._input_name: tensor})[0]
        except Exception as error:
            raise OSError(f"ArcFace inference failed: {type(error).__name__}") from error
        vector = np.asarray(output, dtype=np.float32).reshape(1, -1)
        norm = float(np.linalg.norm(vector))
        if norm <= 0.0 or not np.isfinite(norm):
            return np.zeros_like(vector, dtype=np.float32)
        return vector / norm
