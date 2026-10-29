"""Additional AC tests: do not change settings to match implementation drift."""

from datetime import UTC, datetime, timedelta

import pytest

from app.services.fall_tracker import FallTracker
from app.services.pose_geometry import NormalizedKeypoint, PoseGeometry

BASE = datetime(2026, 10, 18, 0, 0, tzinfo=UTC)
KPS = [NormalizedKeypoint(x=0.5, y=0.5, visibility=0.95) for _ in range(33)]


def geometry(angle=10.0, center=300.0):
    return PoseGeometry(
        torso_angle_deg=angle,
        center_height=0.4,
        aspect_ratio=1.0,
        center_y_px=center,
        bbox_height_px=200.0,
        bbox_width_px=200.0,
        keypoints_detected=33,
    )


def feed(tracker, seconds, angle=10.0, center=300.0, frame=None):
    return tracker.evaluate_frame(
        observed_at=BASE + timedelta(seconds=seconds),
        frame_id=frame or str(seconds),
        keypoints=KPS,
        geometry=geometry(angle, center),
        pose_available=True,
        reason="NORMAL_POSTURE",
    )


def candidate():
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for i in range(10):
        feed(tracker, i * 0.2, 85.0, 200.0)
    assert feed(tracker, 2.0)["state"] == "CANDIDATE"
    return tracker


@pytest.mark.parametrize(
    "elapsed,expected", [(2.999, "CANDIDATE"), (3.0, "CANDIDATE"), (3.001, "CONFIRMED")]
)
def test_qa_ac17_strict_3_seconds(elapsed, expected):
    tracker = candidate()
    for i in range(1, 15):
        feed(tracker, 2.0 + i * 0.2)
    assert feed(tracker, 2.0 + elapsed)["state"] == expected


@pytest.mark.parametrize(
    "angle,center,expected",
    [(29.999, 240.0, "CANDIDATE"), (30.0, 240.0, "MONITORING"), (29.999, 239.8, "MONITORING")],
)
def test_qa_ac16_angle_and_drop_boundary(angle, center, expected):
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for i in range(10):
        feed(tracker, i * 0.2, 85.0, 200.0)
    assert feed(tracker, 2.0, angle, center)["state"] == expected


@pytest.mark.parametrize("gap,expected", [(4.999, "CANDIDATE"), (5.0, "CANCELLED")])
def test_qa_missing_pose_boundary(gap, expected):
    tracker = candidate()
    result = tracker.evaluate_frame(
        observed_at=BASE + timedelta(seconds=2.0 + gap),
        frame_id="missing",
        keypoints=None,
        geometry=None,
        pose_available=False,
        reason="NO_POSE",
    )
    assert result["state"] == expected


def test_qa_gap_does_not_add_blind_time():
    tracker = candidate()
    result = feed(tracker, 18.0)
    assert result["state"] != "CONFIRMED", (
        "16 seconds without observations cannot prove continuous immobility"
    )
    assert result["immobileSeconds"] == 0


def test_qa_prone_at_start_is_not_a_fall():
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for i in range(120):
        result = feed(tracker, i * 0.2, 10.0, 300.0)
        assert result["state"] == "MONITORING", (
            "No observed lowering transition: do not infer a fall from startup prone posture"
        )


def test_candidate_requires_low_center_throughout_immobility():
    tracker = candidate()
    for i in range(1, 15):
        feed(tracker, 2.0 + i * 0.2)
    # Still horizontal, but no longer below the frozen center-drop threshold.
    result = feed(tracker, 5.0, center=220.0)
    assert result["state"] == "CANDIDATE"
    assert result["immobileSeconds"] == 0
    # The first low-center frame after that cannot prove a whole abnormal pair.
    assert feed(tracker, 5.2)["immobileSeconds"] == 0
    assert feed(tracker, 5.4)["immobileSeconds"] == pytest.approx(0.2)


def test_qa_duplicate_frame_does_not_fill_history():
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for _ in range(10):
        feed(tracker, 0, 85.0, 200.0, frame="same-frame")
    assert feed(tracker, 0.2)["state"] == "MONITORING"


def test_qa_missing_then_return_restarts_interval():
    tracker = candidate()
    for i in range(1, 15):
        feed(tracker, 2.0 + i * 0.2)
    tracker.evaluate_frame(
        observed_at=BASE + timedelta(seconds=5.0),
        frame_id="missing",
        keypoints=None,
        geometry=None,
        pose_available=False,
        reason="NO_POSE",
    )
    result = feed(tracker, 5.4)
    assert result["state"] != "CONFIRMED"
    assert result["immobileSeconds"] <= 0.6


def test_qa_registry_keeps_session_identity_separate():
    from app.services.fall_tracker_registry import FallTrackerRegistry

    registry = FallTrackerRegistry()
    a = registry.get_tracker("cam", "session-a", "track")
    b = registry.get_tracker("cam", "session-b", "track")
    assert a is not b


def test_qa_confirmed_episode_latched():
    tracker = candidate()
    for i in range(1, 78):
        result = feed(tracker, 2.0 + i * 0.2)
    assert result["state"] == "CONFIRMED"
    episode = result["episodeId"]
    assert feed(tracker, 18.0)["episodeId"] == episode


def test_qa_restart_has_empty_history():
    assert len(FallTracker("cam", "session", "track").history) == 0


def test_motion_breaks_two_two_second_intervals():
    tracker = candidate()
    for i in range(1, 11):
        feed(tracker, 2 + i * 0.2)
    moving = [NormalizedKeypoint(x=0.8, y=0.8, visibility=0.95) for _ in range(33)]
    result = tracker.evaluate_frame(
        BASE + timedelta(seconds=4.2), "moving", moving, geometry(), True, "NORMAL_POSTURE"
    )
    assert result["immobileSeconds"] == 0
    for i in range(1, 11):
        result = feed(tracker, 4.2 + i * 0.2)
    assert result["state"] == "CANDIDATE"
    assert result["immobileSeconds"] <= 2


def test_out_of_order_and_duplicate_recovery_cannot_mutate_candidate():
    tracker = candidate()
    assert feed(tracker, 1.9, 85, 200)["isReplay"]
    assert feed(tracker, 2.1, 85, 200, frame="2.0")["isReplay"]
    assert tracker.state == "CANDIDATE"
    assert tracker.last_valid_pose_at == BASE + timedelta(seconds=2)


def test_sweeper_cancels_at_exact_grace_without_new_request():
    tracker = candidate()
    tracker.sweep(BASE + timedelta(seconds=7))
    assert tracker.state == "CANCELLED"
    assert tracker.reason == "MISSING_TIMEOUT"


def test_returning_pose_at_grace_cancels_previous_episode():
    tracker = candidate()
    assert feed(tracker, 7)["state"] == "CANCELLED"
    assert tracker.immobile_seconds == 0


def test_drop_threshold_does_not_round_up_insufficient_lowering():
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for i in range(10):
        feed(tracker, i * 0.2, 85, 200)
    assert feed(tracker, 2, 10, 239.999)["state"] == "MONITORING"


def test_short_missing_pose_preserves_valid_monitoring_baseline():
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for i in range(10):
        feed(tracker, i * 0.2, 85, 200)
    tracker.evaluate_frame(BASE + timedelta(seconds=2), "occluded", None, None, False, "NO_POSE")
    assert feed(tracker, 2.2)["state"] == "CANDIDATE"
    assert tracker.immobile_seconds == 0


def test_missing_monitoring_baseline_still_expires_after_invalid_gap():
    tracker = FallTracker("qa-camera", "qa-session", "qa-track")
    for i in range(10):
        feed(tracker, i * 0.2, 85, 200)
    missing = tracker.evaluate_frame(
        BASE + timedelta(seconds=2), "occluded", None, None, False, "NO_POSE"
    )
    assert missing["reason"] == "NO_POSE"
    assert feed(tracker, 2.5)["state"] == "MONITORING"
    assert len(tracker.history) == 1
