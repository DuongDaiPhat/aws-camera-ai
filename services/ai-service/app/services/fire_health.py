"""Thread-safe, bounded process counters without images or camera credentials."""

from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from app.models.fire import FireResponse
from app.models.fire_health import FireRuntimeHealth


class FireHealth:
    def __init__(self, enabled: bool, model_version: str) -> None:
        self.lock = Lock()
        self.enabled = enabled
        self.instance_id = uuid4()
        self.model_version = model_version
        self.requests = 0
        self.errors = 0
        self.stale = 0
        self.capacity = 0
        self.in_flight = 0
        self.last_request: datetime | None = None
        self.last_success: datetime | None = None
        self.last_error_code: str | None = None
        self.last_duration_ms: float | None = None
        self.failed = False

    def begin(self) -> None:
        with self.lock:
            self.requests += 1
            self.in_flight += 1
            self.last_request = datetime.now(UTC)

    def finish(self, result: FireResponse | None, duration_ms: float) -> None:
        with self.lock:
            self.in_flight -= 1
            self.last_duration_ms = duration_ms
            if result is None or result.error:
                self.errors += 1
                self.last_error_code = (
                    result.error.code if result and result.error else "REQUEST_FAILED"
                )
                self.capacity += int(self.last_error_code == "PROVIDER_UNAVAILABLE")
                self.failed = True
            elif result.reason == "STALE_FRAME":
                self.stale += 1
            elif not result.is_replay and result.reason != "OUT_OF_ORDER":
                self.last_success = datetime.now(UTC)
                self.failed = False

    def snapshot(self, model_loaded: bool) -> FireRuntimeHealth:
        with self.lock:
            if not self.enabled:
                status = "DISABLED"
            elif self.failed:
                status = "DEGRADED"
            else:
                status = "READY" if model_loaded and self.last_success else "STARTING"
            return FireRuntimeHealth(
                status=status,
                instance_id=self.instance_id,
                model_version=self.model_version,
                model_loaded=model_loaded,
                request_count=self.requests,
                error_count=self.errors,
                stale_frame_count=self.stale,
                capacity_rejected_count=self.capacity,
                in_flight=self.in_flight,
                last_request_at=self.last_request,
                last_success_at=self.last_success,
                last_error_code=self.last_error_code,
                last_duration_ms=self.last_duration_ms,
            )
