"""Tests for Stage-2 local ONNX context classifier (`FireVerifier`) and FireService integration."""

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from app.config import Settings
from app.models.fire import FireBoundingBox, FireDetection, FireFrame
from app.services.fire_detector import FireDetectorError
from app.services.fire_service import FireService
from app.services.fire_verifier import (
    VERIFIER_INPUT_SIZE,
    FireVerifier,
    extract_context_crop,
    preprocess_crop,
    softmax_fire_probability,
)


def _sample_image(width: int = 320, height: int = 240) -> np.ndarray:
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8)


def _sample_jpeg(width: int = 160, height: int = 120) -> bytes:
    stream = BytesIO()
    Image.new("RGB", (width, height), color=(220, 100, 40)).save(stream, format="JPEG")
    return stream.getvalue()


def test_context_crop_expands_and_pads_near_frame_edge() -> None:
    image = _sample_image(320, 240)
    corner_box = FireBoundingBox(x=0.0, y=0.0, width=0.05, height=0.05)
    crop = extract_context_crop(image, corner_box, context_scale=2.5)
    assert crop.shape == (VERIFIER_INPUT_SIZE, VERIFIER_INPUT_SIZE, 3)
    assert crop.dtype == np.uint8
    tensor = preprocess_crop(crop)
    assert tensor.shape == (1, 3, VERIFIER_INPUT_SIZE, VERIFIER_INPUT_SIZE)
    assert tensor.dtype == np.float32
    assert np.isfinite(tensor).all()


def test_softmax_fire_probability_handles_valid_and_invalid_logits() -> None:
    high_fire = softmax_fire_probability(np.array([[-2.0, 2.0]], dtype=np.float32))
    low_fire = softmax_fire_probability(np.array([[2.0, -2.0]], dtype=np.float32))
    assert high_fire > 0.95
    assert low_fire < 0.05
    with pytest.raises(ValueError, match="Invalid fire verifier output"):
        softmax_fire_probability(np.array([[1.0, 2.0, 3.0]], dtype=np.float32))
    with pytest.raises(ValueError, match="Invalid fire verifier output"):
        softmax_fire_probability(np.array([[float("nan"), 1.0]], dtype=np.float32))


def test_verifier_selectively_suppresses_non_fire_box_and_keeps_real_fire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        fire_verifier_enabled=True,
        fire_confidence_threshold=0.50,
        fire_verifier_confidence_threshold=0.55,
    )
    verifier = FireVerifier(settings)
    phone_box = FireBoundingBox(x=0.6, y=0.4, width=0.1, height=0.15)
    flame_box = FireBoundingBox(x=0.1, y=0.3, width=0.1, height=0.15)
    detections = [
        FireDetection(label="fire", confidence=0.76, bounding_box=phone_box),
        FireDetection(label="fire", confidence=0.72, bounding_box=flame_box),
    ]
    scores = {phone_box.x: 0.12, flame_box.x: 0.91}
    monkeypatch.setattr(verifier, "score_box", lambda _img, box: scores[box.x])

    filtered = verifier.filter_detections(_sample_image(), detections)
    assert len(filtered) == 1
    assert filtered[0].bounding_box == flame_box


def test_verifier_checksum_enforced_and_fail_open_vs_fail_closed(tmp_path: Path) -> None:
    bad_model = tmp_path / "bad.onnx"
    bad_model.write_bytes(b"corrupt")
    box = FireBoundingBox(x=0.2, y=0.2, width=0.2, height=0.2)
    det = [FireDetection(label="fire", confidence=0.76, bounding_box=box)]

    open_verifier = FireVerifier(
        Settings(
            _env_file=None,
            fire_verifier_enabled=True,
            fire_verifier_model_path=str(bad_model),
            fire_verifier_model_sha256="0" * 64,
            fire_verifier_fail_open=True,
        )
    )
    assert open_verifier.filter_detections(_sample_image(), det) == det

    closed_verifier = FireVerifier(
        Settings(
            _env_file=None,
            fire_verifier_enabled=True,
            fire_verifier_model_path=str(bad_model),
            fire_verifier_model_sha256="0" * 64,
            fire_verifier_fail_open=False,
        )
    )
    with pytest.raises(FireDetectorError) as error:
        closed_verifier.filter_detections(_sample_image(), det)
    assert error.value.code == "MODEL_NOT_LOADED"


def test_fire_service_suppresses_false_alarm_before_tracker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        m3_enabled=True,
        fire_verifier_enabled=True,
        fire_verifier_confidence_threshold=0.60,
    )
    service = FireService(settings)
    phone_det = FireDetection(
        label="fire",
        confidence=0.76,
        bounding_box=FireBoundingBox(x=0.5, y=0.5, width=0.1, height=0.15),
    )
    monkeypatch.setattr(service.detector, "detect_image", lambda _img: [phone_det])
    session = SimpleNamespace(
        get_inputs=lambda: [SimpleNamespace(name="image")],
        run=lambda _out, _inp: [np.array([[3.0, -3.0]], dtype=np.float32)],
    )
    monkeypatch.setattr(service.verifier, "_load", lambda: session)

    frame = FireFrame(
        camera_slug="cam-1",
        source_session_id="sess-1",
        frame_id="frame-1",
        observed_at=datetime.now(UTC),
    )
    response = service.process(frame, _sample_jpeg())
    assert not response.confirmed
    assert response.reason == "NEGATIVE"
    assert response.detections == []
    assert response.max_confidence is None
