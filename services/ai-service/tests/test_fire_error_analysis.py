"""Keep intermittent detections distinct from three-frame temporal evidence."""

from pathlib import Path

import pytest

from app.models.fire import FireBoundingBox, FireDetection
from scripts.analyze_fire_errors import SavedFrame, TemporalRule, read_frames, sequence_diagnostic
from scripts.evaluate_fire_videos import ClipReport


def saved_frame(index: int, seconds: float, score: float) -> SavedFrame:
    return SavedFrame(
        clip="fixture.avi",
        frame=index,
        seconds=seconds,
        fire_reason="INSUFFICIENT_FRAMES",
        combined_reason="INSUFFICIENT_FRAMES",
        detections=[
            FireDetection(
                label="fire",
                confidence=score,
                bounding_box=FireBoundingBox(x=0, y=0, width=1, height=1),
            )
        ],
    )


def test_isolated_high_scores_do_not_become_consecutive_confirmation() -> None:
    rows = [saved_frame(0, 0, 0.9), saved_frame(5, 0.2, 0.4), saved_frame(10, 0.4, 0.8)]
    result = sequence_diagnostic(rows, TemporalRule(0.5, 3, 1, 5))
    assert result.qualifying_fire_frames == 2
    assert result.longest_consecutive_fire_run == 1
    assert result.strongest_window_min_saved_fire_score == pytest.approx(0.4)


def test_missing_frame_interval_cannot_join_two_runs() -> None:
    rows = [saved_frame(0, 0, 0.7), saved_frame(5, 0.2, 0.8), saved_frame(50, 2, 0.9)]
    result = sequence_diagnostic(rows, TemporalRule(0.5, 3, 1, 5))
    assert result.longest_consecutive_fire_run == 2
    assert result.strongest_window_min_saved_fire_score == 0


def test_duplicate_or_reversed_frames_refuse_diagnostics() -> None:
    rows = [saved_frame(1, 0.2, 0.9), saved_frame(1, 0.4, 0.9)]
    with pytest.raises(ValueError, match="strictly ordered"):
        sequence_diagnostic(rows, TemporalRule(0.5, 3, 1, 5))


def test_incomplete_predictions_cannot_explain_away_a_miss(tmp_path: Path) -> None:
    report = ClipReport("fixture.avi", "sha256", True, 25, 1, 2, [], [], 1, 0, 0.9, 0, 0, 0)
    row = saved_frame(0, 0, 0.9)
    (tmp_path / "frames.jsonl").write_text(row.model_dump_json(by_alias=True) + "\n")
    with pytest.raises(ValueError, match="Incomplete saved predictions"):
        read_frames(tmp_path, [report])
