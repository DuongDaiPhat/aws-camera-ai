"""Screen public positive/negative videos with the production ONNX decoder and temporal rule.

This is offline video-level screening, without live transport or annotated fire onset times.
Run as python -m scripts.evaluate_fire_videos from the AI service directory.
"""

import argparse
import hashlib
import json
import logging
import math
import statistics
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TextIO

import cv2

from app.config import Settings
from app.models.fire import FireDetection, FireFrame
from app.services.fire_detector import FireDetector
from app.services.fire_tracker import FireTracker

LOGGER = logging.getLogger(__name__)
SERVICE_DIR = Path(__file__).resolve().parents[1]
OFFLINE_ORIGIN = datetime(2026, 1, 1, tzinfo=UTC)
DATASET_URL = "https://zenodo.org/records/836749"
ARCHIVE_MD5 = "7cfe8286cc4b45193149186bf67ea00d"


@dataclass
class ClipReport:
    clip: str
    sha256: str
    expected_fire: bool
    source_fps: float
    duration_seconds: float
    sampled_frames: int
    fire_episode_seconds: list[float]
    combined_episode_seconds: list[float]
    fire_positive_frames: int
    smoke_positive_frames: int
    peak_fire_confidence: float
    peak_smoke_confidence: float
    inference_p50_ms: float
    inference_p95_ms: float


def checksum(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[math.ceil(len(values) * fraction) - 1]


def evaluate_clip(
    path: Path,
    output: Path,
    detector: FireDetector,
    settings: Settings,
    sample_fps: float,
    jpeg_quality: int,
    frames_log: TextIO,
) -> ClipReport:
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    if not capture.isOpened() or not math.isfinite(fps) or fps < sample_fps:
        raise ValueError(f"Unsupported or unreadable video: {path}")
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    report = ClipReport(
        path.name,
        checksum(path),
        path.parent.name == "pos",
        fps,
        count / fps,
        0,
        [],
        [],
        0,
        0,
        0,
        0,
        0,
        0,
    )
    combined, fire_only = FireTracker(settings), FireTracker(settings)
    timings: list[float] = []
    sample_index = 0
    index = 0
    try:
        while capture.grab():
            seconds = index / fps
            index += 1
            if seconds + 1e-8 < sample_index / sample_fps:
                continue
            success, image = capture.retrieve()
            if not success:
                raise ValueError(f"Failed to decode sampled frame {index - 1}: {path.name}")
            success, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
            if not success:
                raise ValueError(f"JPEG encoding failed: {path.name}")
            started = time.perf_counter()
            detections = detector.detect(encoded.tobytes())
            timings.append((time.perf_counter() - started) * 1000)
            at = OFFLINE_ORIGIN + timedelta(seconds=seconds)
            frame = FireFrame(
                camera_slug="offline",
                source_session_id=path.stem,
                frame_id=f"source-frame-{index - 1}",
                observed_at=at,
            )
            fire = [item for item in detections if item.label == "fire"]
            smoke = [item for item in detections if item.label == "smoke"]
            all_result = combined.evaluate(frame, detections, at)
            fire_result = fire_only.evaluate(frame, fire, at)
            record_frame(report, fire, smoke, settings.fire_confidence_threshold)
            if all_result.reason == "CONFIRMED":
                report.combined_episode_seconds.append(seconds)
            if fire_result.reason == "CONFIRMED":
                report.fire_episode_seconds.append(seconds)
                cv2.imwrite(
                    str(output / f"{path.stem}-fire-{len(report.fire_episode_seconds)}.jpg"), image
                )
            frames_log.write(
                json.dumps(
                    {
                        "clip": path.name,
                        "frame": index - 1,
                        "seconds": seconds,
                        "fireReason": fire_result.reason,
                        "combinedReason": all_result.reason,
                        "detections": [
                            item.model_dump(mode="json", by_alias=True) for item in detections
                        ],
                    }
                )
                + "\n"
            )
            sample_index += 1
    finally:
        capture.release()
    if index != count:
        raise ValueError(
            f"Decoded {index}/{count} frames; refusing a truncated-video metric: {path}"
        )
    if not timings:
        raise ValueError(f"No sampled frames: {path}")
    report.inference_p50_ms = statistics.median(timings)
    report.inference_p95_ms = percentile(timings, 0.95)
    return report


def record_frame(
    report: ClipReport,
    fire: list[FireDetection],
    smoke: list[FireDetection],
    threshold: float,
) -> None:
    fire_score = max((item.confidence for item in fire), default=0)
    smoke_score = max((item.confidence for item in smoke), default=0)
    report.peak_fire_confidence = max(report.peak_fire_confidence, fire_score)
    report.peak_smoke_confidence = max(report.peak_smoke_confidence, smoke_score)
    report.fire_positive_frames += int(fire_score >= threshold)
    report.smoke_positive_frames += int(smoke_score >= threshold)
    report.sampled_frames += 1


def summary(reports: list[ClipReport], combined: bool) -> dict[str, object]:
    positive = [item for item in reports if item.expected_fire]
    negative = [item for item in reports if not item.expected_fire]
    episodes = {
        item.clip: item.combined_episode_seconds if combined else item.fire_episode_seconds
        for item in reports
    }
    true_positive = sum(bool(episodes[item.clip]) for item in positive)
    false_positive = sum(bool(episodes[item.clip]) for item in negative)
    negative_seconds = sum(item.duration_seconds for item in negative)
    false_episodes = sum(len(episodes[item.clip]) for item in negative)
    return {
        "positive_clips": len(positive),
        "negative_clips": len(negative),
        "detected_positive_clips": true_positive,
        "missed_positive_clips": len(positive) - true_positive,
        "false_positive_clips": false_positive,
        "false_positive_episodes": false_episodes,
        "negative_seconds": negative_seconds,
        "video_level_recall": true_positive / len(positive) if positive else None,
        "video_level_precision": true_positive / (true_positive + false_positive)
        if true_positive + false_positive
        else None,
        "observed_false_episodes_per_negative_hour": false_episodes * 3600 / negative_seconds
        if negative_seconds
        else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sample-fps", type=float, default=5)
    parser.add_argument("--jpeg-quality", type=int, default=85)
    args = parser.parse_args()
    if not 0 < args.sample_fps <= 5 or not 1 <= args.jpeg_quality <= 100:
        raise ValueError("Invalid sampling FPS or JPEG quality")
    verify_source(args.archive, args.input_dir)
    args.output_dir.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((SERVICE_DIR / "model-manifest.json").read_text(encoding="utf-8"))
    artifact = manifest["fire"]["artifact"]
    settings = Settings(
        _env_file=None,
        fire_model_path=str(SERVICE_DIR / "models" / artifact["filename"]),
        fire_model_sha256=artifact["sha256"],
        fire_model_version=artifact["modelVersion"],
    )
    detector = FireDetector(settings)
    reports: list[ClipReport] = []
    with (args.output_dir / "frames.jsonl").open("w", encoding="utf-8") as frames_log:
        for path in sorted(args.input_dir.rglob("*.avi")):
            if path.parent.name not in {"pos", "neg"}:
                raise ValueError("Expected public dataset pos/neg directories")
            result = evaluate_clip(
                path,
                args.output_dir,
                detector,
                settings,
                args.sample_fps,
                args.jpeg_quality,
                frames_log,
            )
            reports.append(result)
            (args.output_dir / "clips.json").write_text(
                json.dumps([asdict(item) for item in reports], indent=2), encoding="utf-8"
            )
            LOGGER.info(
                "Screened %s: fireEpisodes=%s combinedEpisodes=%s peakFire=%.3f",
                result.clip,
                len(result.fire_episode_seconds),
                len(result.combined_episode_seconds),
                result.peak_fire_confidence,
            )
    if len(reports) != 27 or sum(item.expected_fire for item in reports) != 11:
        raise ValueError(
            "Incomplete FIRESENSE flame dataset: expected 11 positive and 16 negative clips"
        )
    report = {
        "source": DATASET_URL,
        "archive_md5": ARCHIVE_MD5,
        "archive_sha256": checksum(args.archive),
        "model": artifact,
        "settings": {
            "sample_fps": args.sample_fps,
            "jpeg_quality": args.jpeg_quality,
            "output_confidence_floor": settings.fire_output_confidence_floor,
            "cpu_threads": settings.fire_cpu_threads,
            "threshold": settings.fire_confidence_threshold,
            "required_frames": settings.fire_min_consecutive_frames,
            "window_seconds": settings.fire_confirmation_window_seconds,
            "max_gap_seconds": settings.fire_max_frame_gap_seconds,
            "clear_seconds": settings.fire_clear_seconds,
        },
        "fire_only": summary(reports, False),
        "production_fire_or_smoke": summary(reports, True),
        "limitations": [
            "Video-level labels only; no annotated fire onset times or bbox ground truth",
            "Training overlap not verified; diagnostic screening, not an independent holdout claim",
            "Offline timestamps; live transport/freshness and delivery are not exercised",
            "Short negative exposure cannot establish a deployment false-alarm rate",
            "Flame-negative clips are not independently labelled for smoke; combined false-positive fields are flame-label proxies",
        ],
    }
    (args.output_dir / "summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    LOGGER.info("Screening complete: %s", json.dumps(report["fire_only"]))


def verify_source(archive: Path, input_dir: Path) -> None:
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "md5").hexdigest() != ARCHIVE_MD5:
            raise ValueError("Archive does not match the official FIRESENSE record checksum")
    with zipfile.ZipFile(archive) as source:
        for path in sorted(input_dir.rglob("*.avi")):
            with source.open(path.relative_to(input_dir).as_posix()) as stream:
                entry_hash = hashlib.sha256()
                while chunk := stream.read(1024 * 1024):
                    entry_hash.update(chunk)
                expected = entry_hash.hexdigest()
            if checksum(path) != expected:
                raise ValueError(f"Video differs from the verified public archive: {path.name}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
