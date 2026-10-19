"""Replay annotated clips through the production estimator/tracker without stretching time.

This is an offline model evaluation, not proof of Frigate track association or delivery E2E.
Run from services/ai-service with --dataset ../../datasets/Fall_Dataset_Classified.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import math
import os
import platform
import sys
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import mediapipe
import numpy as np

from app.config import get_settings
from app.services.fall_tracker import FallTracker
from app.services.pose_estimator import PoseEstimator


def annotations(path: Path) -> dict[int, tuple[int, int, int, int]]:
    """The dataset stores one annotated person per frame, in pixel xyxy coordinates."""
    boxes = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines()[2:]:
        parts = line.split(",")
        if len(parts) != 6:
            raise ValueError(f"Invalid annotation row in {path.name}: {line}")
        index, _action, x1, y1, x2, y2 = (int(part) for part in parts)
        boxes[index] = (x1, y1, x2, y2)
    return boxes


def classification_metrics(clips: list[dict], prediction: str) -> dict:
    """Clip-level metrics; missing predictions stay FN, never dropped from the denominator."""
    tp = sum(c["label"] == "fall" and bool(c[prediction]) for c in clips)
    fp = sum(c["label"] == "non_fall" and bool(c[prediction]) for c in clips)
    positives = sum(c["label"] == "fall" for c in clips)
    negatives = len(clips) - positives
    fn, tn = positives - tp, negatives - fp
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / positives if positives else None
    specificity = tn / negatives if negatives else None
    return {
        "TP": tp,
        "FP": fp,
        "FN": fn,
        "TN": tn,
        "precision": precision,
        "recall": recall,
        "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
        "specificity": specificity,
        "accuracy": (tp + tn) / len(clips) if clips else None,
        "balancedAccuracy": (recall + specificity) / 2
        if recall is not None and specificity is not None
        else None,
    }


def replay(
    path: Path, row: dict[str, str], estimator: PoseEstimator | None, sample_fps: float
) -> dict:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"Cannot decode {path}")
    fps = capture.get(cv2.CAP_PROP_FPS)
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if not np.isfinite(fps) or fps <= 0 or count <= 0:
        raise ValueError(f"Invalid video timing: {path}")
    start, end = int(row["start_frame"]), int(row["end_frame"])
    annotation_path = path.parent / row["annotation_file"] if row["annotation_file"] else None
    boxes = annotations(annotation_path) if annotation_path else None
    tracker = FallTracker("dataset", path.stem, "annotated-person")
    base = datetime(2026, 10, 19, tzinfo=UTC)
    with path.open("rb") as video_source:
        checksum = hashlib.file_digest(video_source, "sha256").hexdigest()
    result = {
        "file": f"{row['label']}/{path.name}",
        "label": row["label"],
        "sha256": checksum,
        "annotationSha256": hashlib.sha256(annotation_path.read_bytes()).hexdigest()
        if annotation_path
        else None,
        "bboxSource": "annotation" if annotation_path else "full-frame single-person probe",
        "fps": fps,
        "frameCount": count,
        "durationSeconds": count / fps,
        "fallStartFrame": start,
        "fallEndFrame": end,
        "postFallSeconds": (count - end) / fps if end else None,
        "hasConfirmationTail": bool(
            end and (count - end) / fps > get_settings().fall_immobility_seconds
        ),
        "samples": 0,
        "poseSamples": 0,
        "annotatedPersonSamples": 0,
        "candidates": [],
        "confirmed": [],
        "reasons": {},
        "inferenceMs": [],
        "maxImmobileSeconds": 0,
        "maxCenterDropRatio": 0,
        "confirmationEvidence": [],
    }
    if estimator is None:
        capture.release()
        return result
    next_sample = 0.0
    index = 0
    reasons: Counter[str] = Counter()
    episodes = set()
    confirmations = set()
    try:
        while True:
            ok, image = capture.read()
            if not ok:
                break
            index += 1
            seconds = (index - 1) / fps
            if seconds + 1e-6 < next_sample:
                continue
            next_sample += 1.0 / sample_fps
            height, width = image.shape[:2]
            x1, y1, x2, y2 = (
                boxes.get(index, (0, 0, 0, 0)) if boxes is not None else (0, 0, width, height)
            )
            if 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height:
                result["annotatedPersonSamples"] += int(boxes is not None)
                before = time.perf_counter()
                keypoints, geometry, available, reason = estimator.estimate(
                    image,
                    {
                        "x": x1 / width,
                        "y": y1 / height,
                        "width": (x2 - x1) / width,
                        "height": (y2 - y1) / height,
                    },
                )
                result["inferenceMs"].append((time.perf_counter() - before) * 1000)
            else:
                keypoints, geometry, available, reason = None, None, False, "NO_ANNOTATED_PERSON"
            state = tracker.evaluate_frame(
                base + timedelta(seconds=seconds),
                str(index),
                keypoints,
                geometry,
                available,
                reason,
            )
            result["samples"] += 1
            result["poseSamples"] += int(available)
            result["maxImmobileSeconds"] = max(
                result["maxImmobileSeconds"], state["immobileSeconds"]
            )
            result["maxCenterDropRatio"] = max(
                result["maxCenterDropRatio"], state["centerDropRatio"] or 0
            )
            reasons[state["reason"]] += 1
            if state["state"] == "CANDIDATE" and state["episodeId"] not in episodes:
                episodes.add(state["episodeId"])
                result["candidates"].append(seconds)
            if state["state"] == "CONFIRMED" and state["episodeId"] not in confirmations:
                confirmations.add(state["episodeId"])
                result["confirmed"].append(seconds)
                result["confirmationEvidence"].append(
                    {
                        "candidateStartedAt": state["candidateStartedAt"],
                        "confirmedAt": state["confirmedAt"],
                        "immobileSeconds": state["immobileSeconds"],
                        "immobileSinceSeconds": seconds - state["immobileSeconds"],
                    }
                )
    finally:
        capture.release()
    if index != count:
        raise ValueError(f"Truncated decode {path.name}: {index}/{count}")
    result["reasons"] = dict(reasons)
    return result


def apply_configuration(path: Path) -> None:
    configuration = json.loads(path.read_text(encoding="utf-8-sig"))
    for name, value in configuration.items():
        if not name.startswith(("pose_", "fall_")) and name != "m2a_enabled":
            raise ValueError(f"Unexpected configuration field: {name}")
        os.environ[name.upper()] = str(value).lower() if isinstance(value, bool) else str(value)
    get_settings.cache_clear()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--configuration", type=Path, help="Saved pose/fall-only Settings JSON")
    parser.add_argument(
        "--supplement-unlisted",
        action="store_true",
        help="Probe unlisted videos separately using a full-frame ROI",
    )
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--sample-fps", type=float, default=5)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if not 2 <= args.sample_fps <= 30:
        parser.error("sample-fps must be between 2 and 30")
    if args.configuration:
        apply_configuration(args.configuration)
    logging.basicConfig(level=logging.WARNING)
    with (args.dataset / "dataset_manifest.csv").open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    estimator = None if args.inventory_only else PoseEstimator(args.model)
    clips = []
    started = time.perf_counter()
    supplementary = []
    listed = {f"{row['label']}/{row['video_file']}" for row in rows}
    unlisted = sorted(
        str(path.relative_to(args.dataset)).replace("\\", "/")
        for path in args.dataset.rglob("*.mp4")
        if str(path.relative_to(args.dataset)).replace("\\", "/") not in listed
    )
    try:
        for row in rows[: args.limit]:
            if row["label"] not in ("fall", "non_fall"):
                raise ValueError("Invalid label")
            path = (args.dataset / row["label"] / row["video_file"]).resolve()
            if not path.is_relative_to(args.dataset.resolve()):
                raise ValueError("Video path escapes dataset")
            clips.append(replay(path, row, estimator, args.sample_fps))
            print(f"[{len(clips)}/{len(rows[: args.limit])}] {row['video_file']}", flush=True)
        if args.supplement_unlisted:
            for name in unlisted:
                label = Path(name).parts[0]
                if label not in ("fall", "non_fall"):
                    raise ValueError(f"Unknown supplementary folder label: {name}")
                row = {"label": label, "annotation_file": "", "start_frame": "0", "end_frame": "0"}
                supplementary.append(replay(args.dataset / name, row, estimator, args.sample_fps))
                print(f"[supplementary] {name}", flush=True)
    finally:
        if estimator:
            estimator.close()
    timings = [value for clip in clips for value in clip.pop("inferenceMs")]
    positives = sum(c["label"] == "fall" for c in clips)
    negatives = len(clips) - positives
    confirmed = classification_metrics(clips, "confirmed") if estimator else None
    candidate = classification_metrics(clips, "candidates") if estimator else None
    negative_seconds = sum(c["durationSeconds"] for c in clips if c["label"] == "non_fall")
    negative_episodes = sum(len(c["confirmed"]) for c in clips if c["label"] == "non_fall")
    elapsed = time.perf_counter() - started
    settings = get_settings()
    configuration = {
        key: value
        for key, value in settings.model_dump().items()
        if key.startswith(("pose_", "fall_")) or key == "m2a_enabled"
    }
    model_path = Path(estimator._model_path) if estimator else args.model
    for clip in supplementary:
        clip.pop("inferenceMs")
    source_paths = [
        Path(__file__),
        *Path("app/services").glob("*pose*.py"),
        Path("app/services/fall_tracker.py"),
        Path("app/config.py"),
    ]
    report = {
        "scope": "inventory"
        if args.inventory_only
        else "offline annotated-person replay; original video time",
        "createdAt": datetime.now(UTC).isoformat(),
        "modelVersion": get_settings().pose_model_version,
        "sampleFps": args.sample_fps,
        "thresholdSeconds": get_settings().fall_immobility_seconds,
        "elapsedSeconds": elapsed,
        "configuration": configuration,
        "modelSha256": hashlib.sha256(model_path.read_bytes()).hexdigest() if model_path else None,
        "manifestSha256": hashlib.sha256(
            (args.dataset / "dataset_manifest.csv").read_bytes()
        ).hexdigest(),
        "sourceSha256": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths},
        "runtime": {
            "python": sys.version,
            "platform": platform.platform(),
            "opencv": cv2.__version__,
            "numpy": np.__version__,
            "mediapipe": mediapipe.__version__,
        },
        "unlistedVideos": unlisted,
        "supplementaryClips": supplementary,
        "summary": {
            "clips": len(clips),
            "fall": positives,
            "nonFall": negatives,
            "fallClipsWithConfirmationTail": sum(c["hasConfirmationTail"] for c in clips),
            "clipTP": confirmed["TP"] if confirmed else None,
            "clipFP": confirmed["FP"] if confirmed else None,
            "clipFN": confirmed["FN"] if confirmed else None,
            "clipTN": confirmed["TN"] if confirmed else None,
            "candidateMetrics": candidate,
            "confirmedMetrics": confirmed,
            "candidateFallClips": sum(
                c["label"] == "fall" and bool(c["candidates"]) for c in clips
            ),
            "inferenceP95Ms": float(np.percentile(timings, 95)) if timings else None,
            "inferenceP50Ms": float(np.percentile(timings, 50)) if timings else None,
            "durationSeconds": sum(c["durationSeconds"] for c in clips),
            "negativeDurationSeconds": negative_seconds,
            "negativeConfirmedEpisodes": negative_episodes,
            "falseAlarmsPerNegativeHour": negative_episodes * 3600 / negative_seconds
            if estimator and negative_seconds
            else None,
            "zeroFalseAlarmPoissonUpper95PerHour": -math.log(0.05) * 3600 / negative_seconds
            if estimator and negative_seconds and negative_episodes == 0
            else None,
            "poseSamples": sum(c["poseSamples"] for c in clips),
            "samples": sum(c["samples"] for c in clips),
            "annotatedPersonSamples": sum(c["annotatedPersonSamples"] for c in clips),
            "offlineSamplesPerWallSecond": sum(c["samples"] for c in clips) / elapsed,
            "confirmationIntervalP95Seconds": float(
                np.percentile(
                    [e["immobileSeconds"] for c in clips for e in c["confirmationEvidence"]], 95
                )
            )
            if any(c["confirmed"] for c in clips)
            else None,
        },
        "limitations": [
            "Ground-truth boxes replace Frigate tracking; no multi-person association measurement.",
            "Fall labels do not certify the required continuous immobility interval or REST polygons.",
            "No repeated terminal frame, time stretching, threshold tuning, or notification delivery.",
            "Clip-level prediction is any episode anywhere in a clip, not temporal event matching.",
            "All manifest clips are descriptive evaluation; no independent held-out acceptance split.",
            "Offline throughput/inference timing do not measure live publisher FPS, queue age, UI or alerts.",
            "Unlisted videos lack a manifest/annotation and are excluded from main metrics; optional probes are separate.",
        ],
        "clips": clips,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"]), flush=True)


if __name__ == "__main__":
    main()
