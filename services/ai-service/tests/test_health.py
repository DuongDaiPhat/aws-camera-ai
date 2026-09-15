"""Smoke test cho /health — dam bao app khoi tao duoc va cau hinh doc duoc."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_tra_ve_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-service"
    assert body["uptime_seconds"] >= 0


def test_health_bao_cao_face_provider_dang_bat() -> None:
    """Feature flag US-24 phai quan sat duoc tu ben ngoai."""
    body = client.get("/health").json()

    assert body["face_provider"] in {"local", "rekognition"}
