"""Benchmark fall detection thresholds, ablation study, and 95% bootstrap CI from pose cache.

Replays 5 FPS cached 33-keypoint MediaPipe data through the exact production
`calculate_pose_geometry` and `FallTracker` implementation.

Usage:
    python scripts/benchmark_fall_thresholds.py \
        --cache /content/drive/MyDrive/fall_cache/cache_le2i_103.json.gz \
        --output-dir /content/drive/MyDrive/fall_cache/results_le2i
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import random
import sys
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

AI_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.services.fall_tracker import FallTracker  # noqa: E402
from app.services.pose_geometry import (  # noqa: E402
    NormalizedKeypoint,
    PoseGeometry,
    calculate_pose_geometry,
)


def load_cache(path: Path) -> dict:
    """Load .json or .json.gz pose cache."""
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as gz:
            return json.load(gz)
    return json.loads(path.read_text(encoding="utf-8"))


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


def compute_metrics(records: list[tuple[bool, bool]]) -> dict:
    """Compute TP, FP, FN, TN, Precision, Recall, F1, Specificity from (is_fall, pred) pairs."""
    tp = sum(1 for y, p in records if y and p)
    fp = sum(1 for y, p in records if not y and p)
    fn = sum(1 for y, p in records if y and not p)
    tn = sum(1 for y, p in records if not y and not p)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    specificity = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    return {
        "TP": tp,
        "FP": fp,
        "FN": fn,
        "TN": tn,
        "precision": round(precision * 100, 2),
        "recall": round(recall * 100, 2),
        "f1": round(f1 * 100, 2),
        "specificity": round(specificity * 100, 2),
    }


def bootstrap_ci(
    records: list[tuple[bool, bool]], n_boot: int = 1000, seed: int = 42
) -> dict[str, dict[str, float]]:
    """Compute 95% bootstrap confidence intervals for precision, recall, and F1."""
    rng = random.Random(seed)
    n = len(records)
    if n == 0:
        return {}
    precs, recs, f1s = [], [], []
    for _ in range(n_boot):
        sample = [records[rng.randrange(n)] for _ in range(n)]
        m = compute_metrics(sample)
        precs.append(m["precision"])
        recs.append(m["recall"])
        f1s.append(m["f1"])

    def pct(arr: list[float]) -> dict[str, float]:
        s = sorted(arr)
        return {
            "low": s[int(0.025 * len(s))],
            "median": s[len(s) // 2],
            "high": s[int(0.975 * len(s))],
        }

    return {"precision": pct(precs), "recall": pct(recs), "f1": pct(f1s)}


def estimate_bbox_size_from_keypoints(
    kps: list[NormalizedKeypoint], min_vis: float
) -> tuple[float, float]:
    """Estimate normalized (width, height) from visible keypoints when no detector bbox exists."""
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


def evaluate_cache(
    clips: list[dict],
    overrides: dict[str, str | float | int],
    disable_3d_angle: bool = False,
) -> dict:
    """Replay all cached clips under given settings overrides."""
    base_time = datetime(2026, 10, 19, tzinfo=UTC)
    candidate_records: list[tuple[bool, bool]] = []
    confirmed_records: list[tuple[bool, bool]] = []

    with override_settings(overrides) as settings:
        min_vis = settings.pose_min_visibility
        for clip in clips:
            is_fall = clip["label"] == "fall"
            width = int(clip["width"])
            height = int(clip["height"])
            has_ann_bbox = bool(clip.get("hasAnnotationBbox", False))
            tracker = FallTracker("benchmark", clip["clipId"], "person-1")

            has_candidate = False
            has_confirmed = False

            for s in clip["samples"]:
                ts = base_time + timedelta(seconds=float(s["timestampS"]))
                frame_id = str(s["frameIndex"])
                raw_kps = s["keypoints"]
                bbox = s["bbox"] or [0.0, 0.0, 1.0, 1.0]

                if not s["poseAvailable"] or raw_kps is None:
                    res = tracker.evaluate_frame(ts, frame_id, None, None, False, s["reason"])
                else:
                    kps = [
                        NormalizedKeypoint(x=kp[0], y=kp[1], z=kp[2], visibility=kp[3])
                        for kp in raw_kps
                    ]
                    if has_ann_bbox:
                        bbox_w, bbox_h = float(bbox[2]), float(bbox[3])
                    else:
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
                        if disable_3d_angle:
                            geom = PoseGeometry(
                                torso_angle_deg=geom.torso_angle_deg,
                                center_height=geom.center_height,
                                aspect_ratio=geom.aspect_ratio,
                                center_y_px=geom.center_y_px,
                                bbox_height_px=geom.bbox_height_px,
                                bbox_width_px=geom.bbox_width_px,
                                keypoints_detected=geom.keypoints_detected,
                                image_width=geom.image_width,
                                image_height=geom.image_height,
                                torso_length_px=geom.torso_length_px,
                                torso_angle_3d_deg=90.0,
                            )
                        res = tracker.evaluate_frame(ts, frame_id, kps, geom, True, "OK")

                if res["state"] == "CANDIDATE":
                    has_candidate = True
                elif res["state"] == "CONFIRMED":
                    has_confirmed = True

            candidate_records.append((is_fall, has_candidate))
            confirmed_records.append((is_fall, has_confirmed))

    return {
        "candidate": compute_metrics(candidate_records),
        "confirmed": compute_metrics(confirmed_records),
        "candidateRecords": candidate_records,
        "confirmedRecords": confirmed_records,
    }


def try_plot_sweeps(sweeps: dict[str, list[dict]], output_dir: Path) -> list[str]:
    """Generate PNG sensitivity plots if matplotlib is installed."""
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    saved: list[str] = []
    for param_name, rows in sweeps.items():
        level = (
            "confirmed"
            if param_name in ("FALL_MOTION_SPEED_THRESHOLD", "FALL_RECOVERY_ANGLE_DEG")
            else "candidate"
        )
        xs = [r["value"] for r in rows]
        precs = [r[level]["precision"] for r in rows]
        recs = [r[level]["recall"] for r in rows]
        f1s = [r[level]["f1"] for r in rows]

        fig, ax = plt.subplots(figsize=(7, 4.2))
        ax.plot(xs, precs, marker="o", label="Precision (%)")
        ax.plot(xs, recs, marker="s", label="Recall (%)")
        ax.plot(xs, f1s, marker="^", linewidth=2.2, label="F1-Score (%)")
        ax.set_title(f"Sensitivity Analysis: {param_name} ({level.upper()})")
        ax.set_xlabel(param_name)
        ax.set_ylabel("Score (%)")
        ax.set_ylim(0, 105)
        ax.grid(True, linestyle="--", alpha=0.5)
        ax.legend()
        fig.tight_layout()

        out_path = output_dir / f"sweep_{param_name.lower()}.png"
        fig.savefig(out_path, dpi=150)
        plt.close(fig)
        saved.append(str(out_path.name))
    return saved


def build_markdown_report(
    dataset_name: str,
    total_clips: int,
    baseline_res: dict,
    ci_candidate: dict,
    ci_confirmed: dict,
    ablation_rows: list[dict],
    sweeps: dict[str, list[dict]],
    immobility_seconds: float = 3.0,
) -> str:
    """Format benchmark results into Markdown tables ready for the thesis report."""
    lines = [
        f"# KẾT QUẢ THỰC NGHIỆM CHỨNG MINH NGƯỠNG — {dataset_name}",
        "",
        f"- **Tổng số clip:** {total_clips}",
        f"- **Thời gian chạy:** {datetime.now(UTC).isoformat()}",
        "",
        "## 1. Độ tin cậy thống kê (Bootstrap 95% CI, n=1000)",
        "",
        f"- **Pha 1 (`CANDIDATE`):** "
        f"Precision = **{baseline_res['candidate']['precision']}%** "
        f"(95% CI: {ci_candidate['precision']['low']}% – {ci_candidate['precision']['high']}%), "
        f"Recall = **{baseline_res['candidate']['recall']}%** "
        f"(95% CI: {ci_candidate['recall']['low']}% – {ci_candidate['recall']['high']}%), "
        f"F1 = **{baseline_res['candidate']['f1']}%** "
        f"(95% CI: {ci_candidate['f1']['low']}% – {ci_candidate['f1']['high']}%)",
        f"- **Pha 2 (`CONFIRMED`, immobility={immobility_seconds}s, motion=0.20):** "
        f"Precision = **{baseline_res['confirmed']['precision']}%** "
        f"(95% CI: {ci_confirmed['precision']['low']}% – {ci_confirmed['precision']['high']}%), "
        f"Recall = **{baseline_res['confirmed']['recall']}%** "
        f"(95% CI: {ci_confirmed['recall']['low']}% – {ci_confirmed['recall']['high']}%), "
        f"F1 = **{baseline_res['confirmed']['f1']}%** "
        f"(95% CI: {ci_confirmed['f1']['low']}% – {ci_confirmed['f1']['high']}%)",
        "",
        "## 2. Ablation Study (Đóng góp từng tầng thuật toán)",
        "",
        "| Cấu hình | Stage | TP | FP | FN | TN | Precision (%) | Recall (%) | F1 (%) |",
        "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]
    for row in ablation_rows:
        m = row["metrics"]
        lines.append(
            f"| {row['name']} | {row['stage']} | {m['TP']} | {m['FP']} | {m['FN']} | {m['TN']} "
            f"| {m['precision']} | {m['recall']} | **{m['f1']}** |"
        )

    lines.extend(["", "## 3. Sensitivity Analysis (Quét lưới từng ngưỡng)"])
    for param_name, rows in sweeps.items():
        level = (
            "confirmed"
            if param_name in ("FALL_MOTION_SPEED_THRESHOLD", "FALL_RECOVERY_ANGLE_DEG")
            else "candidate"
        )
        lines.extend(
            [
                "",
                f"### {param_name} (đánh giá ở `{level.upper()}`)",
                "",
                "| Giá trị | TP | FP | FN | TN | Precision (%) | Recall (%) | F1 (%) |",
                "| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
            ]
        )
        for r in rows:
            m = r[level]
            lines.append(
                f"| `{r['value']}` | {m['TP']} | {m['FP']} | {m['FN']} | {m['TN']} "
                f"| {m['precision']} | {m['recall']} | **{m['f1']}** |"
            )

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True, help="Path to .json.gz cache file")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for report/plots")
    parser.add_argument(
        "--immobility-seconds",
        type=float,
        default=3.0,
        help="Immobility seconds for CONFIRMED benchmark on short clips (default: 3.0)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING)
    t0 = time.perf_counter()
    cache = load_cache(args.cache)
    clips = cache["clips"]
    print(f"Loaded {len(clips)} clips from {args.cache.name}", flush=True)

    # Baseline configuration matching .env (with configurable immobility_seconds for short video clips)
    base_cfg: dict[str, str | float | int] = {
        "POSE_MIN_VISIBILITY": 0.30,
        "FALL_HISTORY_FRAME_COUNT": 5,
        "FALL_HISTORY_MAX_SECONDS": 4.0,
        "FALL_TORSO_ANGLE_THRESHOLD_DEG": 30.0,
        "FALL_CENTER_DROP_RATIO": 0.20,
        "FALL_TORSO_SHRINK_RATIO": 0.55,
        "FALL_ASPECT_RATIO_THRESHOLD": 0.90,
        "FALL_IMMOBILITY_SECONDS": args.immobility_seconds,
        "FALL_MOTION_SPEED_THRESHOLD": 0.20,
        "FALL_MAX_VALID_FRAME_GAP_SECONDS": 5.0,
        "FALL_MISSING_POSE_GRACE_SECONDS": 10.0,
        "FALL_RECOVERY_ANGLE_DEG": 60.0,
        "FALL_CANDIDATE_MAX_SECONDS": 60.0,
    }

    print("1/3 Running baseline + Bootstrap 95% CI...", flush=True)
    baseline_res = evaluate_cache(clips, base_cfg)
    ci_cand = bootstrap_ci(baseline_res["candidateRecords"])
    ci_conf = bootstrap_ci(baseline_res["confirmedRecords"])

    print("2/3 Running Ablation Study...", flush=True)
    ablation_2d = evaluate_cache(
        clips,
        {**base_cfg, "FALL_TORSO_SHRINK_RATIO": 1e-6, "FALL_ASPECT_RATIO_THRESHOLD": 1e-6},
        disable_3d_angle=True,
    )
    ablation_rows = [
        {
            "name": "1. Baseline (Chỉ 2D Angle < 30° & Drop >= 0.20)",
            "stage": "CANDIDATE",
            "metrics": ablation_2d["candidate"],
        },
        {
            "name": "2. + 3D Angle & Foreshortening (CANDIDATE đầy đủ)",
            "stage": "CANDIDATE",
            "metrics": baseline_res["candidate"],
        },
        {
            "name": f"3. Full Pipeline (+ Immobility FSM {args.immobility_seconds}s)",
            "stage": "CONFIRMED",
            "metrics": baseline_res["confirmed"],
        },
    ]

    print("3/3 Running Sensitivity Grid Sweeps...", flush=True)
    sweep_grid: dict[str, list[float]] = {
        "FALL_TORSO_ANGLE_THRESHOLD_DEG": [20.0, 25.0, 30.0, 35.0, 40.0],
        "FALL_CENTER_DROP_RATIO": [0.10, 0.15, 0.20, 0.25, 0.30],
        "FALL_TORSO_SHRINK_RATIO": [0.45, 0.50, 0.55, 0.60, 0.65],
        "FALL_ASPECT_RATIO_THRESHOLD": [0.75, 0.85, 0.90, 1.00, 1.10],
        "FALL_MOTION_SPEED_THRESHOLD": [0.05, 0.10, 0.15, 0.20, 0.25, 0.30],
        "FALL_RECOVERY_ANGLE_DEG": [50.0, 60.0, 70.0, 80.0],
    }
    sweeps: dict[str, list[dict]] = {}
    for param, values in sweep_grid.items():
        rows = []
        for val in values:
            res = evaluate_cache(clips, {**base_cfg, param: val})
            rows.append(
                {
                    "value": val,
                    "candidate": res["candidate"],
                    "confirmed": res["confirmed"],
                }
            )
        sweeps[param] = rows

    args.output_dir.mkdir(parents=True, exist_ok=True)
    plots = try_plot_sweeps(sweeps, args.output_dir)

    md_text = build_markdown_report(
        dataset_name=args.cache.stem,
        total_clips=len(clips),
        baseline_res=baseline_res,
        ci_candidate=ci_cand,
        ci_confirmed=ci_conf,
        ablation_rows=ablation_rows,
        sweeps=sweeps,
        immobility_seconds=args.immobility_seconds,
    )
    (args.output_dir / "report.md").write_text(md_text, encoding="utf-8")

    summary_json = {
        "dataset": args.cache.name,
        "totalClips": len(clips),
        "baseline": {
            "candidate": baseline_res["candidate"],
            "confirmed": baseline_res["confirmed"],
            "ciCandidate95": ci_cand,
            "ciConfirmed95": ci_conf,
        },
        "ablation": ablation_rows,
        "sweeps": sweeps,
        "plots": plots,
        "elapsedSeconds": round(time.perf_counter() - t0, 2),
    }
    (args.output_dir / "summary.json").write_text(
        json.dumps(summary_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(
        f"Done in {summary_json['elapsedSeconds']}s! Report saved to {args.output_dir / 'report.md'}",
        flush=True,
    )
    if plots:
        print(f"Generated plots: {', '.join(plots)}", flush=True)


if __name__ == "__main__":
    main()
