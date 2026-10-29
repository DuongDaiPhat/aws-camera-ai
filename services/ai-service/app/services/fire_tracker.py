"""Bounded camera hazard sequences and observed-negative episode rearming."""

import json
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock
from uuid import NAMESPACE_URL, uuid5

from app.config import Settings
from app.models.fire import FireDetection, FireFrame, FireInferenceError, FireReason, FireResponse

REPLAY_CACHE_SIZE = 256


def canonical_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class QualifiedFrame:
    frame: FireFrame
    score: float


@dataclass
class CameraState:
    session: str
    last_observed: datetime | None = None
    candidates: list[QualifiedFrame] = field(default_factory=list)
    confirmed: FireResponse | None = None
    negative_since: datetime | None = None
    retired_sessions: deque[str] = field(default_factory=lambda: deque(maxlen=32))
    responses: OrderedDict[str, FireResponse] = field(default_factory=OrderedDict)


class FireTracker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.states: dict[str, CameraState] = {}
        self.lock = RLock()

    def response(
        self, frame: FireFrame, now: datetime, reason: FireReason, **values: object
    ) -> FireResponse:
        return FireResponse.model_validate(
            {
                **frame.model_dump(),
                "model_version": self.settings.fire_model_version,
                "processed_at": now,
                "required_frames": self.settings.fire_min_consecutive_frames,
                "window_seconds": self.settings.fire_confirmation_window_seconds,
                "max_frame_gap_seconds": self.settings.fire_max_frame_gap_seconds,
                "threshold_used": self.settings.fire_confidence_threshold,
                "reason": reason,
                **values,
            }
        )

    def preflight(self, frame: FireFrame, now: datetime) -> FireResponse | None:
        """Do not infer/count duplicates, old timestamps or retired source sessions."""
        with self.lock:
            state = self.states.get(frame.camera_slug)
            if (
                state
                and state.session == frame.source_session_id
                and frame.frame_id in state.responses
            ):
                cached = state.responses[frame.frame_id]
                if cached.observed_at != frame.observed_at:
                    return self.response(frame, now, "OUT_OF_ORDER")
                return cached.model_copy(deep=True, update={"is_replay": True, "reason": "REPLAY"})
            age = (now - frame.observed_at).total_seconds()
            if (
                age > self.settings.fire_frame_max_age_seconds
                or age < -self.settings.fire_frame_future_tolerance_seconds
            ):
                return self.response(frame, now, "STALE_FRAME")
            if state and (
                frame.source_session_id in state.retired_sessions
                or (state.last_observed is not None and frame.observed_at <= state.last_observed)
            ):
                return self.response(frame, now, "OUT_OF_ORDER")
            return None

    def reset(self, camera_slug: str) -> None:
        with self.lock:
            if state := self.states.get(camera_slug):
                state.candidates.clear()
                state.negative_since = None

    def sweep(self, now: datetime) -> None:
        """Silence expires evidence; it never confirms or clears an active episode."""
        with self.lock:
            for state in self.states.values():
                if (
                    state.last_observed
                    and (now - state.last_observed).total_seconds()
                    > self.settings.fire_max_frame_gap_seconds
                ):
                    state.candidates.clear()
                    state.negative_since = None

    def failure(self, frame: FireFrame, now: datetime, error: FireInferenceError) -> FireResponse:
        with self.lock:
            self.reset(frame.camera_slug)
            state = self._state(frame)
            if state and (state.last_observed is None or frame.observed_at > state.last_observed):
                state.last_observed = frame.observed_at
            return self.response(frame, now, "INFERENCE_ERROR", error=error)

    def _state(self, frame: FireFrame) -> CameraState | None:
        state = self.states.get(frame.camera_slug)
        if state is None:
            if len(self.states) >= self.settings.fire_max_cameras:
                return None
            state = CameraState(session=frame.source_session_id)
            self.states[frame.camera_slug] = state
        elif state.session != frame.source_session_id:
            retired = state.retired_sessions
            retired.append(state.session)
            state = CameraState(session=frame.source_session_id, retired_sessions=retired)
            self.states[frame.camera_slug] = state
        return state

    def evaluate(
        self, frame: FireFrame, detections: list[FireDetection], now: datetime
    ) -> FireResponse:
        # Ignore legacy/non-fire predictions even when an adapter bypasses model validation.
        detections = [item for item in detections if item.label == "fire"]
        with self.lock:
            if early := self.preflight(frame, now):
                return early
            state = self._state(frame)
            if state is None:
                return self.failure(
                    frame,
                    now,
                    FireInferenceError(
                        code="PROVIDER_UNAVAILABLE", message="Fire camera state capacity reached."
                    ),
                )
            score = max((item.confidence for item in detections), default=None)
            gap = (
                state.last_observed is not None
                and (frame.observed_at - state.last_observed).total_seconds()
                > self.settings.fire_max_frame_gap_seconds
            )
            if gap:
                state.candidates.clear()
                state.negative_since = None
            state.last_observed = frame.observed_at
            if score is None or score < self.settings.fire_confidence_threshold:
                response = self._negative(state, frame, now, detections, score)
            else:
                response = self._positive(state, frame, now, detections, score, gap)
            state.responses[frame.frame_id] = response.model_copy(deep=True)
            if len(state.responses) > REPLAY_CACHE_SIZE:
                state.responses.popitem(last=False)
            return response

    def _negative(
        self,
        state: CameraState,
        frame: FireFrame,
        now: datetime,
        detections: list[FireDetection],
        score: float | None,
    ) -> FireResponse:
        state.candidates.clear()
        if state.confirmed:
            state.negative_since = state.negative_since or frame.observed_at
            if (
                frame.observed_at - state.negative_since
            ).total_seconds() >= self.settings.fire_clear_seconds:
                state.confirmed = None
                state.negative_since = None
        return self.response(
            frame,
            now,
            "NEGATIVE" if score is None else "BELOW_THRESHOLD",
            detections=detections,
            max_confidence=score,
        )

    def _positive(
        self,
        state: CameraState,
        frame: FireFrame,
        now: datetime,
        detections: list[FireDetection],
        score: float,
        gap: bool,
    ) -> FireResponse:
        state.negative_since = None
        if state.confirmed:
            frozen_evidence = state.confirmed.model_dump(
                exclude={
                    "camera_slug",
                    "source_session_id",
                    "frame_id",
                    "observed_at",
                    "processed_at",
                    "reason",
                    "detections",
                    "max_confidence",
                    "model_version",
                    "required_frames",
                    "window_seconds",
                    "max_frame_gap_seconds",
                    "threshold_used",
                }
            )
            return self.response(
                frame,
                now,
                "ACTIVE_EPISODE",
                **frozen_evidence,
                detections=detections,
                max_confidence=score,
            )
        before = len(state.candidates)
        state.candidates = [
            item
            for item in state.candidates
            if (frame.observed_at - item.frame.observed_at).total_seconds()
            <= self.settings.fire_confirmation_window_seconds
        ]
        reason: FireReason = "FRAME_GAP" if gap else "INSUFFICIENT_FRAMES"
        if len(state.candidates) < before:
            reason = "WINDOW_EXPIRED"
        state.candidates.append(QualifiedFrame(frame=frame, score=score))
        evidence = state.candidates[-self.settings.fire_min_consecutive_frames :]
        confirmed = len(evidence) >= self.settings.fire_min_consecutive_frames
        first_at = evidence[0].frame.observed_at
        identity = json.dumps(
            [frame.camera_slug, frame.source_session_id, canonical_timestamp(first_at)],
            separators=(",", ":"),
            ensure_ascii=False,
        )
        response = self.response(
            frame,
            now,
            "CONFIRMED" if confirmed else reason,
            detections=detections,
            max_confidence=score,
            confirmed=confirmed,
            consecutive_frames=len(evidence),
            episode_id=uuid5(NAMESPACE_URL, identity),
            first_qualified_at=first_at,
            confirmed_at=frame.observed_at if confirmed else None,
            qualifying_frame_ids=[item.frame.frame_id for item in evidence],
            qualifying_frame_timestamps=[item.frame.observed_at for item in evidence],
            incident_confidence=min(item.score for item in evidence) if confirmed else None,
        )
        if confirmed:
            state.confirmed = response.model_copy(deep=True)
            state.candidates.clear()
        return response
