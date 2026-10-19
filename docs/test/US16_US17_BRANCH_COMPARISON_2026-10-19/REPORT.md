# So sánh dataset US16/17: feat và fix — 19/10/2026

Đã checkout `feat/US-16-US-17-pose-fall` tại `C:\Users\ADMIN\.codex\worktrees\us16-us17-feat-eval\aws-camera-ai`, commit `549f9c092a3b274aaa8629c9323365b0c0a2d1e6` sau khi fetch origin; tracked source sạch, không sửa implementation để chạy test. Workspace chính giữ các thay đổi chưa commit của `fix/US-16-US-17-pose-fall`. Hai nhánh có cùng HEAD nền nhưng source fix khác do working tree đã sửa; phân biệt bằng source SHA-256 và [snapshot](source-snapshots), không dùng commit nền để coi hai implementation giống nhau.

## Kết quả chính

Cùng cấu hình 3s, recall confirmed theo nhãn clip của feat là **15.28%**, fix **8.33%**, chênh lệch feat−fix **+6.94 điểm phần trăm**. Đây là kết quả operational của pose + rule trên dataset, không phải kết luận model feat tốt hơn: feat gặp lỗi runtime và vẫn có các hành vi không đáp ứng plan về transition/bất động liên tục. Số liệu không thay thế nghiệm thu E2E.

## 1. Điều kiện chung và hai lượt feat

- Cùng **103 clip manifest: 72 fall, 31 non_fall**, tổng 1338.745s; negative 518.842s (~8,65 phút). Model SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`; manifest SHA-256 `a7f68dc90de8cba5e1d80919fabe0464f773e2c10f5ed9904104195a3ffa9d05`.
- Cùng Python 3.11.13, MediaPipe 0.10.32, OpenCV 4.10.0, NumPy 1.26.4 trên Windows; cùng timestamp nguyên bản, bbox annotation, 5 mẫu/giây, reset tracker mỗi clip. Không lặp frame cuối, không kéo dài thời gian, không train/tune.
- **Feat mặc định:** giữ defaults nhánh, gồm >15s, visibility 0.50, angle <45°, gap 1.20s. Dataset không có clip manifest fall còn >15s sau fallEndFrame; không quy toàn bộ việc không confirmed cho model.
- **Feat cùng config 3s:** override settings qua env trong process kiểm thử bằng settings của fix, gồm >3s, visibility 0.60, angle <30°, gap 0.60s. Tất cả key chung được kiểm tra bằng nhau; vẫn giữ nguyên code và tham số riêng `FALL_PRONE_CONSECUTIVE_FRAMES=3` của feat. Config có mặt không bảo đảm code thực thi gate đó.
- **Fix 3s:** sử dụng nguyên kết quả và kiểm tra lại source/hash của [lượt trước](../US16_US17_DATASET_EVAL_2026-10-19/REPORT.md), không thay số liệu cũ. Các lượt không cùng thời điểm/tải CPU nên không dùng timing để kết luận nhánh nhanh hơn.

## 2. Lỗi runtime và chính sách tính metrics

Replay ban đầu của cả hai cấu hình feat dừng vì `UnboundLocalError: motion_score`. Trong `_step_candidate_state`, biến chỉ được gán khi angle < threshold nhưng được dùng ở cuối hàm; candidate có góc nằm giữa threshold và góc recovery 60° gây lỗi. Router của feat không bắt exception này khi gọi tracker, nên request tương ứng sẽ lỗi server.

Giữ nguyên implementation feat. Bộ replay ghi lỗi từng frame, **không tạo prediction giả, không reset hoặc rollback tracker**; frame sau dùng cùng tracker với state đã mutate, như các request tiếp theo sau lỗi server. Metrics operational giữ đủ 103 clip: clip dương khi có ít nhất một response candidate/confirmed thành công; lỗi là abstention, không phải một dự đoán non-fall hợp lệ. Vì thế TN/accuracy operational phải đọc cùng tỷ lệ lỗi. Ngoài ra báo riêng cohort không lỗi chung cho cả ba lượt, tránh âm thầm loại mẫu lỗi hoặc so mẫu số khác nhau.

| Lượt          | Clip có lỗi | Frame lỗi / frame lấy mẫu | Tỷ lệ clip không lỗi |
| ------------- | ----------: | ------------------------: | -------------------: |
| feat-native   |      10/103 |                   38/6717 |               90.29% |
| feat-matched  |      11/103 |                   72/6717 |               89.32% |
| fix-reference |       0/103 |                    0/6717 |              100.00% |

Exception ghi nhận: `{'UnboundLocalError': 110}`. Ví dụ feat matched: `fall/Coffee_room_01_video (5).mp4`, frame 156, t=6.200s, angle=44.45°. Xem [log abort native](feat-native-aborted.txt), [log abort matched](feat-matched-aborted.txt), và `errorFrames` trong JSON đầy đủ. [Hai test bộ replay](harness-tests.txt) xác minh giữ cùng tracker, tiếp tục sau lỗi và không làm mất mẫu số.

## 3. Metrics theo clip — giữ đủ 103 clip

US16: có ít nhất một response CANDIDATE trong clip.

| Metric           | feat mặc định 15s | feat cùng config 3s |  fix 3s |
| ---------------- | ----------------: | ------------------: | ------: |
| TP               |                59 |                  52 |      35 |
| FP               |                 3 |                   2 |       0 |
| FN               |                13 |                  20 |      37 |
| TN               |                28 |                  29 |      31 |
| precision        |            95.16% |              96.30% | 100.00% |
| recall           |            81.94% |              72.22% |  48.61% |
| f1               |            88.06% |              82.54% |  65.42% |
| specificity      |            90.32% |              93.55% | 100.00% |
| accuracy         |            84.47% |              78.64% |  64.08% |
| balancedAccuracy |            86.13% |              82.89% |  74.31% |

US17: có ít nhất một response CONFIRMED trong clip.

| Metric           | feat mặc định 15s | feat cùng config 3s |  fix 3s |
| ---------------- | ----------------: | ------------------: | ------: |
| TP               |                 0 |                  11 |       6 |
| FP               |                 0 |                   0 |       0 |
| FN               |                72 |                  61 |      66 |
| TN               |                31 |                  31 |      31 |
| precision        |               N/A |             100.00% | 100.00% |
| recall           |             0.00% |              15.28% |   8.33% |
| f1               |             0.00% |              26.51% |  15.38% |
| specificity      |           100.00% |             100.00% | 100.00% |
| accuracy         |            30.10% |              40.78% |  35.92% |
| balancedAccuracy |            50.00% |              57.64% |  54.17% |

TP/FN dùng 72 clip fall; FP/TN dùng 31 non_fall. Precision=TP/(TP+FP), recall=TP/(TP+FN), F1=2TP/(2TP+FP+FN), specificity=TN/(TN+FP), balanced accuracy=(recall+specificity)/2. N/A khi mẫu số bằng 0. Đây là **clip-level**, không matching event theo tolerance thời gian; phát hiện trước cú ngã trong clip fall vẫn làm clip dương, vì vậy không diễn giải là event precision.

Trong điều kiện cùng config, feat xác nhận thêm 6 clip fall mà fix không xác nhận; 1 clip fix xác nhận nhưng feat không xác nhận. Chi tiết từng clip và cờ lỗi ở [CSV đối chiếu](clip-comparison.csv).

### Kiểm tra bằng chứng timer trả về

| Lượt          | CONFIRMED có response immobileSeconds ≤ threshold / tổng confirmed |
| ------------- | -----------------------------------------------------------------: |
| feat-native   |                                                                0/0 |
| feat-matched  |                                                              10/11 |
| fix-reference |                                                                0/6 |

Feat matched có 10/11 response đầu tiên của episode CONFIRMED báo `immobileSeconds=3.00` với threshold 3.0, trong khi fix trả 3.2s cho cả 6 episode. Đây là vấn đề bằng chứng tại biên threshold/làm tròn; output 3.00 không thể chứng minh điều kiện nghiêm ngặt >3s. Không tự sửa/loại những output này khỏi bảng metrics raw ở trên, cũng không coi chúng đã đạt nghiệm thu. Chưa audit độc lập toàn bộ chuỗi frame để chứng minh continuity của mọi episode. Xem [bằng chứng từng lần confirmed](confirmation-evidence.csv).

## 4. Cohort không lỗi chung

Cùng **87 clip: 57 fall, 30 non_fall**, bỏ mọi clip có lỗi ở bất kỳ lượt nào. Bảng này chỉ bổ sung; cohort được chọn theo hành vi lỗi nên có selection bias và không thay thế bảng 103 clip.

| Lượt          | TP / FP / FN / TN confirmed | Precision | Recall |     F1 |
| ------------- | --------------------------: | --------: | -----: | -----: |
| feat-native   |             0 / 0 / 57 / 30 |       N/A |  0.00% |  0.00% |
| feat-matched  |            11 / 0 / 46 / 30 |   100.00% | 19.30% | 32.35% |
| fix-reference |             6 / 0 / 51 / 30 |   100.00% | 10.53% | 19.05% |

## 5. Vì sao recall cao hơn chưa đủ để chọn nhánh

| Hành vi                                      | Feat (cả hai config)                                         | Fix                                             |
| -------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Candidate khi không quan sát được cú hạ thấp | Có fallback nằm liên tiếp 3 frame                            | Yêu cầu angle/drop và history                   |
| Chất lượng vai/hông                          | Cho phép một vai và một hông                                 | Đủ cả 4 landmark hữu hạn                        |
| Association                                  | Chưa thực thi IoU dù có setting; fallback toàn ảnh           | Kiểm tra IoU, từ chối assignment mơ hồ          |
| Motion geometry                              | Kích thước suy từ bbox/aspect                                | Kích thước ảnh gốc                              |
| Chuyển động trong candidate                  | Trừ dần timer, có fallback center speed                      | Reset interval khi không đủ bằng chứng bất động |
| Missing/gap/continuation                     | Có thể giữ timer/history; không giữ điều kiện drop đóng băng | Reset continuity, kiểm tra angle và drop        |
| Candidate góc trung gian                     | UnboundLocalError                                            | Không lỗi, reset interval                       |

Các khác biệt là đọc source, không phải kết quả ablation chứng minh riêng từng nguyên nhân. Cùng trọng số model nhưng khác số pose yêu cầu và các gate/luật; không suy là backbone model được cải thiện. Nhãn fall chưa có ground truth bất động liên tục, REST_AREA, che khuất hoặc association đa người; 39/72 clip chỉ có đủ >3s đuôi, không chứng minh bất động. Không báo nhầm trên 31 clip ngắn cũng chưa chứng minh FAR production bằng 0. Không chọn nhánh chỉ dựa recall/accuracy, cũng không tuyên bố fix tốt hơn về recall khi số liệu không ủng hộ.

## 6. Hai video đang debug

Video `Coffee_room_01_video (1).mp4` dùng bbox annotation. `Coffe_room_15s_01.mp4` ngoài manifest được probe riêng không truyền track bbox; scale khác nên không so trực tiếp với video annotation, không cộng vào metrics và không coi bản kéo dài là mẫu độc lập mới.

| Clip                                | Lượt          | Candidate tại giây | Confirmed tại giây | Max immobile | Frame lỗi |
| ----------------------------------- | ------------- | ------------------ | ------------------ | -----------: | --------: |
| `fall/Coffee_room_01_video (1).mp4` | feat-native   | [3.2]              | []                 |       3.000s |         0 |
| `fall/Coffee_room_01_video (1).mp4` | feat-matched  | [3.2]              | [6.2]              |       3.000s |         0 |
| `fall/Coffee_room_01_video (1).mp4` | fix-reference | []                 | []                 |       0.000s |         0 |
| `fall/Coffe_room_15s_01.mp4`        | feat-native   | [2.8]              | []                 |      10.400s |         0 |
| `fall/Coffe_room_15s_01.mp4`        | feat-matched  | [2.8]              | [6.8]              |       3.000s |         0 |
| `fall/Coffe_room_15s_01.mp4`        | fix-reference | []                 | []                 |       0.000s |         0 |

## 7. Evidence và tái lập

- [Metrics CSV](metrics-comparison.csv), [config CSV](configuration-comparison.csv), [CSV từng clip](clip-comparison.csv), [cohort không lỗi](metrics-common-error-free.csv).
- [Lỗi từng frame](frame-errors.csv), [bằng chứng confirmed và biên threshold](confirmation-evidence.csv).
- [Feat native JSON](feat-native.json), [feat matched JSON](feat-matched.json), [fix reference](fix-reference.json), [fix supplementary](fix-supplementary-reference.json).
- [Provenance/import paths](provenance.json), [validation](verification.json), [checksum evidence](evidence-sha256.json), [harness chung](comparison-evaluator.py).
- Cả hai lượt feat dùng cùng evaluator, source production trong checkout feat sạch; weights được truyền bằng path đến model host có checksum chung. Không chuyển code fix vào implementation feat, không khởi động pipeline UI/notification để tạo alert thật.

Để tái lập, đứng trong `services/ai-service` của checkout feat sạch, đặt `PYTHONPATH` tới chính thư mục đó, rồi chạy harness chung bằng Python 3.11 với `--dataset`, `--output`, `--model` là absolute paths và `--sample-fps 5 --supplement-unlisted`. Lượt native bỏ các env `POSE_*`, `FALL_*`, `M2A_ENABLED` để dùng defaults; lượt matched thêm `--configuration` tới settings runtime của fix. Harness chỉ bắt lỗi tracker để ghi abstention, không sửa kết quả thành công hoặc luật nhánh.
