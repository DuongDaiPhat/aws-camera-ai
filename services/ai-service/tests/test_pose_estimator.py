"""Integration test cho PoseEstimator voi model thuc te (smoke test)."""

import numpy as np

from app.services.pose_estimator import PoseEstimator


def test_pose_estimator_blank_image() -> None:
    # Tao anh den 640x480
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    estimator = PoseEstimator.get_instance()

    keypoints, geometry, pose_available, reason = estimator.estimate(
        image_bgr=blank,
        person_bbox={"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
    )

    # Anh den khong the tim thay pose
    assert pose_available is False
    assert reason == "NO_POSE"
    assert keypoints is None
    assert geometry is None


def test_pose_estimator_empty_image() -> None:
    empty = np.zeros((0, 0, 3), dtype=np.uint8)
    estimator = PoseEstimator.get_instance()

    _, _, pose_available, reason = estimator.estimate(empty)
    assert pose_available is False
    assert reason == "EMPTY_IMAGE"
