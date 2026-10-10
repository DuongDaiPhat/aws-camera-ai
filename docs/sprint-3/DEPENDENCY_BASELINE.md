# Dependency baseline — Sprint 3 M2a/M3/M5

> Một người tích hợp dependency chung, một graph/version cho mỗi môi trường. Mỗi story được triển khai E2E bởi một người với một AI Agent. Trạng thái và bằng chứng hiện hành ở mục cập nhật gate; các mục cũ giữ snapshot thiết kế. Chất lượng model FIRE và nghiệm thu feature vẫn thuộc implementation từng story.

## Cập nhật gate ngày 10/10/2026

Baseline runtime đã **MERGED_FROZEN** qua [PR #25](https://github.com/DuongDaiPhat/aws-camera-ai/pull/25), commit `04080bf3c305e14fd00f5388f437d00b28d0e2b6`, sau khi 9 jobs của [CI run #89](https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/38017191512) đạt. Lock có hashes, setup, Docker và CI đã ở main. Các mục 3/5/6 bên dưới là snapshot khi chuẩn bị plan; tham chiếu mục này và [SHARED_GATE_HANDOFF.md](SHARED_GATE_HANDOFF.md) khi bắt đầu implementation.

| Phần                    | Nguồn chốt hiện hành                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract/DDL            | PR #24, merge SHA `97765fc710aefd0d76c0572f7e74c86fa10efdca`                                                                                                                   |
| Python                  | CPython **3.11.13**, `services/ai-service/.python-version`; không dùng 3.14 hoặc tự nâng patch                                                                                 |
| Linux runtime/dev       | `services/ai-service/requirements-runtime.lock`, `requirements-dev.lock`                                                                                                       |
| Windows x64 runtime/dev | `services/ai-service/requirements-runtime-windows.lock`, `requirements-dev-windows.lock`                                                                                       |
| Công cụ tạo lock        | `requirements-lock-tools.in` và `requirements-lock-tools.lock`; pip 24.3.1, pip-tools 7.4.1, setuptools 75.6.0, wheel 0.45.1                                                   |
| Shared AI               | NumPy 1.26.4, OpenCV contrib 4.10.0.84, MediaPipe 0.10.32, ONNX Runtime 1.20.1                                                                                                 |
| Web AI đã resolve       | FastAPI 0.143.0, Pydantic 2.14.0, pydantic-settings 2.15.0, Uvicorn 0.54.0, Pillow 12.3.0; graph bắc cầu lấy từ lock                                                           |
| Training US-18          | `training/requirements.in` và `training/requirements-cpu-linux.lock`; Linux x86_64, Python 3.11.13, PyTorch 2.5.1+cpu, torchvision 0.20.1+cpu, Ultralytics 8.3.59, ONNX 1.17.0 |
| Model artifacts M1/M2a  | `model-manifest.json`: immutable source/version, size và SHA-256 đo từ file tải thực; không commit weights                                                                     |
| JS/M5                   | Giữ nguyên pnpm 9.12.0 và `pnpm-lock.yaml`; US20 không thêm thư viện                                                                                                           |

Runtime không cài Ultralytics/PyTorch/dlib hoặc nhiều distribution `cv2`. Training dùng `opencv-python` trong môi trường riêng; không cài training lock vào API. CPU wheels được chỉ định bằng URL đúng CPython/Linux, tránh tải graph CUDA hoặc wheel cho platform khác.

Python base image đã pin: `python:3.11.13-slim-bookworm@sha256:86adf8dbadc3d6e82ee5dd2c74bec2e1c2467cdad47886280501df722372d2e1`. Linux runtime build và Windows clean install đã qua `pip check`, import, model load/inference trên ảnh trống và 31 tests M1 (coverage 94,34%). Smoke không chứng minh chất lượng phát hiện té ngã/cháy. Model FIRE vẫn `PENDING_TRAINING`; dataset/holdout/training/ONNX parity của model đã train thuộc US18.

CI chạy Python trên Windows/Linux, kiểm tra hashes, model checksums và chỉ một OpenCV flavor. Quy trình sinh lại: tạo venv công cụ riêng đúng Python, cài `requirements-lock-tools.lock` với `--require-hashes`, chạy `python scripts/lock_dependencies.py` trên từng OS; training dùng `--training` trên Linux. Không hand-edit lock hoặc regenerate bằng interpreter khác.

## 1. Nguồn sự thật và baseline đã có

`package.json` chốt pnpm **9.12.0**, `.nvmrc` chốt Node **22**; `pnpm-lock.yaml` chốt toàn bộ JS dependency graph và integrity. Build dùng `pnpm install --frozen-lockfile`; không chạy add/install package riêng theo ý từng contributor. Phiên bản dưới đây đọc từ lockfile hiện tại, không lấy “latest”:

| Thành phần           | Exact version đã resolve | Mục đích                                                  |
| -------------------- | ------------------------ | --------------------------------------------------------- |
| NestJS common/core   | 10.4.22                  | Orchestrator, controller/service và lifecycle scheduler   |
| pg                   | 8.23.0                   | PostgreSQL transaction/lease/row locking                  |
| BullMQ               | 6.3.9                    | Queue hiện hữu; M5 không tạo dependency queue mới         |
| mqtt                 | 5.16.0                   | Nguồn Frigate/publisher metadata hiện hữu                 |
| Next.js              | 15.5.24                  | Dashboard hiện hữu                                        |
| React                | 18.3.1                   | UI hiện hữu                                               |
| TypeScript workspace | 5.9.3                    | Contracts/FE/BE; nested versions trong lock không tự thay |
| openapi-typescript   | 7.13.0                   | Regenerate cả hai hợp đồng                                |
| Redocly CLI          | 1.34.20                  | Lint spec                                                 |
| Jest                 | 29.7.0                   | Backend/unit/integration                                  |
| Vitest               | 2.1.9                    | Frontend                                                  |

Node patch, container image digest và lockfile SHA-256 được ghi từ môi trường thực trong PR triển khai; không đoán patch/digest. Docker baseline hiện có PostgreSQL `16-alpine`, Redis `7-alpine`, Frigate **0.18.0**, AI Python **3.11-slim**. Dùng digest sau clean startup/regression để tránh rebuild lấy artifact mới cùng tag.

## 2. M5 — quyết định đã chốt

M5 **không thêm thư viện**. Dùng Nest lifecycle + timer để đánh thức, PostgreSQL làm durable scheduler bằng occurrence unique/lease; SQL `AT TIME ZONE` tính lịch IANA và built-in `Intl.DateTimeFormat` hiển thị. Không cài `@nestjs/schedule`, cron/node-cron, moment/luxon/date-fns-tz, Redis client khác hoặc Python AI package cho M5.

Tách timer khỏi correctness: restart không mất run, nhiều replica dựa DB locks, không dựa setTimeout 5 phút trên RAM. Quyết định này tránh việc hai người cài hai bộ scheduler/timezone khác nhau.

## 3. M2a/M3 — inputs của gate Python

Các exact inputs dưới đây theo [plan M2a](PLAN_US-16_US-17_POSE_FALL_E2E.md) và [plan M3](PLAN_US-18_YOLO_FIRE_SMOKE_E2E.md), cần resolve/lock/test trước viết runtime:

| Môi trường                    | Lựa chọn chốt                                                                                                                                    | Giới hạn                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Shared AI runtime Python 3.11 | `mediapipe==0.10.32`, `numpy==1.26.4`, `opencv-contrib-python==4.10.0.84`, `onnxruntime==1.20.1`                                                 | Một flavor cv2; bỏ OpenCV headless/base/extra conflict trong PR dependency được review; hồi quy M1 YuNet/SFace  |
| M3 training Python 3.11 riêng | `ultralytics==8.3.59`, `torch==2.5.1`, `torchvision==0.20.1`, `numpy==1.26.4`, `opencv-python==4.10.0.84`, `onnx==1.17.0`, `onnxruntime==1.20.1` | Chọn một bộ CPU/CUDA wheels và index cụ thể; không cài vào AI runtime, không để training kéo flavor cv2 thứ hai |
| Lock tool riêng               | `pip-tools==7.4.1`                                                                                                                               | Chỉ môi trường tạo lock, không runtime                                                                          |
| M3 runtime model              | YOLO11n fine-tune class 0=smoke, 1=fire, ONNX FP32 static 640/batch1/opset17/nms=false/simplify=false                                            | Training/holdout/export parity phải đạt trước feature; runtime chỉ ONNX đã kiểm chứng                           |
| M2a model                     | Pose landmarker lite artifact version 1 theo plan                                                                                                | Bất biến URI/version/SHA-256, không `/latest/` hoặc startup download                                            |

FastAPI/Pydantic/settings/Uvicorn/Pillow và dependency bắc cầu đang khai báo ranges trong repo; **chưa có full Python lock**. Một owner resolve trên Linux/Windows mục tiêu, chốt exact versions có hashes vào `requirements-runtime.lock` và `requirements-dev.lock`; training có lock riêng CPU/CUDA và constraint riêng. Những người khác dùng đúng bộ lock/artifact đã merge, không tự `pip install` rồi freeze máy mình.

Nếu resolve/import/M1 regression thất bại, chưa qua gate: điều chỉnh baseline qua PR chung với bằng chứng, không âm thầm lấy MediaPipe/Ultralytics/OpenCV khác. Không uninstall/update Python global của người dùng. Không khẳng định runtime đã pin chỉ vì bảng này có inputs; implementation gate chỉ đạt khi graph đầy đủ sạch và được review.

## 4. Quy trình thay đổi baseline

1. Đăng ký contributor, story, môi trường và package/version đề xuất trước sửa manifests/locks; một integrator giữ shared runtime/JS lock.
2. Dựng môi trường sạch, resolve đúng target OS/Python/CPU-CUDA; chạy pip check/import/model smoke/M1 regression hoặc JS install/typecheck/health.
3. Ghi versions/markers/hashes, toolchain, OS/hardware/image digest và model/dataset checksum thực. Không bịa checksum khi chưa tải/train.
4. Merge dependency PR trước feature. CI/build cài frozen lock, model checksum được verify trước inference; không auto-install/auto-download model ở request.
5. Conflict lock: regenerate từ manifest/baseline cuối; không merge lock bằng tay hoặc chọn toàn bộ ours/theirs. Thay version sau gate cần PR baseline riêng và regression liên quan.

## 5. Các trạng thái chưa được chứng nhận

- JS versions ở mục 1 là graph đã khóa trong repo; clean install đa môi trường/image digest thuộc gate release.
- Shared Python/training exact inputs đã thống nhất theo hai plan; graph đầy đủ/compatibility/model hashes và chất lượng train vẫn cần chứng minh trong implementation.
- M5 không có dependency download mới. DDL/spec/plan có thể review mà không cài model hoặc train YOLO.

## 6. Fingerprint local khi chuẩn bị contract

- Node thực chạy: `v22.20.0`, win32/x64; package manager declared `pnpm@9.12.0`.
- `pnpm-lock.yaml SHA-256: 99cf285b961721d2e83ac3cc6029008e7518b12386d310ec54e01a3832554d6a`. Không thay lockfile/package manifests trong phiên này.
- Không cài/download dependency hoặc model mới cho M5. Python training/runtime locks và image/model checksums vẫn cần gate của M2a/M3.
