"""Bounded inference orchestration, deadline handling and temporal evidence."""

import logging
import time
from datetime import UTC, datetime
from threading import BoundedSemaphore

from app.config import Settings
from app.models.fire import FireFrame, FireInferenceError, FireResponse
from app.services.fire_detector import FireDetector, FireDetectorError, FireImageTooLargeError
from app.services.fire_health import FireHealth
from app.services.fire_tracker import FireTracker

LOGGER = logging.getLogger(__name__)


class FireService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.detector = FireDetector(settings)
        self.tracker = FireTracker(settings)
        self.slots = BoundedSemaphore(settings.fire_max_concurrent_requests)
        self.health = FireHealth(settings.m3_enabled, settings.fire_model_version)

    def process(self, frame: FireFrame, data: bytes) -> FireResponse:
        started = time.monotonic()
        result = None
        self.health.begin()
        try:
            result = self._process(frame, data)
            return result
        finally:
            self.health.finish(result, (time.monotonic() - started) * 1000)

    def _process(self, frame: FireFrame, data: bytes) -> FireResponse:
        now = datetime.now(UTC)
        if early := self.tracker.preflight(frame, now):
            return early
        if not self.settings.m3_enabled:
            return self.tracker.failure(
                frame, now, FireInferenceError(code="MODEL_NOT_LOADED", message="M3 is disabled.")
            )
        if not self.slots.acquire(blocking=False):
            return self.tracker.failure(
                frame,
                now,
                FireInferenceError(
                    code="PROVIDER_UNAVAILABLE", message="Fire inference capacity reached."
                ),
            )
        started = time.monotonic()
        try:
            detections = self.detector.detect(data)
            if (time.monotonic() - started) * 1000 > self.settings.fire_request_timeout_ms:
                raise FireDetectorError("TIMEOUT", "Fire inference deadline exceeded.")
            result = self.tracker.evaluate(frame, detections, datetime.now(UTC))
            if result.reason == "CONFIRMED":
                LOGGER.info(
                    "Fire episode confirmed camera=%s episode=%s modelVersion=%s",
                    frame.camera_slug,
                    result.episode_id,
                    result.model_version,
                )
            return result
        except FireImageTooLargeError:
            self.tracker.reset(frame.camera_slug)
            raise
        except FireDetectorError as error:
            LOGGER.warning("Fire inference error camera=%s code=%s", frame.camera_slug, error.code)
            return self.tracker.failure(
                frame, datetime.now(UTC), FireInferenceError(code=error.code, message=str(error))
            )
        finally:
            self.slots.release()
