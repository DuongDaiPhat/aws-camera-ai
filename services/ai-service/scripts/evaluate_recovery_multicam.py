"""Evaluate FALL_RECOVERY_ANGLE_DEG on Multiple Cameras Fall Dataset (chute*/cam*.avi).

Self-contained 2-stage pipeline that does not modify existing benchmark scripts or results:
1. Extracts and caches 5 FPS 33-keypoint MediaPipe Pose data to --cache (.json.gz),
   or reuses --cache if it already exists.
2. Sweeps FALL_RECOVERY_ANGLE_DEG across [40, 45, 50, 55, 60, 65, 70, 75] deg and reports
   CANDIDATE -> CANCELLED (RECOVERED) transitions, recovery latency, and a PNG plot.
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import sys
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

AI_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.services.fall_tracker import FallTracker  # noqa: E402
from app.services.pose_estimator import PoseEstimator  # noqa: E402
from app.services.pose_geometry import (  # noqa: E402
    NormalizedKeypoint,
    calculate_pose_geometry,
)

VIDEO_EXTENSIONS = (".avi", ".mp4", ".mov", ".mkv")


@contextmanager
def override_settings(overrides: dict[str, str | float | int]):
    """Temporarily override FALL_*/POSE_* env vars and clear Settings cache."""
    previous: dict[str, str | None] = {}
    for key, val in overrides.items():
        env_key = key.upper()
        previous[env_key] = os.environ.get(env_key)
        os.environ[env_key] = str(val)
    get_settings.cache_clear()
    try:
        yield get_settings()
    finally:
        for env_key, old_val in previous.items():
            if old_val is None:
                os.environ.pop(env_key, None)
            else:
                os.environ[env_key] = old_val
        get_settings.cache_clear()


def discover_multicam_videos(dataset_dir: Path) -> list[Path]:
    """Recursively find all video files (e.g. chute01/cam1.avi)."""
    videos = sorted(
        p for p in dataset_dir.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
    )
    if not videos:
        raise FileNotFoundError(f"No video files found under {dataset_dir}")
    return videos


def extract_or_load_cache(
    dataset_dir: Path | None,
    cache_path: Path,
    model_path: Path | None,
    sample_fps: float,
    limit: int | None,
) -> list[dict]:
    """Load existing .json.gz cache or extract 5 FPS keypoints from videos."""
    if cache_path.exists():
        print(f"Loading existing cache: {cache_path}", flush=True)
        with gzip.open(cache_path, "rt", encoding="utf-8") as gz:
            data = json.load(gz)
        clips = data["clips"]
        return clips[:limit] if limit else clips

    if dataset_dir is None:
        raise ValueError("--dataset is required when --cache does not exist yet")

    videos = discover_multicam_videos(dataset_dir)
    if limit:
        videos = videos[:limit]

    estimator = PoseEstimator(model_path)
    started = time.perf_counter()
    cached_clips: list[dict] = []
    errors: list[dict] = []

    try:
        total = len(videos)
        for i, video_path in enumerate(videos, start=1):
            rel_id = str(video_path.relative_to(dataset_dir)).replace("\\", "/")
            capture = cv2.VideoCapture(str(video_path))
            if not capture.isOpened():
                errors.append({"clipId": rel_id, "error": "Cannot decode video"})
                continue

            fps = float(capture.get(cv2.CAP_PROP_FPS))
            count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            if not np.isfinite(fps) or fps <= 0 or count <= 0:
                capture.release()
                errors.append({"clipId": rel_id, "error": f"Invalid timing ({fps=}, {count=})"})
                continue

            samples: list[dict] = []
            next_sample = 0.0
            index = 0
            width, height = 0, 0
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
                    width, height = frame_w, frame_h
                    keypoints, _geom, available, reason = estimator.estimate(image, None)
                    kp_compact = (
                        [
                            [
                                round(kp.x, 5),
                                round(kp.y, 5),
                                round(kp.z, 5),
                                round(kp.visibility, 4),
                            ]
                            for kp in keypoints
                        ]
                        if keypoints is not None
                        else None
                    )
                    samples.append(
                        {
                            "frameIndex": index,
                            "timestampS": round(seconds, 4),
                            "poseAvailable": bool(available),
                            "reason": reason,
                            "keypoints": kp_compact,
                        }
                    )
            finally:
                capture.release()

            cached_clips.append(
                {
                    "clipId": rel_id,
                    "fps": round(fps, 4),
                    "frameCount": index,
                    "width": width,
                    "height": height,
                    "durationSeconds": round(index / fps, 3),
                    "samples": samples,
                }
            )

            if i % 10 == 0 or i == total:
                elapsed = time.perf_counter() - started
                eta = (elapsed / i) * (total - i)
                print(
                    f"[{i}/{total}] {rel_id} | elapsed={elapsed:.1f}s | eta={eta:.1f}s",
                    flush=True,
                )
    finally:
        estimator.close()

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": "multicam-pose-cache-v1",
        "createdAt": datetime.now(UTC).isoformat(),
        "sampleFps": sample_fps,
        "totalClips": len(cached_clips),
        "errors": errors,
        "clips": cached_clips,
    }
    with gzip.open(cache_path, "wt", encoding="utf-8") as gz:
        gz.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    size_mb = cache_path.stat().st_size / (1024 * 1024)
    print(f"Saved cache: {cache_path} ({size_mb:.2f} MB, {len(cached_clips)} clips)", flush=True)
    return cached_clips


def estimate_bbox_size_from_keypoints(
    kps: list[NormalizedKeypoint], min_vis: float
) -> tuple[float, float]:
    """Estimate normalized (width, height) from visible keypoints."""
    pts = [
        (kp.x, kp.y)
        for kp in kps
        if kp.visibility >= min_vis and 0.0 <= kp.x <= 1.0 and 0.0 <= kp.y <= 1.0
    ]
    if len(pts) < 2:
        pts = [(kp.x, kp.y) for kp in kps]
    if len(pts) < 2:
        return 1.0, 1.0
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    bw = max(0.05, min(1.0, (max(xs) - min(xs)) * 1.15))
    bh = max(0.05, min(1.0, (max(ys) - min(ys)) * 1.12))
    return bw, bh


def evaluate_recovery_angle(
    clips: list[dict], recovery_angle_deg: float, immobility_seconds: float
) -> dict:
    """Replay all clips at a given FALL_RECOVERY_ANGLE_DEG and collect recovery stats."""
    base_time = datetime(2026, 10, 19, tzinfo=UTC)
    overrides: dict[str, str | float | int] = {
        "POSE_MIN_VISIBILITY": 0.30,
        "FALL_HISTORY_FRAME_COUNT": 5,
        "FALL_HISTORY_MAX_SECONDS": 4.0,
        "FALL_TORSO_ANGLE_THRESHOLD_DEG": 30.0,
        "FALL_CENTER_DROP_RATIO": 0.20,
        "FALL_TORSO_SHRINK_RATIO": 0.55,
        "FALL_ASPECT_RATIO_THRESHOLD": 0.90,
        "FALL_IMMOBILITY_SECONDS": immobility_seconds,
        "FALL_MOTION_SPEED_THRESHOLD": 0.20,
        "FALL_MAX_VALID_FRAME_GAP_SECONDS": 5.0,
        "FALL_MISSING_POSE_GRACE_SECONDS": 10.0,
        "FALL_RECOVERY_ANGLE_DEG": recovery_angle_deg,
        "FALL_CANDIDATE_MAX_SECONDS": 60.0,
    }

    entered_candidate = 0
    recovered_clips = 0
    confirmed_clips = 0
    recovery_durations: list[float] = []
    recovery_angles: list[float] = []

    with override_settings(overrides) as settings:
        min_vis = settings.pose_min_visibility
        for clip in clips:
            width = int(clip["width"])
            height = int(clip["height"])
            tracker = FallTracker("multicam", clip["clipId"], "person-1")

            clip_candidate_at: float | None = None
            clip_recovered = False
            clip_confirmed = False

            for s in clip["samples"]:
                t_sec = float(s["timestampS"])
                ts = base_time + timedelta(seconds=t_sec)
                frame_id = str(s["frameIndex"])
                raw_kps = s["keypoints"]

                if not s["poseAvailable"] or raw_kps is None:
                    res = tracker.evaluate_frame(ts, frame_id, None, None, False, s["reason"])
                else:
                    kps = [
                        NormalizedKeypoint(x=kp[0], y=kp[1], z=kp[2], visibility=kp[3])
                        for kp in raw_kps
                    ]
                    bbox_w, bbox_h = estimate_bbox_size_from_keypoints(kps, min_vis)
                    geom = calculate_pose_geometry(
                        keypoints=kps,
                        image_width=width,
                        image_height=height,
                        bbox_width=bbox_w,
                        bbox_height=bbox_h,
                        min_visibility=min_vis,
                    )
                    if geom is None:
                        res = tracker.evaluate_frame(
                            ts, frame_id, None, None, False, "AMBIGUOUS_POSE"
                        )
                    else:
                        res = tracker.evaluate_frame(ts, frame_id, kps, geom, True, "OK")

                if res["state"] == "CANDIDATE" and clip_candidate_at is None:
                    clip_candidate_at = t_sec
                elif (
                    res["state"] == "CANCELLED"
                    and res["reason"] == "RECOVERED"
                    and clip_candidate_at is not None
                    and not clip_recovered
                ):
                    clip_recovered = True
                    recovery_durations.append(round(t_sec - clip_candidate_at, 2))
                    if res["torsoAngleDeg"] is not None:
                        recovery_angles.append(float(res["torsoAngleDeg"]))
                elif res["state"] == "CONFIRMED":
                    clip_confirmed = True

            if clip_candidate_at is not None:
                entered_candidate += 1
            if clip_recovered:
                recovered_clips += 1
            if clip_confirmed:
                confirmed_clips += 1

    recovery_rate = (recovered_clips / entered_candidate * 100.0) if entered_candidate else 0.0
    confirmed_rate = (confirmed_clips / entered_candidate * 100.0) if entered_candidate else 0.0
    return {
        "recoveryAngleDeg": recovery_angle_deg,
        "totalClips": len(clips),
        "enteredCandidate": entered_candidate,
        "recovered": recovered_clips,
        "confirmed": confirmed_clips,
        "recoveryRatePct": round(recovery_rate, 2),
        "confirmedRatePct": round(confirmed_rate, 2),
        "medianRecoverySeconds": round(float(np.median(recovery_durations)), 2)
        if recovery_durations
        else None,
        "meanRecoveryAngleDeg": round(float(np.mean(recovery_angles)), 2)
        if recovery_angles
        else None,
    }


def try_plot_recovery(rows: list[dict], output_dir: Path) -> str | None:
    """Plot recovery rate and confirmed rate vs FALL_RECOVERY_ANGLE_DEG."""
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return None

    xs = [r["recoveryAngleDeg"] for r in rows]
    rec_rates = [r["recoveryRatePct"] for r in rows]
    conf_rates = [r["confirmedRatePct"] for r in rows]

    fig, ax = plt.subplots(figsize=(7.5, 4.4))
    ax.plot(xs, rec_rates, marker="o", linewidth=2.2, label="CANDIDATE -> RECOVERED (%)")
    ax.plot(xs, conf_rates, marker="s", linestyle="--", label="CANDIDATE -> CONFIRMED (%)")
    ax.axvline(60.0, color="green", linestyle=":", linewidth=1.8, label="Selected (60°)")
    ax.set_title("Sensitivity Analysis: FALL_RECOVERY_ANGLE_DEG (Multiple Cameras Dataset)")
    ax.set_xlabel("FALL_RECOVERY_ANGLE_DEG (degrees)")
    ax.set_ylabel("Percentage of Candidate Clips (%)")
    ax.set_ylim(0, 105)
    ax.grid(True, linestyle="--", alpha=0.5)
    ax.legend()
    fig.tight_layout()

    out_path = output_dir / "sweep_fall_recovery_angle_deg.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path.name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, help="Path to Fall_dataset/dataset directory")
    parser.add_argument("--cache", type=Path, required=True, help="Path to .json.gz cache")
    parser.add_argument("--output-dir", type=Path, required=True, help="Output directory")
    parser.add_argument("--model", type=Path, help="Optional path to pose_landmarker_lite.task")
    parser.add_argument("--sample-fps", type=float, default=5.0)
    parser.add_argument("--immobility-seconds", type=float, default=3.0)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING)
    clips = extract_or_load_cache(args.dataset, args.cache, args.model, args.sample_fps, args.limit)

    angles = [40.0, 45.0, 50.0, 55.0, 60.0, 65.0, 70.0, 75.0]
    rows = [evaluate_recovery_angle(clips, angle, args.immobility_seconds) for angle in angles]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    plot_name = try_plot_recovery(rows, args.output_dir)

    md_lines = [
        "# KẾT QUẢ THỰC NGHIỆM NGƯỠNG HỒI PHỤC (`FALL_RECOVERY_ANGLE_DEG`)",
        "",
        f"- **Tổng số clip:** {len(clips)}",
        f"- **Ngưỡng bất động đối chiếu (`FALL_IMMOBILITY_SECONDS`):** {args.immobility_seconds}s",
        "",
        "| `FALL_RECOVERY_ANGLE_DEG` | Vào `CANDIDATE` | Hủy (`RECOVERED`) | Tỷ lệ hồi phục (%) | Vào `CONFIRMED` | Trung vị thời gian đứng dậy (s) | Góc thân TB lúc hủy (°) |",
        "| :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]
    for r in rows:
        md_lines.append(
            f"| `{r['recoveryAngleDeg']}°` | {r['enteredCandidate']} | {r['recovered']} "
            f"| **{r['recoveryRatePct']}%** | {r['confirmed']} "
            f"| {r['medianRecoverySeconds'] if r['medianRecoverySeconds'] is not None else '-'} "
            f"| {r['meanRecoveryAngleDeg'] if r['meanRecoveryAngleDeg'] is not None else '-'} |"
        )

    report_path = args.output_dir / "recovery_report.md"
    report_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    (args.output_dir / "recovery_summary.json").write_text(
        json.dumps({"rows": rows, "plot": plot_name}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Done! Report saved to {report_path}", flush=True)
    if plot_name:
        print(f"Generated plot: {plot_name}", flush=True)


if __name__ == "__main__":
    main()
