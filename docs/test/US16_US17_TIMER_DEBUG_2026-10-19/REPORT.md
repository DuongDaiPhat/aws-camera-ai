# Debug immobileSeconds bằng 0 — 19/10/2026

Nhánh `fix/US-16-US-17-pose-fall`, threshold bất động vẫn `>3s`.

## Kết luận từ runtime

Log AI của track `1792403518.897033-3pnz89` chủ yếu là `MONITORING / HISTORY_INSUFFICIENT`, poseAvailable=true, góc nằm thường khoảng 6–13°. Timer chưa được khởi động vì chưa tạo được CANDIDATE; đây không phải bằng chứng rằng pose đang CANDIDATE nhưng bộ đếm không tăng.

Đo thụ động MQTT: 51 header pose trong khoảng 19,396s, khoảng 2,58 mẫu/giây. Có nhiều gap khoảng 0,4s và một số gap khoảng 1,4s. Cấu hình target 5 mẫu/giây. [Header trước sửa](mqtt-before.json) không chứa JPEG.

## Hai lỗi đã sửa

1. Bridge so sánh `currentTime-lastPublishedTime >= 0.2` và dời mốc lấy mẫu theo mỗi frame đã chọn. Capture interval thực tế dao động quanh 200ms; frame cách 199ms bị bỏ và frame sau thành 400ms. Sửa bằng lịch deadline giữ phase, cho phép jitter 10% chu kỳ (20ms tại 5Hz), không bắt kịp backlog bằng cách phát lại frame. Capture timestamp gốc được giữ nguyên. Unit jitter trước sửa chỉ nhận 3/6 frame, sau sửa nhận 6/6; nguồn 10Hz vẫn được giới hạn 5 mẫu trong cửa sổ 1s của test.
2. Tracker trước đó xóa toàn bộ history mỗi lần missing pose. Sửa để giữ các quan sát hợp lệ khi một dropout ngắn không vượt gap/age limits. Vẫn cần đủ 10 frame hợp lệ; frame lỗi không được tính vào history. Missing luôn reset immobileSeconds và last_observation. Gap >0,6s và history quá 3s vẫn bị loại, không cộng thời gian mù. Test baseline 10 frame → một missing → drop ở gap 0,4s tái hiện lỗi trước sửa và Passed sau sửa; gap 0,7s vẫn không tạo candidate từ baseline cũ.

Replay bộ lấy mẫu trên 86 timestamp metadata thật có person cho kết quả **51 frame theo thuật toán cũ, 81 theo thuật toán mới**. Đây là mô phỏng trên timestamp thực, không phải số đo live sau triển khai. Các frame thực sự bị mất hoặc gap 1,4s không được bù giả. [So sánh](sampler-comparison.json).

Thêm log debug `[POSE_TRACK]`: frame, capture time, state, reason, history hiện có/required, pose, angle, drop, motion và immobileSeconds. `[POSE_CONTINUITY_RESET]` chỉ rõ gap và ngưỡng. Missing trong MONITORING trả reason missing thay vì giữ NORMAL_POSTURE cũ.

## Replay hai video bằng model thật sau sửa

Không phát MQTT, tạo event hay gửi thông báo khi replay offline. Giữ thời gian video gốc, lấy 5 mẫu/giây. [Trace từng mẫu](video-traces.json).

| Video                        | Phạm vi                                                                | Kết quả                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coffee_room_01_video (1).mp4 | Bbox annotation; 25fps, 6,28s                                          | Chưa có CANDIDATE/CONFIRMED. Đủ 10 pose vào khoảng 2,2s, lúc đó đã nằm. Frame 2,4s thiếu pose; ở 2,6s drop khoảng 0,1703 <0,20. Max drop khi đủ baseline khoảng 0,1703.                                                                                                                        |
| Coffe_room_15s_01.mp4        | Full-frame single-person probe, không phải bbox Frigate; 30fps, 25,93s | Chưa có CANDIDATE/CONFIRMED. Có pose từ khoảng 0,8s; cần 10 frame trước frame hiện tại nên kiểm tra đầy đủ từ khoảng 2,8s. Max drop đo trong probe khi đủ baseline khoảng 0,1330 <0,20. Denominator full-frame khác bbox người thật, không dùng số này để khẳng định giá trị drop của runtime. |

Vì vậy việc kéo dài phần nằm không tự giải quyết được điều kiện tạo candidate. MediaPipe cung cấp landmark; quy tắc M2a còn yêu cầu đủ history và `angle<30`, `centerDropRatio>=0.20` trước khi đếm hơn 3s bất động. Không tái đưa fallback nằm sẵn vào detector hoặc hạ các ngưỡng để ép clip Passed. Cần kiểm tra clip có đủ baseline trước ngã và calibration bằng bbox/runtime thực, có cả video âm tính, nếu thay tiêu chí candidate.

## Kiểm chứng và áp dụng

- [AI](ai-tests.txt): 73 Passed, coverage 87,87%; bao gồm ngưỡng 3s, missing, gap, duplicate, startup prone và recovery.
- [Bridge](bridge-tests.txt): 13 Passed, gồm sampler jitter và nguồn 10Hz.
- Ruff/format cho các file sửa và `git diff --check` đạt.
- Chưa xác nhận hai video tạo được FALL qua pipeline live sau sửa; không đánh dấu Passed từ unit test hoặc offline probe.

Code AI đang mount vào container và dùng auto-reload; cần restart Frigate để tiến trình bridge đọc source mới. Sau đó replay từ trước lúc ngã để tạo baseline mới:

```powershell
docker compose restart frigate ai-service
docker compose logs -f --tail 30 ai-service orchestrator frigate |
  Select-String -Pattern 'POSE_TRACK|POSE_CONTINUITY_RESET|M2A_|Pose frame|Pose encode'
```

Đọc theo thứ tự: history đủ 10 → drop đạt 0,20 và angle dưới 30 → CANDIDATE → motion hợp lệ dưới ngưỡng liên tục hơn 3s → CONFIRMED. Không có candidate thì immobileSeconds=0 là đúng với rule hiện tại. Có candidate nhưng motion=None hoặc gap reset thì cần xử lý chất lượng/nhịp frame; không tăng timer bằng dữ liệu thiếu.
