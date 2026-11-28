"""Extract 2.5x context crops from Stage-1 YOLO26 detections for Stage-2 verifier training.

Splits crops by source video/image group (never mixing frames from the same video
between train and val) so validation metrics reflect real generalization.
"""

import argparse
import hashlib
import json
import logging
from pathlib import Path

import cv2

from app.config import Settings
from app.models.fire import FireBoundingBox
from app.services.fire_detector import FireDetector
from app.services.fire_verifier import VERIFIER_INPUT_SIZE, extract_context_crop

LOGGER = logging.getLogger(__name__)
SERVICE_DIR = Path(__file__).resolve().parents[2]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".avi", ".mp4", ".mkv", ".mov"}


def split_bucket(group_key: str, val_ratio: float) -> str:
    digest = hashlib.sha256(group_key.encode("utf-8")).digest()
    fraction = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    return "val" if fraction < val_ratio else "train"


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


def save_detection_crops(
    image: cv2.typing.MatLike,
    boxes: list[tuple[FireBoundingBox, float]],
    output_dir: Path,
    split: str,
    label_name: str,
    prefix: str,
    context_scale: float,
) -> int:
    target = output_dir / split / label_name
    target.mkdir(parents=True, exist_ok=True)
    saved = 0
    for idx, (box, score) in enumerate(boxes):
        crop = extract_context_crop(
            image, box, context_scale=context_scale, output_size=VERIFIER_INPUT_SIZE
        )
        filename = f"{prefix}_b{idx}_s{int(round(score * 100)):03d}.jpg"
        if cv2.imwrite(str(target / filename), crop, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            saved += 1
    return saved


def process_image_dir(
    directory: Path,
    detector: FireDetector,
    label_name: str,
    output_dir: Path,
    min_score: float,
    context_scale: float,
    val_ratio: float,
    max_per_dir: int,
) -> int:
    total = 0
    files = sorted(p for p in directory.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)
    for path in files:
        if max_per_dir and total >= max_per_dir:
            break
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            continue
        detections = [d for d in detector.detect_image(image) if d.confidence >= min_score]
        if not detections:
            continue
        split = split_bucket(f"{label_name}:{path.stem}", val_ratio)
        boxes = [(d.bounding_box, d.confidence) for d in detections]
        total += save_detection_crops(
            image, boxes, output_dir, split, label_name, f"img_{path.stem}", context_scale
        )
    return total


def process_video_dir(
    directory: Path,
    detector: FireDetector,
    label_name: str,
    output_dir: Path,
    min_score: float,
    context_scale: float,
    val_ratio: float,
    sample_fps: float,
    max_per_video: int,
) -> int:
    total = 0
    videos = sorted(p for p in directory.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS)
    for video_path in videos:
        capture = cv2.VideoCapture(str(video_path))
        fps = capture.get(cv2.CAP_PROP_FPS)
        if not capture.isOpened() or fps <= 0:
            capture.release()
            continue
        step = max(1, int(round(fps / sample_fps)))
        split = split_bucket(f"{label_name}:{video_path.stem}", val_ratio)
        frame_idx = 0
        saved_video = 0
        try:
            while capture.grab():
                if frame_idx % step == 0:
                    ok, image = capture.retrieve()
                    if ok and image is not None:
                        detections = [
                            d for d in detector.detect_image(image) if d.confidence >= min_score
                        ]
                        if detections:
                            boxes = [(d.bounding_box, d.confidence) for d in detections]
                            saved = save_detection_crops(
                                image,
                                boxes,
                                output_dir,
                                split,
                                label_name,
                                f"vid_{video_path.stem}_f{frame_idx:06d}",
                                context_scale,
                            )
                            saved_video += saved
                            total += saved
                            if max_per_video and saved_video >= max_per_video:
                                break
                frame_idx += 1
        finally:
            capture.release()
        LOGGER.info(
            "Video %s (%s/%s): extracted %d crops", video_path.name, split, label_name, saved_video
        )
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--pos-video-dir", type=Path, action="append", default=[])
    parser.add_argument("--neg-video-dir", type=Path, action="append", default=[])
    parser.add_argument("--pos-image-dir", type=Path, action="append", default=[])
    parser.add_argument("--neg-image-dir", type=Path, action="append", default=[])
    parser.add_argument("--model-path", type=Path, default=None)
    parser.add_argument("--model-sha256", type=str, default=None)
    parser.add_argument("--min-score", type=float, default=0.35)
    parser.add_argument("--context-scale", type=float, default=2.5)
    parser.add_argument("--sample-fps", type=float, default=2.0)
    parser.add_argument("--val-ratio", type=float, default=0.20)
    parser.add_argument("--max-per-video", type=int, default=40)
    parser.add_argument("--max-per-image-dir", type=int, default=1500)
    args = parser.parse_args()

    detector = load_detector(args.model_path, args.model_sha256)
    counts = {"real_fire": 0, "false_alarm": 0}
    for folder in args.pos_video_dir:
        counts["real_fire"] += process_video_dir(
            folder,
            detector,
            "real_fire",
            args.output_dir,
            args.min_score,
            args.context_scale,
            args.val_ratio,
            args.sample_fps,
            args.max_per_video,
        )
    for folder in args.neg_video_dir:
        counts["false_alarm"] += process_video_dir(
            folder,
            detector,
            "false_alarm",
            args.output_dir,
            args.min_score,
            args.context_scale,
            args.val_ratio,
            args.sample_fps,
            args.max_per_video,
        )
    for folder in args.pos_image_dir:
        counts["real_fire"] += process_image_dir(
            folder,
            detector,
            "real_fire",
            args.output_dir,
            args.min_score,
            args.context_scale,
            args.val_ratio,
            args.max_per_image_dir,
        )
    for folder in args.neg_image_dir:
        counts["false_alarm"] += process_image_dir(
            folder,
            detector,
            "false_alarm",
            args.output_dir,
            args.min_score,
            args.context_scale,
            args.val_ratio,
            args.max_per_image_dir,
        )

    manifest = {
        "contextScale": args.context_scale,
        "minStage1Score": args.min_score,
        "valRatio": args.val_ratio,
        "counts": counts,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    LOGGER.info("Extraction complete: %s", json.dumps(counts))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
