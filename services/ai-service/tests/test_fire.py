"""M3 HTTP admission and technical failures preserve contract and M1 health."""

from datetime import UTC, datetime
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import app
from app.models.fire import FireBoundingBox, FireDetection
from app.routers.face import authenticate
from app.routers.fire import get_fire_service
from app.services.fire_service import FireService


@pytest.fixture
def fire_client(monkeypatch: pytest.MonkeyPatch):
    service = FireService(Settings(_env_file=None, m3_enabled=True))
    app.dependency_overrides[authenticate] = lambda: None
    monkeypatch.setattr("app.routers.fire.get_fire_service", lambda: service)
    yield TestClient(app), service
    app.dependency_overrides.clear()
    get_fire_service.cache_clear()


def jpeg() -> bytes:
    stream = BytesIO()
    Image.new("RGB", (64, 48)).save(stream, format="JPEG")
    return stream.getvalue()


def request(client: TestClient, data: bytes, **fields: str):
    body = {"cameraSlug": "room", "frameTimestamp": datetime.now(UTC).isoformat(), **fields}
    return client.post(
        "/fire/detect", files={"image": ("frame.jpg", data, "image/jpeg")}, data=body
    )


def test_token_is_required() -> None:
    app.dependency_overrides.clear()
    assert request(TestClient(app), jpeg()).status_code == 401


def test_decode_and_missing_model_return_error_200(fire_client) -> None:
    client, _ = fire_client
    response = request(client, b"not an image")
    assert response.status_code == 200
    assert response.json()["error"]["code"] == "IMAGE_DECODE_FAILED"
    response = request(client, jpeg())
    assert response.status_code == 200
    assert response.json()["error"]["code"] == "MODEL_NOT_LOADED"
    assert client.get("/health").status_code == 200


def test_invalid_timezone_and_oversize_rejected(fire_client) -> None:
    client, _ = fire_client
    assert request(client, jpeg(), frameTimestamp="2026-10-26T00:00:00").status_code == 422
    assert request(client, jpeg(), frameTimestamp="1792993000").status_code == 422
    assert request(client, jpeg(), frameTimestamp="2026-10-26 00:00:00+00:00").status_code == 422
    assert request(client, b"x" * 1_048_577).status_code == 413


def test_three_real_http_observations_confirm_and_duplicate_replays(
    fire_client, monkeypatch
) -> None:
    client, service = fire_client
    monkeypatch.setattr(
        service.detector,
        "detect",
        lambda _data: [
            FireDetection(
                label="smoke",
                confidence=0.9,
                bounding_box=FireBoundingBox(x=0.1, y=0.2, width=0.3, height=0.4),
            )
        ],
    )
    # Numeric detector fixtures exercise HTTP/temporal integration, not model quality.
    for index in range(3):
        response = request(client, jpeg(), frameId=f"frame-{index}")
        assert response.status_code == 200
        result = response.json()
        assert result["confirmed"] == (index == 2)
    assert result["incidentConfidence"] == 0.9
    replay = request(client, jpeg(), frameId="frame-2", frameTimestamp=result["observedAt"])
    assert replay.json()["isReplay"]
