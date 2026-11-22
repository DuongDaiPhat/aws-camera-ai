"""Real HTTP enrollment edge cases; fixture secrets are never written to evidence."""

import io
import json
import uuid
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/REKOGNITION_2026-11-22"


def main():
    fixture = json.loads((ROOT / "artifacts/rekognition-eval-2026-11-22/fixture.json").read_text())
    session = requests.Session()
    base = "http://localhost:3003/api/v1"
    login = session.post(
        base + "/auth/login",
        json={"email": fixture["email"], "password": fixture["password"]},
        timeout=15,
    )
    login.raise_for_status()
    session.headers["Authorization"] = "Bearer " + login.json()["accessToken"]
    stream = io.BytesIO()
    Image.open(ROOT / "local_image/know_face.png").convert("RGB").save(stream, "WEBP")
    valid = (ROOT / "local_image/know_face.png").read_bytes()
    blank = (ROOT / "artifacts/rekognition-eval-2026-11-22/blank.jpg").read_bytes()
    cases = [
        ("blank", [blank], None, None, "NO_FACE_DETECTED"),
        ("fake-png", [b"not really a png"], None, None, "INVALID_IMAGE"),
        ("truncated-jpeg", [b"\xff\xd8\xff\x00"], None, None, "INVALID_IMAGE"),
        ("six-images", [valid] * 6, None, None, "INVALID_IMAGE"),
        (
            "oversized",
            [b"\xff\xd8\xff" + b"x" * 5242881],
            None,
            None,
            "IMAGE_TOO_LARGE",
        ),
        (
            "duplicate-name",
            [valid],
            "Eval selected-five",
            None,
            "KNOWN_FACE_NAME_EXISTS",
        ),
        ("invalid-selection-json", [valid], None, "{}", "FACE_SELECTION_INVALID"),
        ("webp", [stream.getvalue()], None, None, None),
    ]
    results = []
    for case, images, name, selections, expected in cases:
        fields = {"personName": name or ("HTTP " + case + " " + uuid.uuid4().hex[:6])}
        if selections is not None:
            fields["faceSelections"] = selections
        files = [
            (
                "images",
                (
                    "test.webp" if case == "webp" else "test.jpg",
                    image,
                    "image/webp" if case == "webp" else "image/jpeg",
                ),
            )
            for image in images
        ]
        response = session.post(base + "/known-faces", data=fields, files=files, timeout=90)
        body = response.json()
        code = body.get("error", {}).get("code")
        passed = (
            code == expected
            if expected
            else response.status_code == 201 and body.get("provider") == "REKOGNITION"
        )
        results.append(
            {
                "case": case,
                "httpStatus": response.status_code,
                "response": body,
                "expectedCode": expected,
                "passed": passed,
            }
        )
        print(case, response.status_code, code, passed, flush=True)
    (OUT / "data/http-enrollment-edges.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    if not all(r["passed"] for r in results):
        raise RuntimeError("HTTP enrollment edge regression failed; see evidence")


if __name__ == "__main__":
    main()
