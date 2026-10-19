# US16/17 — Đối chiếu cấu hình và đánh giá dataset, 19/10/2026

Nhánh: `fix/US-16-US-17-pose-fall`. Cấu hình local M2a đã đồng bộ baseline mục 6.2 của [plan](../../sprint-3/PLAN_US-16_US-17_POSE_FALL_E2E.md), các container liên quan đã recreate. **Chưa đạt nghiệm thu toàn bộ plan**: chất lượng nhận diện còn thấp và phép đo offline không thay thế E2E Frigate → AI → incident → UI/notification.

## 1. Kiểm tra và cập nhật cấu hình

Audit đầu phiên thấy `POSE_MIN_VISIBILITY=0.50` thay vì `0.60`; `.env` chỉ có ba biến pose/fall explicit, Compose chưa chuyển toàn bộ bảng tham số vào AI, publisher hard-code 5 FPS. Hiện `.env` có 27 biến liên quan, được chuẩn hóa và bỏ key trùng cùng giá trị. Các cấu hình ngoài phạm vi được giữ nguyên; không đưa token/mật khẩu vào evidence.

| Nhóm                                           | Giá trị runtime đã đối chiếu                                     |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Bật local test                                 | M2A_ENABLED=true; FRIGATE_POSE_FRAMES_ENABLED=true               |
| Model                                          | pose-landmarker-lite-v1; `/app/models/pose_landmarker_lite.task` |
| Visibility / association / ROI padding         | 0.60 / 0.30 / 0.10                                               |
| History                                        | 10 frame trước, tối đa 3s                                        |
| Candidate                                      | angle <30°; center drop ≥0.20                                    |
| Bất động                                       | **>3s**; motion <0.05; gap ≤0.60s                                |
| Missing / recovery / candidate TTL / track TTL | 5s / ≥60° / 60s / 60s                                            |
| Sample / freshness                             | 5 FPS cấu hình; frame stale ≤1s; Frigate object max age 0.25s    |
| Limits                                         | concurrent=2; tracks=128; image bytes=1048576; pixels=2073600    |
| HTTP / sweep                                   | 2000ms / 250ms                                                   |

`POSE_SAMPLE_FPS` được Compose ánh xạ sang `FRIGATE_POSE_MAX_FPS`. `.env.example` giữ hai feature flag mặc định false. Model SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`, khớp manifest. `POSE_MODEL_PATH` trên host và container khác nhau do mount; evaluator dùng model host cùng checksum và toàn bộ settings pose/fall được export từ runtime.

Đã thêm kiểm tra range/quan hệ threshold lúc startup; sửa quality gate yêu cầu đủ 4 vai/hông hữu hạn, torso khác 0; sử dụng IoU để kiểm tra assignment, từ chối nhiều pose cùng khớp, bỏ chọn pose đầu tiên/full-frame fallback không kiểm chứng. MediaPipe tìm tối đa 2 pose để phát hiện mơ hồ; đây chưa phải chứng nhận đa người trong cảnh đông. Continuation phải giữ angle và center drop so với baseline đóng băng ở cả hai quan sát của cặp tính motion. Sửa Dockerfile để chỉ cài lock có hash, bỏ bước `pip install mediapipe` không pin.

Evidence cấu hình: [settings runtime](runtime-after.json), [publisher/orchestrator](pipeline-after.json), [bảng đầy đủ](configuration.csv), [env trước](env-before.json), [env sau](env-after.json). `runtime-before.json` được lấy sau khi mã default visibility đã đổi và trước recreate, **không phải** snapshot của lần quan sát ban đầu 0.50.

## 2. Phương pháp và dữ liệu

Đọc toàn bộ **103 clip manifest: 72 fall, 31 non_fall**, tổng 1338.745s (22.31 phút). Negative: 518.842s = 0.1441 giờ. Tất cả frame được decode, kiểm tra số frame, lấy mẫu 5 FPS theo timestamp video; không kéo dài thời gian hoặc lặp frame cuối. Bbox annotation thay Frigate detector/tracker, mỗi clip reset tracker. Model MediaPipe Lite CPU ở IMAGE mode và rule tracker production; không train/fine-tune hoặc dò ngưỡng trên chính tập này.

Runtime offline: Python 3.11.13, MediaPipe 0.10.32, OpenCV 4.10.0, NumPy 1.26.4; Windows-10-10.0.26200-SP0. Linux Docker được kiểm tra runtime riêng; số đo dataset dưới đây thuộc Windows, không suy là benchmark Linux. Thời gian inference đo trên máy local có các service/build cùng chạy.

Nhãn fall là nhãn video, chưa gán nhãn khoảng bất động/che khuất/REST_AREA. Có **39/72** clip fall còn hơn 3s sau fallEndFrame; đây chỉ là đủ thời lượng đuôi, **không chứng minh** bất động liên tục. Có 4 clip bắt đầu ngã trước 2s, gây khó cho baseline 10 mẫu tại 5 FPS. Toàn bộ tập được dùng làm đánh giá mô tả, không phải holdout độc lập; hai clip người dùng nêu đã được dùng debug trước đó.

## 3. Bảng metrics theo clip

Prediction dương khi clip có ít nhất một episode CANDIDATE/CONFIRMED tương ứng; một clip nhiều episode chỉ đếm một lần. TP/FN dùng 72 clip fall; FP/TN dùng 31 clip non_fall. Không gọi đây là event-level precision/recall vì chưa matching tolerance thời gian với annotation sự kiện.

| Metric               | US16: CANDIDATE | US17: CONFIRMED >3s |
| -------------------- | --------------: | ------------------: |
| TP                   |              35 |                   6 |
| FP                   |               0 |                   0 |
| FN                   |              37 |                  66 |
| TN                   |              31 |                  31 |
| Precision            |         100.00% |             100.00% |
| Recall / sensitivity |          48.61% |               8.33% |
| F1                   |          65.42% |              15.38% |
| Specificity          |         100.00% |             100.00% |
| Accuracy             |          64.08% |              35.92% |
| Balanced accuracy    |          74.31% |              54.17% |

Precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2TP/(2TP+FP+FN), specificity = TN/(TN+FP), balanced accuracy = (recall+specificity)/2. N/A khi mẫu số bằng 0; không thay bằng 100%.

| Chỉ số bổ sung                              |                  Kết quả |
| ------------------------------------------- | -----------------------: |
| Pose hợp lệ / tổng mẫu                      |       4724/6717 = 70.33% |
| Pose hợp lệ / mẫu có bbox annotation hợp lệ |       4724/6410 = 73.70% |
| False alarms CONFIRMED / giờ negative       |                    0.000 |
| Inference p50 / p95                         |         50.61 / 110.65ms |
| Throughput offline                          | 16.77 mẫu/giây wall time |
| CONFIRMED trong cohort có >3s đuôi          |                     6/39 |

Không có false alarm trên lượng negative ngắn không chứng minh FAR production bằng 0. Với giả định Poisson và 0 alarm, cận trên một phía 95% là 20,79 alarm/giờ; các clip tương quan cùng scene nên cũng không phải chứng nhận thống kê độc lập. Inference p95/throughput offline không đo publisher FPS thực, queue age, p95 CPU/RAM hay latency notification. `elapsedSeconds` bao gồm cả clip bổ sung; throughput dùng số mẫu manifest chia tổng wall time, chỉ mang tính mô tả. Chưa có ground truth `immobileSinceAt`, không thể công bố latency từ lúc thực sự bất động. Sáu lần confirmed đều có interval bất động nội bộ 3,2s; đây là bằng chứng của rule, không phải nhãn bất động thực tế.

| Scene nguồn    | Fall | Non-fall | Fall có candidate | Fall confirmed | Non-fall confirmed |
| -------------- | ---: | -------: | ----------------: | -------------: | -----------------: |
| Coffee_room_01 |   38 |        0 |                26 |              4 |                  0 |
| Coffee_room_02 |    9 |        8 |                 6 |              2 |                  0 |
| Home_01        |   19 |        0 |                 2 |              0 |                  0 |
| Home_02        |    6 |       23 |                 1 |              0 |                  0 |

Sáu clip có confirmed trong replay annotation (thời gian tính từ đầu video):

| Clip fall                       | Candidate đầu tiên | Confirmed đầu tiên |
| ------------------------------- | -----------------: | -----------------: |
| `Coffee_room_02_video (58).mp4` |               7,8s |              12,4s |
| `Coffee_room_02_video (56).mp4` |              12,6s |              16,6s |
| `Coffee_room_01_video (17).mp4` |               2,0s |               5,8s |
| `Coffee_room_01_video (41).mp4` |              11,2s |              15,0s |
| `Coffee_room_01_video (48).mp4` |              26,4s |              30,8s |
| `Coffee_room_01_video (38).mp4` |              10,0s |              14,0s |

Các lần confirmed đều sau fallEndFrame của annotation. Replay UI có bbox do Frigate cấp có thể cho kết quả khác replay bbox annotation.

## 4. Phân tích bỏ sót và hai clip đang debug

Có **37** clip fall không tạo candidate; **29** clip có candidate nhưng không confirmed. Chỉ thêm thời gian video hoặc giảm 15s xuống 3s không giải quyết trường hợp chưa qua quality/history/angle/drop. Với candidate, thiếu pose, chuyển động, posture hoặc drop không còn abnormal đều reset khoảng bất động theo plan.

Các reason theo mẫu (có thể xuất hiện nhiều loại trong cùng clip, không phải nguyên nhân độc quyền của FN): NORMAL_POSTURE=2569, HISTORY_INSUFFICIENT=1552, POSE_ASSOCIATION_FAILED=873, NO_POSE=678, FALL_CANDIDATE=591, NO_ANNOTATED_PERSON=307, LOW_VISIBILITY=133, IMMOBILE_CONFIRMED=12, AMBIGUOUS_POSE=2.

`Coffee_room_01_video (1).mp4`: 24/32 mẫu có pose hợp lệ; 0 candidate, 0 confirmed; max immobile 0.000s, max center drop được report 0.0041. Xem reason từng clip trong CSV/JSON để tránh coi immobile=0 là model chưa load.

Clip ngoài manifest được chạy riêng qua nhánh legacy **không truyền track bbox**, yêu cầu một pose không mơ hồ: [kết quả bổ sung](supplementary-results.json), [log](supplementary-run.txt). Có 126/130 mẫu pose hợp lệ, max center drop 0,1330 <0,20; không có candidate, max immobile=0. Không có annotation bbox/fall interval và không dùng vào bảng metrics; scale là chiều cao toàn ảnh nên không so trực tiếp với replay bbox người. Nếu là bản kéo dài từ clip cũ thì không được coi là một mẫu độc lập bổ sung.

JSON của lượt manifest giữ nguyên probe ban đầu truyền bbox bằng cả ảnh; probe đó bị IoU từ chối ở 126 mẫu vì cả ảnh không đại diện bbox người. **Không dùng probe ban đầu để đánh giá chất lượng clip bổ sung.** Evaluator hiện đã đổi nhánh video không annotation sang không truyền bbox; thay đổi này không ảnh hưởng 103 clip có annotation. [Snapshot evaluator của lượt manifest](evaluator-manifest-run.py) khớp source SHA-256 trong JSON gốc; lượt bổ sung có source SHA-256 riêng. Các source production/model/settings giống nhau giữa hai lượt.

| Clip bổ sung                 | Thời lượng | Candidate | Confirmed | Max immobile |
| ---------------------------- | ---------: | --------: | --------: | -----------: |
| `fall/Coffe_room_15s_01.mp4` |    25.933s |         0 |         0 |       0.000s |

## 5. Đánh giá và phần còn thiếu

Cấu hình baseline đã đúng nhưng **chưa đủ chất lượng để nghiệm thu nhận diện té ngã thực tế**. Recall candidate phản ánh cả khả năng MediaPipe lấy pose và quy tắc angle/drop/history; recall confirmed còn chịu điều kiện bất động chưa có nhãn đầy đủ. Không dùng accuracy tổng hoặc việc không báo nhầm để che tỷ lệ bỏ sót. Không so trực tiếp với các report cũ do gate visibility/association/continuation đã khác.

Bước tiếp theo cần gán nhãn pre-fall, thời điểm ngừng chuyển động, che khuất và đứng dậy; tách calibration/holdout theo scene/người/video gốc để tránh leak bản kéo dài; sau đó mới đánh giá lựa chọn model/rule trên holdout. Cần replay live qua Frigate để đo assignment thật, sample FPS/queue age và E2E incident/P1/SSE/UI/notification với recipient đã xác minh. Các testcase acceptance đang Blocked không được tự chuyển Passed bằng lần đo offline này.

## 6. Evidence và tái lập

- [Kết quả đầy đủ + model/source/video/annotation SHA-256](dataset-results.json).
- [Metrics CSV](metrics.csv), [từng clip CSV](clip-results.csv), [inventory](dataset-inventory.json), [log replay](dataset-run.txt).
- [AI tests](ai-tests.txt): 94 passed, coverage 89.68%; [bridge tests](bridge-tests.txt): 13 passed. Ruff và git diff được kiểm tra trước bàn giao.
- [Build Docker từ lock](docker-build.txt); [runtime cuối](runtime-final.json), [dependency/model smoke Linux](dependency-smoke-linux.txt).

Chạy từ `services/ai-service` bằng Python 3.11 đã cài dev lock:

```powershell
python -m scripts.evaluate_fall_dataset --dataset ../../datasets/Fall_Dataset_Classified --output ../../artifacts/fall-evaluation.json --configuration ../../docs/test/US16_US17_DATASET_EVAL_2026-10-19/runtime-after.json --model models/pose_landmarker_lite.task --sample-fps 5 --supplement-unlisted
```

Giữ nguyên manifest, model và settings có checksum trong report nếu cần tái lập kết quả. Đổi cấu hình hoặc code cần tạo một run/report mới.
