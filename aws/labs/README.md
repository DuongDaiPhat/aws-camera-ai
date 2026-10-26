# Lộ trình lab AWS — học đến đâu, nối CameraAI đến đó

**Dành cho:** nhóm chưa từng tích hợp AWS. **Cập nhật:** 21/10/2026.

Không bắt đầu bằng cách dựng toàn bộ sơ đồ. Trước tiên làm một việc nhỏ nhìn thấy kết quả: upload ảnh, gọi Lambda, gửi message. Khi hiểu các mảnh đó mới nối vào NestJS, database và model thật.

## 1. Hai kết quả khác nhau

- **Qua bài lab:** bạn tạo được tài nguyên thử, giải thích được request đi đâu và có bằng chứng kết quả. Có thể dùng dữ liệu mẫu hoặc provider giả lập theo bài.
- **Tính năng CameraAI hoàn tất:** code đã tích hợp, kiểm thử lỗi/quyền/retry và chạy được với model/provider thật mà tiêu chí yêu cầu. Qua lab không tự động làm user story Done.

Các đoạn Python/YAML trong bài là mã mẫu **để người học tạo ở môi trường lab**, không khẳng định handler/template đã có trong repo. Các lệnh cloud có thể tạo chi phí khi người học chạy; tài liệu này chưa chạy chúng trên tài khoản nhóm.

## 2. Thứ tự học

| Bài                                                              | Học gì và làm ra gì?                                           | Cần qua bài                                | Gắn với task      | Buổi thực hành dự kiến        |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ | ----------------- | ----------------------------- |
| [00 — Account, Region và công cụ](00_CHUAN_BI.md)                | Xác định đúng tài khoản/quyền, hiểu Region/role, gọi STS       | Không                                      | AWS-02            | 1 buổi                        |
| [01 — S3 private](01_S3.md)                                      | Upload một ảnh, tạo signed URL, hiểu private khác public       | 00                                         | AWS-02 / US-23    | 1 buổi                        |
| [02 — Lambda + SQS](02_LAMBDA_SQS.md)                            | Gửi event JSON, nhìn log, chủ động tạo lỗi và DLQ              | 00                                         | AWS-02            | 1–2 buổi                      |
| [03 — Face với Rekognition](03_REKOGNITION.md)                   | Enroll/search ảnh, Face Lambda trả result qua queue            | 01, 02                                     | AWS-05 / US-24    | 1–2 buổi                      |
| [04 — Nối NestJS và quản lý bằng SAM](04_TICH_HOP_NESTJS_SAM.md) | Chốt contract, DB receipt/outbox và tái tạo resources bằng IaC | 01, 02; 03 để nghiệm thu face thật         | AWS-01/02/03      | 2–3 buổi                      |
| [05 — Cognito](05_COGNITO.md)                                    | Login PKCE, token verifier và ownership                        | 00; app local đang chạy                    | AWS-04 / US-25    | 2 buổi                        |
| [06 — Step Functions](06_STEP_FUNCTIONS.md)                      | Thử Wait 10 giây, sau đó nối deadline command                  | 02; 04 cho tích hợp                        | AWS-06 / US-13    | 1–2 buổi                      |
| [07 — Sender, SNS và Connect](07_THONG_BAO.md)                   | Dry-run, thử email, rồi SMS/call khi đủ điều kiện              | 02; 04 cho claim/result                    | AWS-07 / US-26/27 | 1–2 buổi, chưa tính chờ quyền |
| [08 — EC2, HTTPS và edge](08_EC2_EDGE.md)                        | App production containers và camera computer kết nối riêng     | 04, 05; 06/07 đã test riêng                | AWS-08            | 2–3 buổi                      |
| [09 — Monitoring](09_CLOUDWATCH.md)                              | Theo dõi DLQ, heartbeat và nhận một email alarm thật           | 02; 08 cho EC2/edge                        | AWS-09 / US-28    | 1–2 buổi                      |
| [10 — Ghép model và bàn giao](10_TICH_HOP_AI_BAN_GIAO.md)        | Thay fixture bằng AI thật, test restart/race và demo           | Các bài trước theo phạm vi; model đạt gate | AWS-10            | 1–2 buổi                      |

Một buổi học khoảng **60–120 phút cho một cặp dev**, là dự toán để chia phiên học, không phải cam kết deadline. Các bài chia cặp chạy song song nên không cộng tất cả thành số ngày lịch. Nhóm mới cần tính thêm thời gian học, sửa quyền và đọc log; không lấy estimate 72 giờ implementation cũ làm tổng thời gian học + làm.

### Thứ tự cho nhóm 5 người

1. A/B/C cùng làm lab 00–02 một lần để có chung kiến thức. Mỗi người phải tự giải thích được tài khoản, Region, role, queue và log; không chỉ xem màn hình của C.
2. Sau đó A/B làm Cognito; B/C làm face/result contract theo các slot riêng; C dựng SAM và deployment. B có nhiều phụ thuộc nên mỗi phiên chỉ nhận một việc chính.
3. D/E tiếp tục dataset/train/export/evaluate; chỉ bàn giao ảnh test, fixture contract và kết quả module theo slot ngắn.
4. Khi AWS chưa có model: replay dữ liệu mẫu để test pipeline. Khi model đạt: làm lab 10, không đổi schema ngẫu hứng ở ngày demo.

## 3. Mẫu ghi chép cho mọi bài

Tạo ghi chép cá nhân ở `artifacts/aws-labs/` hoặc báo cáo đã ẩn thông tin nhạy cảm; không commit ảnh mặt thật, token, mật khẩu hoặc access keys.

```text
Bài / người thực hiện / reviewer:
Account alias và Region (không có credentials):
Mục tiêu tôi đang thử:
Các tài nguyên lab đã tạo:
Request hoặc thao tác đã thực hiện:
Kết quả mong đợi / thực tế:
Ảnh log hoặc message ID đã ẩn thông tin nhạy cảm:
Lỗi đã gặp và cách sửa:
Tôi giải thích được điều gì sau bài này:
Đã giữ/xóa tài nguyên nào, có chi phí tiếp tục không:
Kết luận: LAB_PASS / NEEDS_FIX / BLOCKED_ACCOUNT
```

## 4. Quy tắc tên và dọn tài nguyên

- Dùng prefix `camerai-lab-...`, tách khỏi `camerai-dev` và môi trường demo.
- Bài 00–03 dùng Console/CLI để thấy từng thành phần. Sau lab 04, resources tích hợp thuộc SAM stack riêng; không tạo lại thủ công rồi để hai hệ thống cùng chạy.
- Kết thúc mỗi bài, ghi rõ tài nguyên nào cần cho bài sau. Nếu không học tiếp ngay, dọn theo phần cuối bài; không xóa bucket/DB/queue dùng chung của nhóm.
- Chỉ xóa message sau khi đã lưu kết quả ở bài tích hợp. Chỉ xóa lab stack/collection/bucket đúng tên đã kiểm tra; không dùng lệnh quét/xóa toàn tài khoản.

## 5. Các tài liệu tra cứu

- [Kế hoạch Sprint 4](../SPRINT_4_AWS_EXECUTION_PLAN.md): phân công, task, capacity và nghiệm thu release.
- [Sequence/monitoring diagrams](../METHOD_1_FEATURE_DIAGRAMS.md): đối chiếu đường đi khi làm lab.
- [Draw.io](../diagrams/CameraAI_Hybrid_EC2_Lambda.drawio): vị trí triển khai.

Bắt đầu từ **lab 00**; chưa cần đọc hết kế hoạch kỹ thuật hoặc hiểu mọi thuật ngữ trước khi thử thao tác đầu tiên.
