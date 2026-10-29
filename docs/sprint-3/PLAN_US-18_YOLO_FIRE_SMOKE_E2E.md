# Plan E2E US-18 — Train YOLO và phát hiện lửa/khói (M3)

> Fire-only scope update, 29/10/2026: per lead direction, US-18 now detects and alerts on fire only. Class 1 smoke from the existing verified two-class checkpoint is discarded before scoring, temporal confirmation, evidence rendering and notification. Three consecutive fire frames are still required; smoke-only input is negative and cannot bridge fire frames. New evidence uses `fire-only-temporal-min-v1`. The model artifact name/checksum and legacy `FIRE_SMOKE_DETECTED` storage identifier remain for compatibility; all current web/Telegram labels say fire. Historical smoke metrics and mixed-class acceptance below are superseded for the active feature. Existing records are retained, not relabeled as newly verified fire.

> Hướng dẫn test tay với lead (28/10/2026): [Các bước chạy và nghiệm thu US-18](US-18_HUONG_DAN_NGHIEM_THU.md), gồm webcam, ảnh/video, Telegram và biên bản kết quả.

> Sprint 3 · Một người phụ trách E2E (D theo backlog) · Một AI Agent duy nhất.
> Ngày lập: 09/10/2026 · Baseline khảo sát: commit `865dc6e` cùng contract M2a đang được cập nhật trong working tree.
> US-18: 5 SP theo backlog; không tự tạo số issue hoặc coi việc train là đã hoàn thành.
> Đây là kế hoạch triển khai. Phải train, đánh giá và khóa model trước khi triển khai tính năng E2E.

> Cập nhật 26/10/2026: đã dựng môi trường Windows CPU riêng và export checkpoint YOLO26n do người dùng cung cấp, kiểm tra parity trên 6 ảnh cục bộ. Xem [kết quả kiểm chứng và các khác biệt so với plan](US-18_YOLO26_EXPORT_STATUS.md). Đây là candidate export; G2 chất lượng model và G5 E2E chưa đạt, đặc biệt còn thiếu kiểm chứng phát hiện smoke.

> Bổ sung bằng chứng cùng ngày: người dùng đã cung cấp bộ kết quả test Indoor Fire Smoke (AP@0.5 fire 0,885, smoke 0,838) và video kết quả `bucket11.avi` có box dự đoán. Đã ghi nhận train và đánh giá offline; xem phần cập nhật trong báo cáo trên. Phần còn lại là tích hợp/kiểm chứng runtime và nghiệm thu release/E2E, không yêu cầu train lại từ hai ảnh smoke thử ban đầu.

> Implementation update, 26/10/2026: full-camera transport, YOLO26 ONNX endpoint,
> temporal confirmation, durable P0 incidents/results, media recovery and dashboard
> evidence are implemented with admission disabled by default. An isolated real
> Frigate/MQTT/ONNX/PostgreSQL/MinIO run passed using the user's raw `bucket11.mp4`,
> including a notification intent and user confirmation. This does not close the
> independent quality, source/holdout, deployment load and external-delivery gates.
> See [runtime runbook](US-18_RUNTIME_RUNBOOK.md) and the updated export/status report.

> Validation update, 27/10/2026: fire is the user's main quality priority. Clock
> diagnosis, Docker-aligned Node 22 integration, 27-video screening and real RTSP
> replay with browser confirmation are complete. Fire misses/false confirmations
> still prevent quality acceptance; 0.65 is only an exploratory threshold, with
> 0.50 defaults unchanged. Telegram awaits the user's intended chat. See the
> [current validation report and ordered remaining work](US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations).

> Runtime recovery follow-up, 27/10/2026: five actual local RTSP/MQTT/service
> interruption cases passed with fresh confirmations, durable incident/result
> deduplication and downloaded-media checksum verification. Authenticated M3
> readiness/freshness/error/drop diagnostics are implemented and verified.
> Long CPU/RAM soak, physical deployment, combined M2 load and release acceptance
> remain distinct pending checks; G2/G5 are not marked fully closed.

> Additional quality follow-up, 27/10/2026: the user deferred the local CPU/RAM
> soak. A frozen comparison on 29 eligible KMU videos confirmed fire in 18/19
> positive clips at 0.50 versus 16/19 at 0.65, with zero fire-only false-confirmed
> negatives out of ten at either threshold. Retain 0.50; do not promote the earlier
> exploratory 0.65 candidate. See the [follow-up report](US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations)
> for the three pre-inference training-overlap exclusions and quality limitations.

> Error-analysis follow-up, 27/10/2026: confidence timelines and source/box reviews
> explain the missed sequences without relaxing the three-consecutive-frame rule.
> A 16-clip tiling probe increased false confirmations and was rejected. The
> checkpoint defaults to a different prediction mode from the registered NMS-free
> export; the exporter now preserves checkpoint mode by default. A separate
> eight-image parity pass and fixed-threshold video comparison are recorded in
> the [error analysis](US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations). No new training or automatic
> runtime promotion is implied by this correction.
> The completed 56-video comparison confirms 29/30 fire-positive videos versus
> 27/30, but false-confirmed negatives increase from 5/26 to 7/26. The candidate
> remains separate; the registered model and G2/G5 acceptance are unchanged.

> Indoor-integration update, 27/10/2026: the user accepted the recorded
> limitations as non-blocking for this step. The checkpoint-preserving ONNX is
> now the registered/staged integration candidate, with synchronized AI/backend
> identity and a checksum-bound graph-floor contract. Its own RTSP/Frigate/P0/
> media/browser gate passed in `camerai-us18-video-25468`, including actual user
> confirmation to `RESOLVED`. See [the current evidence](US-18_YOLO26_EXPORT_STATUS.md#checkpoint-model-integration).
> Telegram awaits the intended chat, CPU/RAM soak remains deferred and G2/G5
> release acceptance is not inferred from the local pass.

> Telegram follow-up, 27/10/2026: the user authorized one photo to the existing
> linked private chat of `@camerai_test_bot`. The provider accepted the alert for
> **US18 TEST bucket11**. The real user's `Tôi ổn` callback recorded
> `TELEGRAM` / `IM_OK`, reached `RESOLVED` and updated the caption successfully.
> See [live Telegram verification](US-18_YOLO26_EXPORT_STATUS.md#main-webcam-and-telegram-acceptance). This
> disposable-database test does not enable deployment flags or resume the deferred soak.

## 1. Mục tiêu, phạm vi và điều kiện nghiệm thu

> Operator acceptance correction, 27/10/2026: use the existing application and
> room-camera/WHIP workflow, as required by section 9. The isolated video and
> Telegram fixtures contain different events and are not a single shared user
> session. Main-app physical webcam fire detection and same-event Telegram/web
> confirmation subsequently passed on event `fa0c194a-c5b4-4a91-a2bc-8a4b8fd2e826`:
> real `TELEGRAM` / `IM_OK`, final `RESOLVED` and operator-observed web update.
> One earlier expired test event still requires manual closure. See
> [main webcam acceptance](US-18_YOLO26_EXPORT_STATUS.md#main-webcam-and-telegram-acceptance).

> Fire UX follow-up, 27/10/2026: the existing dashboard now prioritizes fire
> evidence, recovers transient detail/media failures, plays the stored clip,
> highlights unresolved P0 cards and requires local evidence review before
> navigation. Fire dialogs include a large manual 114 link. New clips include
> pre-roll before the first qualifying frame, backed by continuous recording when
> enabled. A separate boxed Telegram delivery JPEG is locally verified; old chat
> photos are unchanged and no new message was sent. See
> [implementation and verification](US-18_YOLO26_EXPORT_STATUS.md#fire-alert-ux-and-evidence). This does not close
> independent model quality or release gates.

> UX refinement and Telegram follow-up, 27/10/2026: attention now fits without a
> scrollbar, with moderate same-row inspect/call actions. Details expose absolute
> detection time and essential context, with only one optional body scroll region.
> A strict three-hour interruption window and persistent per-account/browser
> episode receipts prevent old/repeated popups. A separately approved bounded
> real webcam test delivered a painted photo at 20:28:44; the operator confirmed
> receiving the new photo and its red flame box. See the
> [updated UX and delivery evidence](US-18_YOLO26_EXPORT_STATUS.md#fire-alert-ux-and-evidence).

**Là** người được giám sát (P2), **tôi muốn** hệ thống phát hiện cháy sớm, **để** thoát ra kịp.

Triển khai trọn luồng: chuẩn bị dữ liệu công khai → fine-tune YOLO pretrained cho hai lớp smoke/fire → đánh giá/export/chốt artifact → ảnh thật từ Frigate → inference toàn khung hình → xác nhận chuỗi frame → incident `FIRE_SMOKE_DETECTED` priority `P0` → escalation/thông báo hiện có → dashboard/SSE và xác nhận của người dùng.

Một người làm model, API, AI service, backend, dữ liệu, UI, test và tài liệu bằng cùng một AI Agent; không spawn subagent hoặc chia FE/BE/AI cho nhiều người. Reviewer kiểm tra và nghiệm thu độc lập theo Git workflow, không phải người triển khai thứ hai.

| ID     | Given / When                                                             | Then                                                                                                                |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| AC18-1 | Một frame camera; model YOLO fire/smoke inference                        | Trả danh sách bbox với nhãn `fire` hoặc `smoke`, mỗi bbox có confidence                                             |
| AC18-2 | Có tín hiệu confidence `>= T_fire` liên tục ít nhất 3 frame trong 5 giây | Tạo đúng một incident `FIRE_SMOKE_DETECTED`, priority `P0`, qua luồng cảnh báo hiện có                              |
| AC18-3 | Chỉ một frame đơn lẻ có tín hiệu, các frame sau không xác nhận           | Không tạo cảnh báo                                                                                                  |
| AC18-4 | Kiểm thử mô hình/video/E2E                                               | Chỉ dùng video từ dataset công khai D-Fire/FireNet có nguồn và checksum rõ ràng; tuyệt đối không tự tạo lửa để quay |

Chỉ làm M3/US-18 và tích hợp P0 cần thiết. Không tạo thuật toán face/pose mới, hệ quản lý camera khác, nhà cung cấp notification mới hoặc tự đổi chính sách escalation toàn hệ thống. US-19 là story riêng về timeout/thứ tự ưu tiên; không tuyên bố hoàn thành toàn bộ US-19 chỉ vì incident M3 được gán P0.

Tài liệu bắt buộc đọc trước code:

- [CODING_CONVENTION.md](../conventions/CODING_CONVENTION.md), [GIT_WORKFLOW.md](../conventions/GIT_WORKFLOW.md).
- [API_GUIDE.md](../api/API_GUIDE.md), [backlog/FR](../Roadmap_Backlog_UserStory_FR_CameraAI.md), US-18 và FR-DET-M3-01/02/03.
- [api/openapi.yaml](../../api/openapi.yaml), [api/openapi-ai-service.yaml](../../api/openapi-ai-service.yaml).
- [Plan M2a US-16/US-17](PLAN_US-16_US-17_POSE_FALL_E2E.md) để phối hợp model/runtime/frame/API.
- [FFmpeg/MediaMTX](../FFMPEG_MEDIAMTX_SETUP.md), [Frigate bridge](../../infra/frigate/frame-metadata/README.md), [PR template](../../.github/pull_request_template.md), [CODEOWNERS](../../.github/CODEOWNERS).

## 2. Hiện trạng repo và quyết định chính

| Hiện trạng                                                                                         | Quyết định cho M3                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec có `/fire/detect`, operationId `detectFire`, `FireResponse`; router chưa được triển khai      | Hiện thực endpoint này, không tạo `/fire/smoke` hoặc callback trùng chức năng                                                                            |
| Spec overview nói chỉ `/pose/fall` stateful, trong khi FireResponse có confirmed/consecutiveFrames | PR contract M3 sửa mô tả để chốt `/fire/detect` cũng stateful theo camera/source session; không để hai tài liệu mâu thuẫn                                |
| Đã có `M3_FIRE`, `FIRE_SMOKE_DETECTED`, P0 và escalation rule seed                                 | Không tạo enum tương đương mới; không sửa migration seed lịch sử                                                                                         |
| Đã có AiResultsService/receipts/outbox/escalation/Telegram/SSE                                     | Dùng lại, không gửi Telegram trực tiếp từ detector                                                                                                       |
| Python đang khai báo `ultralytics>=8.3.0` ở extra m3, chưa khóa graph                              | Thay chiến lược: Ultralytics chỉ dùng ở môi trường train/export; runtime M3 dùng ONNX Runtime đã pin                                                     |
| Plan M2a chọn MediaPipe và một flavor opencv-contrib-python                                        | Không cài opencv-python của Ultralytics chồng vào AI service; môi trường train tách riêng                                                                |
| Bridge hiện phát metadata người, không phát ảnh và không chứng minh có chuỗi ảnh M3                | Bổ sung publisher ảnh toàn camera độc lập với person/M2a, không dùng event snapshot hoặc chờ person xuất hiện                                            |
| Luồng event Frigate hiện gắn track người                                                           | Tạo incident M3 riêng theo camera/episode, không phụ thuộc trackId/person/zone                                                                           |
| REST_AREA phục vụ M2a                                                                              | REST_AREA không suppress lửa/khói; có cháy trên giường/sofa vẫn là M3                                                                                    |
| Notification worker hiện chủ yếu claim theo created_at                                             | Kiểm thử luồng P0 thực tế; không suy ra scheduler toàn hệ thống đã ưu tiên P0 từ label. Nếu cần thay thứ tự toàn hệ thống, tách PR/US-19 và test hồi quy |

Tách trách nhiệm: AI service inference và giữ counter/episode tạm; orchestrator xác thực camera, kiểm tra bằng chứng, ghi incident và pending submission bền vững; DB/outbox xử lý dedup/retry; UI chỉ đọc API event. Training không chạy trong container inference hoặc lúc service startup.

## 3. Thứ tự gate bắt buộc

1. **G0 — Baseline:** đọc hướng dẫn, ghi test/hành vi hiện có, kiểm tra dữ liệu/GPU/môi trường và phần shared đang thay đổi.
2. **G1 — Dependency:** merge bộ dependency chung và lock cho training/runtime, phối hợp M2a; chưa viết feature inference/backend/UI.
3. **G2 — Model:** chuẩn bị dữ liệu, train YOLO, calibration/đánh giá, export ONNX, parity test, khóa model/checksum/class map. Đây là yêu cầu phải hoàn thành **trước triển khai tính năng**.
4. **G3 — Contract:** chốt cả hai OpenAPI cùng examples/metadata/data-flow, review và merge trước caller/callee/UI.
5. **G4 — Implementation:** frame pipeline → AI service → incident/outbox/escalation → UI; flag off cho phần chưa hoàn chỉnh.
6. **G5 — E2E/release:** clip công khai chạy qua Frigate thật, hồi quy đầy đủ, số đo/runbook/rollback.

Có thể làm spike tái hiện frame/model trong môi trường thử để giải quyết gate; không gọi spike là tính năng hoàn chỉnh. Nếu chưa có video công khai hoặc model không đạt, ghi rõ phần chưa đạt và tiếp tục phần độc lập, không tự đốt lửa, không bịa metric, không bỏ gate.

## 4. Chốt framework và dependency để không xung đột M2a

### 4.1. Bộ phiên bản ban đầu

Các phiên bản dưới đây là lựa chọn cụ thể cho gate, chưa phải kết quả đã clean-install/test tại máy này. Không tự đổi bản trong PR feature; thay đổi phải đi qua PR dependency phối hợp.

| Môi trường             | Package/framework                                                                                   | Chốt                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Cả training/runtime    | CPython                                                                                             | 3.11; chốt patch và image digest ở manifest, không dùng venv 3.14                                                 |
| Training riêng         | Ultralytics                                                                                         | `ultralytics==8.3.59`, YOLO11n Detect                                                                             |
| Training riêng         | PyTorch/torchvision                                                                                 | `torch==2.5.1`, `torchvision==0.20.1`; CUDA 12.4 cho GPU NVIDIA tương thích hoặc CPU build riêng, cùng minor pair |
| Training riêng         | OpenCV                                                                                              | **Chỉ** `opencv-python==4.10.0.84`, đáp ứng dependency Ultralytics                                                |
| Training/export        | ONNX                                                                                                | `onnx==1.17.0`                                                                                                    |
| Runtime/đánh giá ONNX  | ONNX Runtime                                                                                        | `onnxruntime==1.20.1`, CPUExecutionProvider; không onnxruntime-gpu trong runtime sprint này                       |
| Training/runtime       | NumPy                                                                                               | `numpy==1.26.4`, đồng bộ baseline M2a                                                                             |
| Runtime AI chung       | OpenCV                                                                                              | **Chỉ** `opencv-contrib-python==4.10.0.84` theo gate M2a; không thêm flavor khác                                  |
| Runtime AI chung       | MediaPipe                                                                                           | Giữ `mediapipe==0.10.32` khi M2a được tích hợp; M3 không upgrade                                                  |
| Runtime API            | FastAPI/Pydantic/Uvicorn/Pillow                                                                     | Giữ graph từ lock chung đã merge ở G1; không tự resolve lại từ các range `>=`                                     |
| Node/pnpm              | Node 22, pnpm 9.12.0                                                                                | Dùng `.nvmrc`, `packageManager` và patch baseline đội đã chốt                                                     |
| Backend/frontend/tests | NestJS 10.4.22, BullMQ 6.3.9, MQTT 5.16.0; Next.js 15.5.24, React 18.3.1; Jest 29.7.0, Vitest 2.1.9 | Graph hiện có trong pnpm-lock.yaml; không nâng framework để làm M3                                                |
| Infra                  | Frigate 0.18.0, PostgreSQL 16, Redis 7                                                              | Giữ baseline và pin digest nghiệm thu; không upgrade nội bộ Frigate tùy ý                                         |

Ultralytics 8.3.59 cung cấp YOLO11; cặp PyTorch 2.5.1/torchvision 0.20.1 có hướng dẫn wheel CPU/CUDA 12.4 chính thức. Chọn train riêng vì dependency OpenCV của Ultralytics khác flavor runtime M2a. Tham khảo [release Ultralytics](https://pypi.org/pypi/ultralytics/8.3.59/json), [PyTorch previous versions](https://pytorch.org/get-started/previous-versions/) và [ONNX Runtime 1.20.1](https://pypi.org/pypi/onnxruntime/1.20.1/json).

### 4.2. PR dependency và cài đặt tái lập

- Một manifest chung `docs/sprint-3/DEPENDENCY_BASELINE.md`, dùng lại file của M2a nếu đã có; không tạo bảng version cạnh tranh. Ghi runtime, training GPU/CPU, target OS/ABI, package exact version, wheel index, image digest và owner.
- `services/ai-service/pyproject.toml` là nguồn khai báo runtime: extra m3 đổi sang ONNX Runtime đã pin; extra m2a giữ lựa chọn chung. Không đưa Ultralytics/Torch/TensorFlow/Keras/ImageAI vào runtime chỉ vì dataset có mã inference cũ.
- Runtime/dev locks sinh từ graph **m2a+m3** chung và cùng constraint; dev lock thêm dev nhưng không làm đổi runtime graph. Dùng quy trình pip-tools và lock có hash đã chốt trong plan M2a; không thêm lock tool khác chỉ cho M3.
- Training đặt tại `training/m3/`, venv riêng `training/m3/.venv`; có `requirements-train.in` và lock GPU/CPU riêng theo OS khi cần. Ultralytics/NumPy/OpenCV/Torch/torchvision/ONNX và dependency bắc cầu phải được khóa có hash. Ghi rõ CUDA build suffix/index, không chỉ ghi torch version rồi để resolver chọn build khác.
- Training GPU wheel lấy từ index chính thức PyTorch theo manifest; resolve/index policy có một owner và kiểm tra wheel hash. Không dùng một lock CUDA để cài CPU, không cài onnxruntime và onnxruntime-gpu chung môi trường.
- Docker, CI, setup AI và local đều cài runtime lock chung bằng hash; `pnpm install --frozen-lockfile` cho JS. Không dùng `pip install --upgrade`, `@latest`, auto-install package lúc export hoặc startup.
- Clean-install test Linux x86_64 và Windows x64: `pip check`, imports, chỉ một distribution cv2/mỗi venv, M1 YuNet/SFace vẫn chạy, M2a smoke vẫn chạy, ONNX CPU session hoạt động.
- Notebook/GPU provider nếu dùng cũng phải cài đúng lock; ghi driver/GPU/CUDA metadata. Không tự thuê GPU hoặc chọn dịch vụ có phí trong plan; dùng tài nguyên đã được cấp. CPU được dùng cho smoke, không coi smoke 1 epoch là model release.

Lệnh cài dưới đây **chỉ chạy sau khi owner đã tạo và merge các lock tương ứng**; đây là hướng dẫn cho người thực thi, không phải yêu cầu tải thư viện ngay khi đọc plan:

```powershell
py -3.11 -m venv training/m3/.venv
& "training/m3/.venv/Scripts/python.exe" -m pip install --require-hashes -r training/m3/requirements-train-cu124-win.lock
& "training/m3/.venv/Scripts/python.exe" -m pip check
```

Máy CPU dùng lock CPU của đúng OS đã chốt. Linux gọi `training/m3/.venv/bin/python` và chọn lock Linux; không đổi thư viện của venv AI service hoặc Python global.

**Exit G1:** manifest/lock/image/toolchain version có SHA; clean install/test tương thích đạt; D/E dùng chung baseline runtime đã merge. Gói heavy training không xuất hiện trong runtime AI.

## 5. Hướng dẫn train YOLO trước khi làm tính năng

### 5.1. Chọn đúng pretrained model và dữ liệu

Chốt fine-tune **YOLO11n Detect pretrained COCO** cho hai lớp smoke/fire, không train từ random initialization. COCO pretrained giúp khởi tạo đặc trưng, không tự có classifier fire/smoke; chỉ đổi tên lớp của YOLO COCO không tạo model phát hiện khói/lửa. Nguồn [YOLO11](https://docs.ultralytics.com/models/yolo11) và [COCO class list](https://docs.ultralytics.com/datasets/detect/coco/).

Base weight pin release cụ thể: `https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt`. Tải một lần vào `training/m3/weights/yolo11n.pt`, ghi URL/release/SHA-256/license. Không để YOLO tự tải weight mới nhất lúc chạy train/export; không lấy weights không rõ hai lớp từ video demo.

**Training:** dùng D-Fire images/YOLO bbox và các ảnh trích từ video train/calibration công khai được phép. **Kiểm thử nghiệm thu:** chỉ dùng video công khai D-Fire/FireNet đã hold out; frame trích cho metric vẫn phải truy về video đó. Không dùng bộ ảnh rời hoặc slideshow lặp một ảnh thay bằng chứng 3 frame liên tục.

- [D-Fire chính thức](https://github.com/gaia-solutions-on-demand/DFireDataset) là dataset ảnh có annotations YOLO; repo có liên kết riêng cho surveillance videos. Không coi việc tải archive ảnh là đã có video nghiệm thu.
- Tên FireNet có nhiều dự án. Mặc định ưu tiên video/raw data truy được từ [FireNET của OlafenwaMoses](https://github.com/OlafenwaMoses/FireNET), trong đó có `video1.mp4`; đây là nguồn fire, không tự giả định đã có bbox smoke. Không dùng `.h5`/ImageAI của dự án đó thay YOLO hai lớp.
- [FireNet của Arpit Jadon](https://github.com/arpit-jadon/FireNet-LightWeight-Network-for-Fire-Detection) là nguồn khác với custom dataset và liên kết tập video đánh giá. Nếu sử dụng, ghi đúng project/publication/URL, kiểm tra nội dung, nhãn và quyền sử dụng từng asset; không gộp hai nguồn dưới tên FireNet rồi mất provenance.
- Clip demo đã vẽ prediction/text overlays không phải raw test video; chỉ dùng clip raw có nguồn, hoặc đánh dấu không phù hợp và chọn video D-Fire khác. Fire-only không được xem là bằng chứng smoke detection đạt.
- Chỉ tải dữ liệu công khai, kiểm tra license/attribution và hash; không tự upload camera gia đình lên dịch vụ train.
- **Tuyệt đối không đốt giấy/gas/nến, tạo khói hoặc dàn dựng lửa để quay thêm dữ liệu**. Không chỉ dẫn tự tạo lửa trong runbook/test. Nếu thiếu clip âm tính hoặc smoke-only phù hợp, ghi gap dataset, tìm trong nguồn công khai đã cho phép; không tự quay để lấp gap.

Mọi asset có entry trong manifest `docs/sprint-3/M3_DATASET_MANIFEST.md`: source URL/version, license/attribution, file/checksum, video group/camera/scene, split, lớp hiện diện, FPS/duration và provenance. Binary/weights/runs không commit Git thường; dùng storage artifact đã có, giữ manifest/small fixtures hợp lệ trong repo.

### 5.2. Chuẩn bị labels và chống rò rỉ dữ liệu

1. Tách `raw` bất biến, `prepared` và outputs; không sửa archive gốc. Validate decode/ảnh hỏng, duplicate checksum và near-duplicate theo scene.
2. Chốt class map model v1: **0=smoke, 1=fire**. Đối chiếu class ID dataset tải thực tế bằng tài liệu/sample visualization, rồi remap nếu cần. Không mặc định mọi bản D-Fire/FireNet có cùng thứ tự ID, không dùng `single_cls=True`.
3. Format mỗi dòng YOLO: `class_id x_center y_center width height`, chuẩn hóa 0..1 theo ảnh thật. Bbox width/height dương, toàn bộ box nằm trong ảnh, không NaN/Inf, class chỉ 0/1. Ảnh negative có label rỗng có chủ đích; file label thiếu không tự coi là negative.
4. FireNet có thể là fire-only hoặc image classification, không sẵn bbox smoke: chỉ dùng phần có annotation detector được xác minh hoặc gán bbox cho dữ liệu công khai trong train split. Smoke chưa được annotate không phải negative smoke. Không dùng classifier image label thay bbox.
5. Split **theo video gốc/camera/scene**, không random các frame của cùng video vào train/val/test. Một scene/near-duplicate không xuất hiện ở nhiều split. Image split công bố sẵn vẫn phải audit; không tự tuyên bố leakage-free khi không có provenance đầy đủ.
6. Bảo lưu video nghiệm thu trước train, gồm smoke-only, fire-only, fire+smoke, negative/hard negatives. Không đưa frame của video này vào train hoặc tuning T_fire. Nếu một image archive có frame trùng video test thì loại khỏi train/val.
7. Train/val ảnh giữ negative/hard-negative từ dữ liệu công khai: đèn vàng/đỏ, phản xạ, ánh nắng, vật thể màu lửa, hơi nước/sương mù nếu dataset có. Không bỏ negative để làm metric đẹp; không invent source class annotation.
8. Calibration dùng video split riêng để chọn T_fire/NMS/continuity. Test dùng video holdout chưa tuning; frame-level test images chỉ là frame trích từ chính video holdout, giữ group/time manifest.

Thư mục chuẩn bị trong lúc triển khai:

```text
datasets/m3/
  raw/
  yolo/
    images/train/
    images/val/
    images/test/
    labels/train/
    labels/val/
    labels/test/
    data.yaml
  videos/calibration/
  videos/test/
training/m3/
  requirements-train.in
  requirements-train-cu124-win.lock
  train-fire-smoke.yaml
  weights/yolo11n.pt
  runs/
```

`images/test` chỉ chứa frame của video nghiệm thu, không ảnh test ngẫu nhiên. Dataset/video/training outputs phải ở đường dẫn bị ignore hoặc artifact storage trước stage; `.gitignore` hiện chưa bảo đảm mọi weight/runs trong `training/m3` đều bị ignore, cần patch ignore tối thiểu trong PR tooling khi thực thi.

Ví dụ `data.yaml`; người thực thi sửa duy nhất absolute dataset root theo máy và giữ class map:

```yaml
path: D:/hoc tap/project 1/aws-camera-ai/datasets/m3/yolo
train: images/train
val: images/val
test: images/test
names:
  0: smoke
  1: fire
```

Trước train, overlay tối thiểu 20 ảnh/lớp và 20 negative bằng annotation gốc để kiểm tra class map/box; chạy audit và ghi số lượng theo split/lớp/source. Việc xem/audit dữ liệu train là bước chuẩn bị model, không thay nghiệm thu video. Không bắt đầu train khi warning missing labels/empty class chưa được giải thích.

### 5.3. Smoke run và train chính thức

Chốt config ban đầu cho lần train có thể tái lập; mọi chỉnh sửa tiếp theo tạo experiment ID mới và ghi lý do:

```yaml
task: detect
mode: train
model: training/m3/weights/yolo11n.pt
data: datasets/m3/yolo/data.yaml
epochs: 100
patience: 20
imgsz: 640
batch: 8
device: 0
workers: 0
seed: 42
deterministic: true
pretrained: true
single_cls: false
optimizer: AdamW
lr0: 0.001
lrf: 0.01
weight_decay: 0.0005
amp: false
cache: false
close_mosaic: 10
hsv_h: 0.015
hsv_s: 0.5
hsv_v: 0.3
flipud: 0.0
fliplr: 0.5
degrees: 0.0
mosaic: 0.5
mixup: 0.0
project: training/m3/runs
name: yolo11n-fire-smoke-v1
exist_ok: false
plots: true
```

`workers=0` ưu tiên tái lập trên Windows, `amp=false` tránh bước auto-check tải thêm weight ngoài manifest. Seed/deterministic giảm variance nhưng không đảm bảo bit-identical giữa GPU/OS khác nhau; ghi hardware/driver/lock/config/dataset hashes. Nếu GPU OOM, giảm batch 8→4→2 và ghi experiment; không đổi imgsz/architecture âm thầm. CPU run override device=cpu và batch nhỏ, ghi đó là cấu hình khác.

Tại repo root, sau G1 và chuẩn bị dữ liệu:

```powershell
& "training/m3/.venv/Scripts/yolo.exe" detect train cfg=training/m3/train-fire-smoke.yaml epochs=1 fraction=0.05 close_mosaic=0 name=m3-smoke-run
& "training/m3/.venv/Scripts/yolo.exe" detect train cfg=training/m3/train-fire-smoke.yaml
```

Smoke run chỉ kiểm tra môi trường, nhãn, loss và artifact, không dùng metric làm nghiệm thu. Run chính dùng 100 epochs/early stopping như config; chọn `best.pt` từ validation, giữ `last.pt` để resume. Không chọn checkpoint bằng test set. Resume dùng đúng run/config/dataset/lock gốc, ví dụ:

```powershell
& "training/m3/.venv/Scripts/yolo.exe" detect train model=training/m3/runs/yolo11n-fire-smoke-v1/weights/last.pt resume=True
& "training/m3/.venv/Scripts/yolo.exe" detect val model=training/m3/runs/yolo11n-fire-smoke-v1/weights/best.pt data=datasets/m3/yolo/data.yaml split=val imgsz=640 plots=True
```

Nếu model không học smoke, kiểm tra annotation/class balance/near-duplicates/domain trước kéo dài epochs. YOLO11s chỉ là phương án thay đổi qua gate mới khi n không đạt quality và CPU budget; không tự upgrade framework hoặc đổi model giữa triển khai.

### 5.4. Calibration, đánh giá video và tiêu chí model

Chạy best.pt trên **video calibration công khai**, lưu predictions theo frame timestamp/bbox/class/score rồi áp dụng đúng rule mục 7. Chọn T_fire ban đầu 0,50; quét trên calibration, ghi trade-off recall/false alerts và khóa trước video test. Không dùng confidence detector như xác suất đã hiệu chuẩn.

Ví dụ lệnh xem nhanh predictions trên một clip calibration đã có entry/checksum trong manifest:

```powershell
& "training/m3/.venv/Scripts/yolo.exe" detect predict model=training/m3/runs/yolo11n-fire-smoke-v1/weights/best.pt source=datasets/m3/videos/calibration/calibration-001.mp4 imgsz=640 conf=0.50 iou=0.45 save=True save_txt=True save_conf=True project=training/m3/runs name=m3-calibration-preview
```

Tên clip trên là đường dẫn chuẩn hóa người thực thi đặt sau tải hợp lệ, không khẳng định có asset tên đó trong dataset. CLI preview không tự kiểm chứng temporal confirmation; cần evaluator dùng PTS/FPS và detector đã chốt.

Ghi metrics riêng hai lớp, không chỉ aggregate: precision/recall, mAP50/mAP50-95 của validation, confusion matrix, FN smoke-only, false detections hard-negative. Nghiệm thu chính ở **video event-level**: TP/FP/FN, incident precision/recall, false alarms/giờ negative footage, time-to-first-qualified-frame, time-to-confirm và notification latency.

Mục tiêu engineering **đề xuất để chốt ở G2**, không phải cam kết đã đạt: event recall >=90% trên tập positive đủ quan sát, event precision >=90%, false alarms <=1/giờ negative footage, p95 inference CPU <=200ms/camera ở 640 input. Ghi tử số/mẫu số, thời lượng âm tính và giới hạn sample; không suy ra FAR theo giờ từ vài clip ngắn. Nếu nhóm/US-22 có target khác đã chốt, dùng target đó và ghi phiên bản. Khi thiếu số lượng hoặc model không đạt, G2 chưa pass, không bật feature như production-ready.

Không dùng frame image test ngẫu nhiên thay video test. Có thể chạy `yolo val split=test` trên các frame đã trích từ holdout video để bổ sung metric box, nhưng phải giữ clip nguồn/PTS và vẫn chạy event evaluator video thật. Không lặp một ảnh cháy thành ba frame để chứng minh AC18-2.

### 5.5. Export và khóa artifact trước feature

Chốt ONNX FP32, input `[1,3,640,640]`, opset 17, `dynamic=false`, `nms=false`, `simplify=false`, batch 1. Runtime CPU làm preprocessing/postprocessing/NMS; không TensorRT/INT8 trong sprint này. Pinned exporter [Ultralytics v8.3.59](https://raw.githubusercontent.com/ultralytics/ultralytics/v8.3.59/ultralytics/engine/exporter.py) cho phép export ONNX; tắt simplify tránh kéo onnxslim/GPU runtime tự động.

```powershell
& "training/m3/.venv/Scripts/yolo.exe" export model=training/m3/runs/yolo11n-fire-smoke-v1/weights/best.pt format=onnx imgsz=640 batch=1 opset=17 dynamic=False simplify=False nms=False half=False device=cpu
```

1. Kiểm tra model bằng `onnx.checker`, input/output/metadata/class names, opset/provider và checksum. YOLO11 Detect hai lớp thường xuất raw tensor `[1,6,8400]` gồm cx,cy,w,h và hai class score; phải xác minh artifact thực tế, không viết decoder theo giả định chung YOLOv5 objectness.
2. Preprocessing BGR→RGB, letterbox 640×640 giữ ratio, padding/color và rounding đồng nhất với pinned Ultralytics, float32 `/255`, NCHW. Không crop chỉ vùng person.
3. Chọn class score, confidence floor, class-aware NMS IoU mặc định 0,45; không nhân thêm objectness không tồn tại. Đảo letterbox về pixel ảnh gốc rồi normalize bbox top-left `x,y,width,height`, clamp trong ảnh và loại box degenerate.
4. Parity test best.pt vs ONNX trên frame lấy từ video calibration công khai, gồm smoke/fire/negative và aspect ratio khác nhau: labels/NMS decisions khớp, score sai lệch <=1e-3 và bbox IoU >=0,99 cho boxes tương ứng, loại trường hợp sát ngưỡng khỏi suy diễn kết quả tuyệt đối và ghi khác biệt. Nếu sai, sửa export/preprocess/postprocess trước feature.
5. Benchmark cùng hardware/container runtime dự định dùng, không lấy tốc độ COCO của nhà cung cấp làm tốc độ hệ thống này.
6. Manifest model `services/ai-service/models/fire-smoke-v1.manifest.json`: modelVersion, immutable artifact URI, SHA-256 của pt/onnx/base weight, class map, input/output layout, opset, preprocess/postprocess versions, dataset/config/lock hashes, metrics, hardware và ngày train. Không bịa hash khi chưa tải/train.
7. Copy/download ONNX đã kiểm chứng qua artifact setup vào model mount read-only; không auto-download hoặc train lúc service startup. Weights/runs/binary không được stage vào Git thường; chỉ manifest/config/tooling/report.

**Exit G2:** best.pt và ONNX smoke/fire thật có checksum; model đạt target đã chốt trên video độc lập; parity và CPU benchmark đạt; artifact/threshold/policy frozen. Lúc này mới bắt đầu triển khai tính năng, không đem yolo11n.pt COCO chưa fine-tune vào production endpoint.

## 6. Chốt hai OpenAPI và tránh xung đột với M2a

### 6.1. Namespace và quy trình

| File/phần                                    | M3 phụ trách                                                                  | Không tự sửa trong PR M3                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `api/openapi-ai-service.yaml`                | `/fire/detect`, `detectFire`, `FireResponse`, schema mới prefix `Fire`        | `/pose/fall`, `Fall*`, `/face/*`, face schemas                |
| `api/openapi.yaml`                           | Description/example M3 callback hiện có; schema tài liệu `FireResultMetadata` | `FallResultMetadata`, shape M1/M4, event enums/shared unions  |
| Schema/error/bbox/security/health/info chung | Owner A/B tích hợp patch cần thiết sau phối hợp                               | Không rewrite spec hoặc copy từ branch cũ                     |
| Locks/Compose/config/main/bridge wiring      | Một owner chung tổng hợp theo thứ tự PR                                       | Không mỗi người tự cài version/sửa cùng vùng trên baseline cũ |

Trước G3 dùng lại `docs/sprint-3/API_CHANGE_REGISTER.md` của M2a: story, owner, file/path/schema/operationId, base SHA, PR/status. Nếu file chưa được tạo/merge, tạo trong PR contract thực thi và ghi cả reservation M2a/M3 sau phối hợp, không giả định plan đã tạo lock kỹ thuật.

- Chờ contract M2a merge hoặc phối hợp owner tích hợp hai patch theo thứ tự; rebase baseline mới, không ghi đè Fall fields/examples.
- Một PR contract M3 riêng chứa cả hai spec và generated types; A+B review/merge trước implementation. Ghi frozen SHA/version vào register.
- `pnpm api:lint`, generate/build/typecheck; generate lần hai không diff. Không hand-edit generated hoặc thêm DTO viết tay ở UI.
- Namespace giảm va chạm, không bảo đảm YAML không conflict. Shared changes chỉ một owner tích hợp, conflict resolve theo operation/schema với contributor, không chọn toàn bộ ours/theirs.
- Giữ global version/security/common schemas trừ thay đổi được đăng ký. Riêng overview stateless/stateful phải sửa tối thiểu cho cả pose và fire theo thiết kế final.
- Mọi thay đổi frozen schema/unit/required fields về sau là PR contract trước code, không âm thầm chỉnh spec ở cuối feature.

### 6.2. Request `/fire/detect`

Giữ multipart, operationId `detectFire`, required `image`, `cameraSlug`, `frameTimestamp`. `image` là frame toàn camera đúng timestamp, kể cả không có person. Thêm optional cho backward compatibility nhưng producer mới luôn gửi:

| Field             | Quy ước                                                         |
| ----------------- | --------------------------------------------------------------- |
| `frameId`         | String duy nhất/source session, chống duplicate replay          |
| `sourceSessionId` | Generation nguồn, default legacy cho caller cũ; đổi khi restart |

Không thêm trackId/personBoundingBox/inRestArea vào M3. Validate token, length/date-time/bytes/decode/pixels; 401 khi token sai, 413 oversize, 422 malformed fields. Lỗi decode/model/inference/timeout trả 200 với error != null, confirmed=false và counter reset. Request camera không hợp lệ được orchestrator chặn trước gọi AI; endpoint không ghi DB hoặc gửi Telegram.

### 6.3. Response `FireResponse`

Giữ required cũ `confirmed`, `detections`, `modelVersion`, `processedAt`; mọi field bổ sung optional trong spec, implementation/producer mới yêu cầu evidence đầy đủ. Dùng `FireInferenceError` riêng cho lỗi M3 để không sửa enum InferenceError M1/M2a.

| Field                                                                | Quy ước                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `detections[]`                                                       | Tất cả bbox post-NMS vượt output floor đã chốt, label fire/smoke, score 0..1, bbox trên ảnh đầy đủ; negative trả []    |
| `confirmed`                                                          | true chỉ khi có đủ chuỗi frame hợp lệ vượt ngưỡng; replay episode giữ bằng chứng trước đó, không xác nhận mới từ clock |
| `consecutiveFrames`, `requiredFrames`                                | Số frame liên tiếp qualifying; default required=3, không nhân số bbox thành số frame                                   |
| `maxConfidence`                                                      | Max score trong frame; null khi không có detection/lỗi, nới nullable trong contract trước code                         |
| `cameraSlug`, `sourceSessionId`, `frameId`, `observedAt`, `isReplay` | Echo identity/UTC capture timestamp/replay                                                                             |
| `episodeId`, `firstQualifiedAt`, `confirmedAt`                       | Nullable trước evidence; episode identity ổn định, confirmedAt giữ nguyên khi replay                                   |
| `windowSeconds`, `maxFrameGapSeconds`, `thresholdUsed`               | Snapshot rule temporal/detector dùng thực tế                                                                           |
| `qualifyingFrameIds`, `qualifyingFrameTimestamps`                    | Bounded evidence của chuỗi xác nhận; count/timestamps/id phải khớp, không duplicate                                    |
| `incidentConfidence`, `confidencePolicyVersion`                      | Confidence đại diện incident theo policy tại mục 8, khác maxConfidence single frame                                    |
| `reason`, `error`                                                    | Trạng thái/lý do negative/insufficient/stale/gap/technical; error=null với negative bình thường                        |

Episode UUIDv5 theo namespace URL `6ba7b811-9dad-11d1-80b4-00c04fd430c8`, name là compact UTF-8 JSON `[cameraSlug,sourceSessionId,firstQualifiedAt]`, timestamp canonical UTC millisecond `YYYY-MM-DDTHH:mm:ss.SSSZ`. Không dùng namespace M2a với cùng name shape; name array M3 khác số phần tử nên tách identity. Incident cùng camera/episode mới chỉ tạo một lần.

Examples bắt buộc: negative, one-frame candidate, exactly-three confirmed, duplicate replay, below-threshold reset, gap/out-of-window, model error. Giữ bbox/errors riêng namespace, không refactor face/pose để đẹp file. Chốt public state qua confirmed/reason, không thêm event status M3_CANDIDATE.

### 6.4. Callback orchestrator

Tái sử dụng `POST /internal/events/{eventId}/ai-result` hoặc cùng AiResultsService nội bộ. `schemaVersion=1`, `module=M3_FIRE`, label `FIRE_SMOKE_DETECTED`, một result/incident, error=null khi confirmed. Không gửi candidates/negative hoặc success rỗng vào validator chung.

- Giữ nhánh generic OtherAiResultSubmission/OtherAiResultItem; bổ sung **schema tài liệu** `FireResultMetadata`, descriptions/example. Không tạo oneOf overlapping hoặc làm metadata tất cả M2a/M3/M5 required theo một shape mới.
- Metadata: cameraId/sourceSessionId/episodeId/frameId, firstQualifiedAt/confirmedAt, qualifyingFrameIds/timestamps, consecutiveFrames/requiredFrames/windowSeconds/maxFrameGapSeconds, thresholdUsed, incidentConfidencePolicyVersion, labels hiện diện và detections bounded của frame xác nhận.
- Không raw image/base64/token/RTSP URL; bbox đầy đủ ảnh và cap số detection/payload theo AI_RESULT limits hiện có.
- `observationId=fire:{sourceSessionId}:{episodeId}`, revision=1, resultId một lần lưu trong pending payload; retry giữ payload/hash/processedAt.
- Incident mới phải tồn tại trước callback; detectedAt=confirmedAt. Đừng gắn vào event người đã NOTIFIED/terminal.

**Exit G3:** spec cả hai file được review/merge, generated types khớp, register frozen SHA; owner khác tạo API theo namespace/version này. Spec M3 và generated types đã được chuẩn bị trong phiên bàn giao contract; review/merge SHA và runtime gate vẫn chưa hoàn tất.

## 7. Chốt temporal confirmation: ít nhất 3 frame trong 5 giây

### 7.1. Quy tắc chính xác

- Tracker theo `(cameraSlug, sourceSessionId)`; không yêu cầu person/track/zone. Một frame qualifying khi có ít nhất một bbox fire hoặc smoke có score **>= T_fire** sau preprocessing/NMS đúng modelVersion.
- Mỗi frame mới hợp lệ chỉ cộng 1, dù có nhiều fire/smoke boxes. `fire, smoke, fire` ở ba frame liên tiếp vẫn là cùng tín hiệu nguy cơ camera; không đòi cùng class hoặc IoU box qua frame ngoài AC. Ghi rõ đây là xác nhận nguy cơ theo camera, không tracking một đám lửa cụ thể.
- Frame âm tính hoặc mọi score <T_fire **reset ngay** counter/firstQualifiedAt. Không majority vote 3/5, không cộng dồn `positive,negative,positive,positive` thành 3 consecutive.
- Capture timestamp tăng nghiêm ngặt; unique frameId, độ tươi và session đúng. Duplicate không tăng count, out-of-order không đảo state, replay không kéo dài evidence.
- Với chuỗi đầu vào sample 5 fps, **gap giữa hai frame qualifying <=1 giây** baseline; lớn hơn là thiếu dữ liệu, reset chuỗi. Default window 5 giây là giới hạn tối đa từ frame đầu tới frame xác nhận, không phải bắt buộc chờ 5 giây.
- Confirm ngay frame thứ 3 khi `count>=3 && last-first<=5s` và từng gap hợp lệ. Exactly 5s thuộc window; 5,001s không. Nếu first frame ra ngoài cửa sổ, prune và giữ suffix mới nhất vẫn liên tiếp/gap hợp lệ, chỉ confirm khi suffix có đủ 3; không kết luận cả chuỗi quá cũ.
- Model error, decode failure, no transport, queue gap, source reset hoặc model/config thay đổi làm mất continuity; cleanup không tự confirm theo clock. Với camera silence phải expire counter kể cả không nhận request mới.
- Không đặt điều kiện ở trong REST_AREA hoặc có người để suppress cháy/khói. Camera bị disabled chặn admission/persistence theo trạng thái hiện tại.

### 7.2. Episode và chống notification spam

State nội bộ: IDLE → CANDIDATE → CONFIRMED. Không đủ positive/negative/reset đưa candidate về IDLE; chỉ log/metrics. CONFIRMED latch một episode/camera để chuỗi positive dài không tạo event mỗi 3 frame.

- Giữ episode khi vẫn có qualifying signal; không tạo episode mới chỉ vì restart worker HTTP hoặc đổi model trong cùng incident đang mở.
- Re-arm sau **10 giây negative hợp lệ được quan sát liên tục**, gap vẫn hợp lệ; camera offline/model error không chứng minh lửa đã hết. `FIRE_CLEAR_SECONDS` cấu hình được, không lấy 5-second window làm clear threshold.
- Camera có một episode đang open persist trong DB; sau restart AI cần 3 frame mới để kết luận lại nhưng orchestrator gắn xác nhận vào episode DB đang active, không tạo incident trùng. Positive mới được ghi evidence/log, không reset deadline/notification của incident cũ.
- Người dùng resolve/close incident không đồng nghĩa detector đã thấy clear. Khi signal vẫn positive, giữ latch tới clear; nếu source đã mất state mà DB chưa có observed clear, không re-arm từ timeout đơn thuần.
- Sau observed clear, đóng trạng thái detector episode (khác với event resolved/closed), lần positive sequence mới tạo episode/incident mới. Timestamp/session/rule/model snapshots và CAS/row lock bảo vệ race giữa clear/new-confirm.
- Clear evaluator trong orchestrator kiểm tra các response negative hợp lệ bằng identity/timestamp/threshold snapshot, đếm riêng 10 giây negative liên tục và persist observedClearAt trong transaction khóa active episode. Không suy ra clear chỉ từ confirmed=false, response lỗi hoặc việc AI trả episodeId=null. Restart evaluator reset khoảng negative chưa được persist và phải quan sát đủ khoảng mới.
- AI restart xóa candidate chưa xác nhận; không phục hồi số frame bằng wall clock. Episode đã persist/pending delivery phục hồi từ DB; reset AI không xóa notification/deadline.

## 8. Frame pipeline, inference và incident E2E

### 8.1. Frame toàn camera độc lập với M2a

Nguồn M3 phải chứa cháy ngay cả khi **không có person**. Không gọi crop của face worker, không chỉ subscribe frigate/events có person, không dùng event snapshot lưu một ảnh lặp qua ba request.

- Dùng bridge Frigate 0.18 lấy copy đúng shared-memory frame/timestamp như thiết kế M2a. Publisher M3 riêng qua `frigate/camerai/fire/frames`, `MQTT_TOPIC_FIRE_FRAMES`, QoS0/retain=false; feature flag `FRIGATE_FIRE_FRAMES_ENABLED` độc lập với M2a.
- Reuse binary envelope v1: 4-byte big-endian header length, UTF-8 JSON header, JPEG bytes. Header M3 gồm schemaVersion/sourceSessionId/frameId/cameraSlug/frameTimestamp/frameWidth/frameHeight; không bắt buộc objects/person.
- JPEG encode có thể dùng helper chung đã merge của M2a, nhưng publish/sampling/flag độc lập. Một owner patch bridge/wiring; không đổi format metadata live hoặc topic pose ở PR M3.
- Sample tối đa 5 fps/camera, kể cả frame negative; không phát chỉ lúc detector Frigate thấy motion/person vì sẽ mất negative reset/clear evidence. Giới hạn payload 1MiB/header32KiB/pixels2073600, freshness1s/future0,5s baseline.
- Bounded queue tối đa 2 frame/camera, ưu tiên frame mới, một request đang chạy/camera và concurrency global cấu hình. Drop/overload có metric và làm reset continuity nếu gap vượt ngưỡng, không giả frame.
- M3 có pool/semaphore riêng, không chờ M1/pose inference hoặc download snapshot; model compute chạy worker thread bounded, không block async event loop. CPU/thread budget phải test chung ba module.
- Không lưu frame tạm toàn bộ vào DB/log. Khi confirmed lưu ảnh đúng confirmationFrame vào storage qua media port hiện có, clip phù hợp từ luồng media/camera; không gán clip người không liên quan.

Spike xác minh shared-memory/frame layout trên đúng tag trước feature, test bridge giữ nguyên handle ownership (không unlink frame Frigate), image/identity khớp và không làm chậm metadata/live player. Nếu chưa lấy đúng ảnh thì không nghiệm thu temporal bằng mock.

### 8.2. Confidence và priority

`thresholdUsed=T_fire` là threshold detector được chọn ở G2, không phải tLow/tHigh của escalation. Để trả detections có cả signal yếu phục vụ debug, output floor có thể thấp hơn T_fire (baseline 0,10), nhưng counter chỉ dùng score >=T_fire.

Chốt `fire-temporal-min-v1`: mỗi qualifying frame lấy max score của các boxes fire/smoke; **incidentConfidence là minimum của các score frame trong chuỗi dùng xác nhận**. Không dùng max một frame đơn lẻ hoặc score M2a=1. `maxConfidence` vẫn chỉ tóm tắt current frame. Lưu policyVersion/evidence để không nhầm YOLO score là probability đã hiệu chuẩn.

Rule FIRE hiện có mặc định P0, skipLoggedOnly=true, tWaitSeconds=30. Dùng rule đã lưu, không bypass temporal gate dù escalation skip confidence. Tạo incident ở confirmedAt để 30-second deadline không bắt đầu từ frame candidate cũ. Khi quản trị tắt rule, incident vẫn được ghi đúng chính sách nhưng không tự gửi thông báo trái cấu hình.

US-18 không triển khai lại tất cả kênh/ưu tiên scheduler US-19. Phải kiểm tra P0 label/rule qua flow thật; báo rõ nếu global notification backlog còn FIFO. Không đưa kết quả M3 vào queue inference thấp hơn làm chậm AC18-2. Nếu scope được mở để sửa P0 queue order, PR nhỏ dùng priority thật của event, giữ ordering/idempotency/rate limit/confirmation M1/M2a/M4 và bổ sung regression.

### 8.3. DB transaction và pending results

Migration mới tạo `fire_incidents` lưu camera/active episode identity, firstQualifiedAt/confirmedAt/observedClearAt, eventId, pending AI result payload/resultId bất biến, status/lease/retry/timestamps và model/rule snapshots. Unique episode key; invariant tối đa một detector episode active/camera, độc lập sourceSession thay đổi. Append migration sau rebase, không sửa migrations cũ hoặc lấy số next từ trí nhớ.

Transaction xác nhận khóa camera/active episode, recheck camera enabled, tạo event mới với source AI_SERVICE/trackId=null, type FIRE_SMOKE_DETECTED/P0, detectedAt=confirmedAt và pending result cùng commit. Nếu active episode tồn tại thì reuse incident/latch, không tạo P0 mới. DB lookup lỗi không tự đoán incident chưa có.

Delivery worker claim bằng lease/SKIP LOCKED, submit cùng AiResultsService, receipt ACCEPTED/DUPLICATE thì mark applied. Crash sau submit trước mark retry cùng resultId/hash. Reuse outbox event.updated/escalation; không gọi Telegram trực tiếp hoặc dispatch trước commit.

Media/storage lỗi không xóa incident hoặc làm notification retry thành incident mới. Ghi state media unavailable/retry bằng cơ chế hiện có. Frame model error/negative/candidate không tạo FIRE event hay AI_FAILED cho event M1/M2a/M4 không liên quan.

### 8.4. UI và bàn giao E2E

Event list/filter/detail/SSE hiện có hiển thị “Phát hiện lửa/khói”, P0 đỏ kèm chữ/icon, camera, thời gian, boxes/labels/score nếu phù hợp, số frame và cửa sổ xác nhận. Không hiển thị thông số train/CUDA/ONNX trong luồng sử dụng bình thường.

Tái sử dụng apiFetch và generated contracts, loading/empty/error states, mobile360px, ảnh media lỗi/hết hạn và xác nhận IM_OK/NEED_HELP hiện có. Không tạo dashboard riêng hoặc bỏ auth/owner scope để gọi inference từ browser.

## 9. Cấu hình và observability

| Biến                                                         | Baseline / nguồn          | Ý nghĩa                                                                  |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `M3_ENABLED`                                                 | false                     | Kill switch admission/inference/incident mới                             |
| `FRIGATE_FIRE_FRAMES_ENABLED`                                | false                     | Bật ảnh M3 độc lập với pose/person                                       |
| `FIRE_MODEL_PATH`, `FIRE_MODEL_VERSION`, `FIRE_MODEL_SHA256` | Artifact G2               | Load read-only, verify checksum/class map                                |
| `FIRE_CONFIDENCE_THRESHOLD`                                  | 0,50 rồi chốt calibration | T_fire; qualifying score >= threshold                                    |
| `FIRE_OUTPUT_CONFIDENCE_FLOOR`                               | 0,10                      | Output bbox floor, không dùng thay T_fire                                |
| `FIRE_NMS_IOU_THRESHOLD`                                     | 0,45                      | Class-aware NMS                                                          |
| `FIRE_MIN_CONSECUTIVE_FRAMES`                                | 3                         | Số frame, không số detection                                             |
| `FIRE_CONFIRMATION_WINDOW_SECONDS`                           | 5                         | Inclusive max capture-time span                                          |
| `FIRE_MAX_FRAME_GAP_SECONDS`                                 | 1                         | Gap liên tiếp hợp lệ                                                     |
| `FIRE_CLEAR_SECONDS`                                         | 10                        | Negative observed continuity để re-arm                                   |
| `FIRE_SAMPLE_FPS`                                            | 5                         | Target sample per camera                                                 |
| `FIRE_MAX_CONCURRENT_REQUESTS`                               | 1                         | Budget M3 riêng ban đầu, benchmark để chốt camera capacity               |
| `FIRE_MAX_CAMERAS`                                           | 16                        | Bound tracker memory, không coi là chứng minh hỗ trợ 16 camera inference |
| `FIRE_MAX_IMAGE_BYTES`, `FIRE_MAX_IMAGE_PIXELS`              | 1048576 / 2073600         | Transport/decode limit                                                   |
| `FIRE_REQUEST_TIMEOUT_MS`                                    | 2000                      | Timeout làm mất continuity, không confirmation                           |
| `FIRE_STATE_SWEEP_INTERVAL_MS`                               | 250                       | Expire counters khi camera silence                                       |

Mọi biến thêm `.env.example`, Compose và config validation cùng PR implementation. ConfigService/Settings, tên có đơn vị; outputFloor<=T_fire, threshold/IoU thuộc range, FPS/window/gap hợp lệ. Đổi model/threshold giữa run reset candidate, giữ incident/latch DB, không nối evidence hai phiên bản.

Log transition/error bằng English, correlationId/camera/episode/modelVersion; không log ảnh/vector/token/RTSP URL hoặc info mỗi frame. Metrics: inference latency, frame freshness/drop, candidate/reset/confirmed, active incident, model unavailable, pending retry, duplicate suppressed. M3 model load failure degraded riêng; health/auth/face/pose vẫn responsive. Shared health field mới nếu cần phải đăng ký qua contract chung trước, không tự đổi health schema.

## 10. Các bước triển khai và PR theo một owner

| Bước | Đầu ra                                                          | Gate/phụ thuộc                |
| ---- | --------------------------------------------------------------- | ----------------------------- |
| 0    | Baseline regression, hardware/data/source/frame spike           | G0                            |
| 1    | Shared runtime lock + isolated training locks/manifest          | G1, phối hợp M2a              |
| 2    | Dataset audit/split/config, smoke train, full train             | Dependency và dữ liệu hợp lệ  |
| 3    | Calibration, video evaluation, ONNX parity/checksum/model card  | G2; chưa code feature         |
| 4    | Hai spec/examples/Fire metadata/generated types/register        | G3; merge trước caller/callee |
| 5    | Camera frame publisher/worker và ONNX detector/temporal tracker | G4; flags off                 |
| 6    | Incident/active episode/pending delivery/media/escalation       | G4; không phá event cũ        |
| 7    | UI/SSE/filter/detail/confirmation                               | API/backend đã tích hợp       |
| 8    | E2E video công khai + regression + metrics/runbook/release      | G5                            |

File dự kiến khi triển khai:

- `training/m3/`: dependency/config/data audit/train/export/evaluation tooling và manifest, không chứa binary/runs được commit.
- AI: `app/routers/fire.py`, `app/models/fire.py`, `app/services/fire_detector.py`, `fire_preprocessing.py`, `fire_postprocessing.py`, `fire_tracker.py`, tests tương ứng.
- AI wiring: config/main/models manifest/Docker lock; không sửa thuật toán face/pose.
- Backend: `apps/orchestrator/src/fire-detection/` module, inference port/HTTP adapter, frame worker/coordinator, incident repository/service, pending delivery/clear evaluator.
- Shared ingest/bridge/Compose/ports patch tối thiểu, một owner tích hợp; không block MQTT callback bằng inference.
- DB migration mới, ERD; UI event components/mapping/filter với contracts sinh tự động.
- Docs: `TRAIN_US-18_YOLO_FIRE_SMOKE.md`, `TEST_US-18_FIRE_SMOKE.md`, `RUNBOOK_M3_FIRE_SMOKE.md`, metrics/model/dataset manifest; cập nhật docs index khi thực thi.

Không tạo file rỗng chỉ để đủ danh sách; cấu trúc theo trách nhiệm. Chia PR cùng owner sao cho nhánh sống dưới 3 ngày, main chạy được; training report/config và artifact readiness trước feature. Không yêu cầu reviewer dùng GPU train lại toàn bộ 100 epochs chỉ để review contract.

## 11. Coding convention và Git workflow

- TS: Controller→Service→Repository; outbound interface/adapter; không any/console.log/cast để lách lỗi; validation DTO, không handwrite FE API types.
- Python: type hints public, Pydantic models camelCase aliases đúng spec, get_settings(), logging và specific exceptions; không dict response thô/bare except.
- Config có tên/đơn vị, không magic number, secret không default rỗng để bypass auth. Không commit .env hoặc credential GPU/storage/camera.
- SQL tham số hóa, projection rõ, migration append-only; core coverage >=60%, test domain/state/dedup/threshold/retry thay vì passthrough getters.
- Function nhỏ, tách inference/geometry/temporal/persistence; comment/docstring/code English và FR, UI tiếng Việt. Plan tiếng Việt theo yêu cầu bàn giao.
- Working tree hiện có thay đổi contract M2a và file ngoài phạm vi: giữ nguyên, không stage toàn bộ, không restore/clean/reset DB.
- Branch theo GIT_WORKFLOW: `feat/US-18-fire-smoke`, `chore/sprint3-m3-dependencies`, `docs/sprint3-fire-training`; không đổi convention của repo.
- Commit English, scope hợp lệ: `feat(ai): add fire smoke onnx inference`, `feat(orchestrator): persist confirmed fire incidents`, `test(ai): verify consecutive fire frame evidence`, `docs(docs): document fire model training`.
- Rebase main hằng ngày, không push main, không --no-verify. Conflict lock regenerate theo owner/baseline, không sửa lock bằng tay; conflict schema phối hợp contributor, không bỏ patch Fall.
- PR đầy đủ template/US-18/5SP/sprint và issue thật, CI/checks xanh, ảnh UI và logs/metrics video. API cần A+B approve, các PR tối thiểu một người khác approve; CODEOWNERS placeholder phải được thay bằng reviewer thật trong PR assignment.
- Tác giả không tự merge, reviewer squash sau nghiệm thu; artifact/dataset/runs không đưa Git thường. Một người E2E vẫn giữ review độc lập theo Git workflow.

## 12. Test matrix, hồi quy và nghiệm thu video thật

### 12.1. Test bắt buộc

| Nhóm            | Trường hợp                                                          | Kết quả                                              |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Model           | COCO weight chưa fine-tune/sai class names/checksum                 | Không được bật feature; model degraded rõ            |
| Data            | Class ID đảo, label thiếu, image corrupted, scene leakage           | Audit fail, không train/release sai nhãn             |
| Preprocess      | 16:9/4:3/portrait/letterbox/edge box                                | Transform về ảnh gốc đúng, bbox hữu hạn/normalized   |
| Export          | PT vs ONNX, negative/smoke/fire                                     | Parity/NMS decisions đạt tiêu chí G2                 |
| Output          | Multiple boxes, class ngoài map, max_det limit                      | Chỉ fire/smoke; không tăng frame count theo số box   |
| Threshold       | T_fire-epsilon / exactly T_fire / trên ngưỡng                       | Exactly/bên trên qualifying; bên dưới không          |
| Temporal        | 1 hoặc 2 positive rồi negative                                      | Không incident, counter reset                        |
| Temporal        | 3 unique positive consecutive trong window                          | Một incident P0 tại frame xác nhận                   |
| Temporal        | Positive/negative/positive/positive                                 | Không count thành 3                                  |
| Temporal        | Fire/smoke/fire consecutive; camera không có person                 | Confirm theo camera hazard, không bị person filter   |
| Temporal        | Timestamps duplicate/out-of-order; >5s span; >1s gap                | Không false confirm; suffix/count/reset đúng quy tắc |
| Window          | Exactly5s inclusive, 5.001s exclusive qua fixture config gap hợp lệ | Đúng boundary, không conflating max gap và window    |
| Failure         | Decode/model/timeout/transport silence                              | error/counter reset; no confirmation by timer        |
| Lifecycle       | Model/config/session đổi; AI restart candidate                      | Fresh evidence, không cộng counter cũ                |
| Latch           | Positive lâu, duplicate confirm, process restart                    | Một active incident; không spam mỗi 3 frame          |
| Clear           | 10s negative liên tục; negative bị gap; camera offline              | Chỉ observed clear mới re-arm                        |
| Zone            | REST_AREA/restricted/không zone                                     | M3 không bị suppress do vùng nghỉ                    |
| Auth            | Token sai/oversize/malformed/camera disabled                        | 401/413/422 hoặc admission reject đúng contract      |
| Persistence     | Crash trước commit, sau commit, sau submit trước mark               | Không orphan work hoặc event/notification trùng      |
| Integration     | MQTT image→AI→DB→receipt/outbox→notification→SSE                    | Camera/evidence/score/P0 đúng, ảnh đúng frame        |
| Media           | Storage/clip lỗi, presigned URL hết hạn                             | Incident còn, retry/lỗi media đúng, UI có trạng thái |
| Existing events | Cùng camera đã có M1/M2a/M4 NOTIFIED hoặc terminal                  | Incident FIRE riêng, state/deadline cũ không bị đổi  |
| UI              | Filter/detail/SSE/mobile/IM_OK/NEED_HELP                            | Cập nhật không F5, auth/confirmation giữ hành vi     |

Unit temporal dùng fake clock và synthetic **numeric detection metadata**, không tự tạo video lửa hoặc dùng metadata mock để claim model/E2E đạt. Integration model dùng frame trích từ video công khai; E2E dùng nguyên clip công khai qua RTSP/Frigate thật.

### 12.2. E2E clips và số đo

Manifest clip holdout có raw file/checksum/FPS/PTS/duration và ground truth incident intervals/lớp, để reviewer replay. Ít nhất các nhóm: smoke-only, fire-only, fire+smoke, negative/hard-negative và chuyển cảnh/intermittent signal từ nguồn công khai. Nếu nguồn không có kịch bản, ghi missing coverage thay vì dàn dựng clip nguy hiểm hoặc dùng demo overlay.

Phát **đúng tốc độ gốc** video qua MediaMTX/Frigate theo setup repo; không đổi speed/loop/timestamp mà vẫn tính latency gốc. Khi loop cho load test, generation/clear tách rõ, không biến cuối/đầu clip thành một episode. Video PTS ánh xạ sang capture UTC mới; replay offline không truyền timestamp năm cũ vào live freshness gate.

Nghiệm thu: trước frame thứ 3 chưa alert, tại frame thứ 3 đủ điều kiện có một P0; negative/intermittent không alert; không person vẫn phát hiện; REST_AREA không chặn; clip chạy liên tục không spam; restart/drop reset đúng; notification/SSE/confirmation/media thật hoạt động. Không đặt confidence mock=1 để ép alert rồi báo model đã đạt.

Đo event precision/recall/FAR/TP/FP/FN, thời gian phát hiện/confirm/notification, p50/p95 inference/freshness/queue, CPU/RAM/model load, số camera hỗ trợ khi chạy cùng M1/M2a. Không thay clip/calibration sau thấy test failures rồi báo độc lập. Ghi model/threshold/contract/dependency SHA và mọi giới hạn thiếu dữ liệu.

### 12.3. Hồi quy tính năng cũ

US-01/02 MQTT/dedup/media/live metadata; US-03/04 auth; US-06 event list/filter/SSE; US-09/10 face register/match/collection; US-11 multi-label/receipt/order; US-12 zone CRUD/sync/M4; US-13 escalation/restart/first confirmation; US-14 Telegram retry/callback; US-15 rules/highWait; US-16/17 pose/candidate/grace/rest zones nếu M2a đã triển khai.

Test ba module đồng thời với M3 disabled, enabled, model missing và overload. Model/fire inference lỗi không hạ state M1/M2a/M4 hoặc chiếm event loop làm health/auth mất đáp ứng. Không mặc định toàn hệ thống không regression chỉ vì unit test detector pass.

## 13. Lệnh kiểm tra, release và rollback

Sau dependency/model/contract gates và code implementation:

```powershell
pnpm install --frozen-lockfile
pnpm setup:ai
pnpm api:lint
pnpm contracts:generate
pnpm --filter @cam/contracts build
pnpm --filter @cam/orchestrator test
pnpm --filter @cam/orchestrator test:integration
pnpm --filter @cam/web test
pnpm test:tools
pnpm check:ai
node tools/scripts/py.mjs mypy app
pnpm check:all
docker compose config --quiet
docker compose build ai-service orchestrator web
docker compose --profile cv up -d
docker compose ps
```

Mypy/bridge/model-runtime checks bổ sung CI vì `check:all` hiện không đủ chứng minh M3 artifact chạy thật. Không generate/check bằng bản tool @latest. Test DB dùng database riêng; không db:reset/xóa volumes dữ liệu đang dùng. Startup healthy không thay video E2E/metrics.

Bật feature ở môi trường test/camera nghiệm thu trước; chốt camera capacity theo số đo, không scale Uvicorn workers/replica khi tracker state còn RAM. Training không là bước startup/deploy. Model license/attribution và quyền artifact giữ trong manifest theo nguồn, không tuyên bố export ONNX thay đổi quyền sử dụng weight.

Rollback: `M3_ENABLED=false` dừng admission/incident mới, publisher flag false dừng ảnh M3; pending incident/notification/deadline đã lưu vẫn tiếp tục theo engine hiện có. Khôi phục image/model artifact/lock checksum trước, không pip install vào live container. Schema additive giữ để bảo toàn incident, không drop bảng. Regression M1/M2a/M4/auth/live phải xử lý trước bật lại M3.

## 14. Definition of Done và prompt bàn giao

- [ ] Một người và một AI Agent hoàn thành toàn E2E, review độc lập theo Git workflow.
- [ ] Train/export môi trường riêng, runtime không cài Ultralytics/OpenCV flavor khác đè M2a; locks/hash/version chung đã merge trước feature.
- [ ] Dữ liệu có provenance/split/hash; test chỉ video công khai D-Fire/FireNet, không tự tạo lửa/khói để quay.
- [ ] Model YOLO fine-tune smoke/fire đạt target đã chốt, class map/ONNX parity/CPU metrics/checksum frozen trước feature implementation.
- [ ] Cả hai OpenAPI contract M3 merge trước code, namespace không ghi đè M2a, generated types khớp và change register có SHA.
- [ ] Bbox/label/score đúng ảnh; no-person/REST_AREA vẫn đánh giá M3.
- [ ] Ít nhất 3 frame qualifying liên tiếp trong 5s mới confirm; one-frame/negative/gap/error/duplicate không tạo alarm.
- [ ] FIRE_SMOKE_DETECTED P0 đúng camera/episode, detectedAt=confirmedAt; persistence/delivery crash/retry không trùng.
- [ ] Latch/re-arm bằng observed clear, restart không tạo P0 mới cho cùng incident active.
- [ ] UI/SSE/media/notification/confirmation tích hợp thật, code/log/config đúng convention và hồi quy cũ đạt.
- [ ] Core coverage >=60%, CI/checks/video evidence/metrics/runbook/rollback đầy đủ; không đánh dấu pass khi chưa chạy hoặc thiếu video.

> Triển khai US-18 theo plan này bằng một AI Agent duy nhất. Đọc AGENTS nếu có, CODING_CONVENTION.md/GIT_WORKFLOW.md, giữ mọi thay đổi ngoài phạm vi và baseline test cũ. Chốt shared dependency với M2a, tạo training environment riêng, train fine-tune YOLO11n smoke/fire từ dữ liệu công khai, đánh giá holdout video/export parity và khóa model trước triển khai tính năng. Không tự tạo lửa/khói hoặc quay dữ liệu mới. Chốt cả api/openapi.yaml và api/openapi-ai-service.yaml theo namespace/PR contract trước code, không ghi đè Fall/Face schemas. Triển khai frame toàn camera không cần person, ONNX detector/temporal confirmation, P0 incident/active latch/pending result, media/escalation/UI và E2E video thật. Không auto-install/auto-download model lúc inference, không stage binary/runs hoặc secrets, không spawn subagent, không push main/tự merge PR. Chỉ đánh dấu hoàn thành sau AC/hồi quy/metrics đạt và reviewer hợp lệ nghiệm thu; nếu thiếu dữ liệu/model quality, ghi rõ gap, không bỏ gate hoặc bịa kết quả.

## 15. Nguồn kỹ thuật

- [D-Fire dataset và liên kết surveillance videos](https://github.com/gaia-solutions-on-demand/DFireDataset).
- [FireNET OlafenwaMoses](https://github.com/OlafenwaMoses/FireNET), [FireNet Arpit Jadon](https://github.com/arpit-jadon/FireNet-LightWeight-Network-for-Fire-Detection): phân biệt nguồn, format và video thật.
- [YOLO11](https://docs.ultralytics.com/models/yolo11), [training guide](https://docs.ultralytics.com/modes/train/), [object detection data format](https://docs.ultralytics.com/datasets/detect/), [COCO class list](https://docs.ultralytics.com/datasets/detect/coco/).
- [Ultralytics 8.3.59 metadata](https://pypi.org/pypi/ultralytics/8.3.59/json), [pinned config](https://raw.githubusercontent.com/ultralytics/ultralytics/v8.3.59/ultralytics/cfg/default.yaml), [pinned ONNX exporter](https://raw.githubusercontent.com/ultralytics/ultralytics/v8.3.59/ultralytics/engine/exporter.py).
- [PyTorch version pairs/CPU-CUDA wheels](https://pytorch.org/get-started/previous-versions/), [ONNX 1.17.0](https://pypi.org/pypi/onnx/1.17.0/json), [ONNX Runtime 1.20.1](https://pypi.org/pypi/onnxruntime/1.20.1/json).

Nguồn đối chiếu hỗ trợ lựa chọn kỹ thuật, không thay lock/clean-install test, kiểm chứng class map/labels của archive đã tải hoặc số đo model/E2E thực tế.

## 16. Bàn giao contract và migration

Hai OpenAPI đã được cập nhật theo plan, cùng generated contracts và migration [0014_fire_incidents.sql](../../db/migrations/0014_fire_incidents.sql). [API_CHANGE_REGISTER.md](API_CHANGE_REGISTER.md) reserve operation/schema/migration và local spec hash; [DEPENDENCY_BASELINE.md](DEPENDENCY_BASELINE.md) chốt graph JS, inputs Python và một người tích hợp dependency. Đây là contract/DDL chuẩn bị, chưa implement detector/runtime hoặc apply database. Review/merge, clean install Python/model, PostgreSQL upgrade/concurrency và E2E vẫn là gate bắt buộc.
