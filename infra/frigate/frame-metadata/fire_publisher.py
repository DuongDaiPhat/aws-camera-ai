"""Bounded full-frame M3 publisher for the pinned Frigate 0.18 YUV shared frames."""

import json
import logging
import os
import struct
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Condition, Thread
from typing import Any
from uuid import uuid4

import cv2

LOGGER = logging.getLogger(__name__)
MAX_HEADER_BYTES = 32 * 1024


@dataclass(frozen=True)
class FirePublisherSettings:
    enabled: bool = False
    topic: str = "frigate/camerai/fire/frames"
    sample_fps: float = 5
    max_bytes: int = 1_048_576
    max_pixels: int = 2_073_600
    max_cameras: int = 16
    jpeg_quality: int = 85
    max_age_seconds: float = 1
    future_tolerance_seconds: float = 0.5

    @classmethod
    def from_env(cls) -> "FirePublisherSettings":
        settings = cls(
            enabled=os.getenv("FRIGATE_FIRE_FRAMES_ENABLED", "false").lower() == "true",
            topic=os.getenv("MQTT_TOPIC_FIRE_FRAMES", "frigate/camerai/fire/frames"),
            sample_fps=float(os.getenv("FIRE_SAMPLE_FPS", "5")),
            max_bytes=int(os.getenv("FIRE_MAX_IMAGE_BYTES", "1048576")),
            max_pixels=int(os.getenv("FIRE_MAX_IMAGE_PIXELS", "2073600")),
            max_cameras=int(os.getenv("FIRE_MAX_CAMERAS", "16")),
            jpeg_quality=int(os.getenv("FIRE_JPEG_QUALITY", "85")),
            max_age_seconds=float(os.getenv("FIRE_FRAME_MAX_AGE_SECONDS", "1")),
            future_tolerance_seconds=float(
                os.getenv("FIRE_FRAME_FUTURE_TOLERANCE_SECONDS", "0.5")
            ),
        )
        if (
            not 0 < settings.sample_fps <= 5
            or not 1 <= settings.jpeg_quality <= 100
            or settings.future_tolerance_seconds < 0
        ):
            raise ValueError("Invalid fire publisher sampling/quality")
        if (
            min(
                settings.max_bytes,
                settings.max_pixels,
                settings.max_cameras,
                settings.max_age_seconds,
            )
            <= 0
        ):
            raise ValueError("Invalid fire publisher limits")
        return settings


class FireFramePublisher:
    def __init__(
        self,
        settings: FirePublisherSettings,
        cameras: dict[str, Any],
        frame_manager: Any,
        client: Any,
    ) -> None:
        self.settings = settings
        self.cameras = cameras
        self.frame_manager = frame_manager
        self.client = client
        self.session_id = str(uuid4())
        self.last_frame: dict[str, float] = {}
        self.pending: dict[str, deque[tuple[dict[str, Any], Any]]] = {}
        self.condition = Condition()
        self.stopped = False
        self.worker = Thread(target=self._run, name="camerai-fire-frames", daemon=True)
        if settings.enabled:
            self.worker.start()

    def enqueue(self, payload: list[Any]) -> None:
        if not self.settings.enabled:
            return
        camera, name, timestamp = payload[:3]
        camera_config = self.cameras.get(camera)
        if not camera_config or not camera_config.get("enabled", True):
            return
        if (
            camera not in self.last_frame
            and len(self.last_frame) >= self.settings.max_cameras
        ):
            return
        if (
            time.time() - timestamp > self.settings.max_age_seconds
            or timestamp > time.time() + self.settings.future_tolerance_seconds
        ):
            return
        if timestamp - self.last_frame.get(camera, 0) < 1 / self.settings.sample_fps:
            return
        self.last_frame[camera] = timestamp
        detect = camera_config.get("detect", {})
        width, height = int(detect.get("width", 1280)), int(detect.get("height", 720))
        if (
            min(width, height) <= 0
            or width % 2
            or height % 2
            or width * height > self.settings.max_pixels
        ):
            return
        # Copy while the owner still holds the segment; never delete/unlink Frigate memory.
        owned = self._copy_frame(name, width, height)
        if owned is None:
            return
        header = {
            "schemaVersion": 1,
            "cameraSlug": camera,
            "sourceSessionId": self.session_id,
            "frameId": f"{camera}:{timestamp:.6f}",
            "frameTimestamp": datetime.fromtimestamp(timestamp, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "frameWidth": width,
            "frameHeight": height,
        }
        with self.condition:
            queue = self.pending.setdefault(camera, deque(maxlen=2))
            queue.append((header, owned))
            self.condition.notify()

    def _copy_frame(self, name: str, width: int, height: int) -> Any:
        try:
            try:
                shared = self.frame_manager.get(name, (height * 3 // 2, width))
                if shared is None:
                    return None
                owned = shared.copy()
                del shared
                return owned
            finally:
                self.frame_manager.close(name)
        except (OSError, BufferError, ValueError) as error:
            # A slow subscriber can outlive an owner segment; preserve the metadata loop.
            LOGGER.debug("Fire shared frame unavailable: %s", type(error).__name__)
            return None

    def _publish(self, header: dict[str, Any], yuv: Any) -> None:
        at = datetime.fromisoformat(
            header["frameTimestamp"].replace("Z", "+00:00")
        ).timestamp()
        if time.time() - at > self.settings.max_age_seconds:
            return
        image = cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)
        success, jpeg = cv2.imencode(
            ".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), self.settings.jpeg_quality]
        )
        if not success or jpeg.nbytes > self.settings.max_bytes:
            return
        encoded_header = json.dumps(header, separators=(",", ":")).encode("utf-8")
        if len(encoded_header) > MAX_HEADER_BYTES:
            return
        envelope = (
            struct.pack(">I", len(encoded_header)) + encoded_header + jpeg.tobytes()
        )
        self.client.publish(self.settings.topic, envelope, qos=0, retain=False)

    def _run(self) -> None:
        while True:
            with self.condition:
                self.condition.wait_for(
                    lambda: self.stopped or any(self.pending.values())
                )
                if self.stopped:
                    return
                camera = next(key for key, queue in self.pending.items() if queue)
                work = self.pending[camera].popleft()
                if not self.pending[camera]:
                    del self.pending[camera]
            try:
                self._publish(*work)
            except (ValueError, TypeError, RuntimeError, OSError, cv2.error) as error:
                LOGGER.warning("Fire frame publish failed: %s", type(error).__name__)

    def close(self) -> None:
        with self.condition:
            self.stopped = True
            self.pending.clear()
            self.condition.notify_all()
        if self.worker.is_alive():
            self.worker.join(timeout=2)
