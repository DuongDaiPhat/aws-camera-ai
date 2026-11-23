"""Boundary and failure tests for the real gate embedder adapter."""

import hashlib
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest

from app.services.face_arcface import (
    ARCFACE_DST,
    ArcFaceOnnxRecognizer,
    _verify_sha256,
    umeyama_similarity,
)


@pytest.mark.parametrize("value", ["x" * 64, "abc", "0" * 64])
def test_rejects_bad_checksum(tmp_path: Path, value: str) -> None:
    model = tmp_path / "model.onnx"
    model.write_bytes(b"model")
    with pytest.raises(OSError):
        _verify_sha256(model, value)
    _verify_sha256(model, hashlib.sha256(b"model").hexdigest())


def test_missing_model() -> None:
    with pytest.raises(FileNotFoundError):
        ArcFaceOnnxRecognizer("/absent/model.onnx")


def test_alignment_recovers_translation_and_scale() -> None:
    source = ARCFACE_DST * 2 + [17, 29]
    matrix = umeyama_similarity(source, ARCFACE_DST)
    assert matrix is not None
    assert np.allclose(source @ matrix[:, :2].T + matrix[:, 2], ARCFACE_DST)
    assert umeyama_similarity(np.zeros((5, 2)), ARCFACE_DST) is None
    assert umeyama_similarity(np.zeros((4, 2)), ARCFACE_DST) is None


def test_inference_rejects_invalid_input_and_handles_bad_output() -> None:
    recognizer = object.__new__(ArcFaceOnnxRecognizer)
    recognizer._input_name = "input"
    recognizer._output_name = "output"
    recognizer._session = Mock()
    with pytest.raises(OSError, match="HxWx3"):
        recognizer.feature(np.zeros((112, 112), dtype=np.uint8))
    recognizer._session.run.side_effect = RuntimeError("provider down")
    with pytest.raises(OSError, match="ArcFace inference failed"):
        recognizer.feature(np.zeros((112, 112, 3), dtype=np.uint8))
    recognizer._session.run.side_effect = None
    recognizer._session.run.return_value = [np.zeros((1, 512))]
    assert not recognizer.feature(np.zeros((80, 80, 3), dtype=np.uint8)).any()
    empty = recognizer.align_crop(np.zeros((20, 20, 3), dtype=np.uint8), np.array([50, 50, 10, 10]))
    assert empty.shape == (112, 112, 3)
    assert not empty.any()
