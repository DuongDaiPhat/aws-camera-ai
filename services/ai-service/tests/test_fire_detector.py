"""M3 ONNX layout, class mapping and full-frame coordinate restoration."""

import json
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from app.config import Settings
from app.services.fire_detector import FireDetector, FireDetectorError, FireImageTooLargeError


def encoded(width: int = 1280, height: int = 720) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), color="red").save(output, format="JPEG")
    return output.getvalue()


def test_yolo26_rows_are_xyxy_score_class_without_objectness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    detector = FireDetector(Settings(_env_file=None))
    rows = np.zeros((1, 300, 6), dtype=np.float32)
    rows[0, 0] = [64, 204, 192, 276, 0.9, 0]  # Letterboxed 1280x720: pad top=140.
    rows[0, 1] = [128, 212, 320, 320, 0.8, 1]
    session = SimpleNamespace(
        get_inputs=lambda: [SimpleNamespace(name="images")], run=lambda _outputs, _inputs: [rows]
    )
    monkeypatch.setattr(detector, "_load", lambda: session)
    detections = detector.detect(encoded())
    assert [item.label for item in detections] == ["fire"]
    box = detections[0].bounding_box
    assert box.x == pytest.approx(0.1)
    assert box.y == pytest.approx(64 / 360)
    assert box.width == pytest.approx(0.2)
    assert box.height == pytest.approx(0.2)
    assert detections[0].confidence == pytest.approx(0.9)


def test_smoke_predictions_do_not_consume_the_fire_detection_limit() -> None:
    detector = FireDetector(Settings(_env_file=None))
    rows = np.zeros((1, 300, 6), dtype=np.float32)
    rows[0, :200] = [10, 10, 100, 100, 0.99, 1]
    rows[0, 200] = [20, 20, 120, 120, 0.6, 0]
    detections = detector._postprocess(rows, 640, 640, 1, 0, 0)
    assert len(detections) == 1
    assert detections[0].label == "fire"
    assert detections[0].confidence == pytest.approx(0.6)


def test_smoke_only_output_is_a_negative_fire_observation() -> None:
    rows = np.zeros((1, 300, 6), dtype=np.float32)
    rows[0, 0] = [10, 10, 100, 100, 0.99, 1]
    assert FireDetector(Settings(_env_file=None))._postprocess(rows, 640, 640, 1, 0, 0) == []


def test_preprocessing_rgb_letterbox_handles_portrait() -> None:
    detector = FireDetector(Settings(_env_file=None))
    decoded = detector.decode(encoded(200, 400))
    tensor, gain, left, top = detector.preprocess(decoded)
    assert tensor.shape == (1, 3, 640, 640) and tensor.dtype == np.float32
    assert (gain, left, top) == (1.6, 160, 0)
    assert tensor[0, 0, 320, 320] > 0.9 and tensor[0, 2, 320, 320] < 0.1
    assert tensor[0, 0, 0, 0] == pytest.approx(114 / 255)


def test_image_pixel_limits_and_checksum_are_enforced(tmp_path) -> None:
    detector = FireDetector(Settings(_env_file=None, fire_max_image_pixels=100))
    with pytest.raises(FireImageTooLargeError):
        detector.decode(encoded(20, 20))
    invalid = tmp_path / "unverified.onnx"
    invalid.write_bytes(b"not a model")
    detector = FireDetector(
        Settings(_env_file=None, fire_model_path=str(invalid), fire_model_sha256="0" * 64)
    )
    with pytest.raises(FireDetectorError) as error:
        detector.detect(encoded(64, 48))
    assert error.value.code == "MODEL_NOT_LOADED"


def test_nonfinite_model_output_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    detector = FireDetector(Settings(_env_file=None))
    rows = np.zeros((1, 300, 6), dtype=np.float32)
    rows[0, 0, 4] = np.nan
    session = SimpleNamespace(
        get_inputs=lambda: [SimpleNamespace(name="images")], run=lambda _outputs, _inputs: [rows]
    )
    monkeypatch.setattr(detector, "_load", lambda: session)
    with pytest.raises(FireDetectorError) as error:
        detector.detect(encoded(64, 48))
    assert error.value.code == "FIRE_INFERENCE_FAILED"


def write_contract(path: Path, **updates: object) -> None:
    contract = {
        "modelSha256": "0" * 64,
        "predictionMode": "one-to-many-embedded-nms",
        "outputConfidenceFloor": 0.1,
        **updates,
    }
    path.with_suffix(".contract.json").write_text(json.dumps(contract), encoding="utf-8")


def test_embedded_nms_cannot_load_without_its_graph_floor_contract(tmp_path: Path) -> None:
    detector = FireDetector(Settings(_env_file=None, fire_model_path=str(tmp_path / "model.onnx")))
    with pytest.raises(ValueError, match="requires a deployment contract"):
        detector._validate_model_contract({"end2end": "False"})


def test_filter_floor_cannot_be_configured_below_the_embedded_floor(tmp_path: Path) -> None:
    path = tmp_path / "model.onnx"
    write_contract(path)
    settings = Settings(
        _env_file=None,
        fire_model_path=str(path),
        fire_model_sha256="0" * 64,
        fire_output_confidence_floor=0.05,
    )
    with pytest.raises(ValueError, match="below the embedded graph floor"):
        FireDetector(settings)._validate_model_contract({"end2end": "False"})
    settings.fire_output_confidence_floor = 0.1
    FireDetector(settings)._validate_model_contract({"end2end": "False"})


@pytest.mark.parametrize(
    "updates, message",
    [
        ({"modelSha256": "1" * 64}, "different model"),
        ({"predictionMode": "nms-free-one-to-one"}, "prediction mode"),
    ],
)
def test_sidecar_cannot_be_reused_for_a_different_artifact(
    tmp_path: Path, updates: dict[str, object], message: str
) -> None:
    path = tmp_path / "model.onnx"
    write_contract(path, **updates)
    detector = FireDetector(
        Settings(_env_file=None, fire_model_path=str(path), fire_model_sha256="0" * 64)
    )
    with pytest.raises(ValueError, match=message):
        detector._validate_model_contract({"end2end": "False"})


def test_historical_nms_free_export_remains_loadable_without_a_sidecar(tmp_path: Path) -> None:
    detector = FireDetector(Settings(_env_file=None, fire_model_path=str(tmp_path / "legacy.onnx")))
    detector._validate_model_contract({"end2end": "True"})
