# Sửa lỗi US16 / US17 — 19/10/2026

> Kết quả bên dưới là baseline trước khi đổi ngưỡng (15 giây). Yêu cầu mới ngày 19/10 dùng hơn 3 giây; xem [cập nhật 3 giây](THRESHOLD_3S_UPDATE.md) và evidence `*-3s.*`. Không dùng số đo video cũ để kết luận cho ngưỡng mới.

Nhánh `fix/US-16-US-17-pose-fall`, tạo từ `origin/feat/US-16-US-17-pose-fall` tại `549f9c092a3b274aaa8629c9323365b0c0a2d1e6`. Không merge nhánh US20, không đổi các testcase hoặc lỗi wellness. Các thay đổi có sẵn trong working tree được giữ lại.

## Kết quả

Đã sửa implementation của BUG-M2A-01 đến BUG-M2A-12. Ma trận US16/17 hiện có **20 Passed, 0 Failed, 4 Blocked**. Chưa đủ điều kiện nghiệm thu live hoặc bật mặc định detector. [Testcase](../US16_US17_US20_2026-10-18/TEST_CASES_EXECUTED.md) và [defects](../US16_US17_US20_2026-10-18/DEFECTS.md) giữ kết quả QA cũ trong phần lịch sử, kèm kết quả retest mới.

| Kiểm chứng                                      | Kết quả                                                                           | Bằng chứng                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Toàn bộ unit/module orchestrator                | 375/375 Passed, 50 suites                                                         | [orchestrator-tests.txt](evidence/orchestrator-tests.txt)   |
| Retest pose/fall sau hoàn thiện validation/flag | 48/48 Passed                                                                      | [fall-jest.txt](evidence/fall-jest.txt)                     |
| AI, có cả estimator/model thật                  | 71/71 Passed, coverage 87.85%, không skip                                         | [ai-tests.txt](evidence/ai-tests.txt)                       |
| PostgreSQL16 + MQTT + MinIO                     | 4/4 Passed                                                                        | [runtime-integration.txt](evidence/runtime-integration.txt) |
| Bridge                                          | 11/11 Passed                                                                      | [bridge-tests.txt](evidence/bridge-tests.txt)               |
| Nguồn ảnh SHM trong Frigate 0.18                | Passed trên buffer tổng hợp riêng cho QA                                          | [frigate-shm-smoke.txt](evidence/frigate-shm-smoke.txt)     |
| Model/dependency checksum và CPU inference      | Passed, ảnh trống                                                                 | [model-smoke.txt](evidence/model-smoke.txt)                 |
| Tooling hồi quy                                 | 109/109 Passed                                                                    | [tools-tests.txt](evidence/tools-tests.txt)                 |
| TypeScript                                      | Passed                                                                            | [typecheck.txt](evidence/typecheck.txt)                     |
| Ruff                                            | Passed                                                                            | [ruff.txt](evidence/ruff.txt)                               |
| ESLint phạm vi thay đổi                         | Không có error; còn warning về độ dài/độ phức tạp và return type test             | [eslint.txt](evidence/eslint.txt)                           |
| Compose và whitespace                           | `docker compose config --quiet`, `git diff --check` Passed                        | Kiểm tra tại workspace                                      |
| Mypy toàn AI                                    | Chưa đạt: 9 lỗi alias Pydantic tại 3 file face không thay đổi; không còn lỗi pose | [mypy.txt](evidence/mypy.txt)                               |

Integration positive dùng **HTTP inference response tổng hợp**, không dùng model để tạo CONFIRMED. Các thành phần MQTT, adapter HTTP, REST repository, PostgreSQL, AI receipt/outbox, escalation, SSE emitter và MinIO đều chạy thật. Test xác minh event `FALL_DETECTED/P1/NOTIFIED`, một notification intent, một receipt, snapshot download và URL ký có thể đọc được. Không có Telegram delivery hay browser visual test trong lượt này.

## Các thay đổi

- BUG-01/02: default góc `<30°`, gap hợp lệ tối đa `0.6s`, hủy missing tại `>=5s`; sweep chạy theo vòng đời FastAPI ngay cả khi không có request mới.
- BUG-03/04: mất pose, gap, chuyển động hoặc hết tư thế ngang đều reset khoảng bất động; không cộng thời gian mù hoặc giảm dần timer cũ. Frame trùng/timestamp không tăng bị loại trước mọi mutation; tracker có khóa để đồng bộ với sweeper. Motion tính trên kích thước ảnh gốc. Không làm tròn ngưỡng drop lên 0.20; giữ độ chính xác timer ở biên 15.001s.
- BUG-05: bỏ persistent-prone fallback; phải quan sát lowering transition. History quá cũ không được dùng làm baseline.
- BUG-06/07: kiểm schema v1, bbox hữu hạn/đúng bounds, kích thước và JPEG; freshness mặc định 1s, chặn tương lai quá 0.5s.
- BUG-08: kiểm identity camera/session/track/frame, timestamp, UUID episode, thứ tự thời gian, confidence và điều kiện confirmed tại adapter lẫn coordinator. Không sinh episode hoặc thời gian xác nhận thay thế cho dữ liệu thiếu.
- BUG-09: REST lookup lỗi được truyền lên và chặn xử lý track; không coi DB lỗi là ngoài vùng nghỉ.
- BUG-10: lưu nguyên DTO callback với eventId/resultId trong transaction. Replay pending gửi nguyên payload đã lưu; APPLIED được bỏ qua. Worker chạy độc lập với admission flag, claim bằng `SKIP LOCKED`, lease 30s, retry sau 5s và thu hồi lease hết hạn. Chỉ ACCEPTED/DUPLICATE mới markApplied. Advisory transaction lock bảo vệ cả lần insert đầu khi chưa có row để khóa.
- BUG-11/12: stationary vẫn phải có detection time hợp lệ. Ảnh lấy từ **đúng frame_name trong detection/video**, copy trước khi đóng tham chiếu SHM; không thay thế bằng ảnh mới khi buffer đã mất. JPEG encode/MQTT publish chạy trên worker với queue tối đa hai frame, bỏ frame cũ khi quá tải. Header dùng kích thước thật, bbox Frigate xyxy được chuyển đúng, session ngẫu nhiên mỗi lần bridge khởi động, QoS0 và không retain. Không còn HTTP latest.jpg trong production path.
- Endpoint pose chạy trong worker pool của FastAPI với admission có giới hạn, không thực hiện MediaPipe ngay trong async event loop. Feature flag mặc định off tại Python, consumer, Compose và `.env.example`.

Không đổi OpenAPI, generated contracts, dependency lock hoặc migration. Tận dụng schema và lease columns của migration 0013.

## Dataset thực tế

Đã kiểm kê và replay toàn bộ `datasets/Fall_Dataset_Classified`: **103 video**, **72 fall**, **31 non_fall**, tổng thời lượng khoảng **1.338,745 giây**. Mỗi video và annotation có SHA256 trong [inventory](evidence/dataset-inventory.json) và [evaluation](evidence/dataset-evaluation.json).

Replay ở 5 mẫu/giây, giữ nguyên FPS/timestamp video, dùng model lite đã pin và bounding box annotation của người trong clip. Không lặp frame cuối, không đổi nhãn, không kéo dài thời gian và không tuning threshold theo kết quả. Ground-truth box thay cho Frigate detector/tracker trong phép đo offline này.

Kết quả: candidate xuất hiện ở **33/72** clip fall, **0/31** clip non_fall; không clip nào được CONFIRMED. **0/72** clip fall còn hơn 15 giây sau fallEndFrame. Nhãn fall không đồng nghĩa clip chứng minh được điều kiện bất động liên tục hơn 15 giây. Các con số clipTP/FP/FN/TN trong JSON chỉ là so sánh output confirmed với nhãn clip, không phải event-level accuracy được nghiệm thu. Kết quả candidate cũng chưa được đối chiếu tolerance thời gian với fallStartFrame để gọi là event-level recall.

P95 inference và thời gian chạy đo thực có trong JSON; đây là latency offline của estimator, không phải queue/network/notification latency. Chưa có ground truth REST polygon, multi-person identity hay interval occlusion. Chất lượng candidate 33/72 còn cần đánh giá trên bộ nghiệm thu độc lập; không bật production từ số đo này.

## Bốn testcase còn Blocked

| Testcase     | Đã chứng minh                                                                               | Phần còn thiếu                                                                              |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| US-16-TC-011 | SHM→JPEG đúng timestamp trong container; real MQTT và HTTP adapter                          | Replay MediaMTX→Frigate→model thật xuyên suốt với camera/video đã định cấu hình             |
| US-16-TC-012 | Replay model thật đủ 103 clip, checksum, timestamp nguyên bản                               | Clip có >15s tail và ground truth immobility/occlusion/multi-person; association từ Frigate |
| US-17-TC-010 | Real DB/receipt/outbox/NOTIFIED/notification intent/SSE emitter/MinIO với scripted positive | Confirmed thực từ model/camera qua cùng pipeline; quan sát delivery ngoài ứng dụng          |
| US-17-TC-011 | Timer/recovery/REST unit, pipeline và ảnh storage tích hợp                                  | UI thực, video đủ điều kiện, Telegram test recipient và callback được phép                  |

US-17-TC-008 được chuyển từ Blocked sang Passed **ở cấp storage integration** nhờ MinIO và DB thật. Phần visual UI vẫn thuộc TC-011. Không gửi tin Telegram thật để thay bằng chứng acceptance.

## Chạy lại

Tại repository root, dùng Python runtime đã cài extras m2a và đúng model manifest; ví dụ runtime hiện có của workspace:

```powershell
$env:PYTHONPATH = 'services/ai-service'
& artifacts/ai-gate-windows/Scripts/python.exe services/ai-service/scripts/evaluate_fall_dataset.py --dataset datasets/Fall_Dataset_Classified --model artifacts/gate-models/pose_landmarker_lite.task --output artifacts/fall-dataset-report.json
& artifacts/ai-gate-windows/Scripts/python.exe -m unittest discover -s infra/frigate/frame-metadata -p test_bridge.py
```

Trong `services/ai-service`, đặt `POSE_MODEL_PATH` là đường dẫn tuyệt đối tới model đã pin rồi chạy `python -m pytest`. Trong `apps/orchestrator`, chạy `node node_modules/jest/bin/jest.js --runInBand --no-cache --cacheDirectory=../../artifacts/jest-fall`; integration riêng: thêm `--testRegex='fall-runtime.integration.spec.ts$'`. Integration tạo và dọn các container kiểm thử riêng, không dùng database hiện có.

## Vận hành và giới hạn

Chỉ bật `M2A_ENABLED=true` và `FRIGATE_POSE_FRAMES_ENABLED=true` sau nghiệm thu môi trường. Giữ detect width/height đúng config camera; nếu không xác định shape hoặc buffer mất, bỏ frame và để timer reset. Bridge phải chạy cùng IPC/SHM với Frigate 0.18; service/run đã thêm PYTHONPATH tương ứng. Model phải tồn tại ở `POSE_MODEL_PATH` (Compose hiện mount `services/ai-service/models`), có checksum khớp manifest.

Pending mới chứa full DTO và worker có thể retry sau restart kể cả khi flag admission đã tắt. Các row legacy được tạo bởi bản cũ chỉ lưu cameraSlug/trackId/confidence/ruleSnapshot, thiếu full DTO, **không được tự bổ sung bằng chứng**. Kiểm tra `last_error`, `attempt_count`, `delivery_status` và payload trước rollout; đối soát receipt gốc để có kế hoạch phục hồi riêng. Schema evidence immutable được giữ nguyên. Snapshot upload thất bại vẫn được log, không thay bằng ảnh của một frame sau.

```sql
SELECT id, event_id, result_id, delivery_status, attempt_count, available_at,
       leased_until, last_error, pending_payload ? 'schemaVersion' AS has_full_payload
FROM fall_incidents
WHERE delivery_status <> 'APPLIED'
ORDER BY created_at;
```

Đây là bản sửa để review/retest, chưa phải biên bản nghiệm thu release. Mypy baseline, bốn AC live còn blocked và giới hạn chất lượng model được ghi rõ để không đánh dấu pass từ test double hoặc clip không đủ điều kiện.
