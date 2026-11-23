"""Isolated loopback HTTP target for Newman/k6; uses real YuNet/R50 models."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ.update(
    AI_INTERNAL_TOKEN="face-branch-loopback-test-only",
    FACE_PROVIDER="local",
    FACE_DETECTOR_PATH=str(ROOT / "services/ai-service/models/face_detection_yunet_2023mar.onnx"),
    FACE_EMBEDDER_PATH=str(ROOT / "services/ai-service/models/face_recognition_sface_2021dec.onnx"),
    FACE_GATE_EMBEDDER_PATH=str(ROOT / "services/ai-service/models/w600k_r50.onnx"),
    FACE_GATE_EMBEDDER_BACKEND="arcface_onnx",
    FACE_GATE_MODEL_VERSION="yunet-2023mar-w600k-r50",
    FACE_GATE_EMBEDDER_SHA256="4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
    M3_ENABLED="false",
    M2A_ENABLED="false",
)

if __name__ == "__main__":
    import sys

    import uvicorn

    sys.path.insert(0, str(ROOT / "services/ai-service"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=18082, access_log=False)
