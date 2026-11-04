# Ghép hệ thống và nghiệm thu Sprint 4

Mỗi mốc cần owner, reviewer và bằng chứng. Những việc chưa có service API hoặc chưa có quyền phải ghi rõ; không dùng callback giả trả 200 để làm graph xanh.

**Cách thực hiện từng chặng:** mở [runbook R0–R7](09_RUNBOOK_GHEP_HE_THONG.md). Runbook có bảng cấu hình từ AWS tới từng service, lệnh kiểm tra đã đối chiếu code, thứ tự PR cần hoàn thành và cách lần theo lỗi. File này giữ vai trò bảng mốc/tiêu chí nghiệm thu; các đầu ra code chưa có phải qua điểm dừng NEEDS_IMPLEMENTATION trong runbook.

## 1. Các điểm gặp nhau của ba người

| Mốc | Người thực hiện | Thao tác                                                     | Điều kiện qua                                      |
| --- | --------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| G0  | Cả ba           | Account/quyền, schema v1, owner dữ liệu, resource names      | Bảng bàn giao đủ để ba người bắt đầu               |
| G1a | A+B             | Cognito → mapping issuer/sub → API                           | 200/401/403/cross-owner/refresh/logout             |
| G1b | B+C             | Outbox → SQS → face Lambda → Rekognition → Results → receipt | Ảnh thật và replay duplicate/stale                 |
| G2a | B+C             | NOTIFIED → outbox → Standard Wait → deadline command HTTPS   | Ack/stale/race/restart không nhân escalation       |
| G2b | A+B             | Intent → SQS → sender claim → dry-run/provider → Results     | Ledger, cap/cooldown và reconcile unknown outcome  |
| G3  | C, A/B review   | HTTPS/VPN, alarms, restart, backup/restore, rollback         | Browser máy thứ hai và recovery thật               |
| G4  | Cả ba           | Thay fixture bằng model/edge được đánh giá                   | Truy vết toàn chuỗi, accuracy/latency đúng phép đo |
| G5  | Cả ba           | Staging smoke, UAT, review/phát hành, diễn tập demo          | Scope thật, blockers, inventory đã bàn giao        |

G1a/G1b chạy song song. Sender dry-run không cần SMS/Connect thật. Deadline lab chạy trước khi có EC2; deadline command cloud cần HTTPS của C. C dựng monitoring/release scripts trước business E2E.

## 2. Ánh xạ đầy đủ backlog

| Task plan gốc                 | Owner nhóm ba người    | Hướng dẫn       | Bằng chứng                                    |
| ----------------------------- | ---------------------- | --------------- | --------------------------------------------- |
| AWS-01 contract/fixtures      | B; A/C review          | Chuẩn bị §7, B7 | Schema v1, valid/invalid/duplicate fixtures   |
| AWS-02 IaC/IAM/S3/SQS         | C template; B behavior | B1–B6, C1–C2    | Change set, outputs, IAM, recreate smoke      |
| AWS-03 outbox/result consumer | B                      | B7              | Receipt commit-before-delete, crash replay    |
| AWS-04 Cognito                | A; B review            | A1–A3           | Mapping và auth E2E                           |
| AWS-05 face                   | B; C role/template     | B5–B7           | Enrollment/search/delete, owner isolation     |
| AWS-06 deadline               | B; C deploy            | B8–B9           | Race/version/no-op, failed workflow/reconcile |
| AWS-07 sender                 | A; B ledger; C role    | A4–A6           | Dry-run/provider ID, real channel status      |
| AWS-08 server/edge            | C; B integration       | C3–C7           | HTTPS, private paths, media, restore          |
| AWS-09 operations/cost        | C; A/B inject lỗi      | C8–C11          | Alarm email, heartbeat, inventory             |
| AWS-10 AI/UAT/demo            | Cả ba                  | G4–G5           | Model report, E2E, rollback, video, bàn giao  |

## 3. Chạy một ca end-to-end

1. C công bố HTTPS URL, commit/release digest, queue/workflow ARNs và giờ test. A giữ sender dry-run, chưa bật số nhận thật.
2. B tạo users/cameras theo quy trình app; A xác minh mapping/ownership. Fixture dùng application IDs/UUID hợp lệ.
3. B đưa crop vào S3 bằng producer thực; transaction ghi outbox; ghi eventId/jobId.
4. Tìm jobId trong logs; result về queue; B chứng minh receipt và trạng thái ứng dụng. Message trên Console chưa chứng minh DB đã commit.
5. A xem incident bằng user sở hữu; user khác bị chặn cả metadata/media.
6. Khi NOTIFIED, mở Standard execution tương ứng; timestamp/version đúng, execution ARN gắn với incident.
7. A xác nhận trước deadline. Wait kết thúc, command no-op, không sinh call intent.
8. Incident mới không xác nhận: sau deadline chỉ một ESCALATED/intent hợp lệ; sender claim, dry-run result commit về DB.
9. Sau review ca dry-run, thử một real email/SMS/call theo allowlist và điều kiện tài khoản. Ghi provider ID và xác nhận trên thiết bị người nhận riêng biệt.
10. Ghi IDs, thời gian, expected/actual. Không upload ảnh mặt, token, signed URL hoặc DB dump vào repo.

## 4. Bộ kiểm thử trước demo

| ID      | Thao tác                                            | Expected                                            | Owner |
| ------- | --------------------------------------------------- | --------------------------------------------------- | ----- |
| AUTH-01 | Thiếu/sai/hết hạn token; ID token thay access token | 401                                                 | A     |
| AUTH-02 | Token đúng nhưng chưa provision/thiếu role          | 403                                                 | A+B   |
| AUTH-03 | A đọc camera/media B không được cấp quyền           | Từ chối, không lộ signed URL                        | A+B   |
| FACE-01 | Known/unknown/no-face/ảnh lỗi                       | Phân loại đúng, lỗi không thành KNOWN               | B     |
| FACE-02 | Collection/face owner khác                          | Không lộ dữ liệu chéo owner                         | B     |
| DATA-01 | Cùng resultId 10 lần; stale revision tới sau        | Một kết quả, không ghi đè bản mới                   | B     |
| DATA-02 | Crash sau DB commit trước delete                    | Replay an toàn                                      | B     |
| FLOW-01 | Ack trước/cạnh tranh deadline                       | Không nhân intent, policy xác định được             | B     |
| FLOW-02 | Stale/duplicate/API down                            | No-op/retry/fail và reconcile, không thành công giả | B+C   |
| SEND-01 | Job trùng/lease hết hạn/cooldown/daily cap          | Không gửi ngoài policy                              | A+B   |
| SEND-02 | Provider nhận rồi result publish lỗi                | Unknown outcome được đối soát, không blind resend   | A+B   |
| OPS-01  | DLQ message test/workflow forceError                | Alarm email thực nhận                               | C     |
| OPS-02  | Ngắt heartbeat edge                                 | Báo mất kết nối, không tạo AI event giả             | C     |
| OPS-03  | Restart EC2/restore vào DB test                     | Dữ liệu giữ/khôi phục, pending jobs reconcile       | C+B   |
| REL-01  | Release lỗi và rollback digest                      | Bản trước healthy, không db:reset                   | C     |
| E2E-01  | Video/model thật → incident → notification          | Correlation đầy đủ, có latency/accuracy             | Cả ba |

Model chưa có report thì `E2E-01=BLOCKED_AI`; giữ riêng kết quả fixture của cloud. SMS/call thiếu quyền là `BLOCKED_ACCOUNT`, không gọi dry-run là real channel pass.

## 5. Nhận model với đúng ba người

1. Lấy artifact từ nhánh AI đã review/người đang giữ artifact; không giả định phải có thêm D/E trong sprint.
2. Ghi filename/version/checksum, runtime lock, preprocessing, contract, dataset/evaluation report và device thật.
3. B kiểm tra tương thích runtime; A kiểm tra ý nghĩa kết quả UI; C kiểm tra checksum/startup/recovery.
4. Replay cùng video trước/sau thay fixture; ghi ground truth. Cloud latency và model accuracy là hai phép đo khác nhau.
5. Nếu cần train thêm, ước lượng riêng, không coi model chưa đánh giá là đầu vào sẵn sàng để giữ lịch.

## 6. Git và rollback

Code ở nhánh feat/fix/ci theo [GIT_WORKFLOW](../../docs/conventions/GIT_WORKFLOW.md); docs ở `docs/sprint4-beginners-parallel-guide`. PR có người khác review, API/contract cần A và B review theo quy định dự án; không push trực tiếp main.

Giữ hai nhóm cấu hình trong secret store của môi trường. AUTH_PROVIDER chọn đúng một provider, không fallback khi token sai. Đổi provider cần recreate/redeploy backend và đăng nhập lại; giữ user local dự phòng, vì Cognito-only user không tự có mật khẩu local. Xem [AUTH_PROVIDERS](../../docs/architecture/AUTH_PROVIDERS.md).

Rollback app dùng release/digest trước; migration phải tương thích ngược. Restore DB là thao tác phục hồi riêng có người phụ trách và điểm khôi phục, không tự chạy chỉ vì image mới fail healthcheck.

## 7. Quyết định cuối sprint

Chỉ đánh dấu hoàn tất khi acceptance criteria bắt buộc đã pass. Giảm scope cần người phụ trách duyệt và ghi rõ. Điền:

```text
Release/commit/ngày kiểm tra/A-B-C:
AWS-01..10: PASS / NEEDS_FIX / BLOCKED_ACCOUNT / BLOCKED_AI
Case AUTH/FACE/DATA/FLOW/SEND/OPS/REL/E2E và evidence:
Fixture hay model thật:
Email / SMS / call thật hay dry-run:
Yêu cầu chưa đạt, owner và phương án:
Backup/restore và rollback evidence:
Resources giữ lại, người trả phí, ngày review:
Reviewer và quyết định phát hành:
```

Diễn tập hai lượt: happy path và failure/recovery. C đối chiếu inventory A/B trước khi dọn. Incident/workflow/notification pending phải được xử lý hoặc bàn giao trước khi xóa queue/stack.
