"""Mine hard-negative frames where YOLO26n falsely fires on lights, glare, or screens.

Outputs YOLO-ready background images + empty `.txt` labels for fine-tuning YOLO26n v3.
"""

import argparse
import json
import logging
from pathlib import Path

import cv2

from app.config import Settings
from app.services.fire_detector import FireDetector

LOGGER = logging.getLogger(__name__)
SERVICE_DIR = Path(__file__).resolve().parents[2]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".avi", ".mp4", ".mkv", ".mov"}


def load_detector(model_path: Path | None, model_sha256: str | None) -> FireDetector:
    manifest = json.loads((SERVICE_DIR / "model-manifest.json").read_text(encoding="utf-8"))
    artifact = manifest["fire"]["artifact"]
    resolved_path = model_path or (SERVICE_DIR / "models" / artifact["filename"])
    resolved_sha = model_sha256 or artifact["sha256"]
    settings = Settings(
        _env_file=None,
        fire_model_path=str(resolved_path),
        fire_model_sha256=resolved_sha,
        fire_model_version=artifact["modelVersion"],
        fire_output_confidence_floor=0.10,
    )
    return FireDetector(settings)


def save_hard_negative(image: cv2.typing.MatLike, out_dir: Path, name: str) -> None:
    images_dir = out_dir / "images"
    labels_dir = out_dir / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(images_dir / f"{name}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    (labels_dir / f"{name}.txt").write_text("", encoding="utf-8")


def mine_videos(
    directory: Path,
    detector: FireDetector,
    out_dir: Path,
    min_score: float,
    sample_fps: float,
    min_interval_seconds: float,
) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted(p for p in directory.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS):
        capture = cv2.VideoCapture(str(path))
        fps = capture.get(cv2.CAP_PROP_FPS)
        if not capture.isOpened() or fps <= 0:
            capture.release()
            continue
        step = max(1, int(round(fps / sample_fps)))
        frame_idx = 0
        last_saved_sec = -min_interval_seconds
        saved = 0
        peak = 0.0
        try:
            while capture.grab():
                if frame_idx % step == 0:
                    ok, image = capture.retrieve()
                    if ok and image is not None:
                        detections = detector.detect_image(image)
                        score = max((d.confidence for d in detections), default=0.0)
                        peak = max(peak, score)
                        sec = frame_idx / fps
                        if score >= min_score and (sec - last_saved_sec) >= min_interval_seconds:
                            save_hard_negative(
                                image,
                                out_dir,
                                f"hn_{path.stem}_f{frame_idx:06d}_s{int(score * 100):03d}",
                            )
                            last_saved_sec = sec
                            saved += 1
                frame_idx += 1
        finally:
            capture.release()
        records.append(
            {"source": path.name, "savedFrames": saved, "peakFalseScore": round(peak, 4)}
        )
        LOGGER.info("Mined %s: saved=%d peak=%.3f", path.name, saved, peak)
    return records


def mine_images(
    directory: Path, detector: FireDetector, out_dir: Path, min_score: float
) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted(p for p in directory.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS):
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            continue
        detections = detector.detect_image(image)
        score = max((d.confidence for d in detections), default=0.0)
        if score >= min_score:
            save_hard_negative(image, out_dir, f"hn_img_{path.stem}_s{int(score * 100):03d}")
            records.append(
                {"source": path.name, "savedFrames": 1, "peakFalseScore": round(score, 4)}
            )
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--neg-video-dir", type=Path, action="append", default=[])
    parser.add_argument("--neg-image-dir", type=Path, action="append", default=[])
    parser.add_argument("--model-path", type=Path, default=None)
    parser.add_argument("--model-sha256", type=str, default=None)
    parser.add_argument("--min-score", type=float, default=0.35)
    parser.add_argument("--sample-fps", type=float, default=2.0)
    parser.add_argument("--min-interval-seconds", type=float, default=1.0)
    args = parser.parse_args()

    detector = load_detector(args.model_path, args.model_sha256)
    records: list[dict[str, object]] = []
    for folder in args.neg_video_dir:
        records.extend(
            mine_videos(
                folder,
                detector,
                args.output_dir,
                args.min_score,
                args.sample_fps,
                args.min_interval_seconds,
            )
        )
    for folder in args.neg_image_dir:
        records.extend(mine_images(folder, detector, args.output_dir, args.min_score))

    total_saved = sum(int(r["savedFrames"]) for r in records)
    report = {
        "minScore": args.min_score,
        "totalHardNegativesSaved": total_saved,
        "sources": records,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "hard-negatives-report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    LOGGER.info("Hard-negative mining complete: total_saved=%d", total_saved)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
