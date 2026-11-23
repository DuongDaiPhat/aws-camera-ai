"""Build disclosed, deterministic video stimuli from unmodified native Dataset_2 frames.

No recognition results or quality scores are injected. All recognition remains live.
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/ai-service"))

cv2.setNumThreads(2)
out = ROOT / "artifacts/face-reacceptance-2026-11-23/controls"
out.mkdir(parents=True, exist_ok=True)
videos = ROOT / "local_image/Dataset_2/Videos"
selected = set(sys.argv[1:])
public = ROOT / "docs/test/FACE_REACCEPTANCE_2026-11-23/data/control-manifest.json"
manifest = (
    [
        item
        for item in json.loads(public.read_text(encoding="utf-8"))["controls"]
        if item["file"] not in selected
    ]
    if selected and public.exists()
    else []
)


def frame(name, seconds, file):
    cap = cv2.VideoCapture(str(videos / name))
    cap.set(cv2.CAP_PROP_POS_FRAMES, round(seconds * cap.get(cv2.CAP_PROP_FPS)))
    ok, image = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError(name)
    cv2.imwrite(str(out / file), image)
    return image


def encode(name, args, derivation):
    if selected and name not in selected:
        return
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *args,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "12",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        str(out / name),
    ]
    subprocess.run(command, check=True)
    manifest.append(
        {
            "file": name,
            "derivation": derivation,
            "sha256": hashlib.sha256((out / name).read_bytes()).hexdigest(),
        }
    )
    print(name, flush=True)


high = frame("known_face_vid_2.mp4", 4.6, "A-front.png")
frame("known_face_vid_2.mp4", 13.0, "A-hand.png")
frame("known_face_vid_2.mp4", 3.2, "A-mid.png")
frame("known_face_vid_2.mp4", 6.0, "A-low-yaw.png")


def make_assessor():
    from app.config import Settings
    from app.services.face_quality import FaceQualityAssessor

    return FaceQualityAssessor(
        Settings(
            _env_file=None,
            face_detector_path=str(
                ROOT / "services/ai-service/models/face_detection_yunet_2023mar.onnx"
            ),
            face_embedder_path=str(
                ROOT / "services/ai-service/models/face_recognition_sface_2021dec.onnx"
            ),
        )
    )


assessor = make_assessor()
assessor._load()
faces = assessor._detect_faces(high)
face = max(faces, key=lambda item: item[14])
x, y, w, h = face[:4]
masked = high.copy()
cv2.rectangle(
    masked,
    (max(0, int(x - 0.2 * w)), max(0, int(y - 0.25 * h))),
    (min(high.shape[1], int(x + 1.2 * w)), min(high.shape[0], int(y + 1.2 * h))),
    (32, 32, 32),
    -1,
)
cv2.imwrite(str(out / "A-occluded.png"), masked)
norm = "fps=30,setsar=1,setpts=PTS-STARTPTS"
encode(
    "TC09-unknown-recheck.mp4",
    [
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "12",
        "-i",
        str(out / "A-hand.png"),
        "-ss",
        "4.6",
        "-t",
        "8.4",
        "-i",
        str(videos / "known_face_vid_2.mp4"),
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "18",
        "-i",
        str(out / "A-front.png"),
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        f"[0:v]{norm}[a];[1:v]reverse,{norm}[b];[2:v]{norm}[c];[a][b][c]concat=n=3:v=1:a=0[v]",
        "-map",
        "[v]",
    ],
    {
        "source": "known_face_vid_2.mp4",
        "initialHoldSeconds": 12,
        "initialSourceTime": 13.0,
        "reverseSourceInterval": [4.6, 13.0],
        "finalHoldSeconds": 18,
        "finalSourceTime": 4.6,
        "purpose": "Exercise a genuine quality gain on one continuous person track",
    },
)
encode(
    "TC09-undetermined-retry.mp4",
    [
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "14",
        "-i",
        str(out / "A-occluded.png"),
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "18",
        "-i",
        str(out / "A-front.png"),
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        f"[0:v]{norm}[a];[1:v]{norm}[b];[a][b]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
    ],
    {
        "source": "known_face_vid_2.mp4",
        "sourceTime": 4.6,
        "occlusionSeconds": 14,
        "clearSeconds": 18,
        "occluder": "opaque rectangle over detected face",
        "purpose": "AI-outage/fail-open control, then real no-face AWS outcome and restored quality gate",
    },
)
encode(
    "TC09-undetermined-cap.mp4",
    [
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "12",
        "-i",
        str(out / "A-hand.png"),
        "-ss",
        "3.2",
        "-t",
        "9.8",
        "-i",
        str(videos / "known_face_vid_2.mp4"),
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "16",
        "-i",
        str(out / "A-mid.png"),
        "-ss",
        "3.2",
        "-t",
        "1.4",
        "-i",
        str(videos / "known_face_vid_2.mp4"),
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "20",
        "-i",
        str(out / "A-front.png"),
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        f"[0:v]{norm}[a];[1:v]reverse,{norm}[b];[2:v]{norm}[c];[3:v]{norm}[d];[4:v]{norm}[e];[a][b][c][d][e]concat=n=5:v=1:a=0[v]",
        "-map",
        "[v]",
    ],
    {
        "source": "known_face_vid_2.mp4",
        "holds": [[13.0, 12], [3.2, 16], [4.6, 20]],
        "reverseSourceIntervals": [[3.2, 13.0]],
        "forwardSourceIntervals": [[3.2, 4.6]],
        "purpose": "Genuine quality gains while scoped storage fault causes real InvalidS3ObjectException, verify two-retry cap",
    },
)
for source, name, timestamp in [
    ("known_face_vid_2.mp4", "TC02-known-lock-no-glasses.mp4", 4.6),
    ("known_face_vid2_with_glass.mp4", "TC02-known-lock-glasses.mp4", 5.6),
]:
    file = f"{name}.png"
    frame(source, timestamp, file)
    encode(
        name,
        ["-loop", "1", "-framerate", "30", "-t", "30", "-i", str(out / file)],
        {
            "source": source,
            "sourceTime": timestamp,
            "holdSeconds": 30,
            "purpose": "Observe KNOWN lock for >=10 seconds with a stationary real person image",
        },
    )
encode(
    "TC09-unknown-cap.mp4",
    [
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "12",
        "-i",
        str(out / "A-low-yaw.png"),
        "-ss",
        "4.6",
        "-t",
        "1.4",
        "-i",
        str(videos / "known_face_vid_2.mp4"),
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "20",
        "-i",
        str(out / "A-front.png"),
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        f"[0:v]{norm}[a];[1:v]reverse,{norm}[b];[2:v]{norm}[c];[a][b][c]concat=n=3:v=1:a=0[v]",
        "-map",
        "[v]",
    ],
    {
        "source": "known_face_vid_2.mp4",
        "holds": [[6.0, 12], [4.6, 20]],
        "reverseSourceInterval": [4.6, 6.0],
        "purpose": "Real UNKNOWN single-recheck/cap with >=0.15 quality gain; A absent and B keeps collection nonempty",
    },
)
source_hashes = {
    p.name: hashlib.sha256(p.read_bytes()).hexdigest()
    for p in [
        videos / "known_face_vid_2.mp4",
        videos / "known_face_vid2_with_glass.mp4",
    ]
}
public = ROOT / "docs/test/FACE_REACCEPTANCE_2026-11-23/data/control-manifest.json"
public.write_text(
    json.dumps({"sourceHashes": source_hashes, "controls": manifest}, indent=2),
    encoding="utf-8",
)
