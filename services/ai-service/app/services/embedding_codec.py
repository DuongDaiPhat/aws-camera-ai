"""Float32 little-endian dùng chung cho đăng ký và collection."""

import base64
import binascii

import numpy as np
from numpy.typing import NDArray


def normalize(vector: NDArray[np.float32]) -> NDArray[np.float32]:
    norm = float(np.linalg.norm(vector))
    if not np.all(np.isfinite(vector)) or not np.isfinite(norm) or norm <= 0:
        raise ValueError("Embedding không hợp lệ")
    return np.asarray(vector / norm, dtype="<f4")


def encode(vector: NDArray[np.float32]) -> str:
    return base64.b64encode(normalize(vector).tobytes()).decode("ascii")


def decode(payload: str, dimension: int) -> NDArray[np.float32]:
    try:
        raw = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Embedding không hợp lệ") from error
    if len(raw) != dimension * 4:
        raise ValueError("Embedding sai dimension")
    vector = normalize(np.frombuffer(raw, dtype="<f4").copy())
    vector.flags.writeable = False
    return vector
