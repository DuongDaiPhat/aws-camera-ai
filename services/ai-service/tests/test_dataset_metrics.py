"""Protect evaluation denominators and undefined metrics for zero detections."""

from scripts.evaluate_fall_dataset import classification_metrics


def test_missed_fall_clips_are_not_excluded():
    clips = [
        {"label": "fall", "confirmed": [4]},
        {"label": "fall", "confirmed": []},
        {"label": "non_fall", "confirmed": []},
        {"label": "non_fall", "confirmed": [8, 9]},
    ]
    metrics = classification_metrics(clips, "confirmed")
    assert {key: metrics[key] for key in ("TP", "FP", "FN", "TN")} == {
        "TP": 1,
        "FP": 1,
        "FN": 1,
        "TN": 1,
    }
    assert metrics["precision"] == metrics["recall"] == metrics["f1"] == 0.5


def test_no_predictions_is_not_perfect_precision():
    metrics = classification_metrics(
        [
            {"label": "fall", "confirmed": []},
            {"label": "non_fall", "confirmed": []},
        ],
        "confirmed",
    )
    assert metrics["precision"] is None
    assert metrics["recall"] == metrics["f1"] == 0
    assert classification_metrics([], "confirmed")["accuracy"] is None
