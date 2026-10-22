# Tài liệu AWS — CameraAI

Cập nhật theo kiến trúc Hybrid EC2 + AWS Lambda ngày **21/10/2026**. Đây là kế hoạch và thiết kế, chưa phải xác nhận đã tạo tài nguyên AWS.

**Nhóm mới với AWS: bắt đầu bằng [lộ trình lab 00–10](labs/README.md), không bắt đầu bằng cách deploy toàn bộ sơ đồ.** Mỗi bài có mục tiêu học, điều kiện, bước thực hành, kết quả cần thấy, lỗi thường gặp và dọn tài nguyên.

1. [Lab 00 — Account, Region và công cụ](labs/00_CHUAN_BI.md).
2. [Lab 01 — Upload ảnh S3 private](labs/01_S3.md).
3. [Lab 02 — Lambda + SQS + retry/DLQ](labs/02_LAMBDA_SQS.md).
4. [Toàn bộ lộ trình và cách chia nhóm học song song](labs/README.md).

Tài liệu tra cứu khi đã bắt đầu thực hành:

- [Kế hoạch Sprint 4: task, owner, phụ thuộc và nghiệm thu](SPRINT_4_AWS_EXECUTION_PLAN.md).
- [Sequence Cognito, face, escalation và sơ đồ CloudWatch](METHOD_1_FEATURE_DIAGRAMS.md).
- [Draw.io nguồn: tổng quan và EC2 contents](diagrams/CameraAI_Hybrid_EC2_Lambda.drawio).
- [Hướng dẫn Lambda/event-driven nền](../docs/AWS_LAMBDA_EVENT_DRIVEN_TECHNICAL.md).

AWS làm bằng fixtures ngay trong lúc D/E phát triển model; chỉ gọi end-to-end hoàn tất sau khi có evidence từ model thật và provider thật tương ứng. Chi tiết capacity, trường hợp thiếu quyền SMS/Connect và scope demo nằm trong kế hoạch Sprint 4.

**Qua lab khác Done tính năng.** Handler mẫu trong bài phục vụ học từng thành phần; các bài tích hợp sẽ bổ sung auth/ownership, contract, idempotency và error handling. Thời gian học/sửa quyền phải tính riêng, không mặc định nằm trong estimate implementation cũ.
