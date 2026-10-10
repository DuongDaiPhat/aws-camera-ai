"""Verify the shared M1/M2a/M3 runtime without claiming feature/model accuracy."""

import argparse
import hashlib
import importlib.metadata as metadata
import json
import platform
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", type=Path)
    args = parser.parse_args()
    assert platform.python_version() == "3.11.13", platform.python_version()
    cv_distributions = [
        name
        for name in (
            "opencv-python",
            "opencv-python-headless",
            "opencv-contrib-python",
            "opencv-contrib-python-headless",
        )
        if distribution_exists(name)
    ]
    assert cv_distributions == ["opencv-contrib-python"], cv_distributions
    assert metadata.version("opencv-contrib-python") == "4.10.0.84"
    assert np.__version__ == "1.26.4"
    assert mp.__version__ == "0.10.32"
    assert ort.__version__ == "1.20.1"
    assert "CPUExecutionProvider" in ort.get_available_providers()
    assert hasattr(cv2, "FaceDetectorYN") and hasattr(cv2, "FaceRecognizerSF")
    assert not distribution_exists("ultralytics") and not distribution_exists("torch")
    image = np.zeros((256, 256, 3), dtype=np.uint8)
    assert cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).shape == (256, 256)
    result = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "imports": "PASS",
    }
    if args.models_dir:
        manifest = json.loads((Path(__file__).parents[1] / "model-manifest.json").read_text())
        paths = {}
        for item in manifest["models"]:
            path = args.models_dir / item["filename"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], item["name"]
            paths[item["name"]] = path
        detector = cv2.FaceDetectorYN.create(str(paths["yunet"]), "", (256, 256))
        detector.detect(image)
        recognizer = cv2.FaceRecognizerSF.create(str(paths["sface"]), "")
        embedding = recognizer.feature(np.zeros((112, 112, 3), dtype=np.uint8))
        assert embedding.shape == (1, 128) and np.isfinite(embedding).all()
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(paths["pose"])),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
        )
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
            landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=image))
        # Actual ONNX inference using an existing M1 artifact, not a fake fire model.
        session_options = ort.SessionOptions()
        session_options.log_severity_level = 3
        session = ort.InferenceSession(
            str(paths["sface"]), sess_options=session_options, providers=["CPUExecutionProvider"]
        )
        output = session.run(
            None, {session.get_inputs()[0].name: np.zeros((1, 3, 112, 112), dtype=np.float32)}
        )
        assert output[0].shape == (1, 128) and np.isfinite(output[0]).all()
        result["model_load_and_inference"] = "PASS (blank image; no accuracy claim)"
    print(json.dumps(result))


def distribution_exists(name: str) -> bool:
    try:
        metadata.version(name)
    except metadata.PackageNotFoundError:
        return False
    return True


if __name__ == "__main__":
    main()
