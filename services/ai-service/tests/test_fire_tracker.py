"""Temporal acceptance, replay, failure and rearm invariants for M3."""

from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.models.fire import FireBoundingBox, FireDetection, FireFrame, FireInferenceError
from app.services.fire_tracker import FireTracker

START = datetime(2026, 10, 26, tzinfo=UTC)


def frame(
    seconds: float, frame_id: str | None = None, camera: str = "room", session: str = "source-1"
) -> FireFrame:
    return FireFrame(
        camera_slug=camera,
        source_session_id=session,
        frame_id=frame_id or f"frame-{seconds}",
        observed_at=START + timedelta(seconds=seconds),
    )


def signal(score: float = 0.9, label: str = "fire") -> list[FireDetection]:
    return [
        FireDetection.model_validate(
            {
                "label": label,
                "confidence": score,
                "boundingBox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            }
        )
    ]


def observe(tracker: FireTracker, seconds: float, score: float | None = 0.9, **identity: str):
    item = frame(seconds, **identity)
    return tracker.evaluate(item, [] if score is None else signal(score), item.observed_at)


def test_confirm_three_unique_fire_frames_once() -> None:
    tracker = FireTracker(Settings(_env_file=None))
    first = observe(tracker, 0, 0.8)
    second = tracker.evaluate(frame(0.5), signal(0.9), frame(0.5).observed_at)
    third = observe(tracker, 1, 0.85)
    assert not first.confirmed and not second.confirmed
    assert third.confirmed and third.reason == "CONFIRMED"
    assert third.incident_confidence == 0.8
    assert third.qualifying_frame_ids == ["frame-0", "frame-0.5", "frame-1"]
    active = observe(tracker, 1.5)
    assert active.reason == "ACTIVE_EPISODE" and active.episode_id == third.episode_id
    assert active.confirmed_at == third.confirmed_at


def test_smoke_never_qualifies_or_bridges_fire_confirmation() -> None:
    tracker = FireTracker(Settings(_env_file=None))
    smoke = FireDetection.model_construct(
        label="smoke",
        confidence=0.99,
        bounding_box=FireBoundingBox(x=0.1, y=0.2, width=0.3, height=0.4),
    )
    for seconds in [0, 0.5, 1]:
        result = tracker.evaluate(frame(seconds), [smoke], frame(seconds).observed_at)
        assert not result.confirmed
        assert result.detections == [] and result.max_confidence is None
    observe(tracker, 1.5)
    interrupted = tracker.evaluate(frame(2), [smoke], frame(2).observed_at)
    assert interrupted.consecutive_frames == 0
    assert not observe(tracker, 2.5).confirmed
    assert not observe(tracker, 3).confirmed
    assert observe(tracker, 3.5).confirmed


@pytest.mark.parametrize("negative", [None, 0.49])
def test_negative_resets_instead_of_majority_vote(negative: float | None) -> None:
    tracker = FireTracker(Settings(_env_file=None))
    observe(tracker, 0)
    observe(tracker, 0.5, negative)
    observe(tracker, 1)
    assert not observe(tracker, 1.5).confirmed
    assert observe(tracker, 2).confirmed


def test_duplicate_out_of_order_and_stale_never_add_evidence() -> None:
    tracker = FireTracker(Settings(_env_file=None))
    first = observe(tracker, 0)
    replay = observe(tracker, 0)
    assert replay.is_replay and replay.consecutive_frames == first.consecutive_frames
    assert observe(tracker, -0.1).reason == "OUT_OF_ORDER"
    old = tracker.evaluate(frame(0.2), signal(), START + timedelta(seconds=3))
    assert old.reason == "STALE_FRAME"
    assert not observe(tracker, 0.5).confirmed
    confirmed = observe(tracker, 1)
    assert confirmed.confirmed
    frozen = observe(tracker, 1)
    assert frozen.is_replay and frozen.confirmed_at == confirmed.confirmed_at


def test_gap_error_silence_and_sessions_reset_candidates() -> None:
    tracker = FireTracker(Settings(_env_file=None))
    observe(tracker, 0)
    assert observe(tracker, 1.01).reason == "FRAME_GAP"
    tracker.failure(
        frame(1.2), frame(1.2).observed_at, FireInferenceError(code="TIMEOUT", message="timeout")
    )
    assert observe(tracker, 1.4).consecutive_frames == 1
    tracker.sweep(START + timedelta(seconds=3))
    assert observe(tracker, 3).consecutive_frames == 1
    assert observe(tracker, 3.5, session="source-2").consecutive_frames == 1
    assert observe(tracker, 4, session="source-1").reason == "OUT_OF_ORDER"


def test_inclusive_window_and_pruned_suffix() -> None:
    tracker = FireTracker(Settings(_env_file=None, fire_max_frame_gap_seconds=3))
    observe(tracker, 0)
    observe(tracker, 2.5)
    assert observe(tracker, 5).confirmed
    tracker = FireTracker(Settings(_env_file=None, fire_max_frame_gap_seconds=3))
    observe(tracker, 0)
    observe(tracker, 2.5)
    last = observe(tracker, 5.001)
    assert not last.confirmed and last.reason == "WINDOW_EXPIRED"
    assert last.consecutive_frames == 2


def test_active_episode_rearms_only_after_continuous_observed_clear() -> None:
    tracker = FireTracker(Settings(_env_file=None))
    for seconds in [0, 0.5, 1]:
        confirmed = observe(tracker, seconds)
    original = confirmed.episode_id
    for seconds in range(2, 8):
        observe(tracker, seconds, None)
    tracker.sweep(START + timedelta(seconds=20))
    assert observe(tracker, 20).episode_id == original
    for seconds in range(21, 32):
        observe(tracker, seconds, None)
    for seconds in [31.5, 32, 32.5]:
        fresh = observe(tracker, seconds)
    assert fresh.confirmed and fresh.episode_id != original


def test_camera_capacity_and_many_boxes_do_not_create_extra_frames() -> None:
    tracker = FireTracker(Settings(_env_file=None, fire_max_cameras=1))
    observed = frame(0)
    response = tracker.evaluate(observed, signal() * 5, START)
    assert response.consecutive_frames == 1
    other = observe(tracker, 0, camera="other")
    assert other.error and other.error.code == "PROVIDER_UNAVAILABLE"


def test_bounding_boxes_and_scores_reject_nonfinite_values() -> None:
    with pytest.raises(ValueError):
        FireBoundingBox(x=float("nan"), y=0, width=0.1, height=0.1)
    with pytest.raises(ValueError):
        signal(float("inf"))


def _detection_at(
    x: float, y: float, score: float = 0.85, size: float = 0.08
) -> list[FireDetection]:
    return [
        FireDetection(
            label="fire",
            confidence=score,
            bounding_box=FireBoundingBox(x=x, y=y, width=size, height=size),
        )
    ]


def test_spatial_association_rejects_jumping_false_flashes_and_keeps_swaying_flame() -> None:
    tracker = FireTracker(Settings(_env_file=None))
    # Three flashes jumping across opposite sides of the frame must not confirm.
    first = tracker.evaluate(frame(0.0), _detection_at(0.05, 0.10, 0.85), START)
    second = tracker.evaluate(
        frame(0.2), _detection_at(0.75, 0.10, 0.85), START + timedelta(seconds=0.2)
    )
    third = tracker.evaluate(
        frame(0.4), _detection_at(0.40, 0.70, 0.85), START + timedelta(seconds=0.4)
    )
    assert not first.confirmed and not second.confirmed and not third.confirmed
    assert third.consecutive_frames == 1

    # A small swaying flame within the padded neighborhood stays linked and confirms.
    fourth = tracker.evaluate(
        frame(0.6), _detection_at(0.43, 0.68, 0.85), START + timedelta(seconds=0.6)
    )
    fifth = tracker.evaluate(
        frame(0.8), _detection_at(0.41, 0.71, 0.85), START + timedelta(seconds=0.8)
    )
    assert fourth.consecutive_frames == 2 and not fourth.confirmed
    assert fifth.confirmed and fifth.reason == "CONFIRMED"
    assert fifth.qualifying_frame_ids == ["frame-0.4", "frame-0.6", "frame-0.8"]


def test_peak_confidence_hysteresis_blocks_low_glare_and_confirms_on_peak() -> None:
    tracker = FireTracker(
        Settings(
            _env_file=None, fire_confidence_threshold=0.50, fire_peak_confidence_threshold=0.65
        )
    )
    # Sustained 0.57 glare (e.g. window backlight) fails the 0.65 peak gate.
    for seconds in (0.0, 0.2, 0.4):
        result = observe(tracker, seconds, 0.57)
        assert not result.confirmed
        assert result.reason == "INSUFFICIENT_FRAMES"

    # Once a frame spikes above the peak threshold, the sliding 3-frame window confirms.
    confirmed = observe(tracker, 0.6, 0.72)
    assert confirmed.confirmed and confirmed.reason == "CONFIRMED"
    assert confirmed.qualifying_frame_ids == ["frame-0.2", "frame-0.4", "frame-0.6"]
    assert confirmed.incident_confidence == pytest.approx(0.57)


def test_static_light_suppression_blocks_frozen_lamp_and_allows_flickering_flame() -> None:
    import numpy as np

    tracker = FireTracker(
        Settings(
            _env_file=None,
            fire_confidence_threshold=0.50,
            fire_peak_confidence_threshold=0.65,
            fire_static_suppression_enabled=True,
            fire_min_temporal_motion=0.02,
            fire_static_bypass_confidence=0.85,
        )
    )
    static_frame = np.full((120, 160, 3), 240, dtype=np.uint8)
    for seconds in (0.0, 0.2, 0.4):
        item = frame(seconds)
        result = tracker.evaluate(
            item, _detection_at(0.2, 0.2, 0.74, 0.2), item.observed_at, image=static_frame
        )
        assert not result.confirmed

    # Now simulate real flame flicker inside the ROI (y=24..48, x=32..64).
    flicker_frame = np.full((120, 160, 3), 60, dtype=np.uint8)
    flicker_frame[30:44, 40:56] = 250
    item = frame(0.6)
    confirmed = tracker.evaluate(
        item, _detection_at(0.2, 0.2, 0.74, 0.2), item.observed_at, image=flicker_frame
    )
    assert confirmed.confirmed and confirmed.reason == "CONFIRMED"
