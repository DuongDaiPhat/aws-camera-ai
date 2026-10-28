"""Readiness must not mistake liveness, stale requests or failed inference for success."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.fire import FireFrame
from app.routers.face import authenticate
from app.services.fire_service import FireService


def frame(age_seconds: int = 0) -> FireFrame:
    return FireFrame(
        camera_slug="room",
        source_session_id="probe",
        frame_id=uuid4().hex,
        observed_at=datetime.now(UTC) - timedelta(seconds=age_seconds),
    )


@pytest.mark.parametrize("enabled,status", [(False, "DISABLED"), (True, "STARTING")])
def test_health_requires_internal_token_without_loading_model(monkeypatch, enabled, status) -> None:
    app.dependency_overrides.clear()
    service = FireService(Settings(_env_file=None, m3_enabled=enabled))
    monkeypatch.setattr("app.routers.fire.get_fire_service", lambda: service)
    client = TestClient(app)
    assert client.get("/fire/health").status_code == 401
    app.dependency_overrides[authenticate] = lambda: None
    try:
        health = client.get("/fire/health").json()
        assert health["status"] == status
        assert not health["modelLoaded"]
        assert health["requestCount"] == 0
    finally:
        app.dependency_overrides.clear()


def test_failure_then_fresh_success_recovers_without_erasing_error_history(monkeypatch) -> None:
    service = FireService(Settings(_env_file=None, m3_enabled=True))
    assert service.health.snapshot(False).status == "STARTING"
    failed_frame = frame()
    failed_frame.observed_at -= timedelta(milliseconds=100)
    service.process(failed_frame, b"not an image")
    failed = service.health.snapshot(False)
    assert failed.status == "DEGRADED"
    assert failed.error_count == 1
    assert failed.last_error_code == "IMAGE_DECODE_FAILED"
    assert failed.in_flight == 0
    monkeypatch.setattr(service.detector, "detect", lambda _: [])
    recovered_frame = failed_frame.model_copy(
        update={
            "frame_id": uuid4().hex,
            "observed_at": failed_frame.observed_at + timedelta(milliseconds=50),
        }
    )
    response = service.process(recovered_frame, b"test numeric detector fixture")
    assert response.reason == "NEGATIVE"
    recovered = service.health.snapshot(True)
    assert recovered.status == "READY"
    assert recovered.error_count == 1
    assert recovered.last_success_at is not None
    assert recovered.request_count == 2
    assert recovered.in_flight == 0


def test_stale_and_capacity_rejected_requests_do_not_claim_readiness() -> None:
    service = FireService(Settings(_env_file=None, m3_enabled=True))
    service.process(frame(5), b"not decoded")
    stale = service.health.snapshot(False)
    assert stale.status == "STARTING"
    assert stale.stale_frame_count == 1
    assert stale.last_success_at is None
    assert service.slots.acquire(blocking=False)
    try:
        service.process(frame(), b"not decoded")
    finally:
        service.slots.release()
    rejected = service.health.snapshot(False)
    assert rejected.status == "DEGRADED"
    assert rejected.capacity_rejected_count == 1
    assert rejected.in_flight == 0
    assert rejected.last_success_at is None
    assert FireService(service.settings).health.instance_id != service.health.instance_id
