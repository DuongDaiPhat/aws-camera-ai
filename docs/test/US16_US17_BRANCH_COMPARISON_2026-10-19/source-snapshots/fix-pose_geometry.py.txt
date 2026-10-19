"""Hinh hoc va toan hoc tinh toan dac trung tu 33 landmarks cua MediaPipe Pose.

Tuan thu Section 6.1 trong docs/sprint-3/PLAN_US-16_US-17_POSE_FALL_E2E.md:
- Landmark vai: 11 (trai), 12 (phai).
- Landmark hong: 23 (trai), 24 (phai).
- Cac phep tinh goc va khoang cach deu thuc hien tren he toa do pixel cua anh goc (W, H).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class NormalizedKeypoint:
    """Toa do landmark chuan hoa (0..1) tu MediaPipe."""

    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0


@dataclass(frozen=True)
class PixelPoint:
    """Toa do diem tren pixel anh goc."""

    x: float
    y: float


@dataclass(frozen=True)
class PoseGeometry:
    """Ket qua tinh toan hinh hoc tu pose."""

    torso_angle_deg: float
    center_height: float
    aspect_ratio: float
    center_y_px: float
    bbox_height_px: float
    bbox_width_px: float
    keypoints_detected: int
    image_width: int = 1920
    image_height: int = 1080


# Indices theo chuan MediaPipe Pose 33 landmarks
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28

KEY_LANDMARK_PAIRS = (
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_ELBOW,
    RIGHT_ELBOW,
    LEFT_HIP,
    RIGHT_HIP,
    LEFT_KNEE,
    RIGHT_KNEE,
    LEFT_ANKLE,
    RIGHT_ANKLE,
)


def calculate_torso_angle(
    shoulder_mid: PixelPoint,
    hip_mid: PixelPoint,
) -> float:
    """Tinh goc truc than so voi phuong ngang trong khoang [0, 90] do.

    Trục than v = S - H.
    torsoAngleDeg = atan2(abs(v_y), abs(v_x)) * 180 / pi.
    Goc < 30 do nghia la than gan nam ngang (tu the nam).
    """
    vx = shoulder_mid.x - hip_mid.x
    vy = shoulder_mid.y - hip_mid.y
    angle_rad = math.atan2(abs(vy), abs(vx))
    angle_deg = math.degrees(angle_rad)
    # Stabilize floating point at exact boundaries without rounding 29.999 to 30.
    return round(angle_deg, 10)


def calculate_pose_geometry(
    keypoints: Sequence[NormalizedKeypoint],
    image_width: int,
    image_height: int,
    bbox_width: float,
    bbox_height: float,
    min_visibility: float = 0.60,
) -> PoseGeometry | None:
    """Trích xuất dac trung hinh hoc tu 33 keypoints.

    Yeu cau bat buoc:
    - Du 33 landmarks.
    - Hai vai (11, 12) va hai hong (23, 24) co visibility >= min_visibility.
    """
    if (
        len(keypoints) < 33
        or image_width <= 0
        or image_height <= 0
        or not all(math.isfinite(v) and v > 0 for v in (bbox_width, bbox_height))
    ):
        return None

    vital = (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
    if any(
        not all(math.isfinite(v) for v in (keypoints[i].x, keypoints[i].y, keypoints[i].visibility))
        or keypoints[i].visibility < min_visibility
        for i in vital
    ):
        return None

    # Tinh so keypoints dat visibility
    detected_count = sum(1 for kp in keypoints if kp.visibility >= min_visibility)

    # Chuyen vai va hong sang pixel anh goc
    s_left = PixelPoint(
        keypoints[LEFT_SHOULDER].x * image_width,
        keypoints[LEFT_SHOULDER].y * image_height,
    )
    s_right = PixelPoint(
        keypoints[RIGHT_SHOULDER].x * image_width,
        keypoints[RIGHT_SHOULDER].y * image_height,
    )
    h_left = PixelPoint(
        keypoints[LEFT_HIP].x * image_width,
        keypoints[LEFT_HIP].y * image_height,
    )
    h_right = PixelPoint(
        keypoints[RIGHT_HIP].x * image_width,
        keypoints[RIGHT_HIP].y * image_height,
    )

    s_mid = PixelPoint((s_left.x + s_right.x) / 2.0, (s_left.y + s_right.y) / 2.0)
    h_mid = PixelPoint((h_left.x + h_right.x) / 2.0, (h_left.y + h_right.y) / 2.0)
    if math.hypot(s_mid.x - h_mid.x, s_mid.y - h_mid.y) <= 1e-6:
        return None

    torso_angle = calculate_torso_angle(s_mid, h_mid)

    # Trong tam dai dien than C = (S + H) / 2
    c_y_px = (s_mid.y + h_mid.y) / 2.0
    center_height = round(1.0 - (c_y_px / float(image_height)), 4)

    bbox_w_px = bbox_width * image_width
    bbox_h_px = bbox_height * image_height

    aspect_ratio = round(bbox_h_px / bbox_w_px, 4) if bbox_w_px > 0 else 0.0

    return PoseGeometry(
        torso_angle_deg=torso_angle,
        center_height=center_height,
        aspect_ratio=aspect_ratio,
        center_y_px=c_y_px,
        bbox_height_px=bbox_h_px,
        bbox_width_px=bbox_w_px,
        keypoints_detected=detected_count,
        image_width=image_width,
        image_height=image_height,
    )


def calculate_center_drop_ratio(
    current_center_y_px: float,
    history_center_y_px: Sequence[float],
    baseline_bbox_height_px: float,
) -> float:
    """Tinh ty le ha thap trong tam so voi median cua 10 frame truoc.

    centerDropRatio = (C_y_now - median(C_y_prev10)) / scale_prev
    y tang theo chieu xuong duoi, nen khi roi/nga, C_y tang => drop ratio duong.
    """
    if not history_center_y_px or baseline_bbox_height_px <= 0:
        return 0.0

    sorted_y = sorted(history_center_y_px)
    mid = len(sorted_y) // 2
    if len(sorted_y) % 2 == 1:
        median_y = sorted_y[mid]
    else:
        median_y = (sorted_y[mid - 1] + sorted_y[mid]) / 2.0

    drop_pixels = current_center_y_px - median_y
    drop_ratio = drop_pixels / baseline_bbox_height_px
    return drop_ratio


def calculate_motion_score(
    current_keypoints: Sequence[NormalizedKeypoint],
    previous_keypoints: Sequence[NormalizedKeypoint],
    image_width: int,
    image_height: int,
    dt_seconds: float,
    baseline_scale_px: float,
    min_visibility: float = 0.60,
    max_gap_seconds: float = 0.60,
) -> float | None:
    """Tinh diem chuyen dong giua hai frame lien tiep.

    motionScore = median_displacement / (scale_prev * dt)
    - scale_prev la chieu cao bbox median duoc dong bang luc bat dau candidate.
    - dt_seconds phai hop le (0 < dt <= max_gap_seconds).
    - Bat buoc ca hai frame deu co du vai va hong dat visibility.
    """
    if dt_seconds <= 0 or dt_seconds > max_gap_seconds or baseline_scale_px <= 0:
        return None

    if len(current_keypoints) < 33 or len(previous_keypoints) < 33:
        return None

    # Bat buoc vai va hong dat chat luong
    vital_joints = (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
    for idx in vital_joints:
        if (
            current_keypoints[idx].visibility < min_visibility
            or previous_keypoints[idx].visibility < min_visibility
        ):
            return None

    displacements: list[float] = []
    for idx in KEY_LANDMARK_PAIRS:
        kp_cur = current_keypoints[idx]
        kp_prev = previous_keypoints[idx]
        if kp_cur.visibility >= min_visibility and kp_prev.visibility >= min_visibility:
            dx = (kp_cur.x - kp_prev.x) * image_width
            dy = (kp_cur.y - kp_prev.y) * image_height
            dist = math.sqrt(dx * dx + dy * dy)
            displacements.append(dist)

    # Toi thieu 6 cap landmark hop le
    if len(displacements) < 6:
        return None

    displacements.sort()
    mid = len(displacements) // 2
    if len(displacements) % 2 == 1:
        median_disp = displacements[mid]
    else:
        median_disp = (displacements[mid - 1] + displacements[mid]) / 2.0

    motion_score = median_disp / (baseline_scale_px * dt_seconds)
    return round(motion_score, 4)
