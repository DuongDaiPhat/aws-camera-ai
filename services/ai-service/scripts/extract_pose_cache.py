"""Extract and cache 5 FPS MediaPipe Pose Landmarker 33-keypoint data from fall datasets.

Supports both:
1. Manifest datasets (e.g. Dataset_Classified with dataset_manifest.csv + per-frame bbox .txt)
2. Folder-based datasets (e.g. Test_Dataset_70_30 with Fall/Raw_Video & No_Fall/Raw_Video,
   or generic fall/ & non_fall/ directories)

Output is a compressed .json.gz (or .json) cache containing raw 33 keypoints (x, y, z, visibility),
normalized bbox, frame dimensions, and timestamps so threshold sweeps, ablation studies, and
bootstrap CI calculations can replay FallTracker in seconds without re-running MediaPipe.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import logging
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np

# Ensure `app` package is importable when invoked as `python scripts/extract_pose_cache.py`
AI_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.services.pose_estimator import PoseEstimator  # noqa: E402

VIDEO_EXTENSIONS = (".mp4", ".avi", ".mov", ".mkv")


def load_le2i_annotations(path: Path) -> dict[int, tuple[int, int, int, int]]:
    """Parse Le2i per-frame xyxy pixel bounding boxes."""
    boxes: dict[int, tuple[int, int, int, int]] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines()[2:]:
        parts = line.split(",")
        if len(parts) != 6:
            continue
        index, _action, x1, y1, x2, y2 = (int(part) for part in parts)
        boxes[index] = (x1, y1, x2, y2)
    return boxes


def discover_clips(dataset_dir: Path) -> list[dict]:
    """Discover clips from dataset_manifest.csv or standard Fall/No_Fall folder layout."""
    manifest_csv = dataset_dir / "dataset_manifest.csv"
    if manifest_csv.exists():
        clips: list[dict] = []
        with manifest_csv.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                label = row["label"].strip()
                video_path = (dataset_dir / label / row["video_file"]).resolve()
                ann_file = row.get("annotation_file", "").strip()
                ann_path = (video_path.parent / ann_file) if ann_file else None
                clips.append(
                    {
                        "clipId": f"{label}/{row['video_file']}",
                        "label": label,
                        "videoPath": video_path,
                        "annotationPath": ann_path if ann_path and ann_path.exists() else None,
                        "fallStartFrame": int(row["start_frame"])
                        if row.get("start_frame")
                        else None,
                        "fallEndFrame": int(row["end_frame"]) if row.get("end_frame") else None,
                    }
                )
        return clips

    # Fallback: Test_Dataset_70_30 (Fall/Raw_Video, No_Fall/Raw_Video) or fall/, non_fall/
    folder_candidates = [
        ("fall", dataset_dir / "Fall" / "Raw_Video"),
        ("non_fall", dataset_dir / "No_Fall" / "Raw_Video"),
        ("fall", dataset_dir / "fall"),
        ("non_fall", dataset_dir / "non_fall"),
    ]
    clips = []
    seen: set[Path] = set()
    for label, folder in folder_candidates:
        if not folder.is_dir():
            continue
        for video_path in sorted(folder.iterdir()):
            if video_path.is_file() and video_path.suffix.lower() in VIDEO_EXTENSIONS:
                resolved = video_path.resolve()
                if resolved in seen:
                    continue
                seen.add(resolved)
                clips.append(
                    {
                        "clipId": f"{label}/{video_path.name}",
                        "label": label,
                        "videoPath": resolved,
                        "annotationPath": None,
                        "fallStartFrame": None,
                        "fallEndFrame": None,
                    }
                )
    if not clips:
        raise FileNotFoundError(
            f"No dataset_manifest.csv or Fall/No_Fall video folders found in {dataset_dir}"
        )
    return clips


def extract_clip(
    clip_info: dict,
    estimator: PoseEstimator,
    sample_fps: float,
) -> dict:
    """Decode one video at sample_fps and extract 33 MediaPipe landmarks per sampled frame."""
    path: Path = clip_info["videoPath"]
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"Cannot decode video: {path}")

    fps = float(capture.get(cv2.CAP_PROP_FPS))
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not np.isfinite(fps) or fps <= 0 or count <= 0:
        capture.release()
        raise ValueError(f"Invalid video timing ({fps=}, {count=}): {path}")

    boxes = (
        load_le2i_annotations(clip_info["annotationPath"])
        if clip_info["annotationPath"] is not None
        else None
    )

    samples: list[dict] = []
    next_sample = 0.0
    index = 0
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

            frame_h, frame_w = image.shape[:2]
            width = frame_w
            height = frame_h
            bbox_norm: dict[str, float] | None = None
            bbox_compact: list[float] | None = None

            if boxes is not None:
                x1, y1, x2, y2 = boxes.get(index, (0, 0, 0, 0))
                if not (0 <= x1 < x2 <= frame_w and 0 <= y1 < y2 <= frame_h):
                    samples.append(
                        {
                            "frameIndex": index,
                            "timestampS": round(seconds, 4),
                            "poseAvailable": False,
                            "reason": "NO_ANNOTATED_PERSON",
                            "bbox": None,
                            "keypoints": None,
                            "inferenceMs": 0.0,
                        }
                    )
                    continue
                bbox_norm = {
                    "x": x1 / frame_w,
                    "y": y1 / frame_h,
                    "width": (x2 - x1) / frame_w,
                    "height": (y2 - y1) / frame_h,
                }
                bbox_compact = [round(bbox_norm[k], 5) for k in ("x", "y", "width", "height")]

            t0 = time.perf_counter()
            keypoints, _geometry, available, reason = estimator.estimate(image, bbox_norm)
            infer_ms = round((time.perf_counter() - t0) * 1000.0, 2)

            kp_compact = (
                [
                    [round(kp.x, 5), round(kp.y, 5), round(kp.z, 5), round(kp.visibility, 4)]
                    for kp in keypoints
                ]
                if keypoints is not None
                else None
            )
            if bbox_compact is None:
                # Full-frame fallback uses normalized [0, 0, 1, 1] as bbox scale when no detector bbox exists.
                bbox_compact = [0.0, 0.0, 1.0, 1.0]

            samples.append(
                {
                    "frameIndex": index,
                    "timestampS": round(seconds, 4),
                    "poseAvailable": bool(available),
                    "reason": reason,
                    "bbox": bbox_compact,
                    "keypoints": kp_compact,
                    "inferenceMs": infer_ms,
                }
            )
    finally:
        capture.release()

    return {
        "clipId": clip_info["clipId"],
        "label": clip_info["label"],
        "fps": round(fps, 4),
        "frameCount": index,
        "width": width,
        "height": height,
        "durationSeconds": round(index / fps, 3),
        "hasAnnotationBbox": boxes is not None,
        "fallStartFrame": clip_info["fallStartFrame"],
        "fallEndFrame": clip_info["fallEndFrame"],
        "samples": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True, help="Path to dataset directory")
    parser.add_argument(
        "--output", type=Path, required=True, help="Output cache path (.json.gz or .json)"
    )
    parser.add_argument("--model", type=Path, help="Optional path to pose_landmarker_lite.task")
    parser.add_argument("--sample-fps", type=float, default=5.0, help="Sampling rate (default: 5)")
    parser.add_argument("--limit", type=int, help="Optional limit on number of clips for testing")
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING)
    clips_meta = discover_clips(args.dataset)
    if args.limit:
        clips_meta = clips_meta[: args.limit]

    estimator = PoseEstimator(args.model)
    started = time.perf_counter()
    cached_clips: list[dict] = []
    errors: list[dict] = []

    try:
        total = len(clips_meta)
        for i, info in enumerate(clips_meta, start=1):
            try:
                clip_data = extract_clip(info, estimator, args.sample_fps)
                cached_clips.append(clip_data)
            except Exception as exc:
                errors.append({"clipId": info["clipId"], "error": str(exc)})
                print(f"[{i}/{total}] ERROR {info['clipId']}: {exc}", flush=True)
                continue

            if i % 10 == 0 or i == total:
                elapsed = time.perf_counter() - started
                eta = (elapsed / i) * (total - i)
                print(
                    f"[{i}/{total}] {info['clipId']} | elapsed={elapsed:.1f}s | eta={eta:.1f}s",
                    flush=True,
                )
    finally:
        model_path = Path(estimator._model_path)
        estimator.close()

    settings = get_settings()
    payload = {
        "schemaVersion": "pose-cache-v1",
        "createdAt": datetime.now(UTC).isoformat(),
        "datasetDir": str(args.dataset),
        "sampleFps": args.sample_fps,
        "modelVersion": settings.pose_model_version,
        "modelSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        "totalClips": len(cached_clips),
        "errorCount": len(errors),
        "errors": errors,
        "clips": cached_clips,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    raw_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if args.output.suffix == ".gz":
        with gzip.open(args.output, "wt", encoding="utf-8") as gz:
            gz.write(raw_json)
    else:
        args.output.write_text(raw_json, encoding="utf-8")

    size_mb = args.output.stat().st_size / (1024 * 1024)
    print(
        f"Done: {len(cached_clips)} clips ({len(errors)} errors) saved to {args.output} ({size_mb:.2f} MB)",
        flush=True,
    )


if __name__ == "__main__":
    main()
