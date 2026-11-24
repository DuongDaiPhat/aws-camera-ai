# Nhánh feat/us-13-aws-deadline-stepfunctions — bàn giao và nghiệm thu

Cập nhật: 24/11/2026 (Asia/Bangkok). Bản sửa đã qua CI đầy đủ và nghiệm thu fixture trên AWS Staging. Ảnh chụp bị công cụ Computer Use chặn; bằng chứng giao kèm là JSON/log thật.

## Phạm vi và nguồn

- Nhánh gốc: `4213afe`; 8 commit triển khai Deadline của B.
- Đã ghép `origin/main` tại `a93ec4a` trong worktree `outputs/deadline-fix`.
- Không thay đổi checkout chính. Giữ cả thay đổi Face hiện hành và notification/Sender của A.
- Hợp đồng: `aws/sprint4/00_HOP_DONG_G0.md`, phần 4.

## Luồng xử lý

1. `EscalationEngineService` chuyển event sang NOTIFIED, tăng `deadline_version`, ghi dispatch trong cùng transaction.
2. `DeadlineStepFunctionsService` claim dispatch rồi StartExecution ngoài transaction; execution name là `deadline-<commandId>` và input giữ nguyên qua retry.
3. State Machine Standard đợi expectedDeadlineAt, gọi Deadline Lambda.
4. Lambda gọi `POST /api/v1/internal/events/{eventId}/deadline` bằng internal token qua HTTPS.
5. Backend lock event, kiểm receipt/version/trạng thái/clock DB. Quá sớm trả 409 NOT_DUE; ack rồi trả NO_OP; hết hạn ghi ESCALATED + history + một notification intent + receipt nguyên tử.
6. Intent đi qua NotificationCloudService của A, SQS, Sender và Results. REAL/DRY_RUN do claim policy quyết định.
7. Reconciler dùng cùng operation idempotent khi workflow thất bại. Không tạo intent lần hai khi replay.

## Sửa hai lỗi review

### Recovery bị ngừng sau lỗi DB tạm thời

- Truy vấn reconcile nhận cả STARTED và FAILED khi đến lượt; ưu tiên reconciled_at cũ để tránh bỏ đói công việc phía sau.
- FAILED được gọi lại bằng operation nghiệp vụ chung, không mở execution mới trùng tên.
- Recovery gặp lỗi giữ quyền xử lý và dời lượt retry 30 giây. Không đẩy lỗi DB tạm thời vào một trạng thái bị bỏ quên.

### Chuyển cloud về local bỏ rơi deadline

- Chọn chặn chuyển mode thay vì tự chuyển quyền khi workflow đang chạy.
- `assertLocalDriverSafe()` từ chối khởi động local nếu event NOTIFIED còn deadline cloud PENDING/STARTED/FAILED đúng version.
- Giữ backend cloud để drain/reconcile; ack/resolve hoặc hoàn tất event; kiểm count bằng 0 rồi mới khởi động local.
- Không xóa dispatch/receipt để ép chuyển mode; không bật hai driver trên hai backend cùng DB.

## Ghép với main và Sender

- Build worker gồm `face`, `sender`, `deadline`, dùng TemporaryDirectory và kiểm đường dẫn từ main.
- CD giữ SHA-256, upload và deploy cả ba ZIP; giữ các guard cấu hình Sender và authenticated dependency smoke.
- EscalationModule giữ NotificationCloudModule cùng providers/controller Deadline.
- Docker Compose giữ cả biến Deadline và cấu hình Sender của A.
- Migration `0024_aws_deadline_stepfunctions.sql` là file riêng; không sửa checksum migration đã áp dụng.
- CI thêm PostgreSQL integration Deadline vào job Node.

## Kết quả kiểm thử

| Nhóm                                      | Kết quả                                                                                                   | Bằng chứng                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| CI đầy đủ                                 | SUCCESS, source SHA 2c40d699e2de52ad48299432e0c7a568c429a196                                              | [CI run 45358456431](https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/45358456431) |
| Backend unit                              | 848/848, 99 suites                                                                                        | CI Node                                                                                      |
| Frontend unit                             | 373/373, 82 files                                                                                         | CI Node                                                                                      |
| PostgreSQL Deadline                       | 5/5, gồm FAILED recovery và guard handoff                                                                 | CI và local container                                                                        |
| Lambda Deadline Python 3.12               | 13/13                                                                                                     | CI Deadline worker                                                                           |
| AI Python                                 | 170/170 mỗi nền tảng Linux/Windows                                                                        | CI Python; không cộng trùng hai nền tảng                                                     |
| Typecheck/lint/format/OpenAPI/secret scan | PASS; lint còn warnings                                                                                   | CI                                                                                           |
| Migration và Docker AI/backend/web        | PASS                                                                                                      | CI                                                                                           |
| AWS ack trước hạn                         | PASS: RESOLVED, receipt NO_OP, không tạo notification                                                     | acceptance.json                                                                              |
| AWS timeout và Sender                     | PASS: ESCALATED, đúng một intent; SQS → Sender → Results, DRY_RUN/BLOCKED_PROVIDER, provider_called=false | acceptance.json                                                                              |
| AWS NOT_DUE retry                         | PASS: TaskSucceeded NOT_DUE → WaitUntilRetry → APPLIED → SUCCEEDED                                        | timeout-execution-history.json                                                               |
| Replay command                            | PASS: replay hai lần, vẫn một notification                                                                | acceptance.json                                                                              |
| FAILED recovery/handoff                   | PASS: chặn local khi còn việc, recovery hoàn tất, cho phép local sau drain                                | acceptance.json                                                                              |
| Khởi động container local và restore      | PASS: local healthy, intent 0/1/1, restore healthy                                                        | switch-restore.json                                                                          |
| Ảnh chụp                                  | BLOCKED                                                                                                   | Computer Use không xác định chắc URL Windows; đã dừng, không tạo ảnh giả                     |

Một số unit test local bị sandbox EACCES khi mở loopback; kết luận toàn bộ CI dựa trên runner GitHub, không che lỗi môi trường local. Commitlint skip đúng cấu hình workflow_dispatch; hook commitlint của commit local đã chạy.

### Fixture và giới hạn nghiệm thu

Đây là fixture DB/service trên camera Staging `cam_1_phat`, không phải video camera hay test UI nhiều household. Các lời gọi workflow/Lambda/API/SQS/Sender/Results là thật. Backend QA ép SENDER_DRY_RUN=true; Sender không gọi provider thật. Không khẳng định nhận email/SMS/cuộc gọi từ lượt này.

- Ack event: `582b1161-5776-441f-9d65-7df44a25c527`; command `4dcd41a4-36ee-4675-9e3b-afaea0ad12d0`.
- Timeout event: `9c07d090-00a4-4a92-a2fd-a979c6d4dc7e`; command `75f91ac8-dbb6-4637-a364-c96f250311c9`.
- Notification: `817ab6e1-8adc-43af-b56c-63e17824dab3`; attempt `0e7b6949-7db7-47c6-ab8d-a7e7e2a8b39d`.
- Recovery event: `bdd4b471-da01-4585-9f5d-6a5bc4ddbbd5`; command `dfbb50d1-6a0a-4470-9f8b-d1a7725cdccc`.
- ARN execution theo mẫu `arn:aws:states:ap-southeast-1:926883321040:execution:argusai-staging-deadline:deadline-<commandId>`.
- Bằng chứng JSON nằm trong [thư mục test](test/US13_AWS_DEADLINE_2026-11-24/acceptance.json). Log thô ở workspace gốc `artifacts/deadline-staging-20261124/` (gitignored).

## Cách triển khai QA và phục hồi

- Commit code đã kiểm: `2c40d699e2de52ad48299432e0c7a568c429a196`, nhánh đã push; chưa merge main.
- CI: workflow_dispatch trên đúng nhánh; không triển khai Production.
- Image QA: `926883321040.dkr.ecr.ap-southeast-1.amazonaws.com/camerai/orchestrator@sha256:76821ad5e59c6736701ae1b2d725a33ff9b9a9845586a115a3ce7bd781fe9077`.
- Deploy backend QA bằng SSM, không phải CD main. Khóa `/opt/camerai/deploy.lock`, backup trước migration, runtime QA `/opt/camerai/deadline-qa/2c40d69`.
- Backup: `s3://argusai-backups-926883321040/staging/qa-deadline-2c40d69.dump`. Migration 0024 Deadline áp dụng thành công; giữ schema cộng thêm khi rollback app.
- Lambda Deadline QA version 2, baseline version 1. ZIP SHA-256 base64 `E5GGDF/aRv255nBGundnXElnS+lNW3D4XOLU+KD0L3Q=`.
- Release bucket từ chối PutObject theo policy. Không đổi policy; update Lambda Staging trực tiếp bằng `--zip-file` qua quyền Lambda hiện có.
- SSM runtime-env và cấu hình Sender Lambda không bị thay đổi. Chỉ runtime copy QA dùng dry-run.
- Release trước QA: `a93ec4a6e0c42ecc756daef10c3fa48f11b4d641-45351592388-1`.
- Fixture được đóng CLOSED sau kiểm đếm, giữ audit. Không xóa DB/volume hay ảnh của người dùng.

## Quy tắc cho agent tiếp theo

- Không lấy PASS local làm PASS AWS; không lấy provider accepted làm xác nhận hộp thư.
- Chạy dry-run với đúng fixture Staging; không gửi thật SMS/Connect hoặc đổi Production.
- Backup DB trước migration/deploy; ghi release cũ để rollback; không xóa volume hay sửa migration cũ.
- Bằng chứng cần gồm source SHA, release ID, eventId, commandId, executionArn, receipt, notificationId, attemptId, outcomeId và số intent. Không lưu token/password hay raw runtime-env.
- Chụp trang event và execution/result hoặc log thật có dấu thời gian. Ảnh phải ghi rõ fixture/DRY_RUN nếu áp dụng.
- Sau test: trả cấu hình camera/driver/Sender về trạng thái trước test; giữ audit cần thiết và ghi mọi cleanup.

## Trạng thái cuối và điểm tiếp tục

- Nghiệm thu hoàn tất 24/11/2026 khoảng 15:56 (Asia/Bangkok).
- Container QA đã thực sự khởi động ở DEADLINE_DRIVER=local sau khi drain; không phát sinh intent trùng. Sau đó đã khôi phục release `a93ec4a...-45351592388-1`, DEADLINE_DRIVER=stepfunctions, SENDER_DRY_RUN=false giống baseline.
- Lambda Deadline alias live đã trả về version 1. Version 2 còn tồn tại làm artifact QA; không có đổi Production.
- Ba event fixture CLOSED, giữ receipt/history/notification để truy vết. Migration cộng thêm và backup được giữ lại.
- Nhánh runtime sửa đã push, chưa merge main. Khi release chính thức, dùng build/CD đã ghép và cùng biến DEADLINE_FUNCTION_NAME/ALIAS; chạy CI trên commit release cuối.
- Screenshot là phần duy nhất chưa hoàn thành: Computer Use đã trả lỗi không xác định URL Windows và dừng lượt. Không dùng công cụ khác để vượt chặn; báo cáo không nhúng hình được dựng lại từ JSON như thể ảnh chụp UI.
- Agent sau có thể mở trang GitHub CI run và các execution ARN/event IDs ở trên để chụp ảnh khi Computer Use hoạt động trở lại. Các execution SUCCEEDED và fixture audit được giữ nguyên.
