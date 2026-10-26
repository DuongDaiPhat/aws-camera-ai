# Lab 10 — Thay dữ liệu mẫu bằng model thật và tổng duyệt

## Mục tiêu và điều kiện

Các lab AWS trước đã có evidence theo phạm vi; D/E bàn giao model đạt gate riêng. Đây là lúc chứng minh toàn hệ thống, không dùng fixture test để thay báo cáo độ chính xác AI.

## A. Nhận bàn giao model

1. D/E gửi artifact path/checksum SHA-256, modelVersion, runtime/locks, preprocessing và input/output schema, thresholds đã đo và evaluation report. Không đưa trọng số lớn/ảnh mặt thật vào Git tùy tiện.
2. B đối chiếu contract với mapper AI result. C kiểm tra model load/inference trong runtime đích trên edge; không cài training dependencies vào Lambda/EC2 app image để chữa lỗi.
3. Chọn một module đã đạt, thay fixture bằng model thật qua **cùng contract**. Giữ fixture replay để regression; không bật song song producer cũ/mới cho một observation.
4. Với fall giữ temporal history/gap/restart semantics; với fire giữ multi-frame/cooldown semantics. Cloud adapter không được biến logic chuỗi thời gian thành từng frame độc lập.

## B. Chạy các lượt demo và failure test

| Lượt | Input                          | Kết quả cần thấy                                                        |
| ---- | ------------------------------ | ----------------------------------------------------------------------- |
| 1    | Known/unknown person crop thật | Rekognition result đúng policy, DB receipt và event UI                  |
| 2    | Video fall đã gắn nhãn         | Model thật tạo event theo ngưỡng, cảnh báo và user acknowledgement      |
| 3    | Video fire/smoke đã gắn nhãn   | Priority/rule đúng, deadline và call intent                             |
| 4    | Bấm Tôi ổn trước/sát deadline  | Transaction quyết định trạng thái; không tạo intent mới nếu đã resolved |
| 5    | Duplicate/stale results        | Không nhân incident hoặc ghi đè kết quả mới                             |
| 6    | Restart consumer/API           | Work khôi phục từ queues/outbox/DB, không mất kết quả đã commit         |
| 7    | Edge disconnect / provider lỗi | Heartbeat/DLQ/workflow alarm, có runbook và retry hữu hạn               |
| 8    | Backup restore                 | Dữ liệu cần giữ khôi phục trên DB test riêng                            |

SMS/Connect chưa được cấp quyền thì chạy dry-run để chứng minh pipeline và ghi phần real provider chưa đạt. Một ContactId không chứng minh đã answered; callback/DTMF cần kiểm tra riêng nếu release yêu cầu.

Đo end-to-end từ thời điểm detection/occurredAt đến dashboard/notification submission hoặc delivery theo tín hiệu đo được; ghi rõ điểm đầu/cuối, p50/p95 và số mẫu. Không gọi Lambda duration là latency hệ thống, không nhầm thời gian chờ escalation với thời gian phát hiện AI.

## C. Mẫu báo cáo cuối

```text
Commit và environment:
Model / checksum / thresholds / dataset:
Case và event/correlation IDs:
Input: fixture hay model-real
Provider: dry-run hay real
Expected / actual / trạng thái DB:
Workflow execution / queue receipt / provider ID:
Thời gian đo và cách đo:
PASS / FAIL / BLOCKED_ACCOUNT / BLOCKED_MODEL:
Giới hạn và cách rollback:
Chi phí actual/ước tính, tài nguyên cần giữ/xóa:
```

Làm hai lần tổng duyệt bằng máy/người khác; quay video 5–7 phút có bằng chứng thật, thêm video fixture dự phòng nhưng ghi nhãn rõ. Freeze tính năng trước UAT; không bỏ guard/receipt/DLQ để graph xanh ở ngày demo.

## Câu hỏi nhóm phải tự trả lời

- Nếu model chưa xong, phần AWS nào vẫn kiểm thử được?
- Nếu EC2 chết, queues/workflow giữ được gì và phần nào chưa chạy được?
- Nếu gửi xong nhưng chưa lưu receipt thì rủi ro gì? Vì sao SNS SMS chưa có exactly-once?
- Nếu người dùng xác nhận sau claim nhưng trước provider call, cancellation policy là gì?
- Resource nào vẫn tính phí khi stop EC2? Nhóm dọn theo inventory nào?

## Qua bài và bàn giao

Mỗi tính năng có evidence đúng mode; các phần blocked không bị tick Done. Người khác làm theo README/labs có thể tái lập deployment, biết xem logs và phục hồi một failure case. Sau demo dừng producers theo runbook, giữ backup/evidence cần thiết và dọn resources đúng scope; kiểm tra Billing lại do có độ trễ.

Xem [kế hoạch Sprint 4](../SPRINT_4_AWS_EXECUTION_PLAN.md) để đối chiếu Definition of Done của release. Qua chuỗi lab là nền tảng, không phải chứng nhận hệ thống HA production.
