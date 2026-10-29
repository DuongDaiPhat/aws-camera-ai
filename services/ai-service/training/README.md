# US18 training baseline

Linux x86_64 CPU, CPython 3.11.13. `requirements-cpu-linux.lock` is the complete hash-locked graph generated from `requirements.in`. PyTorch 2.5.1+cpu and torchvision 0.20.1+cpu are direct official CPU wheels for this target. CUDA/other platforms require separate reviewed locks.

Do not install this environment into the shared FastAPI runtime. The training environment uses `opencv-python`; serving uses `opencv-contrib-python` and ONNX Runtime, without Ultralytics/PyTorch.

From repository root:

```powershell
docker build -t camerai-training-cpu services/ai-service/training
docker run --rm camerai-training-cpu
```

The smoke builds an untrained, two-class YOLO11n graph, exports static batch1/640 FP32 ONNX opset17 without simplify/NMS, and compares its CPU output with PyTorch. It checks toolchain/export compatibility only. It does not train a fire detector, download pretrained weights, use a dataset, certify accuracy, or produce a deployable model. Temporary export files are removed by the smoke.

The user has supplied a trained YOLO26n checkpoint and offline fire/smoke evaluation.
Its verified ONNX is registered as `INTEGRATION_CANDIDATE` in `../model-manifest.json`,
and local raw-video integration has passed. The YOLO11 smoke above remains only a
toolchain check. Remaining release work covers public source/holdout attribution,
calibration and broader deployment acceptance; no repeat training is requested.
Keep M3 disabled until those gates pass. See the
[runtime runbook](../../../docs/sprint-3/US-18_RUNTIME_RUNBOOK.md) and
[dependency baseline](../../../docs/sprint-3/DEPENDENCY_BASELINE.md).

The supplied checkpoint records YOLO26n / Ultralytics 8.4.184 rather than this
YOLO11 baseline. Its isolated Windows export tooling and lock are documented in
[yolo26/README.md](yolo26/README.md). This candidate does not replace the shared
runtime or certify the model quality gate.
