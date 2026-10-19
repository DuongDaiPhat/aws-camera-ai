"""Unit tests cho FallTracker state machine (AC16-1, AC16-2, AC16-3, AC17-1..3)."""

from datetime import UTC, datetime, timedelta

from app.services.fall_tracker import FallTracker
from app.services.fall_tracker_registry import FallTrackerRegistry
from app.services.pose_geometry import NormalizedKeypoint, PoseGeometry


def make_geom(angle: float = 85.0, center_y: float = 300.0, height: float = 200.0) -> PoseGeometry:
    return PoseGeometry(
        torso_angle_deg=angle,
        center_height=0.6,
        aspect_ratio=2.5,
        center_y_px=center_y,
        bbox_height_px=height,
        bbox_width_px=80.0,
        keypoints_detected=33,
    )


def make_kps() -> list[NormalizedKeypoint]:
    return [NormalizedKeypoint(x=0.5, y=0.5, visibility=0.9) for _ in range(33)]


def test_fall_tracker_history_requires_10_frames_ac16_2() -> None:
    tracker = FallTracker("cam1", "sess1", "track1")
    t0 = datetime(2026, 10, 11, 12, 0, 0, tzinfo=UTC)
    geom_standing = make_geom(angle=85.0, center_y=200.0, height=200.0)
    kps = make_kps()

    # Nạp 10 frame đứng thẳng
    for i in range(10):
        res = tracker.evaluate_frame(
            observed_at=t0 + timedelta(milliseconds=i * 200),
            frame_id=f"f{i}",
            keypoints=kps,
            geometry=geom_standing,
            pose_available=True,
            reason="NORMAL_POSTURE",
        )
        assert res["state"] == "MONITORING"
        if i < 9:
            assert res["reason"] == "HISTORY_INSUFFICIENT"
        else:
            # Frame thứ 10: lúc này history mới có 9 frame trước nó -> vẫn HISTORY_INSUFFICIENT
            assert res["reason"] == "HISTORY_INSUFFICIENT"

    # Frame thứ 11 (sau khi history đã có đủ 10 frame đứng thẳng): vẫn đứng thẳng
    res_11 = tracker.evaluate_frame(
        observed_at=t0 + timedelta(milliseconds=10 * 200),
        frame_id="f10",
        keypoints=kps,
        geometry=geom_standing,
        pose_available=True,
        reason="NORMAL_POSTURE",
    )
    assert res_11["state"] == "MONITORING"
    assert res_11["reason"] == "NORMAL_POSTURE"

    # Frame thứ 12: Ngã! Góc 15 độ, trọng tâm hạ từ 200 xuống 300 (drop = 100/200 = 0.50 >= 0.20)
    geom_fall = make_geom(angle=15.0, center_y=300.0, height=100.0)
    res_12 = tracker.evaluate_frame(
        observed_at=t0 + timedelta(milliseconds=11 * 200),
        frame_id="f11",
        keypoints=kps,
        geometry=geom_fall,
        pose_available=True,
        reason="NORMAL_POSTURE",
    )
    # AC16-2: Phải vào CANDIDATE và có episodeId
    assert res_12["state"] == "CANDIDATE"
    assert res_12["reason"] == "FALL_CANDIDATE"
    assert res_12["episodeId"] is not None
    assert res_12["candidateStartedAt"] is not None


def test_fall_tracker_rest_area_suppression_ac17_3() -> None:
    tracker = FallTracker("cam1", "sess1", "track1")
    t0 = datetime(2026, 10, 11, 12, 0, 0, tzinfo=UTC)
    geom_standing = make_geom(angle=85.0, center_y=200.0, height=200.0)
    kps = make_kps()

    for i in range(10):
        tracker.evaluate_frame(
            observed_at=t0 + timedelta(milliseconds=i * 200),
            frame_id=f"f{i}",
            keypoints=kps,
            geometry=geom_standing,
            pose_available=True,
            reason="NORMAL_POSTURE",
        )

    # Frame ngã nhưng trong REST_AREA
    geom_fall = make_geom(angle=10.0, center_y=300.0, height=100.0)
    res = tracker.evaluate_frame(
        observed_at=t0 + timedelta(milliseconds=11 * 200),
        frame_id="f_rest",
        keypoints=kps,
        geometry=geom_fall,
        pose_available=True,
        reason="NORMAL_POSTURE",
        in_rest_area=True,
    )
    # Không được tạo candidate hay confirmed
    assert res["state"] == "MONITORING" or res["state"] == "CANCELLED"
    assert res["reason"] == "REST_AREA"
    assert res["episodeId"] is None


def test_fall_tracker_missing_pose_grace_period_ac16_3() -> None:
    tracker = FallTracker("cam1", "sess1", "track1")
    t0 = datetime(2026, 10, 11, 12, 0, 0, tzinfo=UTC)
    geom_standing = make_geom(angle=85.0, center_y=200.0, height=200.0)
    kps = make_kps()

    for i in range(10):
        tracker.evaluate_frame(
            observed_at=t0 + timedelta(milliseconds=i * 200),
            frame_id=f"f{i}",
            keypoints=kps,
            geometry=geom_standing,
            pose_available=True,
            reason="NORMAL_POSTURE",
        )

    # Trigger candidate
    geom_fall = make_geom(angle=15.0, center_y=300.0, height=100.0)
    res_cand = tracker.evaluate_frame(
        observed_at=t0 + timedelta(seconds=2.0),
        frame_id="f_fall",
        keypoints=kps,
        geometry=geom_fall,
        pose_available=True,
        reason="NORMAL_POSTURE",
    )
    assert res_cand["state"] == "CANDIDATE"

    # Mất pose ở giây thứ 3 (sau candidate 1 giây) -> vẫn CANDIDATE, reset immobile
    res_missing_1 = tracker.evaluate_frame(
        observed_at=t0 + timedelta(seconds=3.0),
        frame_id="f_missing_1",
        keypoints=None,
        geometry=None,
        pose_available=False,
        reason="NO_POSE",
    )
    assert res_missing_1["state"] == "CANDIDATE"
    assert res_missing_1["poseAvailable"] is False
    assert res_missing_1["immobileSeconds"] == 0.0
    assert res_missing_1["missingPoseSeconds"] == 1.0

    # Mất pose quá 5 giây (ở giây thứ 7.1) -> CANCELLED, MISSING_TIMEOUT
    res_missing_timeout = tracker.evaluate_frame(
        observed_at=t0 + timedelta(seconds=7.1),
        frame_id="f_missing_timeout",
        keypoints=None,
        geometry=None,
        pose_available=False,
        reason="NO_POSE",
    )
    assert res_missing_timeout["state"] == "CANCELLED"
    assert res_missing_timeout["reason"] == "MISSING_TIMEOUT"


def test_fall_tracker_recovered_when_standing_up_ac17_2() -> None:
    tracker = FallTracker("cam1", "sess1", "track1")
    t0 = datetime(2026, 10, 11, 12, 0, 0, tzinfo=UTC)
    geom_standing = make_geom(angle=85.0, center_y=200.0, height=200.0)
    kps = make_kps()

    for i in range(10):
        tracker.evaluate_frame(
            observed_at=t0 + timedelta(milliseconds=i * 200),
            frame_id=f"f{i}",
            keypoints=kps,
            geometry=geom_standing,
            pose_available=True,
            reason="NORMAL_POSTURE",
        )

    # Vào candidate
    geom_fall = make_geom(angle=15.0, center_y=300.0, height=100.0)
    tracker.evaluate_frame(
        observed_at=t0 + timedelta(seconds=2.0),
        frame_id="f_fall",
        keypoints=kps,
        geometry=geom_fall,
        pose_available=True,
        reason="NORMAL_POSTURE",
    )

    # Đứng dậy (góc 70 độ >= 60 độ) trước 3s
    geom_stand_up = make_geom(angle=70.0, center_y=220.0, height=180.0)
    res_stand = tracker.evaluate_frame(
        observed_at=t0 + timedelta(seconds=5.0),
        frame_id="f_stand",
        keypoints=kps,
        geometry=geom_stand_up,
        pose_available=True,
        reason="NORMAL_POSTURE",
    )
    assert res_stand["state"] == "CANCELLED"
    assert res_stand["reason"] == "RECOVERED"


def test_fall_tracker_registry_and_sweeper() -> None:
    registry = FallTrackerRegistry.get_instance()
    tracker = registry.get_tracker("cam1", "sess1", "track1")
    assert tracker is not None
    assert tracker.track_id == "track1"

    # Sweep khi chua co timeout
    assert registry.sweep_all() == 0


def test_fall_tracker_startup_prone_never_creates_candidate() -> None:
    tracker = FallTracker("cam1", "sess1", "track_prone")
    t0 = datetime(2026, 10, 11, 12, 0, 0, tzinfo=UTC)
    for i in range(120):
        result = tracker.evaluate_frame(
            observed_at=t0 + timedelta(milliseconds=i * 200),
            frame_id=f"f{i}",
            keypoints=make_kps(),
            geometry=make_geom(angle=10.0, center_y=300.0, height=100.0),
            pose_available=True,
            reason="NORMAL_POSTURE",
        )
        assert result["state"] == "MONITORING"
        assert result["episodeId"] is None
