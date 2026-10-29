"""Explore threshold tradeoffs from saved predictions without changing deployment settings."""

import argparse
import json
import logging
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

from app.config import Settings
from app.models.fire import FireDetection, FireFrame
from app.services.fire_tracker import FireTracker
from scripts.evaluate_fire_videos import OFFLINE_ORIGIN, ClipReport, checksum, record_frame, summary

LOGGER = logging.getLogger(__name__)


def replay(input_dir: Path, threshold: float) -> dict[str, object]:
    source = json.loads((input_dir / "summary.json").read_text(encoding="utf-8"))
    reports = [
        replace(
            ClipReport(**item),
            fire_episode_seconds=[],
            combined_episode_seconds=[],
            fire_positive_frames=0,
            smoke_positive_frames=0,
            sampled_frames=0,
        )
        for item in json.loads((input_dir / "clips.json").read_text(encoding="utf-8"))
    ]
    report_by_clip = {item.clip: item for item in reports}
    rule = source["settings"]
    output_floor = rule.get("output_confidence_floor", 0.10)
    if threshold < output_floor:
        raise ValueError("Threshold is below the saved detector confidence floor")
    settings = Settings(
        _env_file=None,
        fire_confidence_threshold=threshold,
        fire_output_confidence_floor=output_floor,
        fire_min_consecutive_frames=rule["required_frames"],
        fire_confirmation_window_seconds=rule["window_seconds"],
        fire_max_frame_gap_seconds=rule["max_gap_seconds"],
        fire_clear_seconds=rule["clear_seconds"],
    )
    trackers = {item.clip: (FireTracker(settings), FireTracker(settings)) for item in reports}
    with (input_dir / "frames.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            report = report_by_clip[row["clip"]]
            at = OFFLINE_ORIGIN + timedelta(seconds=row["seconds"])
            frame = FireFrame(
                camera_slug="offline",
                source_session_id=Path(row["clip"]).stem,
                frame_id=f"source-frame-{row['frame']}",
                observed_at=at,
            )
            detections = [FireDetection.model_validate(item) for item in row["detections"]]
            fire = [item for item in detections if item.label == "fire"]
            smoke = [item for item in detections if item.label == "smoke"]
            record_frame(report, fire, smoke, threshold)
            combined, fire_only = trackers[row["clip"]]
            if combined.evaluate(frame, detections, at).reason == "CONFIRMED":
                report.combined_episode_seconds.append(row["seconds"])
            if fire_only.evaluate(frame, fire, at).reason == "CONFIRMED":
                report.fire_episode_seconds.append(row["seconds"])
    return {
        "threshold": threshold,
        "fire_only": summary(reports, False),
        "production_fire_or_smoke": summary(reports, True),
        "missed_fire_clips": [
            item.clip for item in reports if item.expected_fire and not item.fire_episode_seconds
        ],
        "false_fire_clips": [
            item.clip for item in reports if not item.expected_fire and item.fire_episode_seconds
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--threshold", type=float, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if any(not 0.1 <= value <= 1 for value in args.threshold):
        raise ValueError("Saved detections have a 0.10 floor; require thresholds in 0.10..1")
    results = []
    for threshold in sorted(set(args.threshold)):
        result = replay(args.input_dir, threshold)
        results.append(result)
        LOGGER.info("Threshold %.2f: %s", threshold, json.dumps(result["fire_only"]))
    evidence = {
        "input_sha256": {
            name: checksum(args.input_dir / name)
            for name in ("summary.json", "clips.json", "frames.jsonl")
        },
        "deployment_settings_changed": False,
        "interpretation": "Exploratory sensitivity on the same screening clips; not independent validation of a chosen threshold",
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(evidence, stream, indent=2)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
