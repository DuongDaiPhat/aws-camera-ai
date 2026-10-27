"""Unit tests cho pose_geometry.py (AC16-1, Section 6.1)."""

import math

import pytest

from app.services.pose_geometry import (
    LEFT_HIP,
    LEFT_SHOULDER,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    NormalizedKeypoint,
    PixelPoint,
    calculate_center_drop_ratio,
    calculate_motion_score,
    calculate_pose_geometry,
    calculate_torso_angle,
)


def make_dummy_keypoints(
    shoulder_y: float = 0.2,
    hip_y: float = 0.5,
    shoulder_x: float = 0.5,
    hip_x: float = 0.5,
    visibility: float = 0.9,
) -> list[NormalizedKeypoint]:
    """Tao danh sach 33 keypoints mau."""
    kps = [NormalizedKeypoint(x=0.5, y=0.5, visibility=visibility) for _ in range(33)]
    # Shoulder 11, 12
    kps[LEFT_SHOULDER] = NormalizedKeypoint(
        x=shoulder_x - 0.05, y=shoulder_y, visibility=visibility
    )
    kps[RIGHT_SHOULDER] = NormalizedKeypoint(
        x=shoulder_x + 0.05, y=shoulder_y, visibility=visibility
    )
    # Hip 23, 24
    kps[LEFT_HIP] = NormalizedKeypoint(x=hip_x - 0.05, y=hip_y, visibility=visibility)
    kps[RIGHT_HIP] = NormalizedKeypoint(x=hip_x + 0.05, y=hip_y, visibility=visibility)
    return kps


def test_calculate_torso_angle_vertical_and_horizontal() -> None:
    # Thang dung tuyet doi: vx = 0, vy = 100 -> 90 do
    s_mid = PixelPoint(100.0, 50.0)
    h_mid = PixelPoint(100.0, 150.0)
    assert calculate_torso_angle(s_mid, h_mid) == 90.0

    # Nam ngang tuyet doi: vx = 100, vy = 0 -> 0 do
    s_mid_h = PixelPoint(50.0, 100.0)
    h_mid_h = PixelPoint(150.0, 100.0)
    assert calculate_torso_angle(s_mid_h, h_mid_h) == 0.0

    # Goc 45 do: dx = dy
    s_mid_45 = PixelPoint(0.0, 0.0)
    h_mid_45 = PixelPoint(100.0, 100.0)
    assert calculate_torso_angle(s_mid_45, h_mid_45) == 45.0

    # Test bien 30 do
    # tan(30 deg) ~ 0.57735 => dy = 57.735, dx = 100
    s_mid_30 = PixelPoint(0.0, 0.0)
    h_mid_30 = PixelPoint(100.0, 100.0 * math.tan(math.radians(30.0)))
    assert calculate_torso_angle(s_mid_30, h_mid_30) == 30.0

    # 29.9 do: nho hon 30
    s_mid_29 = PixelPoint(0.0, 0.0)
    h_mid_29 = PixelPoint(100.0, 100.0 * math.tan(math.radians(29.9)))
    assert calculate_torso_angle(s_mid_29, h_mid_29) == 29.9


def test_calculate_pose_geometry_valid_standing() -> None:
    kps = make_dummy_keypoints(shoulder_y=0.2, hip_y=0.5, visibility=0.9)
    geom = calculate_pose_geometry(
        keypoints=kps,
        image_width=1920,
        image_height=1080,
        bbox_width=0.2,
        bbox_height=0.6,
        min_visibility=0.60,
    )
    assert geom is not None
    assert geom.torso_angle_deg == 90.0
    assert geom.keypoints_detected == 33
    # center y = (0.2 + 0.5) / 2 * 1080 = 0.35 * 1080 = 378
    assert geom.center_y_px == pytest.approx(378.0)
    # center height = 1 - 0.35 = 0.65
    assert geom.center_height == pytest.approx(0.65)
    # aspect ratio = (0.6 * 1080) / (0.2 * 1920) = 648 / 384 = 1.6875
    assert geom.aspect_ratio == pytest.approx(1.6875)


def test_calculate_pose_geometry_rejects_low_visibility() -> None:
    # Ca 2 vai visibility thap < 0.6
    kps = make_dummy_keypoints(visibility=0.9)
    kps[LEFT_SHOULDER] = NormalizedKeypoint(x=0.45, y=0.2, visibility=0.4)
    kps[RIGHT_SHOULDER] = NormalizedKeypoint(x=0.55, y=0.2, visibility=0.4)
    geom = calculate_pose_geometry(
        keypoints=kps,
        image_width=1920,
        image_height=1080,
        bbox_width=0.2,
        bbox_height=0.6,
        min_visibility=0.60,
    )
    assert geom is None

    # Danh sach khong du 33 keypoints
    assert calculate_pose_geometry([], 1920, 1080, 0.2, 0.6) is None


def test_calculate_center_drop_ratio() -> None:
    history_centers = [100.0, 102.0, 98.0, 100.0, 101.0, 99.0, 100.0, 103.0, 97.0, 100.0]
    baseline_height = 200.0

    # Khong roi: center y van la 100 -> drop ratio = 0
    drop_0 = calculate_center_drop_ratio(100.0, history_centers, baseline_height)
    assert drop_0 == 0.0

    # Roi 40 pixel: drop = 40 / 200 = 0.20 (nguong candidate)
    drop_40 = calculate_center_drop_ratio(140.0, history_centers, baseline_height)
    assert drop_40 == 0.20

    # Roi 60 pixel: drop = 60 / 200 = 0.30
    drop_60 = calculate_center_drop_ratio(160.0, history_centers, baseline_height)
    assert drop_60 == 0.30

    # Danh sach rong hoac height am
    assert calculate_center_drop_ratio(100.0, [], 200.0) == 0.0
    assert calculate_center_drop_ratio(100.0, history_centers, 0.0) == 0.0


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_all_four_vital_joints_finite_required(value: float) -> None:
    for index in (11, 12, 23, 24):
        kps = make_dummy_keypoints()
        kps[index] = NormalizedKeypoint(x=0.5, y=0.3, visibility=value)
        assert calculate_pose_geometry(kps, 640, 480, 0.5, 0.8) is None


def test_vital_joints_at_least_one_shoulder_and_hip() -> None:
    # Neu mat ca 2 vai -> None
    kps = make_dummy_keypoints()
    kps[11] = NormalizedKeypoint(x=0.5, y=0.3, visibility=0.1)
    kps[12] = NormalizedKeypoint(x=0.5, y=0.3, visibility=0.1)
    assert calculate_pose_geometry(kps, 640, 480, 0.5, 0.8) is None

    # Neu mat ca 2 hong -> None
    kps = make_dummy_keypoints()
    kps[23] = NormalizedKeypoint(x=0.5, y=0.3, visibility=0.1)
    kps[24] = NormalizedKeypoint(x=0.5, y=0.3, visibility=0.1)
    assert calculate_pose_geometry(kps, 640, 480, 0.5, 0.8) is None

    # Neu chi thay 1 ben (1 vai + 1 hong) do nam nghieng/nga doc -> Hop le
    kps = make_dummy_keypoints()
    kps[11] = NormalizedKeypoint(x=0.5, y=0.3, visibility=0.1)
    kps[23] = NormalizedKeypoint(x=0.5, y=0.3, visibility=0.1)
    geom = calculate_pose_geometry(kps, 640, 480, 0.5, 0.8)
    assert geom is not None


def test_degenerate_geometry_is_not_a_horizontal_torso() -> None:
    kps = make_dummy_keypoints(shoulder_y=0.5, hip_y=0.5)
    assert calculate_pose_geometry(kps, 640, 480, 0.5, 0.8) is None
    kps = make_dummy_keypoints()
    assert calculate_pose_geometry(kps, 640, 480, 0, 0.8) is None
    kps[11] = NormalizedKeypoint(x=float("inf"), y=0.3)
    assert calculate_pose_geometry(kps, 640, 480, 0.5, 0.8) is None


def test_calculate_motion_score() -> None:
    kps_prev = make_dummy_keypoints(shoulder_y=0.7, hip_y=0.7, visibility=0.9)
    # Khong dich chuyen
    kps_cur = make_dummy_keypoints(shoulder_y=0.7, hip_y=0.7, visibility=0.9)

    score_static = calculate_motion_score(
        current_keypoints=kps_cur,
        previous_keypoints=kps_prev,
        image_width=1000,
        image_height=1000,
        dt_seconds=0.2,
        baseline_scale_px=200.0,
        min_visibility=0.60,
    )
    assert score_static == 0.0

    # Gap thoi gian qua lon > 0.6s -> None
    assert (
        calculate_motion_score(
            current_keypoints=kps_cur,
            previous_keypoints=kps_prev,
            image_width=1000,
            image_height=1000,
            dt_seconds=0.8,
            baseline_scale_px=200.0,
        )
        is None
    )

    # dt <= 0 -> None
    assert (
        calculate_motion_score(
            current_keypoints=kps_cur,
            previous_keypoints=kps_prev,
            image_width=1000,
            image_height=1000,
            dt_seconds=0.0,
            baseline_scale_px=200.0,
        )
        is None
    )
