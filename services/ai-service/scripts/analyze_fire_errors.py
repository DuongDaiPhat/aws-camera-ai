"""Explain saved video errors without relaxing the production confirmation rule.

All videos have already been inspected. Results are error diagnostics, never a
new holdout evaluation or a recommendation to tune on these same examples.
"""

import argparse
import html
import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict, Field

from app.models.fire import FireDetection, FireReason
from scripts.evaluate_fire_videos import ClipReport, checksum

LOGGER = logging.getLogger(__name__)
REVIEW_FRAME_COUNT = 6
REVIEW_COLUMNS = 3
CELL_WIDTH = 400
CELL_HEIGHT = 350
PLOT_HEIGHT = 210


class SavedFrame(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    clip: str
    frame: int = Field(ge=0)
    seconds: float = Field(ge=0)
    fire_reason: FireReason = Field(alias="fireReason")
    combined_reason: FireReason = Field(alias="combinedReason")
    detections: list[FireDetection]

    def score(self, label: str) -> float:
        return max((item.confidence for item in self.detections if item.label == label), default=0)


@dataclass(frozen=True)
class TemporalRule:
    threshold: float
    required_frames: int
    max_gap_seconds: float
    window_seconds: float


@dataclass(frozen=True)
class SequenceDiagnostic:
    qualifying_fire_frames: int
    longest_consecutive_fire_run: int
    strongest_window_min_saved_fire_score: float
    strongest_window_start_index: int
    peak_saved_fire_score: float


def sequence_diagnostic(rows: list[SavedFrame], rule: TemporalRule) -> SequenceDiagnostic:
    """Keep an isolated high score distinct from a consecutive confirmation."""
    longest = current = qualifying = 0
    strongest_minimum = 0.0
    strongest_index = 0
    previous: SavedFrame | None = None
    for index, row in enumerate(rows):
        if previous and (row.frame <= previous.frame or row.seconds <= previous.seconds):
            raise ValueError("Saved frames must be unique and strictly ordered")
        gap_valid = previous is None or row.seconds - previous.seconds <= rule.max_gap_seconds
        if row.score("fire") >= rule.threshold:
            qualifying += 1
            current = current + 1 if gap_valid else 1
            longest = max(longest, current)
        else:
            current = 0
        start = index + 1 - rule.required_frames
        if start >= 0:
            window = rows[start : index + 1]
            continuous = all(
                right.seconds - left.seconds <= rule.max_gap_seconds
                for left, right in zip(window, window[1:], strict=False)
            )
            if continuous and row.seconds - window[0].seconds <= rule.window_seconds:
                minimum = min(item.score("fire") for item in window)
                if minimum > strongest_minimum:
                    strongest_minimum, strongest_index = minimum, start
        previous = row
    return SequenceDiagnostic(
        qualifying,
        longest,
        strongest_minimum,
        strongest_index,
        max((row.score("fire") for row in rows), default=0),
    )


def read_frames(input_dir: Path, reports: list[ClipReport]) -> dict[str, list[SavedFrame]]:
    grouped: dict[str, list[SavedFrame]] = {item.clip: [] for item in reports}
    if len(grouped) != len(reports):
        raise ValueError("Duplicate clip reports")
    with (input_dir / "frames.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = SavedFrame.model_validate_json(line)
            if row.clip not in grouped:
                raise ValueError("Prediction references an unknown clip")
            grouped[row.clip].append(row)
    for report in reports:
        rows = grouped[report.clip]
        if not rows or len(rows) != report.sampled_frames:
            raise ValueError("Incomplete saved predictions")
        if [
            row.seconds for row in rows if row.fire_reason == "CONFIRMED"
        ] != report.fire_episode_seconds:
            raise ValueError("Saved confirmations disagree with the clip report")
    return grouped


def draw_timeline(
    canvas: Image.Image, rows: list[SavedFrame], duration: float, rule: TemporalRule
) -> None:
    draw = ImageDraw.Draw(canvas)
    left, top, width, height = 50, 45, canvas.width - 90, PLOT_HEIGHT - 85
    draw.text(
        (left, 10), "Saved fire score (red), smoke score (gray); source seconds", fill="black"
    )
    draw.rectangle((left, top, left + width, top + height), outline="black")
    threshold_y = top + height * (1 - rule.threshold)
    draw.line((left, threshold_y, left + width, threshold_y), fill="blue", width=1)
    draw.text((left, threshold_y - 14), f"threshold {rule.threshold:.2f}", fill="blue")
    for label, color in (("smoke", "gray"), ("fire", "red")):
        points = [
            (left + row.seconds / duration * width, top + (1 - row.score(label)) * height)
            for row in rows
        ]
        if len(points) >= 2:
            draw.line(points, fill=color, width=2)
    draw.text((left, top + height + 8), "0s", fill="black")
    draw.text((left + width - 65, top + height + 8), f"{duration:.2f}s", fill="black")


def annotated_frame(
    capture: cv2.VideoCapture, row: SavedFrame, threshold: float, raw_path: Path, jpeg_quality: int
) -> Image.Image:
    capture.set(cv2.CAP_PROP_POS_FRAMES, row.frame)
    success, source = capture.read()
    if not success or round(capture.get(cv2.CAP_PROP_POS_FRAMES)) - 1 != row.frame:
        raise ValueError(f"Cannot seek exact source frame: {row.frame}")
    success, encoded = cv2.imencode(".jpg", source, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not success:
        raise ValueError("Cannot encode source review frame")
    raw_path.write_bytes(encoded.tobytes())
    image = Image.fromarray(cv2.cvtColor(source, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(image)
    for detection in row.detections:
        if detection.label != "fire":
            continue
        box = detection.bounding_box
        rectangle = (
            box.x * image.width,
            box.y * image.height,
            (box.x + box.width) * image.width,
            (box.y + box.height) * image.height,
        )
        draw.rectangle(
            rectangle, outline="red" if detection.confidence >= threshold else "orange", width=2
        )
    image.thumbnail((CELL_WIDTH - 10, CELL_HEIGHT - 65))
    return image


def write_review(
    path: Path,
    output: Path,
    report: ClipReport,
    rows: list[SavedFrame],
    rule: TemporalRule,
    diagnostic: SequenceDiagnostic,
    jpeg_quality: int,
) -> str:
    first_confirmed = next(
        (index for index, row in enumerate(rows) if row.fire_reason == "CONFIRMED"), None
    )
    if first_confirmed is None and not report.expected_fire:
        first_confirmed = next(
            (index for index, row in enumerate(rows) if row.combined_reason == "CONFIRMED"), None
        )
    best_start = diagnostic.strongest_window_start_index
    start = max(
        0,
        (first_confirmed - rule.required_frames + 1 if first_confirmed is not None else best_start)
        - 1,
    )
    selected = rows[start : start + REVIEW_FRAME_COUNT]
    canvas = Image.new("RGB", (CELL_WIDTH * REVIEW_COLUMNS, PLOT_HEIGHT + CELL_HEIGHT * 2), "white")
    draw_timeline(canvas, rows, report.duration_seconds, rule)
    draw = ImageDraw.Draw(canvas)
    raw_dir = output / "review-frames"
    raw_dir.mkdir(exist_ok=True)
    candidates = []
    capture = cv2.VideoCapture(str(path))
    try:
        for index, row in enumerate(selected):
            x, y = (
                (index % REVIEW_COLUMNS) * CELL_WIDTH,
                PLOT_HEIGHT + (index // REVIEW_COLUMNS) * CELL_HEIGHT,
            )
            draw.text(
                (x + 5, y + 5),
                f"frame {row.frame} / {row.seconds:.3f}s / {row.fire_reason}",
                fill="black",
            )
            draw.text(
                (x + 5, y + 23),
                f"saved fire={row.score('fire'):.4f} smoke={row.score('smoke'):.4f}",
                fill="black",
            )
            raw_path = raw_dir / f"{path.stem}-frame-{row.frame}.jpg"
            canvas.paste(
                annotated_frame(capture, row, rule.threshold, raw_path, jpeg_quality),
                (x + 5, y + 48),
            )
            candidates.append(
                {
                    "image": raw_path.relative_to(output).as_posix(),
                    "image_sha256": checksum(raw_path),
                    "source_clip_sha256": report.sha256,
                    "source_frame": row.frame,
                    "source_seconds": row.seconds,
                    "video_expected_fire": report.expected_fire,
                    "review_status": "ANNOTATION_REQUIRED",
                    "suggested_detections_only": [
                        item.model_dump(mode="json", by_alias=True) for item in row.detections
                    ],
                }
            )
    finally:
        capture.release()
    filename = f"{path.stem}-review.jpg"
    canvas.save(output / filename, quality=92)
    curation = {
        "purpose": "Manual annotation candidates; not approved training labels",
        "split_restriction": "Keep each source video and related source scene together; these inspected videos cannot be a fresh holdout",
        "smoke_ground_truth": "UNVERIFIED",
        "source_clip": report.clip,
        "frames": candidates,
    }
    (output / f"{path.stem}-curation.json").write_text(
        json.dumps(curation, indent=2), encoding="utf-8"
    )
    return filename


def run(input_dir: Path, dataset_dir: Path, output: Path, review_jpeg_quality: int) -> None:
    if not 1 <= review_jpeg_quality <= 100:
        raise ValueError("Invalid review JPEG quality")
    input_hashes = {
        name: checksum(input_dir / name) for name in ("summary.json", "clips.json", "frames.jsonl")
    }
    source = json.loads((input_dir / "summary.json").read_text(encoding="utf-8"))
    reports = [
        ClipReport(**item)
        for item in json.loads((input_dir / "clips.json").read_text(encoding="utf-8"))
    ]
    settings = source["settings"]
    rule = TemporalRule(
        settings["threshold"],
        settings["required_frames"],
        settings["max_gap_seconds"],
        settings["window_seconds"],
    )
    grouped = read_frames(input_dir, reports)
    output.mkdir(parents=True, exist_ok=False)
    results = []
    for report in reports:
        rows = grouped[report.clip]
        diagnostic = sequence_diagnostic(rows, rule)
        fire_error = report.expected_fire != bool(report.fire_episode_seconds)
        smoke_only_negative = (
            not report.expected_fire
            and bool(report.combined_episode_seconds)
            and not report.fire_episode_seconds
        )
        review = None
        if fire_error or smoke_only_negative:
            path = (
                dataset_dir / ("pos" if report.expected_fire else "neg") / report.clip
            ).resolve()
            if not path.is_relative_to(dataset_dir.resolve()):
                raise ValueError("Source video escapes dataset directory")
            if checksum(path) != report.sha256:
                raise ValueError(f"Source bytes changed: {report.clip}")
            review = write_review(path, output, report, rows, rule, diagnostic, review_jpeg_quality)
        results.append(
            {
                "clip": report.clip,
                "expected_fire": report.expected_fire,
                "fire_confirmed": bool(report.fire_episode_seconds),
                "fire_error": fire_error,
                "smoke_only_flame_negative": smoke_only_negative,
                "review": review,
                **asdict(diagnostic),
            }
        )
    if any(checksum(input_dir / name) != digest for name, digest in input_hashes.items()):
        raise ValueError("Evaluation evidence changed during analysis")
    evidence = {
        "input_sha256": input_hashes,
        "analyzer_sha256": checksum(Path(__file__)),
        "review_jpeg_quality": review_jpeg_quality,
        "deployment_settings_changed": False,
        "limitations": [
            "Known-error diagnostics, not independent validation",
            "Scores below the saved output floor are censored, not proven zero",
            "Source time is not annotated ignition or alert latency",
            "Flame-negative clips have unverified smoke ground truth",
        ],
        "clips": results,
    }
    (output / "analysis.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    links = "\n".join(
        f'<li>{html.escape(str(row["clip"]))}: <a href="{html.escape(str(row["review"]))}">review</a></li>'
        for row in results
        if row["review"]
    )
    (output / "index.html").write_text(
        f"<!doctype html><html lang='en'><meta charset='utf-8'><title>Fire error review</title><h1>Known-error diagnostic review</h1><p>Red boxes qualify; orange boxes are below threshold. Scores below the output floor are censored. No deployment change.</p><ul>{links}</ul></html>",
        encoding="utf-8",
    )
    LOGGER.info(
        "Analyzed %s clips; wrote %s reviews",
        len(results),
        sum(row["review"] is not None for row in results),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--review-jpeg-quality", type=int, default=85)
    args = parser.parse_args()
    run(args.input_dir, args.dataset_dir, args.output_dir, args.review_jpeg_quality)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
