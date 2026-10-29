# YOLO26 checkpoint export candidate (Windows x64)

This environment is for the supplied YOLO26n checkpoint, trained with Ultralytics
8.4.184 and classes `0=fire`, `1=smoke`. It is separate from the existing YOLO11
training baseline and the shared FastAPI runtime. The export tool does not approve
a production release. The verified artifact is now registered separately as an
integration candidate; see the [runtime runbook](../../../../docs/sprint-3/US-18_RUNTIME_RUNBOOK.md).
The exporter now preserves the checkpoint's default prediction mode. The earlier
registered artifact explicitly selected the NMS-free head; see the
[error analysis](../../../../docs/sprint-3/US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations).
The checkpoint-preserving artifact is now the registered integration candidate
and has its own [local full-chain pass](../../../../docs/sprint-3/US-18_YOLO26_EXPORT_STATUS.md#checkpoint-model-integration).

## Setup

Run from the repository root using an existing Python 3.11 or newer:

```powershell
& "C:/Users/Admin/AppData/Local/Programs/Python/Python313/python.exe" services/ai-service/training/yolo26/setup_export.py
```

Setup verifies the pinned uv 0.8.22 wheel against its PyPI SHA-256, downloads
portable Python 3.11.13 without changing PATH or the Windows registry, then syncs
the complete hash-locked graph into `artifacts/m3/export-env`. Python, bootstrap
tools, caches and a separate lock environment stay under Git-ignored `artifacts/m3`.

| Component             | Version                |
| --------------------- | ---------------------- |
| Python                | 3.11.13                |
| Ultralytics           | 8.4.184                |
| Torch / torchvision   | 2.5.1+cpu / 0.20.1+cpu |
| NumPy / OpenCV Python | 1.26.4 / 4.10.0.84     |
| ONNX / ONNX Runtime   | 1.17.0 / 1.20.1        |

Torch uses explicit official CPU wheel URLs. Only `opencv-python` is installed in
this environment. Shared API dependencies are unchanged. Transitive versions and
hashes are in `requirements-export-windows.lock`; installation requires hashes.
The export environment contains no lock-generation tools.

Pass `--resolve-lock` to deliberately regenerate this candidate lock using the
repository's existing pip-tools 7.4.1 hash-locked toolchain in `artifacts/m3/lock-env`.
Review the resulting lock. uv handles Python/bootstrap and installation;
pip-tools remains the lock generator.

## Export and verify

Supply local images explicitly and use a new output directory for each attempt:

```powershell
& artifacts/m3/export-env/Scripts/python.exe services/ai-service/training/yolo26/export_checkpoint.py `
  --checkpoint artifacts/m3/trained/best.pt `
  --output-dir artifacts/m3/exported/my-run `
  --image datasets/m3/raw/D-Fire/val/images/AoF06723.jpg
```

The tool exports a copy of the checkpoint to static FP32 ONNX, batch 1, 640 pixels,
opset 17 and `simplify=False`. Default `--head-mode checkpoint` preserves the
loaded prediction mode. This checkpoint loads with `end2end=False`, so its
one-to-many graph embeds NMS with `--output-floor 0.10` and `--nms-iou 0.70`.
Use `--head-mode nms-free` to explicitly select the earlier one-to-one branch.
The tool checks ONNX validity, CPU execution and exported mode metadata.
Package auto-install and online checks are disabled. The original checkpoint's
hash is verified afterward.
After parity passes, the exporter also writes a `.contract.json` sidecar binding
the graph checksum, prediction mode and confidence floor. Deploy it with the
ONNX; embedded-NMS runtime loading requires the sidecar and validates that
configured filtering does not hide qualifying scores below the graph floor.

Both supported export modes must have input `[1,3,640,640]` and output
`[1,300,6]`. Rows contain `x1,y1,x2,y2,confidence,classId` in padded input pixels.
The tool verifies actual shapes and class metadata; the original YOLO11 decoder
assumption does not apply.

On each image, PyTorch and ONNX use the same fixed letterbox/RGB/NCHW preparation
and coordinate restoration. Matched classes/counts, score difference <=0.001 and
box IoU >=0.99 are required. Both paths use the recorded prediction mode. Mismatches fail
and are recorded in `export-report.json`. A small CPU benchmark records p50/p95
for `session.run` alone after warmup.

The report includes hashes, versions, IO, detections, parity and limitations.
Local image parity and single-input timing do not establish independent model
quality, per-class accuracy, event precision/recall, FAR, camera capacity or video
E2E acceptance. Training metrics do not automatically transfer to the selected
export head. Calibration, holdout videos and E2E remain required.

## Primary references

- [Ultralytics 8.4.184](https://pypi.org/project/ultralytics/8.4.184/)
- [Pinned ONNX exporter](https://github.com/ultralytics/ultralytics/blob/v8.4.184/ultralytics/engine/exporter.py)
- [YOLO26 output layouts](https://docs.ultralytics.com/models/yolo26/)
- [uv Python install options](https://docs.astral.sh/uv/reference/cli/#uv-python-install)
