"""Native-video quality A/B, without AWS. This is not a Frigate/Re-ID acceptance test.

Run with the AI service virtualenv from the repository root. Face-box association is
only for grouping visible face runs; it must not be used to claim identity safety.
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/ai-service"))


def old_score(m):
    pose = 1 - (min(1, m.pose_yaw_ratio / 0.675) + min(1, m.pose_pitch_ratio / 0.675)) / 2
    return round(
        0.30 * m.detection_score
        + 0.20 * min(1, min(m.face_width_px, m.face_height_px) / 120)
        + 0.25 * min(1, m.sharpness / 135)
        + 0.25 * pose,
        4,
    )


def old_pass(m):
    return (
        min(m.face_width_px, m.face_height_px) >= 60
        and m.detection_score >= 0.75
        and m.sharpness >= 45
        and max(m.pose_yaw_ratio, m.pose_pitch_ratio) <= 0.45
    )


def choose(samples, mode):
    accepted = []
    last = -100
    start = None
    for s in samples:
        if s["time"] - last < (0.35 if mode == "old" else 0.2) - 1e-5:
            continue
        last = s["time"]
        valid = s["oldPassed"] if mode == "old" else s["passed"]
        if not valid:
            continue
        if start is None:
            start = s["time"]
        if s["time"] - start > (1.2 if mode == "old" else 4) + 1e-5:
            break
        accepted.append(s)
        if mode == "old" and (s["oldScore"] >= 0.82 or len(accepted) >= 4):
            break
    return (
        max(
            accepted,
            key=lambda s: s["oldScore"] if mode == "old" else s["qualityScore"],
        )
        if accepted
        else None
    )


def sample_video(name, detector, assessor, private):
    path = ROOT / "local_image/Dataset_2/Videos" / name
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open {name}")
    fps = capture.get(cv2.CAP_PROP_FPS)
    stride = max(1, round(fps / 5))
    tracks = []
    frame_index = -1
    while True:
        ok = capture.grab()
        if not ok:
            break
        frame_index += 1
        if frame_index % stride:
            continue
        ok, frame = capture.retrieve()
        if not ok:
            raise RuntimeError("Frame decode failed")
        t = frame_index / fps
        scale = min(1, 960 / max(frame.shape[:2]))
        small = cv2.resize(frame, (round(frame.shape[1] * scale), round(frame.shape[0] * scale)))
        detector.setInputSize((small.shape[1], small.shape[0]))
        _, faces = detector.detect(small)
        used = set()
        for face in [] if faces is None else faces:
            box = face[:4] / scale
            center = box[:2] + box[2:] / 2
            options = [
                (
                    np.linalg.norm(center - tr["center"]) / max(box[2], tr["width"], 1),
                    i,
                )
                for i, tr in enumerate(tracks)
                if i not in used and t - tr["last"] <= 1
            ]
            distance, idx = min(options, default=(math.inf, -1))
            if distance > 1.5:
                idx = len(tracks)
                tracks.append({"center": center, "width": box[2], "last": t, "samples": []})
            used.add(idx)
            tr = tracks[idx]
            tr.update(center=center, width=box[2], last=t)
            x, y, w, h = box
            # Isolate a face at native pixel scale. No upscaling/sharpening.
            roi = frame[
                max(0, int(y - 0.4 * h)) : min(frame.shape[0], math.ceil(y + 1.4 * h)),
                max(0, int(x - 0.4 * w)) : min(frame.shape[1], math.ceil(x + 1.4 * w)),
            ]
            if not roi.size:
                continue
            _, encoded = cv2.imencode(".png", roi)
            assessment = assessor.assess(encoded.tobytes(), include_embedding=False)
            if assessment.metrics is None:
                continue
            filename = f"{Path(name).stem}-{idx}-{frame_index}.png"
            (private / filename).write_bytes(encoded.tobytes())
            m = assessment.metrics
            tr["samples"].append(
                {
                    "time": round(t, 5),
                    "frame": frame_index,
                    "qualityScore": assessment.quality_score,
                    "passed": assessment.passed,
                    "reason": assessment.rejection_reason,
                    "oldPassed": old_pass(m),
                    "oldScore": old_score(m),
                    "metrics": m.model_dump(by_alias=True),
                    "privateFile": filename,
                }
            )
    capture.release()
    return tracks


def main():
    from app.config import Settings
    from app.services.face_quality import FaceQualityAssessor

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="docs/test/FACE_BEST_SHOT_2026-11-23")
    parser.add_argument("--videos", nargs="*")
    args = parser.parse_args()
    out = ROOT / args.output
    (out / "crops").mkdir(parents=True, exist_ok=True)
    private = ROOT / "artifacts/face-best-shot-benchmark"
    private.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(2)
    settings = Settings(
        _env_file=None,
        face_detector_path=str(
            ROOT / "services/ai-service/models/face_detection_yunet_2023mar.onnx"
        ),
        face_embedder_path=str(
            ROOT / "services/ai-service/models/face_recognition_sface_2021dec.onnx"
        ),
    )
    assessor = FaceQualityAssessor(settings)
    assessor._load()
    detector = cv2.FaceDetectorYN.create(settings.face_detector_path, "", (320, 320), 0.75)
    videos = args.videos or [
        "known_face_vid_2.mp4",
        "known_face_vid2_with_glass.mp4",
        "known_face_vid6.mp4",
        "known_face_vid6_with_glass.mp4",
        "known_face_and_stranger.mp4",
        "known_face_with_glass_and_stranger.mp4",
        "known_face_vid9.mp4",
        "known_face_turning_back.mp4",
        "known_face_head_tilt_down.mp4",
    ]
    results = []
    for name in videos:
        tracks = sample_video(name, detector, assessor, private)
        for idx, tr in enumerate(tracks):
            samples = tr["samples"]
            if not samples:
                continue
            row = {
                "video": name,
                "faceRun": idx,
                "sampleCount": len(samples),
                "first": samples[0]["time"],
                "last": samples[-1]["time"],
                "old": None,
                "new": None,
            }
            for mode, key in [("old", "old"), ("new", "new")]:
                selected = choose(samples, mode)
                if selected:
                    payload = (private / selected["privateFile"]).read_bytes()
                    file = f"crops/{Path(name).stem}-{idx}-{mode}.png"
                    (out / file).write_bytes(payload)
                    row[key] = {k: v for k, v in selected.items() if k != "privateFile"}
                    row[key].update(file=file, sha256=hashlib.sha256(payload).hexdigest())
            results.append(row)
        (out / f"{Path(name).stem}-samples.json").write_text(
            json.dumps(
                [
                    {
                        "faceRun": i,
                        "samples": [
                            {k: v for k, v in s.items() if k != "privateFile"}
                            for s in tr["samples"]
                        ],
                    }
                    for i, tr in enumerate(tracks)
                ],
                indent=2,
            ),
            encoding="utf-8",
        )
        print(
            json.dumps(
                {
                    "video": name,
                    "faceRuns": len(tracks),
                    "samples": sum(len(tr["samples"]) for tr in tracks),
                }
            ),
            flush=True,
        )
    summary = {
        "method": "native-video-face-runs-5fps-quality-only",
        "awsCalls": 0,
        "limitations": "Offline face-box association, not Frigate person tracks. No recognition or tailgating acceptance claims.",
        "settings": {"windowMs": 4000, "minFacePx": 80, "minNormalizedSharpness": 12},
        "results": results,
    }
    (out / "benchmark.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    # Real pixel comparison, never enlarge the saved crops themselves.
    rows = [r for r in results if r["old"] or r["new"]]
    board = Image.new("RGB", (720, len(rows) * 210), "#ececec")
    draw = ImageDraw.Draw(board)
    for i, r in enumerate(rows):
        draw.text((8, i * 210 + 3), f"{r['video']} / run {r['faceRun']}", fill="black")
        for j, key in enumerate(["old", "new"]):
            shot = r[key]
            draw.text(
                (j * 360 + 8, i * 210 + 22),
                f"{key}: no accepted face"
                if not shot
                else f"{key} t={shot['time']} width={shot['metrics']['faceWidthPx']} detail={shot['metrics']['normalizedSharpness']:.1f}",
                fill="black",
            )
            if shot:
                im = Image.open(out / shot["file"]).convert("RGB")
                im.thumbnail((335, 155))
                board.paste(im, (j * 360 + 8, i * 210 + 45))
    board.save(out / "comparison.jpg", quality=95)


if __name__ == "__main__":
    main()
