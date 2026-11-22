"""Dev-only live Lambda evidence and deterministic edge cases."""

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import boto3
import requests
from botocore.config import Config
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/REKOGNITION_2026-11-22"
PRIVATE = ROOT / "artifacts/rekognition-eval-2026-11-22"
CONFIG = Config(
    connect_timeout=5,
    read_timeout=140,
    retries={"total_max_attempts": 2, "mode": "standard"},
)


def write(path, obj):
    path.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")


def main():  # noqa: C901 - Offline evaluation/report orchestration
    p = argparse.ArgumentParser()
    p.add_argument(
        "action",
        choices=["prepare", "upload", "invoke", "logs", "deploy-logging", "edges"],
    )
    a = p.parse_args()
    session = boto3.Session(region_name=os.environ.get("AWS_REGION", "ap-southeast-1"))
    lam = session.client("lambda", config=CONFIG)
    function = "camerai-s4-dev-face"
    if a.action == "prepare":
        cases = []
        definitions = [
            ("known-no-glasses", "KNOWN", "has_known_face_no_glasses__008__f0.jpg"),
            ("known-glasses", "KNOWN", "has_known_face_with_glasses__007__f0.jpg"),
            (
                "known-crowd-crop",
                "KNOWN",
                "has_known_face_with_many_stranger_faces__000__f4.jpg",
            ),
            ("stranger", "UNKNOWN", "no_known_face__000__f0.jpg"),
            (
                "false-face-hand",
                "UNDETERMINED",
                "has_known_face_no_glasses__038__f1.jpg",
            ),
        ]
        for name, expected, filename in definitions:
            cases.append(
                {
                    "name": name,
                    "expected": expected,
                    "path": str((PRIVATE / "crops" / filename).relative_to(ROOT)),
                }
            )
        blank = PRIVATE / "blank.jpg"
        Image.new("RGB", (640, 480), "white").save(blank)
        cases.append(
            {
                "name": "no-face",
                "expected": "UNDETERMINED",
                "path": str(blank.relative_to(ROOT)),
            }
        )
        frame = PRIVATE / "frames/has_known_face_with_many_stranger_faces__000.jpg"
        cases.append(
            {
                "name": "whole-multiple-faces",
                "expected": "UNDETERMINED",
                "path": str(frame.relative_to(ROOT)),
            }
        )
        corrupt = PRIVATE / "corrupt.jpg"
        corrupt.write_bytes(b"not-an-image")
        cases.append(
            {
                "name": "provider-error-and-retry",
                "expected": "KNOWN",
                "path": str(corrupt.relative_to(ROOT)),
                "delivery": "direct",
            }
        )
        write(OUT / "data/e2e-cases.json", cases)
        print("Prepared 8 live integration cases.")
    elif a.action == "upload":
        s3 = session.client("s3", config=CONFIG)
        jobs = json.loads((PRIVATE / "jobs.json").read_text())
        for job in jobs:
            image = job["envelope"]["payload"]["image"]
            s3.upload_file(
                str(ROOT / job["path"]),
                image["bucket"],
                image["key"],
                ExtraArgs={"ContentType": "image/jpeg", "Tagging": "Expire7d=true"},
            )
        print("Uploaded 8 scoped job images to S3 dev.")
    elif a.action == "invoke":
        jobs = json.loads((PRIVATE / "jobs.json").read_text())
        traces = []
        for job in jobs:
            if job.get("delivery") != "direct":
                continue
            event = {
                "Records": [
                    {
                        "messageId": job["envelope"]["messageId"],
                        "body": json.dumps(job["envelope"]),
                    }
                ]
            }
            for phase in ["invalid-image", "retry-fixed-image", "cached-replay"]:
                if phase == "retry-fixed-image":
                    image = job["envelope"]["payload"]["image"]
                    session.client("s3", config=CONFIG).upload_file(
                        str(ROOT / "local_image/know_face.png"),
                        image["bucket"],
                        image["key"],
                        ExtraArgs={"ContentType": "image/png"},
                    )
                response = lam.invoke(
                    FunctionName=function,
                    InvocationType="RequestResponse",
                    LogType="Tail",
                    Payload=json.dumps(event).encode(),
                )
                with response["Payload"] as body:
                    payload = json.load(body)
                trace = {
                    "phase": phase,
                    "requestId": response["ResponseMetadata"]["RequestId"],
                    "payload": payload,
                    "log": base64.b64decode(response.get("LogResult", "")).decode(),
                }
                traces.append(trace)
                print(phase, payload, flush=True)
        # Replay a successfully queued message too: cache/result receipt must remain unique.
        job = jobs[0]
        response = lam.invoke(
            FunctionName=function,
            InvocationType="RequestResponse",
            LogType="Tail",
            Payload=json.dumps(
                {
                    "Records": [
                        {
                            "messageId": job["envelope"]["messageId"],
                            "body": json.dumps(job["envelope"]),
                        }
                    ]
                }
            ).encode(),
        )
        with response["Payload"] as body:
            payload = json.load(body)
        traces.append(
            {
                "phase": "queued-known-duplicate",
                "payload": payload,
                "log": base64.b64decode(response.get("LogResult", "")).decode(),
            }
        )
        write(OUT / "data/lambda-invocations.json", traces)
    elif a.action == "logs":
        logs = session.client("logs", config=CONFIG)
        started = json.loads((OUT / "data/lambda-update.json").read_text())["at"]
        start = int((datetime.fromisoformat(started).timestamp() - 60) * 1000)
        items = []
        for page in logs.get_paginator("filter_log_events").paginate(
            logGroupName="/aws/lambda/" + function, startTime=start
        ):
            items.extend(page.get("events", []))
        write(OUT / "data/cloudwatch.json", items)
        (OUT / "logs/cloudwatch.txt").write_text(
            "\n".join(x["message"].rstrip() for x in items), encoding="utf-8"
        )
        print("Collected", len(items), "CloudWatch log records.")
    elif a.action == "deploy-logging":
        cfg = lam.get_function(FunctionName=function)
        response = requests.get(cfg["Code"]["Location"], timeout=60)
        response.raise_for_status()
        (PRIVATE / "lambda-before.zip").write_bytes(response.content)
        original = zipfile.ZipFile(io.BytesIO(response.content))
        deployed = original.read("handler.py")
        (PRIVATE / "deployed-handler-before.py").write_bytes(deployed)
        baseline = subprocess.run(
            ["git", "show", "HEAD:services/aws-workers/face/handler.py"],
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout
        if deployed.decode().replace("\r\n", "\n") != baseline.decode().replace("\r\n", "\n"):
            raise RuntimeError(
                "Deployed handler differs from branch baseline; inspect before replacing it"
            )
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for item in original.infolist():
                z.writestr(
                    item,
                    (ROOT / "services/aws-workers/face/handler.py").read_bytes()
                    if item.filename == "handler.py"
                    else original.read(item.filename),
                )
        updated = lam.update_function_code(
            FunctionName=function,
            ZipFile=stream.getvalue(),
            RevisionId=cfg["Configuration"]["RevisionId"],
        )
        lam.get_waiter("function_updated_v2").wait(
            FunctionName=function, WaiterConfig={"Delay": 2, "MaxAttempts": 60}
        )
        write(
            OUT / "data/lambda-code-update.json",
            {
                "functionName": function,
                "previousSha256": cfg["Configuration"]["CodeSha256"],
                "newSha256": updated["CodeSha256"],
                "backup": "artifacts/rekognition-eval-2026-11-22/lambda-before.zip",
            },
        )
        print("Updated dev Lambda handler; original ZIP saved privately.")
    elif a.action == "edges":
        rek = session.client("rekognition", config=CONFIG)
        collection = json.loads((OUT / "data/enrollment.json").read_text())[0]["collection"]
        source = Image.open(PRIVATE / "crops/has_known_face_no_glasses__008__f0.jpg").convert("RGB")
        transforms = {
            "baseline": source,
            "horizontal-flip": ImageOps.mirror(source),
            "rotate-180": source.rotate(180),
            "rotate-90": source.rotate(90, expand=True),
            "dark-25pct": ImageEnhance.Brightness(source).enhance(0.25),
            "bright-2x": ImageEnhance.Brightness(source).enhance(2),
            "blur-radius-5": source.filter(ImageFilter.GaussianBlur(5)),
            "tiny-40px": ImageOps.contain(source, (40, 40)),
        }
        masked = source.copy()
        masked.paste("black", (0, masked.height // 2, masked.width, masked.height))
        transforms["lower-half-covered"] = masked
        results = []
        for name, im in transforms.items():
            stream = io.BytesIO()
            im.save(stream, format="JPEG", quality=94)
            data = stream.getvalue()
            path = PRIVATE / (name + ".jpg")
            path.write_bytes(data)
            detected = rek.detect_faces(Image={"Bytes": data}, Attributes=["DEFAULT"])
            row = {
                "case": name,
                "faceCount": len(detected.get("FaceDetails", [])),
                "requestId": detected["ResponseMetadata"]["RequestId"],
            }
            if row["faceCount"] == 1:
                response = rek.search_faces_by_image(
                    CollectionId=collection,
                    Image={"Bytes": data},
                    FaceMatchThreshold=0,
                    MaxFaces=100,
                    QualityFilter="NONE",
                )
                row["matches"] = response.get("FaceMatches", [])
            results.append(row)
            print(name, "faces=", row["faceCount"], flush=True)
        write(OUT / "data/transformation-edges.json", results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
