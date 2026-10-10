"""CPU training/export toolchain smoke; this untrained graph is never a fire artifact."""

import importlib.metadata as metadata
import tempfile
from contextlib import chdir
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
import yaml
from ultralytics import YOLO
from ultralytics.nn.tasks import yaml_model_load


def main() -> None:
    assert torch.__version__ == "2.5.1+cpu"
    assert metadata.version("torchvision") == "0.20.1+cpu"
    assert metadata.version("ultralytics") == "8.3.59"
    assert metadata.version("opencv-python") == "4.10.0.84"
    assert np.__version__ == "1.26.4"
    assert onnx.__version__ == "1.17.0" and ort.__version__ == "1.20.1"
    torch.set_num_threads(2)
    with tempfile.TemporaryDirectory(prefix="camerai-training-smoke-") as directory, chdir(directory):
        config = yaml_model_load("yolo11n.yaml")
        config["nc"] = 2
        path = Path(directory) / "yolo11n-gate.yaml"
        path.write_text(yaml.safe_dump(config))
        model = YOLO(str(path))
        model.model.eval()
        batch = torch.zeros((1, 3, 640, 640))
        with torch.no_grad():
            expected = model.model(batch)[0].numpy()
        exported = model.export(
            format="onnx",
            imgsz=640,
            batch=1,
            opset=17,
            dynamic=False,
            simplify=False,
            device="cpu",
        )
        onnx.checker.check_model(onnx.load(exported))
        session = ort.InferenceSession(exported, providers=["CPUExecutionProvider"])
        actual = session.run(None, {session.get_inputs()[0].name: batch.numpy()})[0]
        assert actual.shape == expected.shape == (1, 6, 8400)
        np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-3)
    print("PASS: isolated CPU YOLO11n two-class ONNX opset17 export/parity; untrained smoke only")


if __name__ == "__main__":
    main()
