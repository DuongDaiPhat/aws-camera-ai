"""Reproducible, resumable evaluation against real dev Rekognition (no mock scores)."""

import argparse
import hashlib
import io
import json
import math
import os
import re
import sys
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

import boto3
import cv2
from botocore.config import Config
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/REKOGNITION_2026-11-22"
DATA = OUT / "data"
PRIVATE = ROOT / "artifacts/rekognition-eval-2026-11-22"
PHOTOS = [
    "know_face.png",
    "known_face_half_left.jpg",
    "known_face_half_right.jpg",
    "known_face_left.jpg",
    "known_face_right.jpg",
]
CONFIG = Config(
    connect_timeout=5,
    read_timeout=30,
    retries={"total_max_attempts": 3, "mode": "standard"},
)
COLLECTION = "camerai-s4-dev-owner-" + str(
    uuid.uuid5(uuid.NAMESPACE_URL, "camera-ai-eval-2026-11-22")
)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def jpeg(im):
    stream = io.BytesIO()
    im.convert("RGB").save(stream, format="JPEG", quality=94)
    return stream.getvalue()


def call(client, method, **kwargs):
    response = getattr(client, method)(**kwargs)
    with (OUT / "logs/aws-requests.jsonl").open("a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "at": datetime.now(UTC).isoformat(),
                    "operation": method,
                    "requestId": response.get("ResponseMetadata", {}).get("RequestId"),
                    "httpStatus": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
                }
            )
            + "\n"
        )
    return response


def sheet(items, path, cols=6, width=215, height=152):
    canvas = Image.new("RGB", (cols * width, math.ceil(len(items) / cols) * height), "#17202b")
    draw = ImageDraw.Draw(canvas)
    for i, (im, text) in enumerate(items):
        thumb = ImageOps.contain(im.convert("RGB"), (width - 6, height - 30))
        x, y = i % cols * width, i // cols * height
        canvas.paste(thumb, (x + (width - thumb.width) // 2, y))
        draw.text((x + 4, y + height - 28), text, fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)


def prepare():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    frames = []
    manifest = {
        "sampling": "2s for long videos; 0.5s for short videos; start=0",
        "files": [],
    }
    for p in sorted((ROOT / "local_image").iterdir()):
        if p.suffix.lower() not in (".jpg", ".png", ".mp4"):
            continue
        entry = {
            "name": p.name,
            "bytes": p.stat().st_size,
            "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
        }
        if p.suffix == ".mp4":
            cap = cv2.VideoCapture(str(p))
            fps, count = (
                cap.get(cv2.CAP_PROP_FPS),
                int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            )
            duration = count / fps
            entry.update(fps=fps, frameCount=count, durationSeconds=duration)
            step = 2 if duration > 20 else 0.5
            items = []
            for index in range(math.ceil(duration / step)):
                t = index * step
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
                ok, frame = cap.read()
                if not ok:
                    continue
                sample_id = f"{p.stem}__{index:03d}"
                im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                dest = PRIVATE / "frames" / f"{sample_id}.jpg"
                dest.parent.mkdir(parents=True, exist_ok=True)
                im.save(dest, quality=94)
                frames.append(
                    {
                        "sampleId": sample_id,
                        "video": p.name,
                        "time": t,
                        "framePath": str(dest.relative_to(ROOT)),
                    }
                )
                items.append((im, f"{index:03d}  t={t:g}s"))
            cap.release()
            sheet(items, OUT / "screenshots" / f"samples-{p.stem}.jpg")
        manifest["files"].append(entry)
    save(DATA / "manifest.json", manifest)
    save(DATA / "frames.json", frames)
    sheet(
        [(Image.open(ROOT / "local_image" / p), p) for p in PHOTOS],
        OUT / "screenshots/reference-angles.jpg",
        cols=5,
        width=240,
        height=260,
    )
    print(
        json.dumps(
            {
                "frames": len(frames),
                "videos": [v for v in manifest["files"] if "fps" in v],
            },
            indent=2,
        )
    )


def configure_lambda(session):
    client = session.client("lambda", config=CONFIG)
    name = "camerai-s4-dev-face"
    cfg = client.get_function_configuration(FunctionName=name)
    log = (OUT / "logs/cloudflared.txt").read_text(encoding="utf-8-sig")
    urls = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", log)
    if not urls:
        raise ValueError("No tunnel URL found")
    url = urls[0] + "/api/v1"
    variables = cfg["Environment"]["Variables"].copy()
    old = variables["INTERNAL_API_BASE_URL"]
    if old != url:
        variables["INTERNAL_API_BASE_URL"] = url
        result = call(
            client,
            "update_function_configuration",
            FunctionName=name,
            RevisionId=cfg["RevisionId"],
            Environment={"Variables": variables},
        )
        client.get_waiter("function_updated_v2").wait(
            FunctionName=name, WaiterConfig={"Delay": 2, "MaxAttempts": 60}
        )
    else:
        result = cfg
    # Never persist the Lambda secret variables.
    record = {
        "functionName": name,
        "previousUrl": old,
        "newUrl": url,
        "revisionId": result["RevisionId"],
        "at": datetime.now(UTC).isoformat(),
        "state": client.get_function_configuration(FunctionName=name)["LastUpdateStatus"],
    }
    save(DATA / "lambda-update.json", record)
    env_file = ROOT / ".env"
    text = env_file.read_text(encoding="utf-8-sig")
    text = re.sub(r"(?m)^INTERNAL_API_BASE_URL=.*$", f"INTERNAL_API_BASE_URL={url}", text)
    env_file.write_text(text, encoding="utf-8")
    print(json.dumps(record, indent=2))


def evaluate(session):
    rek = session.client("rekognition", config=CONFIG)
    enrollment_path = DATA / "enrollment.json"
    if enrollment_path.exists():
        enrollment = json.loads(enrollment_path.read_text(encoding="utf-8"))
    else:
        with suppress(rek.exceptions.ResourceAlreadyExistsException):
            call(rek, "create_collection", CollectionId=COLLECTION)
        enrollment = []
        for variant in ["original", "mirror"]:
            for index, name in enumerate(PHOTOS):
                im = ImageOps.exif_transpose(Image.open(ROOT / "local_image" / name)).convert("RGB")
                if variant == "mirror":
                    im = ImageOps.mirror(im)
                path = PRIVATE / "enrollment" / f"{variant}-{index}.jpg"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(jpeg(im))
                detection = call(
                    rek,
                    "detect_faces",
                    Image={"Bytes": path.read_bytes()},
                    Attributes=["DEFAULT"],
                )
                result = call(
                    rek,
                    "index_faces",
                    CollectionId=COLLECTION,
                    Image={"Bytes": path.read_bytes()},
                    ExternalImageId=f"eval-{variant}-{index}",
                    MaxFaces=2,
                    QualityFilter="AUTO",
                    DetectionAttributes=["DEFAULT"],
                )
                row = {
                    "variant": variant,
                    "angle": index,
                    "file": name,
                    "detected": detection.get("FaceDetails", []),
                    "faceRecords": result.get("FaceRecords", []),
                    "unindexedFaces": result.get("UnindexedFaces", []),
                    "modelVersion": result.get("FaceModelVersion"),
                    "collection": COLLECTION,
                }
                enrollment.append(row)
                print(
                    f"index {variant} {name}: {len(row['faceRecords'])} indexed",
                    flush=True,
                )
        save(enrollment_path, enrollment)
    frames = json.loads((DATA / "frames.json").read_text(encoding="utf-8"))
    collection = enrollment[0]["collection"]
    rows_path = DATA / "detections.jsonl"
    done = (
        {
            json.loads(line)["sampleId"]
            for line in rows_path.read_text(encoding="utf-8").splitlines()
        }
        if rows_path.exists()
        else set()
    )
    for frame in frames:
        if frame["sampleId"] in done:
            continue
        im = Image.open(ROOT / frame["framePath"]).convert("RGB")
        detection = call(rek, "detect_faces", Image={"Bytes": jpeg(im)}, Attributes=["DEFAULT"])
        faces = []
        for index, face in enumerate(detection.get("FaceDetails", [])):
            b = face["BoundingBox"]
            left, top = b["Left"] * im.width, b["Top"] * im.height
            w, h = b["Width"] * im.width, b["Height"] * im.height
            crop = im.crop(
                (
                    max(0, int(left - w * 0.25)),
                    max(0, int(top - h * 0.25)),
                    min(im.width, int(left + w * 1.25)),
                    min(im.height, int(top + h * 1.25)),
                )
            )
            crop_path = PRIVATE / "crops" / f"{frame['sampleId']}__f{index}.jpg"
            crop_path.parent.mkdir(parents=True, exist_ok=True)
            crop.save(crop_path, quality=94)
            crop_detection = call(
                rek, "detect_faces", Image={"Bytes": jpeg(crop)}, Attributes=["DEFAULT"]
            )
            search = None
            if len(crop_detection.get("FaceDetails", [])) == 1:
                search = call(
                    rek,
                    "search_faces_by_image",
                    CollectionId=collection,
                    Image={"Bytes": jpeg(crop)},
                    FaceMatchThreshold=0,
                    MaxFaces=100,
                    QualityFilter="NONE",
                )
            faces.append(
                {
                    "index": index,
                    "detail": face,
                    "cropPath": str(crop_path.relative_to(ROOT)),
                    "cropFaceCount": len(crop_detection.get("FaceDetails", [])),
                    "matches": [] if search is None else search.get("FaceMatches", []),
                    "searchedBox": None
                    if search is None
                    else search.get("SearchedFaceBoundingBox"),
                }
            )
        row = {
            **frame,
            "faces": faces,
            "detectRequestId": detection["ResponseMetadata"]["RequestId"],
        }
        with rows_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        print(
            f"sample {frame['sampleId']} t={frame['time']}: faces={len(faces)}",
            flush=True,
        )
    for video in sorted({f["video"] for f in frames}):
        rows = [
            json.loads(line)
            for line in rows_path.read_text().splitlines()
            if json.loads(line)["video"] == video
        ]
        items = [
            (
                Image.open(ROOT / f["cropPath"]),
                f"{r['sampleId'].split('__')[-1]} f{f['index']}",
            )
            for r in rows
            for f in r["faces"]
        ]
        if items:
            sheet(
                items,
                OUT / "screenshots" / f"crops-{Path(video).stem}.jpg",
                cols=8,
                width=145,
                height=175,
            )
    print("EVALUATION_COMPLETE", flush=True)


def rescore(session):
    rek = session.client("rekognition", config=CONFIG)
    collection = json.loads((DATA / "enrollment.json").read_text())[0]["collection"]
    raw = DATA / "detections-raw.jsonl"
    if not raw.exists():
        raw.write_bytes((DATA / "detections.jsonl").read_bytes())
        (DATA / "detections.jsonl").write_text("")
    done = {
        json.loads(line)["sampleId"]
        for line in (DATA / "detections.jsonl").read_text().splitlines()
    }
    for line in raw.read_text().splitlines():
        row = json.loads(line)
        if row["sampleId"] in done:
            continue
        for face in row["faces"]:
            if face["cropFaceCount"] == 1:
                response = call(
                    rek,
                    "search_faces_by_image",
                    CollectionId=collection,
                    Image={"Bytes": (ROOT / face["cropPath"]).read_bytes()},
                    FaceMatchThreshold=0,
                    MaxFaces=100,
                    QualityFilter="NONE",
                )
                face["matches"] = response.get("FaceMatches", [])
                face["searchedBox"] = response.get("SearchedFaceBoundingBox")
        with (DATA / "detections.jsonl").open("a") as f:
            f.write(json.dumps(row) + "\n")
        print("rescored " + row["sampleId"], flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "configure-lambda", "evaluate", "rescore"])
    args = parser.parse_args()
    for p in [DATA, PRIVATE, OUT / "logs", OUT / "screenshots"]:
        p.mkdir(parents=True, exist_ok=True)
    if args.action == "prepare":
        prepare()
        return 0
    session = boto3.Session(region_name=os.environ.get("AWS_REGION", "ap-southeast-1"))
    if args.action == "configure-lambda":
        configure_lambda(session)
    elif args.action == "evaluate":
        evaluate(session)
    elif args.action == "rescore":
        rescore(session)
    return 0


if __name__ == "__main__":
    sys.exit(main())
