"""Unit tests cho router POST /pose/fall (US-16 / US-17 contract)."""

import io
from collections.abc import Generator
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings, get_settings
from app.main import app
from app.routers import pose
from app.services.pose_estimator import PoseEstimator
from app.services.pose_geometry import PoseGeometry


def make_test_image_bytes(w: int = 100, h: int = 100) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (w, h), color=(128, 128, 128)).save(output, format="JPEG")
    return output.getvalue()


@pytest.fixture
def client_with_token(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    test_settings = Settings(ai_internal_token="secret-token-123")
    monkeypatch.setattr(pose, "get_settings", lambda: test_settings)
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_evaluate_fall_auth_required(client_with_token: TestClient) -> None:
    img = make_test_image_bytes()
    data = {
        "trackId": "person-1",
        "cameraSlug": "cam-front",
        "frameTimestamp": "2026-10-11T12:00:00.000Z",
    }
    # Khong truyen token -> 401
    resp = client_with_token.post("/pose/fall", data=data, files={"image": ("frame.jpg", img)})
    assert resp.status_code == 401

    # Token sai -> 401
    resp_bad = client_with_token.post(
        "/pose/fall",
        data=data,
        files={"image": ("frame.jpg", img)},
        headers={"X-Internal-Token": "wrong-token"},
    )
    assert resp_bad.status_code == 401


def test_evaluate_fall_timestamp_validation(client_with_token: TestClient) -> None:
    img = make_test_image_bytes()
    headers = {"X-Internal-Token": "secret-token-123"}
    data = {
        "trackId": "person-1",
        "cameraSlug": "cam-front",
        "frameTimestamp": "invalid-timestamp",
    }
    resp = client_with_token.post(
        "/pose/fall", data=data, files={"image": ("frame.jpg", img)}, headers=headers
    )
    assert resp.status_code == 422


def test_evaluate_fall_bbox_validation(client_with_token: TestClient) -> None:
    img = make_test_image_bytes()
    headers = {"X-Internal-Token": "secret-token-123"}
    data = {
        "trackId": "person-1",
        "cameraSlug": "cam-front",
        "frameTimestamp": "2026-10-11T12:00:00.000Z",
        "personBoundingBox": "invalid-json",
    }
    resp = client_with_token.post(
        "/pose/fall", data=data, files={"image": ("frame.jpg", img)}, headers=headers
    )
    assert resp.status_code == 422


def test_evaluate_fall_corrupt_image(client_with_token: TestClient) -> None:
    headers = {"X-Internal-Token": "secret-token-123"}
    data = {
        "trackId": "person-1",
        "cameraSlug": "cam-front",
        "frameTimestamp": "2026-10-11T12:00:00.000Z",
    }
    resp = client_with_token.post(
        "/pose/fall",
        data=data,
        files={"image": ("frame.jpg", b"corrupted-data")},
        headers=headers,
    )
    assert resp.status_code == 200
    json_data = resp.json()
    assert json_data["error"] is not None
    assert json_data["error"]["code"] == "IMAGE_DECODE_FAILED"
    assert json_data["state"] == "MONITORING"


def test_evaluate_fall_success_flow(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    img = make_test_image_bytes(200, 200)
    headers = {"X-Internal-Token": "secret-token-123"}
    data = {
        "trackId": "person-1",
        "cameraSlug": "cam-front",
        "frameTimestamp": "2026-10-11T12:00:00.000Z",
        "frameId": "frame-001",
        "sourceSessionId": "session-abc",
        "personBoundingBox": '{"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.8}',
        "inRestArea": "false",
    }

    mock_geom = PoseGeometry(
        torso_angle_deg=85.0,
        center_height=0.6,
        aspect_ratio=2.5,
        center_y_px=300.0,
        bbox_height_px=200.0,
        bbox_width_px=80.0,
        keypoints_detected=33,
    )

    mock_estimator = Mock(spec=PoseEstimator)
    mock_estimator.estimate.return_value = (
        [],
        mock_geom,
        True,
        "NORMAL_POSTURE",
    )
    monkeypatch.setattr(PoseEstimator, "get_instance", lambda: mock_estimator)

    resp = client_with_token.post(
        "/pose/fall", data=data, files={"image": ("frame.jpg", img)}, headers=headers
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["trackId"] == "person-1"
    assert result["cameraSlug"] == "cam-front"
    assert result["sourceSessionId"] == "session-abc"
    assert result["state"] == "MONITORING"
    assert result["torsoAngleDeg"] == 85.0
    assert result["poseAvailable"] is True
    assert result["error"] is None
