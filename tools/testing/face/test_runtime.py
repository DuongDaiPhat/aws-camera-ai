"""Explicit opt-in real-model integration tests; no mocked detector or embedder."""

import base64
import importlib
import io
import sys
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
serve = importlib.import_module("serve")

sys.path.insert(0, str(serve.ROOT / "services/ai-service"))
app = importlib.import_module("app.main").app

HEADERS = {"X-Internal-Token": "face-branch-loopback-test-only"}
CROP = (
    serve.ROOT
    / "docs/test/FACE_TEST6_2026-11-23/evidence/crops"
    / "TC02-no-glasses-final-1795410461.084077-hx9jgm-r1.png"
)


def test_assessor_and_sface_http_contracts() -> None:
    with TestClient(app) as client:
        image = CROP.read_bytes()
        assessed = client.post(
            "/face/assess", headers=HEADERS, files={"image": ("face.png", image)}
        )
        assert assessed.status_code == 200
        result = assessed.json()
        assert result["passed"] and result["gateStatus"] == "READY"
        assert result["embeddingDim"] == 512
        vector = np.frombuffer(base64.b64decode(result["embeddingBase64"]), dtype="<f4")
        assert np.isfinite(vector).all() and np.isclose(np.linalg.norm(vector), 1)
        embedded = client.post("/face/embed", headers=HEADERS, files={"image": ("face.png", image)})
        assert embedded.status_code == 200
        assert embedded.json()["embeddingDim"] == 128
        assert embedded.json()["error"] is None


def test_blank_image_rejected_by_real_yunet() -> None:
    output = io.BytesIO()
    Image.new("RGB", (320, 320), "white").save(output, format="PNG")
    with TestClient(app) as client:
        response = client.post(
            "/face/assess",
            headers=HEADERS,
            files={"image": ("blank.png", output.getvalue())},
        )
        assert response.status_code == 200
        assert response.json()["passed"] is False
        assert response.json()["rejectionReason"] == "NO_FACE_DETECTED"
        assert response.json()["embeddingBase64"] is None
