"""Video-level screening metrics do not silently become frame or event recall."""

import pytest

from scripts.evaluate_fire_videos import ClipReport, summary


def clip(name: str, positive: bool, fire: list[float], combined: list[float]) -> ClipReport:
    return ClipReport(name, "sha256", positive, 25, 1800, 1, fire, combined, 0, 0, 0, 0, 0, 0)


def test_video_labels_and_negative_exposure_have_distinct_denominators() -> None:
    results = [
        clip("positive", True, [2, 30], [2, 30]),
        clip("miss", True, [], []),
        clip("negative", False, [3, 60], [3, 60, 120]),
        clip("clear", False, [], []),
    ]
    fire = summary(results, False)
    assert fire["video_level_recall"] == 0.5
    assert fire["video_level_precision"] == 0.5
    assert fire["false_positive_clips"] == 1
    assert fire["false_positive_episodes"] == 2
    assert fire["negative_seconds"] == 3600
    assert fire["observed_false_episodes_per_negative_hour"] == pytest.approx(2)
    assert summary(results, True)["false_positive_episodes"] == 3


def test_empty_or_one_sided_data_does_not_fabricate_precision_or_recall() -> None:
    assert summary([], False)["video_level_recall"] is None
    assert summary([], False)["video_level_precision"] is None
    result = summary([clip("negative", False, [], [])], False)
    assert result["video_level_recall"] is None
    assert result["observed_false_episodes_per_negative_hour"] == 0
