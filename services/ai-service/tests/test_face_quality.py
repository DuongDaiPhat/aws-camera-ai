"""Unit tests for Layer 2 local face quality gate (YuNet/SFace)."""

import io
from pathlib import Path
from unittest.mock import Mock

import cv2
import numpy as np
import pytest
from PIL import Image

from app.config import Settings, get_settings
from app.services.embedding_codec import decode
from app.services.face_quality import FaceQualityAssessor


def _sharp_picture(width: int = 240, height: int = 240) -> bytes:
    """Create a crisp checkerboard-textured PNG with high Laplacian variance."""
    yy, xx = np.indices((height, width))
    pattern = (((xx // 4) + (yy // 4)) % 2 * 220 + 20).astype(np.uint8)
    rgb = np.stack([pattern, pattern, pattern], axis=-1)
    out = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(out, format="PNG")
    return out.getvalue()


def _blurry_picture(width: int = 240, height: int = 240) -> bytes:
    """Create a smooth uniform PNG with near-zero Laplacian variance."""
    rgb = np.full((height, width, 3), 128, dtype=np.uint8)
    out = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(out, format="PNG")
    return out.getvalue()


def _yunet_face(
    *,
    x: float = 40.0,
    y: float = 40.0,
    w: float = 120.0,
    h: float = 120.0,
    nose_x: float | None = None,
    nose_y: float | None = None,
    score: float = 0.92,
) -> list[float]:
    rx, ry = x + 0.30 * w, y + 0.35 * h
    lx, ly = x + 0.70 * w, y + 0.35 * h
    nx = (x + 0.50 * w) if nose_x is None else nose_x
    ny = (y + 0.55 * h) if nose_y is None else nose_y
    rmx, rmy = x + 0.35 * w, y + 0.75 * h
    lmx, lmy = x + 0.65 * w, y + 0.75 * h
    return [x, y, w, h, rx, ry, lx, ly, nx, ny, rmx, rmy, lmx, lmy, score]


def _fake_assessor(
    faces: list[list[float]], *, settings: Settings | None = None
) -> FaceQualityAssessor:
    assessor = FaceQualityAssessor(settings or Settings())
    assessor._detector = Mock()
    assessor._detector.detect.return_value = (
        1,
        np.asarray(faces, dtype=np.float32) if faces else None,
    )
    assessor._recognizer = Mock()
    assessor._recognizer.alignCrop.return_value = np.zeros((112, 112, 3), dtype=np.uint8)
    assessor._recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)
    return assessor


def test_face_quality_gate_defaults_and_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = Settings(_env_file=None)
    assert defaults.face_quality_gate_enabled is True
    assert defaults.face_gate_min_face_px == 60
    assert defaults.face_gate_min_detection_score == 0.75
    assert defaults.face_gate_min_sharpness == 45.0
    assert defaults.face_gate_max_yaw_ratio == 0.45
    assert defaults.face_gate_max_pitch_ratio == 0.45

    monkeypatch.setenv("FACE_QUALITY_GATE_ENABLED", "false")
    monkeypatch.setenv("FACE_GATE_MIN_FACE_PX", "80")
    monkeypatch.setenv("FACE_GATE_MIN_DETECTION_SCORE", "0.8")
    monkeypatch.setenv("FACE_GATE_MIN_SHARPNESS", "60.5")
    monkeypatch.setenv("FACE_GATE_MAX_YAW_RATIO", "0.35")
    monkeypatch.setenv("FACE_GATE_MAX_PITCH_RATIO", "0.40")
    get_settings.cache_clear()
    try:
        loaded = get_settings()
        assert loaded.face_quality_gate_enabled is False
        assert loaded.face_gate_min_face_px == 80
        assert loaded.face_gate_min_detection_score == 0.8
        assert loaded.face_gate_min_sharpness == 60.5
        assert loaded.face_gate_max_yaw_ratio == 0.35
        assert loaded.face_gate_max_pitch_ratio == 0.40
    finally:
        get_settings.cache_clear()


def test_quality_gate_loads_local_models_independently_of_face_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    detector_mock = Mock()
    detector_mock.detect.return_value = (1, np.asarray([_yunet_face()], dtype=np.float32))
    recognizer_mock = Mock()
    recognizer_mock.alignCrop.return_value = np.zeros((112, 112, 3), dtype=np.uint8)
    recognizer_mock.feature.return_value = np.ones((1, 128), dtype=np.float32)

    monkeypatch.setattr(Path, "is_file", lambda _self: True)
    monkeypatch.setattr(cv2.FaceDetectorYN, "create", Mock(return_value=detector_mock))
    monkeypatch.setattr(cv2.FaceRecognizerSF, "create", Mock(return_value=recognizer_mock))

    settings = Settings(_env_file=None, face_provider="rekognition")
    assessor = FaceQualityAssessor(settings)
    result = assessor.assess(_sharp_picture(), include_embedding=True)

    assert result.passed is True
    assert result.gate_status == "READY"
    assert result.rejection_reason is None
    assert result.embedding_dim == 128
    assert result.embedding_base64 is not None
    assert len(decode(result.embedding_base64, 128)) == 128


def test_missing_models_degrades_gracefully_to_unavailable(tmp_path: Path) -> None:
    missing = str(tmp_path / "missing.onnx")
    assessor = FaceQualityAssessor(
        Settings(_env_file=None, face_provider="rekognition", face_detector_path=missing)
    )
    result = assessor.assess(_sharp_picture())
    assert result.passed is False
    assert result.gate_status == "UNAVAILABLE"
    assert result.rejection_reason == "MODEL_UNAVAILABLE"
    assert result.quality_score == 0.0
    assert result.face_count == 0
    assert result.embedding_base64 is None


def test_opencv_runtime_error_degrades_to_unavailable() -> None:
    assessor = _fake_assessor([])
    assessor._detector.detect.side_effect = cv2.error("boom")
    result = assessor.assess(_sharp_picture())
    assert result.passed is False
    assert result.gate_status == "UNAVAILABLE"
    assert result.rejection_reason == "MODEL_UNAVAILABLE"


def test_disabled_gate_bypasses_without_loading_models(tmp_path: Path) -> None:
    assessor = FaceQualityAssessor(
        Settings(
            _env_file=None,
            face_quality_gate_enabled=False,
            face_detector_path=str(tmp_path / "missing.onnx"),
        )
    )
    result = assessor.assess(b"anything")
    assert result.passed is True
    assert result.gate_status == "DISABLED"
    assert result.rejection_reason is None
    assert result.face_count == 0


def test_invalid_images_and_limits_rejected() -> None:
    assessor = _fake_assessor([_yunet_face()])
    for payload in [b"", b"not-an-image"]:
        res = assessor.assess(payload)
        assert res.passed is False
        assert res.gate_status == "READY"
        assert res.rejection_reason == "IMAGE_DECODE_FAILED"

    small_bytes_assessor = _fake_assessor(
        [_yunet_face()], settings=Settings(face_max_image_bytes=5)
    )
    assert small_bytes_assessor.assess(_sharp_picture()).rejection_reason == "IMAGE_DECODE_FAILED"

    small_px_assessor = _fake_assessor([_yunet_face()], settings=Settings(face_max_pixels=10))
    assert small_px_assessor.assess(_sharp_picture()).rejection_reason == "IMAGE_DECODE_FAILED"


def test_face_count_rejections() -> None:
    zero = _fake_assessor([]).assess(_sharp_picture())
    assert zero.passed is False
    assert zero.face_count == 0
    assert zero.rejection_reason == "NO_FACE_DETECTED"
    assert zero.metrics is None
    assert zero.bounding_box is None

    two = _fake_assessor([_yunet_face(x=10), _yunet_face(x=120)]).assess(_sharp_picture())
    assert two.passed is False
    assert two.face_count == 2
    assert two.rejection_reason == "MULTIPLE_FACES"
    assert two.metrics is None


@pytest.mark.parametrize(
    "face_kwargs",
    [
        {"w": 50.0, "h": 90.0},
        {"w": 90.0, "h": 59.0},
    ],
)
def test_face_too_small_rejected(face_kwargs: dict[str, float]) -> None:
    assessor = _fake_assessor([_yunet_face(**face_kwargs)])
    res = assessor.assess(_sharp_picture())
    assert res.passed is False
    assert res.face_count == 1
    assert res.rejection_reason == "FACE_TOO_SMALL"
    assert res.metrics is not None
    assert res.bounding_box is not None
    assert res.embedding_base64 is None


def test_low_detection_score_rejected() -> None:
    assessor = _fake_assessor([_yunet_face(score=0.70)])
    res = assessor.assess(_sharp_picture())
    assert res.passed is False
    assert res.rejection_reason == "LOW_DETECTION_SCORE"
    assert res.metrics is not None
    assert res.metrics.detection_score == pytest.approx(0.7, abs=1e-4)
    assert res.embedding_base64 is None


def test_blurry_face_roi_rejected() -> None:
    assessor = _fake_assessor([_yunet_face()])
    res = assessor.assess(_blurry_picture())
    assert res.passed is False
    assert res.rejection_reason == "BLURRY"
    assert res.metrics is not None
    assert res.metrics.sharpness < 45.0
    assert res.embedding_base64 is None


def test_extreme_yaw_and_pitch_rejected() -> None:
    # Eyes at x=40+36=76 and x=40+84=124 (mid=100, dist=48); nose at 125 -> yaw_ratio > 0.50 > 0.45
    yaw_face = _yunet_face(nose_x=125.0)
    yaw_res = _fake_assessor([yaw_face]).assess(_sharp_picture())
    assert yaw_res.passed is False
    assert yaw_res.rejection_reason == "EXTREME_POSE"
    assert yaw_res.metrics is not None
    assert yaw_res.metrics.pose_yaw_ratio > 0.45

    # Eye mid y = 40+42=82, mouth mid y = 40+90=130 (dist=48); nose at y=82 -> pitch_ratio = 0.50 > 0.45
    pitch_face = _yunet_face(nose_y=82.0)
    pitch_res = _fake_assessor([pitch_face]).assess(_sharp_picture())
    assert pitch_res.passed is False
    assert pitch_res.rejection_reason == "EXTREME_POSE"
    assert pitch_res.metrics is not None
    assert pitch_res.metrics.pose_pitch_ratio > 0.45


def test_passing_face_embedding_toggle_scaling_and_score_ordering() -> None:
    good_face = _yunet_face(x=200.0, y=200.0, w=200.0, h=200.0, score=0.96)
    # Scaled input image (> 640px) simulates rescale inside _detect_faces
    assessor = FaceQualityAssessor(Settings(_env_file=None))
    assessor._detector = Mock()
    # Detector sees 640x640 (scale = 0.8 from 800x800), so return scaled coords
    scaled = np.asarray(good_face, dtype=np.float32)
    scaled[:14] = scaled[:14] * 0.8
    assessor._detector.detect.return_value = (1, np.asarray([scaled], dtype=np.float32))
    assessor._recognizer = Mock()
    assessor._recognizer.alignCrop.return_value = np.zeros((112, 112, 3), dtype=np.uint8)
    assessor._recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)

    passed_with_emb = assessor.assess(_sharp_picture(800, 800), include_embedding=True)
    assert passed_with_emb.passed is True
    assert passed_with_emb.gate_status == "READY"
    assert passed_with_emb.rejection_reason is None
    assert passed_with_emb.metrics is not None
    assert passed_with_emb.metrics.face_width_px == 200
    assert passed_with_emb.metrics.face_height_px == 200
    assert passed_with_emb.embedding_dim == 128
    assert passed_with_emb.embedding_base64 is not None
    assert 0.8 <= passed_with_emb.quality_score <= 1.0

    assessor_no_emb = _fake_assessor([_yunet_face(w=70.0, h=70.0, score=0.77, nose_x=82.0)])
    borderline = assessor_no_emb.assess(_sharp_picture(), include_embedding=False)
    assert borderline.passed is True
    assert borderline.embedding_base64 is None
    assert borderline.embedding_dim is None
    assessor_no_emb._recognizer.feature.assert_not_called()
    assert 0.0 <= borderline.quality_score < passed_with_emb.quality_score


def test_degenerate_landmarks_out_of_bounds_roi_and_zero_embedding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Degenerate eye/mouth landmarks -> yaw/pitch = 1.0 -> EXTREME_POSE
    degenerate = [
        40.0,
        40.0,
        100.0,
        100.0,
        50.0,
        50.0,
        50.0,
        50.0,
        50.0,
        50.0,
        50.0,
        50.0,
        50.0,
        50.0,
        0.9,
    ]
    res_deg = _fake_assessor([degenerate]).assess(_sharp_picture())
    assert res_deg.passed is False
    assert res_deg.rejection_reason == "EXTREME_POSE"

    # Out-of-bounds box -> empty ROI -> sharpness 0.0 -> BLURRY
    oob = [
        500.0,
        500.0,
        100.0,
        100.0,
        530.0,
        535.0,
        570.0,
        535.0,
        550.0,
        555.0,
        535.0,
        575.0,
        565.0,
        575.0,
        0.9,
    ]
    res_oob = _fake_assessor([oob]).assess(_sharp_picture())
    assert res_oob.passed is False
    assert res_oob.rejection_reason == "BLURRY"
    assert res_oob.metrics is not None
    assert res_oob.metrics.sharpness == 0.0

    # Zero-norm embedding vector handled cleanly without crashing
    assessor_zero = _fake_assessor([_yunet_face()])
    assessor_zero._recognizer.feature.return_value = np.zeros((1, 128), dtype=np.float32)
    res_zero = assessor_zero.assess(_sharp_picture(), include_embedding=True)
    assert res_zero.passed is True
    assert res_zero.embedding_base64 is None
    assert res_zero.embedding_dim is None

    # Lazy recognizer load when detector already loaded but embedder missing
    assessor_missing_emb = FaceQualityAssessor(
        Settings(_env_file=None, face_embedder_path="/does/not/exist.onnx")
    )
    assessor_missing_emb._detector = Mock()
    assessor_missing_emb._detector.detect.return_value = (
        1,
        np.asarray([_yunet_face()], dtype=np.float32),
    )
    res_missing = assessor_missing_emb.assess(_sharp_picture(), include_embedding=True)
    assert res_missing.passed is False
    assert res_missing.gate_status == "UNAVAILABLE"
    assert res_missing.rejection_reason == "MODEL_UNAVAILABLE"

    monkeypatch.setattr(Path, "is_file", lambda _self: True)
    rec_mock = Mock()
    rec_mock.alignCrop.return_value = np.zeros((112, 112, 3), dtype=np.uint8)
    rec_mock.feature.return_value = np.ones((1, 128), dtype=np.float32)
    monkeypatch.setattr(cv2.FaceRecognizerSF, "create", Mock(return_value=rec_mock))
    res_lazy = assessor_missing_emb.assess(_sharp_picture(), include_embedding=True)
    assert res_lazy.passed is True
    assert res_lazy.embedding_dim == 128
