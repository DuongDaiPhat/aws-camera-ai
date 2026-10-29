"""Export the supplied YOLO26 checkpoint and check CPU parity on local images.

This is export validation, not independent model-quality or video E2E acceptance.
"""

import argparse
import ast
import hashlib
import importlib.metadata as metadata
import json
import logging
import os
import platform
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)
IMAGE_SIZE = 640
SCORE_TOLERANCE = 1e-3
MIN_BOX_IOU = 0.99
EXPECTED_VERSIONS = {
    "ultralytics": "8.4.184",
    "torch": "2.5.1+cpu",
    "torchvision": "0.20.1+cpu",
    "numpy": "1.26.4",
    "opencv-python": "4.10.0.84",
    "onnx": "1.17.0",
    "onnxruntime": "1.20.1",
}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--image", action="append", type=Path, required=True)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--benchmark-runs", type=int, default=20)
    parser.add_argument("--head-mode", choices=("checkpoint", "nms-free"), default="checkpoint")
    parser.add_argument("--output-floor", type=float, default=0.10)
    parser.add_argument("--nms-iou", type=float, default=0.70)
    return parser.parse_args()


def check_environment() -> dict[str, str]:
    if platform.python_version() != "3.11.13":
        raise RuntimeError("This export baseline requires Python 3.11.13")
    versions = {name: metadata.version(name) for name in EXPECTED_VERSIONS}
    if versions != EXPECTED_VERSIONS:
        raise RuntimeError(f"Unexpected export dependencies: {versions}")
    cv_distributions = [name for name in metadata.packages_distributions().get("cv2", [])]
    if cv_distributions != ["opencv-python"]:
        raise RuntimeError(f"Expected only opencv-python, got {cv_distributions}")
    return versions


def compare_detections(expected: Any, actual: Any) -> dict[str, Any]:
    import numpy as np

    unmatched = set(range(len(actual)))
    matches = []
    for box in expected:
        candidates = []
        for index in unmatched:
            other = actual[index]
            if int(box[5]) != int(other[5]):
                continue
            upper_left = np.maximum(box[:2], other[:2])
            lower_right = np.minimum(box[2:4], other[2:4])
            intersection = float(np.maximum(lower_right - upper_left, 0).prod())
            union = float(np.maximum(box[2:4] - box[:2], 0).prod())
            union += float(np.maximum(other[2:4] - other[:2], 0).prod()) - intersection
            candidates.append((intersection / union if union > 0 else 0.0, index))
        if not candidates:
            continue
        overlap, index = max(candidates)
        unmatched.remove(index)
        matches.append(
            {
                "iou": overlap,
                "scoreDifference": abs(float(box[4]) - float(actual[index, 4])),
            }
        )
    passed = len(expected) == len(actual) == len(matches) and all(
        item["iou"] >= MIN_BOX_IOU and item["scoreDifference"] <= SCORE_TOLERANCE
        for item in matches
    )
    return {
        "passed": passed,
        "pytorchCount": len(expected),
        "onnxCount": len(actual),
        "minimumIou": min((item["iou"] for item in matches), default=None),
        "maximumScoreDifference": max((item["scoreDifference"] for item in matches), default=None),
    }


def export_onnx(args: argparse.Namespace, report: dict[str, Any]) -> Any:
    import onnx
    import onnxruntime as ort
    import torch
    from ultralytics import YOLO

    torch.set_num_threads(args.threads)
    checkpoint_copy = args.output_dir / "fire-smoke-yolo26n.pt"
    if checkpoint_copy.exists():
        raise FileExistsError(f"Use a new output directory: {checkpoint_copy}")
    shutil.copy2(args.checkpoint, checkpoint_copy)
    model = YOLO(str(checkpoint_copy), task="detect")
    if model.names != {0: "fire", 1: "smoke"}:
        raise RuntimeError(f"Unexpected checkpoint class map: {model.names}")
    if model.model.yaml.get("yaml_file") != "yolo26n.yaml":
        raise RuntimeError("Expected the inspected YOLO26n architecture")
    report["classMap"] = model.names
    report["architecture"] = model.model.yaml.get("yaml_file")
    checkpoint_end_to_end = bool(model.model.end2end)
    export_end_to_end = checkpoint_end_to_end or args.head_mode == "nms-free"
    report["predictionHead"] = {
        "selection": args.head_mode,
        "checkpointEndToEnd": checkpoint_end_to_end,
        "exportEndToEnd": export_end_to_end,
        "preservesCheckpointMode": checkpoint_end_to_end == export_end_to_end,
        "embeddedNms": not export_end_to_end,
        "outputConfidenceFloor": args.output_floor,
        "nmsIou": args.nms_iou if not export_end_to_end else None,
    }
    exported = Path(
        model.export(
            format="onnx",
            imgsz=IMAGE_SIZE,
            batch=1,
            opset=17,
            dynamic=False,
            simplify=False,
            nms=not export_end_to_end,
            conf=args.output_floor,
            iou=args.nms_iou,
            max_det=300,
            half=False,
            device="cpu",
        )
    )
    graph = onnx.load(exported)
    onnx.checker.check_model(graph, full_check=True)
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(exported), sess_options=options, providers=["CPUExecutionProvider"]
    )
    input_node, output_node = session.get_inputs()[0], session.get_outputs()[0]
    if input_node.shape != [1, 3, IMAGE_SIZE, IMAGE_SIZE] or output_node.shape != [1, 300, 6]:
        raise RuntimeError(f"Unexpected ONNX IO: {input_node.shape}, {output_node.shape}")
    exported_end_to_end = session.get_modelmeta().custom_metadata_map.get("end2end")
    if exported_end_to_end != str(export_end_to_end):
        raise RuntimeError("Exported prediction head disagrees with the requested mode")
    if ast.literal_eval(session.get_modelmeta().custom_metadata_map["names"]) != model.names:
        raise RuntimeError("ONNX class metadata does not match the checkpoint")
    report["onnx"] = {
        "path": str(exported),
        "sha256": sha256(exported),
        "sizeBytes": exported.stat().st_size,
        "input": {"name": input_node.name, "shape": input_node.shape, "type": input_node.type},
        "output": {"name": output_node.name, "shape": output_node.shape, "type": output_node.type},
        "opsets": [{"domain": item.domain, "version": item.version} for item in graph.opset_import],
        "providers": session.get_providers(),
        "mode": "nms-free-one-to-one" if export_end_to_end else "one-to-many-embedded-nms",
        "rowLayout": ["x1", "y1", "x2", "y2", "confidence", "classId"],
    }
    return session


def check_samples(args: argparse.Namespace, session: Any, report: dict[str, Any]) -> Any:
    import cv2
    import numpy as np
    import torch
    from ultralytics import YOLO
    from ultralytics.data.augment import LetterBox
    from ultralytics.utils import ops

    input_node = session.get_inputs()[0]
    reference = YOLO(str(args.checkpoint), task="detect")
    parity = []
    last_tensor = None
    for path in args.image:
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f"Cannot decode sample: {path}")
        padded = LetterBox((IMAGE_SIZE, IMAGE_SIZE), auto=False)(image=image)
        tensor = (
            np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32)
            / 255.0
        )
        raw = session.run(None, {input_node.name: tensor})[0][0]
        if not np.isfinite(raw).all():
            raise ValueError("ONNX output contains nonfinite values")
        actual = raw[raw[:, 4] > args.confidence].copy()
        actual[:, :4] = ops.scale_boxes(
            tensor.shape[2:], torch.from_numpy(actual[:, :4]), image.shape
        ).numpy()
        predicted = reference.predict(
            image,
            imgsz=IMAGE_SIZE,
            rect=False,
            conf=args.confidence,
            nms=not report["predictionHead"]["exportEndToEnd"],
            iou=args.nms_iou,
            max_det=300,
            device="cpu",
            verbose=False,
        )[0]
        expected = predicted.boxes.data.cpu().numpy()
        result = compare_detections(expected, actual)
        parity.append(
            {
                "image": str(path),
                "sha256": sha256(path),
                "shape": list(image.shape),
                **result,
                "pytorchDetections": expected.tolist(),
                "onnxDetections": actual.tolist(),
            }
        )
        LOGGER.info("Parity %s: %s", path.name, result)
        last_tensor = tensor
    report["parity"] = parity
    if last_tensor is None:
        raise ValueError("At least one sample is required")
    return last_tensor


def benchmark(args: argparse.Namespace, session: Any, tensor: Any) -> dict[str, Any]:
    import numpy as np

    input_node = session.get_inputs()[0]
    for _ in range(5):
        session.run(None, {input_node.name: tensor})
    timings = []
    for _ in range(args.benchmark_runs):
        started = time.perf_counter()
        session.run(None, {input_node.name: tensor})
        timings.append((time.perf_counter() - started) * 1000)
    return {
        "runs": len(timings),
        "warmupRuns": 5,
        "threads": args.threads,
        "p50Ms": float(np.percentile(timings, 50)),
        "p95Ms": float(np.percentile(timings, 95)),
        "scope": "ONNX session.run only; one local sample; excludes preprocessing, queue, other modules and camera load",
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    args = arguments()
    args.checkpoint = args.checkpoint.resolve(strict=True)
    args.image = [path.resolve(strict=True) for path in args.image]
    args.output_dir = args.output_dir.resolve()
    if not 0 < args.confidence < 1 or args.threads < 1 or args.benchmark_runs < 1:
        raise ValueError("Invalid confidence, threads or benchmark run count")
    if not 0 <= args.output_floor <= args.confidence or not 0 < args.nms_iou <= 1:
        raise ValueError("Output floor must cover parity confidence; NMS IoU must be in (0,1]")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise FileExistsError("Use a new, empty output directory to preserve previous reports")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_AUTOINSTALL"] = "false"
    os.environ["YOLO_OFFLINE"] = "true"
    os.environ["YOLO_CONFIG_DIR"] = str(args.output_dir / "ultralytics-config")
    report: dict[str, Any] = {
        "status": "FAILED",
        "checkedAt": datetime.now(UTC).isoformat(),
        "exportLockSha256": sha256(Path(__file__).with_name("requirements-export-windows.lock")),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "processor": platform.processor(),
        "checkpointSha256": sha256(args.checkpoint),
        "confidence": args.confidence,
        "scoreTolerance": SCORE_TOLERANCE,
        "minimumBoxIou": MIN_BOX_IOU,
        "limitations": [
            "Local images are technical samples, not certified independent calibration/holdout video.",
            "This is not model quality, per-class accuracy, FAR, event temporal confirmation or E2E acceptance.",
            "The selected head requires video evaluation; stored training metrics do not certify this export.",
        ],
    }
    try:
        report["versions"] = check_environment()
        session = export_onnx(args, report)
        tensor = check_samples(args, session, report)
        report["cpuSmokeBenchmark"] = benchmark(args, session, tensor)
        if not all(item["passed"] for item in report["parity"]):
            raise RuntimeError("Detection parity failed; inspect the per-image report")
        contract = {
            "modelSha256": report["onnx"]["sha256"],
            "predictionMode": report["onnx"]["mode"],
            "outputConfidenceFloor": (
                args.output_floor if report["predictionHead"]["embeddedNms"] else 0
            ),
        }
        Path(report["onnx"]["path"]).with_suffix(".contract.json").write_text(
            json.dumps(contract, indent=2) + "\n", encoding="utf-8"
        )
        report["status"] = "EXPORT_AND_LOCAL_IMAGE_PARITY_PASSED"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        report["checkpointUnchanged"] = sha256(args.checkpoint) == report["checkpointSha256"]
        (args.output_dir / "export-report.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        LOGGER.info("Report: %s", args.output_dir / "export-report.json")


if __name__ == "__main__":
    main()
