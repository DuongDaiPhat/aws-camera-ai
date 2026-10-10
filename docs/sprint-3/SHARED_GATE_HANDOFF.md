# Shared gate — US16/17, US18, US20

Ngày kiểm chứng: **10/10/2026**. Phạm vi: contract, dependency, model compatibility và DDL nền tảng; chưa implement bốn user stories hoặc triển khai AWS.

Contract đã merge qua PR #24. Dependency hiện được kiểm chứng local trên nhánh `codex/sprint-3-dependency-gate`; chưa push/mở PR/merge vì thao tác tạo PR bị automatic approval review từ chối publication ra GitHub. Cần xác nhận repository đích trước bước publication; không đánh dấu dependency `MERGED_FROZEN` khi còn ở local. Hash nguồn/locks được ghi tại [SHARED_GATE_FINGERPRINT.json](SHARED_GATE_FINGERPRINT.json).

## Baseline contract

[PR #24](https://github.com/DuongDaiPhat/aws-camera-ai/pull/24) đã merge với SHA `97765fc710aefd0d76c0572f7e74c86fa10efdca`. Giữ namespace `/pose/fall` + `Fall*`, `/fire/detect` + `Fire*`, `/wellness-schedules*` + `/wellness-checks*` + observations. Migrations reserve 0013 FALL, 0014 FIRE, 0015 wellness đã ở main; không thêm bản sao hoặc sửa migration đã merge/apply.

Lệnh `pnpm contracts:generate` nay đọc cả hai API trong Redocly config rồi format output. Generated diff sau generate là bất đồng bộ contract và phải sửa nguồn; không chỉnh tay generated types. Typecheck toàn workspace đã qua sau build contracts; trạng thái lỗi compiler ở snapshot cũ không đại diện gate hiện tại.

## Baseline dependency

- JS giữ lock hiện có và pnpm 9.12.0; `pnpm install --frozen-lockfile`.
- Python 3.11.13; runtime gồm extra M2a/M3 đã resolve. M1 dùng YuNet/SFace, không còn extra kéo dlib/face-recognition.
- Linux và Windows có runtime/dev locks riêng. Dev graph dùng constraint runtime cùng OS. Linux có uvloop, Windows có các package platform tương ứng; không sao chép freeze Windows sang Linux.
- Python lock tools có graph riêng có hash. Runtime không cài tool tạo lock; dev chỉ có build toolchain cần cho editable install.
- US18 training CPU Linux tách biệt: torch/torchvision CPU URL đúng CPython 3.11, Ultralytics 8.3.59, OpenCV Python 4.10.0.84, ONNX 1.17.0. Chuyển CUDA cần baseline/lock/test riêng; không sửa runtime để training chạy.
- Manifest model ghi checksum thật cho Pose Lite artifact v1, YuNet và SFace từ revision nguồn bất biến. M3 model đã train chưa có; không dùng artifact smoke làm detector FIRE.

## Setup cho người triển khai

Chuẩn bị executable Python 3.11.13. Nếu `.venv` cũ dùng 3.14, setup báo lỗi và giữ nguyên nó; chọn venv mới trong artifacts hoặc tự quản lý backup môi trường cũ.

```powershell
# Đặt CAMERAI_PYTHON thành đường dẫn thực tới Python 3.11.13 của máy bạn.
$env:CAMERAI_VENV = 'artifacts/ai-dev-311'
pnpm setup:ai
pnpm check:ai
```

`CAMERAI_PYTHON` là tùy chọn khi executable đúng version đã có trên PATH. `CAMERAI_VENV` cần được giữ trong session khi chạy các lệnh AI. Setup cài dev lock đúng OS với hashes, sau đó editable project bằng `--no-deps --no-build-isolation`. Không nâng pip hoặc package tự động.

Chuẩn bị model là thao tác rõ ràng trước inference, không download tại startup/request:

```powershell
python services/ai-service/scripts/fetch_models.py --output-dir artifacts/models
```

Lệnh fetch chỉ dùng thư viện chuẩn nhưng lệnh smoke cần executable trong venv đã cài lock:

```powershell
& artifacts/ai-dev-311/Scripts/python.exe services/ai-service/scripts/dependency_smoke.py --models-dir artifacts/models
```

Trên Linux, dùng `artifacts/ai-dev-311/bin/python` thay `Scripts/python.exe`. Model weights không đưa vào Git; cấu hình path/volume lúc triển khai feature.

## Các gate đã kiểm chứng

| Kiểm tra          | Bằng chứng                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI           | Hai spec lint hợp lệ; 5 warnings hiện hữu, không đổi generic union để che warnings                                                                                            |
| JS install/build  | Frozen install, contracts build/regenerate và workspace typecheck qua                                                                                                         |
| JS regression     | Lint và test workspace qua; frontend 191 tests; tooling 109 tests                                                                                                             |
| Python runtime    | Windows clean venv và Docker Linux từ hash locks; pip check qua, duy nhất contrib OpenCV                                                                                      |
| AI compatibility  | Pose Tasks, YuNet/SFace OpenCV, SFace qua ONNX CPU load/inference; SHA-256 khớp manifest                                                                                      |
| Python regression | 31 tests trên mỗi OS, coverage 94,34%; lint/format được kiểm tra                                                                                                              |
| DB                | PostgreSQL 16.15 container riêng: fresh, upgrade với seed trước 0013, migration runner lần hai không apply trùng                                                              |
| DB invariants     | Dedup FALL, active FIRE latch qua RESOLVED/restart identity, immutable payload, lease shape, occurrence wellness unique, immutable response window, một active wellness event |

Training CPU cũng đã clean-install từ hash lock, qua `pip check`, export YOLO11n hai class ONNX FP32/batch1/640/opset17 và parity với PyTorch. Đây là graph chưa train, không dùng làm model FIRE; export tạm được dọn sau smoke.

Chạy lại DB gate bằng `node tools/scripts/sprint3-db-gate.mjs` khi Docker đang chạy. Script tạo container/database riêng và dọn container trong `finally`, không đọc `.env` hoặc reset DB của người dùng. Check constraint không thay thế kiểm thử race/multi-worker của implementation sau này.

Smoke ảnh trống chỉ kiểm chứng API/ABI/model compatibility. Không suy ra accuracy, FAR/FRR hoặc kết quả E2E. Có warning Starlette về httpx test client, nhưng các test hiện tại qua; không thêm HTTP client mới chỉ để che cảnh báo.

## Bắt đầu ba nhánh song song

Lấy commit đã merge dependency PR trước khi code. US16–17 làm cùng nhánh E2E vì dùng chung candidate/confirmation; US18 và US20 làm nhánh riêng. Cùng dùng baseline này, không tự add dependency hoặc sửa schemas shared.

US16–17 tiếp tục frame/track history và FALL runtime. US18 tiếp tục dataset/training/holdout rồi mới bật model runtime. US20 tiếp tục adapter identity/motion/direction, CRUD và durable scheduler; thiếu departure evidence không được claim skip-away AC. Các file entrypoint, frame bridge, generic notification/escalation và event UI vẫn cần owner tích hợp tuần tự.

Các plan chi tiết giữ làm tài liệu thiết kế. Ghi chú chưa merge/chưa có lock trong snapshot ngày 09/10 được thay thế bằng register/baseline cập nhật và bằng chứng của PR dependency. Tình trạng merge dependency được xác nhận bằng PR/commit thực tế, không bằng việc có file lock trên nhánh local.
