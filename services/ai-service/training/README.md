# US18 training baseline

Linux x86_64 CPU, CPython 3.11.13. `requirements-cpu-linux.lock` is the complete hash-locked graph generated from `requirements.in`. PyTorch 2.5.1+cpu and torchvision 0.20.1+cpu are direct official CPU wheels for this target. CUDA/other platforms require separate reviewed locks.

Do not install this environment into the shared FastAPI runtime. The training environment uses `opencv-python`; serving uses `opencv-contrib-python` and ONNX Runtime, without Ultralytics/PyTorch.

From repository root:

```powershell
docker build -t camerai-training-cpu services/ai-service/training
docker run --rm camerai-training-cpu
```

The smoke builds an untrained, two-class YOLO11n graph, exports static batch1/640 FP32 ONNX opset17 without simplify/NMS, and compares its CPU output with PyTorch. It checks toolchain/export compatibility only. It does not train a fire detector, download pretrained weights, use a dataset, certify accuracy, or produce a deployable model. Temporary export files are removed by the smoke.

The US18 owner must still collect the approved public dataset, split by video/source, train, evaluate holdout/calibration, verify export parity with trained weights, and add the verified artifact/checksum to `../model-manifest.json`. Keep M3 disabled until its feature gates pass. The shared lock-generation instructions are in [dependency baseline](../../../docs/sprint-3/DEPENDENCY_BASELINE.md).
