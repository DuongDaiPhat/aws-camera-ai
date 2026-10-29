"""Integration test cho PoseEstimator voi model thuc te (smoke test)."""

from types import SimpleNamespace

import numpy as np
import pytest

from app.services.pose_estimator import PoseEstimator


def test_pose_estimator_blank_image() -> None:
    # Tao anh den 640x480
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    try:
        estimator = PoseEstimator.get_instance()
    except FileNotFoundError:
        pytest.skip("Pose model not available for smoke test")

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
    try:
        estimator = PoseEstimator.get_instance()
    except FileNotFoundError:
        pytest.skip("Pose model not available for smoke test")

    _, _, pose_available, reason = estimator.estimate(empty)
    assert pose_available is False
    assert reason == "EMPTY_IMAGE"


def test_assignment_rejects_neighbor_and_ambiguity_without_model() -> None:
    estimator = PoseEstimator.__new__(PoseEstimator)
    estimator._min_visibility = 0.6
    estimator._min_association_iou = 0.3
    pose = [
        SimpleNamespace(x=0.3 if i % 2 else 0.7, y=0.2 if i < 20 else 0.8, z=0, visibility=0.9)
        for i in range(33)
    ]
    bbox = {"x": 0.25, "y": 0.1, "width": 0.5, "height": 0.8}
    selected, _ = estimator._select_pose([pose], bbox, 640, 480, 640, 480, 0, 0)
    assert selected is not None
    neighbor = {"x": 0.01, "y": 0.1, "width": 0.1, "height": 0.8}
    selected, reason = estimator._select_pose([pose], neighbor, 640, 480, 640, 480, 0, 0)
    assert selected is None and reason == "POSE_ASSOCIATION_FAILED"
    for box in (bbox, None):
        selected, reason = estimator._select_pose([pose, pose], box, 640, 480, 640, 480, 0, 0)
        assert selected is None and reason == "AMBIGUOUS_POSE"
    pose[11].visibility = 0
    pose[12].visibility = 0
    selected, reason = estimator._select_pose([pose], bbox, 640, 480, 640, 480, 0, 0)
    assert selected is None and reason == "LOW_VISIBILITY"
