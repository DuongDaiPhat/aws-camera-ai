"""Registry quan ly cac instance FallTracker theo (cameraSlug, sourceSessionId, trackId)."""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from app.config import get_settings
from app.services.fall_tracker import FallTracker

logger = logging.getLogger(__name__)


class FallTrackerRegistry:
    """Thread-safe registry quan ly toan bo trackers trong RAM."""

    _instance: FallTrackerRegistry | None = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.settings = get_settings()
        self._trackers: dict[tuple[str, str, str], FallTracker] = {}
        self._trackers_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> FallTrackerRegistry:
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        with cls._lock:
            if cls._instance is not None:
                cls._instance._trackers.clear()
                cls._instance = None

    def get_tracker(
        self,
        camera_slug: str,
        source_session_id: str,
        track_id: str,
    ) -> FallTracker:
        """Lay hoac tao moi tracker cho bo 3 dinh danh."""
        key = (camera_slug, source_session_id, track_id)
        with self._trackers_lock:
            tracker = self._trackers.get(key)
            if tracker is None:
                # Kiem tra gioi han toi da tracks
                if len(self._trackers) >= self.settings.pose_max_tracks:
                    # Evict tracker cu nhat
                    first_key = next(iter(self._trackers))
                    logger.warning(
                        "Max tracks %d reached, evicting %s",
                        self.settings.pose_max_tracks,
                        first_key,
                    )
                    del self._trackers[first_key]

                tracker = FallTracker(
                    camera_slug=camera_slug,
                    source_session_id=source_session_id,
                    track_id=track_id,
                )
                self._trackers[key] = tracker
            return tracker

    def sweep_all(self) -> int:
        """Quet tat ca trackers de xu ly missing grace timeout va don track TTL.

        Returns:
            So luong track da duoc don dep.
        """
        now = datetime.now(UTC)
        to_delete: list[tuple[str, str, str]] = []

        with self._trackers_lock:
            for key, tracker in list(self._trackers.items()):
                should_remove = tracker.sweep(now)
                if should_remove:
                    to_delete.append(key)

            for key in to_delete:
                del self._trackers[key]

        return len(to_delete)
