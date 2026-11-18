# Người A — Nghiệm thu Cognito và hoàn thiện thông báo AWS E2E (Dev → Staging → Production)

Baseline của plan là `c3250bd` trên nhánh `feat/us-29-argus-dev-mode`. Người A được cấp quyền chủ động **tự tạo, cấu hình và vận hành các dịch vụ thuộc phạm vi của A** xuyên suốt **Dev → Staging (`https://argusai-staging.duckdns.org`) → Production (`https://argusai.dynv6.net/login`)**, từ lúc code local đến nghiệm thu E2E trên Production.

- **Phạm vi services A tự chủ:** Cognito App Client/Test Users, Notification Intent/Claim/Outcome API & UI, SNS Topics (Incident Email / SMS nếu khả dụng), Lambda Sender (`*-sender`), IAM execution role của Sender, SQS Event Source Mapping từ `*-notification-jobs`, và Amazon Connect (Instance/Outbound Contact Flow nếu đủ điều kiện tài khoản).
- **Phối hợp với Repo Owner (Dương Đại Phát):** Khi cần thêm hoặc đổi **GitHub Actions Secrets / Variables** hay **duyệt deploy Environment `production`**, A ghi rõ danh sách cần cập nhật trong PR/bàn giao gửi **Dương Đại Phát** thực hiện trên GitHub Settings (không đưa giá trị secret vào Git).
- **Tham chiếu kiểm kê thực tế (local gitignored):** `docs/CI_CD_STAGING_SOURCE_OF_TRUTH.md` và `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md`.

| Luồng         | Đã có ở baseline                                                                                                                                                                  | Phần A tự chủ hoàn thiện (Dev → Staging → Production)                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cognito       | `/auth/config`, Managed Login code + PKCE, callback/refresh/logout, xác thực access token và liên kết `(issuer, sub)`, quyền household.                                           | Tự quản lý App Client callback/auth-flow và user test trên Pool `ap-southeast-1_4WQxu8bnB`, liên kết DB và chạy login/RBAC từ localhost tới Production. |
| Thông báo AWS | `EscalationRepository.createNotificationIntent()` ghi `notifications`. `CloudQueueService.enqueueNotification()` và Results consumer có transport, schema và receipt/outcome log. | Nối intent từ nghiệp vụ, tạo claim/attempt API, viết `services/aws-workers/sender/`, áp dụng outcome ra UI; tự dựng SNS/Sender/Connect cả 3 môi trường. |
| CD & GitHub   | Workflow CD hiện mới đóng gói Face (`face.zip`). [Hiện trạng staging](../../docs/SPRINT4_STAGING_TIEN_DO_VA_RUNBOOK.md)                                                           | Đóng gói `sender.zip`, nối bước deploy Sender vào CD, cập nhật `ArgusAI-GitHub-*-Policy` & SSM runtime-env; gửi **Dương Đại Phát** biến/secret GitHub.  |

---

## 1. Chuẩn bị môi trường & Quyền tự tạo services

1. Dùng nhánh làm việc riêng từ baseline tích hợp. Chuẩn bị Node 22, pnpm theo `package.json`, Python 3.12 và Docker Compose. [Cách chạy local và chuyển Dev Cloud](../../docs/SPRINT4_DEV_CLOUD_LOCALHOST_TO_STAGING.md).
2. Dùng IAM User A (`--profile camerai-lab --region ap-southeast-1`). Kiểm tra danh tính:
   ```powershell
   aws --profile camerai-lab --region ap-southeast-1 sts get-caller-identity
   ```
3. Với thay đổi hạ tầng/CD dùng chung (SSM `/camerai/<env>/runtime-env`, `ArgusAI-GitHub-<Env>-Policy`, `.github/workflows/*.yml`), giữ nguyên tắc **tách biệt hoàn toàn tài nguyên giữa Dev / Staging / Production**, không ghi raw secrets vào Git/log, và phối hợp C khi chạm file deploy chung.

---

## 2. Giai đoạn Dev — Tự tạo services Dev & chạy E2E từ Localhost

### 2.1. Cognito Dev (US-25)

1. Dùng User Pool `ap-southeast-1_4WQxu8bnB` (Domain `https://ap-southeast-14wqxu8bnb.auth.ap-southeast-1.amazoncognito.com`). Tạo hoặc dùng App Client Dev riêng cho `localhost` (Public SPA, không secret, OAuth `code` flow, scopes `openid email profile`, Callback `http://localhost:3000/auth/callback`, Sign-out `http://localhost:3000`; giữ nguyên client `5p3hgqnkmjrdc5ktb99ur46hjr` cho Production `https://argusai.dynv6.net`). [Hướng dẫn Cognito](05_SETUP_COGNITO.md).
2. Tự tạo 2–3 user test trong Cognito Pool và liên kết `(cognito_issuer, cognito_sub, cognito_email)` vào `users` của DB test local (khác household để test phân quyền).
3. Chuyển mode local sang cloud bằng `pnpm argus cloud` (hoặc cấu hình `.env` thủ công theo `CI_CD_STAGING_SOURCE_OF_TRUTH.md` Mục 5) rồi test `/login`, `/auth/me`, `401` (thiếu/sai/ID token), `403` (user chưa link), truy cập chéo household, refresh và logout.

### 2.2. Backend Notification Intent, Claim & Outcome

1. **Tạo intent có thật:** Nối `CloudQueueService.enqueueNotification()` vào vị trí ghi intent dùng chung `EscalationRepository.createNotificationIntent()` trong cùng transaction. Đọc cờ `NOTIFICATION_DRIVER` (`local | sqs`) và chặn hai sender xử lý trùng cùng notification. Giữ luồng Telegram/local khi không chọn SQS.
2. **API Claim:** Thêm `POST /api/v1/internal/notifications/{notificationId}/claim` bảo vệ bởi `InternalTokenGuard` (`X-Internal-Token`). Transaction kiểm tra intent, event/owner/version, recipient policy, cap (5 lần/ngày/người nhận/kênh), cooldown (60 giây), lease (120 giây), trả về `CLAIMED` (`DRY_RUN | REAL`, `delivery`), `NO_OP`, hoặc `409 BUSY` kèm `retryAt`. [Chi tiết contract G0](00_HOP_DONG_G0.md#5-sender-claimoutcome-api-v1--a-triển-khai).
3. **Apply Outcome & UI:** Trong Results consumer (`cloud-queue.service.ts`), đối chiếu `attemptId`, commit `cloud_result_receipts` + `cloud_notification_outcomes` + cập nhật bảng `notifications` (`DRY_RUN → SKIPPED`, `PROVIDER_ACCEPTED → SENT`, `FAILED → FAILED`, `UNCERTAIN` giữ pending và khóa auto-resend) trước khi `DeleteMessage`. Hiển thị trạng thái gửi trong chi tiết sự kiện trên Web.

### 2.3. Tự dựng dịch vụ Dev cho Sender (`camerai-s4-dev-sender`) & Test qua HTTPS Tunnel

1. Viết `services/aws-workers/sender/` (Python 3.12, handler, `requirements.txt`, unit tests) và tích hợp đóng gói `sender.zip` vào `services/aws-workers/build.py`.
2. Trên AWS Dev (`ap-southeast-1`), A tự tạo/cập nhật bộ dịch vụ Dev cho Sender:
   - **SNS Email:** Dùng hoặc tạo topic `camerai-s4-dev-incident-email`, thêm email subscription của A và bấm **Confirm subscription**.
   - **Log Group:** `/aws/lambda/camerai-s4-dev-sender` (retention 7 ngày).
   - **IAM Role:** Tạo/cập nhật role cho Sender Dev với quyền `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` trên `camerai-s4-dev-notification-jobs`, `sqs:SendMessage` trên `camerai-s4-dev-results`, `sns:Publish` trên topic email Dev, và Logs.
   - **Lambda `camerai-s4-dev-sender`:** Thay thế stub 299 bytes hiện tại bằng `sender.zip` thật (`python3.12`, `x86_64`, timeout `30s`), env: `APPLICATION_RESULTS_QUEUE_URL`, `INTERNAL_API_BASE_URL=https://<tunnel-domain>/api/v1`, `INTERNAL_SERVICE_TOKEN` (>= 32 ký tự, khớp API local), `SENDER_DRY_RUN=true`, `SNS_TOPIC_ARN`; publish version + alias `live` + Event Source Mapping từ `camerai-s4-dev-notification-jobs` (`BatchSize: 1`, `ReportBatchItemFailures`).
   - **SMS & Connect Dev (nếu tài khoản hỗ trợ):** Kiểm tra SMS sandbox (`PinpointSmsVoiceV2`) / tạo Connect instance & contact flow Dev; nếu bị AWS chặn quyền/subscription, giữ `DRY_RUN` và ghi `BLOCKED_PROVIDER`.
3. Chạy `pnpm argus cloud`, dựng HTTPS tunnel (`artifacts/DevCloud.Caddyfile` + `cloudflared`/`ngrok`) mở thêm route `POST /api/v1/internal/notifications/<uuid>/claim`. Tạo sự kiện trong UI local (`http://localhost:3000`) → kiểm `SKIPPED` (`DRY_RUN`) → bật gửi thật tới email đã confirm → kiểm `MessageId`, `SENT` và hộp thư thực.

---

## 3. Giai đoạn Staging — Tự tạo services Staging, Note GitHub & Nghiệm thu E2E

### 3.1. Tự tạo/kiểm tra các services của A trên Staging (`argusai-staging-*`)

1. **Cognito Staging (`75ao3v25aoscu9nlfjmi8hu7f`):** Xác nhận Callback `https://argusai-staging.duckdns.org/auth/callback`, Sign-out `https://argusai-staging.duckdns.org`, `ALLOW_USER_PASSWORD_AUTH` (đã bật). Tạo tài khoản test Staging trong pool `ap-southeast-1_4WQxu8bnB` và liên kết vào DB Staging (qua SSM Session Manager trên `i-0bd8c9cf689512b6e`).
2. **SNS Email Staging:** Tạo Standard topic `argusai-staging-incident-email`, subscribe hộp thư test Staging và confirm subscription.
3. **Sender Lambda Staging:**
   - Log Group `/aws/lambda/argusai-staging-sender` (retention 7 ngày).
   - IAM Role `ArgusAI-Lambda-Staging-Sender`: SQS consume `argusai-staging-notification-jobs`, SQS send `argusai-staging-results`, `sns:Publish` trên `arn:aws:sns:ap-southeast-1:926883321040:argusai-staging-incident-email`, Logs `/aws/lambda/argusai-staging-sender:*`.
   - Lambda `argusai-staging-sender` (`python3.12`, `x86_64`, `30s`, alias `live`), env: `APPLICATION_RESULTS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/926883321040/argusai-staging-results`, `INTERNAL_API_BASE_URL=https://argusai-staging.duckdns.org/api/v1`, `INTERNAL_SERVICE_TOKEN=<khớp /camerai/staging/runtime-env>`, `SENDER_DRY_RUN=true`, `SNS_TOPIC_ARN`.
   - Event Source Mapping từ `argusai-staging-notification-jobs` → `argusai-staging-sender:live` (`BatchSize: 1`, `FunctionResponseTypes: ["ReportBatchItemFailures"]`, ban đầu `--no-enabled` tới khi PR claim/outcome đã lên Staging).
4. **SMS / Connect Staging (nếu khả dụng):** Tạo Amazon Connect instance/outbound flow `argusai-staging-emergency-outbound`, bổ sung `connect:StartOutboundVoiceContact` (`Resource: "*"` + `Condition: {"StringEquals": {"aws:RequestedRegion": "ap-southeast-1"}}`) vào `ArgusAI-Lambda-Staging-Sender`.
5. **Cập nhật quyền CD & SSM Staging:**
   - Bổ sung vào `ArgusAI-GitHub-Staging-Policy`: quyền `lambda:GetFunction`, `UpdateFunctionCode`, `GetFunctionConfiguration`, `PublishVersion`, `UpdateAlias`, `CreateAlias`, `GetAlias`, `InvokeFunction` trên `argusai-staging-sender*`.
   - Khi code trong PR đã đọc biến mới, cập nhật SSM `/camerai/staging/runtime-env`: `NOTIFICATION_DRIVER=sqs`, `SNS_TOPIC_ARN=arn:aws:sns:ap-southeast-1:926883321040:argusai-staging-incident-email`, `SENDER_DRY_RUN=true` (và `CONNECT_INSTANCE_ID`, `CONNECT_CONTACT_FLOW_ID` nếu bật). Lưu ý giới hạn 4 KB Standard tier của Parameter Store.

### 3.2. Cập nhật CD trong PR & Danh sách gửi Repo Owner (**Dương Đại Phát**) cho `staging`

- Trong PR (tách 2 PR nhỏ nếu cần: Cognito fix & Notification E2E), bổ sung đóng gói `sender.zip` vào `cd.yml` và step cập nhật `SENDER_FUNCTION_NAME` / `SENDER_FUNCTION_ALIAS` trong `deploy-environment.yml`.
- **Note gửi Repo Owner — Dương Đại Phát (GitHub Environment `staging`):**

| Loại trên GitHub (`Environment: staging`) | Tên biến / secret                                                | Giá trị / Nguồn                            | Khi nào cần thêm                                             |
| ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Environment Variable                      | `SENDER_FUNCTION_NAME`                                           | `argusai-staging-sender`                   | Trước khi merge PR nối CD cho Sender vào `main`              |
| Environment Variable                      | `SENDER_FUNCTION_ALIAS`                                          | `live` _(mặc định nếu bỏ trống)_           | Cùng lúc với `SENDER_FUNCTION_NAME`                          |
| Environment Secrets _(nếu đổi user test)_ | `SMOKE_TEST_EMAIL`, `SMOKE_TEST_PASSWORD`, `SMOKE_REFRESH_TOKEN` | Credentials tài khoản test Cognito Staging | Khi tạo mới hoặc xoay tài khoản test cho `tools/cd/smoke.sh` |

### 3.3. Nghiệm thu E2E trên Staging (`https://argusai-staging.duckdns.org`)

Sau khi PR merge `main` → CI xanh → CD `staging` hoàn tất:

1. Kiểm tra `GET https://argusai-staging.duckdns.org/api/v1/health` đúng `RELEASE_ID`, test đăng nhập Cognito với 2 user khác household (`200` / `401` / `403` / refresh / logout).
2. Bật Event Source Mapping `argusai-staging-sender:live`, test ca `DRY_RUN` (`SKIPPED`), sau đó test gửi email thật tới hộp thư test Staging (`SENT` + `MessageId` + xác nhận nhận thư).
3. Sau khi ghép cùng phần Deadline của B, chạy một ca hết hạn từ `NOTIFIED` → `ESCALATED` đi xuyên suốt qua Sender Staging. Ghi lại `RELEASE_ID`, `eventId`, `notificationId`, `attemptId`, `outcomeId`, `providerId` (che thông tin riêng tư).

---

## 4. Giai đoạn Production — Tự tạo services Production, Note GitHub & Xác minh (`https://argusai.dynv6.net/login`)

_(Chỉ triển khai khi các PR của A đã pass nghiệm thu trên Staging và hạ tầng nền Production ở `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md` đã được C cutover)._

### 4.1. Tự tạo các services của A trên Production (`argusai-production-*`)

1. **Cognito Production (`5p3hgqnkmjrdc5ktb99ur46hjr`):**
   - Kiểm tra Callback `https://argusai.dynv6.net/auth/callback` và Logout `https://argusai.dynv6.net`.
   - Nếu `smoke.sh` dùng `SMOKE_TEST_EMAIL`/`SMOKE_TEST_PASSWORD`, bật thêm `ALLOW_USER_PASSWORD_AUTH` trong `ExplicitAuthFlows` của client `5p3hgqnkmjrdc5ktb99ur46hjr` (hoặc xuất `SMOKE_REFRESH_TOKEN` từ tài khoản test read-only Production) và xác nhận mapping `(cognito_issuer, cognito_sub)` trong DB Production.
2. **SNS & Sender Lambda Production (tách biệt hoàn toàn khỏi Dev/Staging):**
   - Tạo SNS Standard topic `argusai-production-incident-email` + confirm email nhận cảnh báo Production hợp lệ.
   - Tạo Log Group `/aws/lambda/argusai-production-sender` (retention 14–30 ngày).
   - Tạo Role `ArgusAI-Lambda-Production-Sender`: SQS consume `argusai-production-notification-jobs`, SQS send `argusai-production-results`, `sns:Publish` trên `argusai-production-incident-email`, Logs `/aws/lambda/argusai-production-sender:*` (thêm `connect:StartOutboundVoiceContact` với Region condition nếu bật Connect Production).
   - Tạo Lambda `argusai-production-sender` (`python3.12`, `x86_64`, `30s`, alias `live`), env: `APPLICATION_RESULTS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/926883321040/argusai-production-results`, `INTERNAL_API_BASE_URL=https://argusai.dynv6.net/api/v1`, `INTERNAL_SERVICE_TOKEN=<khớp /camerai/production/runtime-env>`, `SENDER_DRY_RUN=true` (chỉ chuyển `false` sau khi smoke Production đạt), `SNS_TOPIC_ARN`, và Event Source Mapping (`BatchSize: 1`, `ReportBatchItemFailures`).
   - Nếu bật Amazon Connect Production: tạo instance/flow riêng cho Production, không dùng chung với Staging.
3. **Cập nhật quyền CD & SSM Production:**
   - Thêm quyền update/alias `argusai-production-sender*` vào `ArgusAI-GitHub-Production-Policy`.
   - Cập nhật SSM `/camerai/production/runtime-env`: `NOTIFICATION_DRIVER=sqs`, `SNS_TOPIC_ARN`, `SENDER_DRY_RUN` (và `CONNECT_*` nếu có).

### 4.2. Note gửi Repo Owner (**Dương Đại Phát**) cho GitHub Environment `production`

| Loại trên GitHub (`Environment: production`) | Tên biến / secret / hành động                                    | Giá trị / Yêu cầu                                              | Khi nào cần thực hiện                                     |
| -------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Environment Variable                         | `SENDER_FUNCTION_NAME`                                           | `argusai-production-sender`                                    | Trước khi duyệt release đầu tiên có Sender lên Production |
| Environment Variable                         | `SENDER_FUNCTION_ALIAS`                                          | `live`                                                         | Cùng lúc với `SENDER_FUNCTION_NAME`                       |
| Environment Secrets                          | `SMOKE_TEST_EMAIL`, `SMOKE_TEST_PASSWORD`, `SMOKE_REFRESH_TOKEN` | Tài khoản test read-only riêng cho `https://argusai.dynv6.net` | Trước khi bật Production smoke có authenticated API       |
| Approval Gate                                | **Approve deployment `production`**                              | Kèm link CD run + bằng chứng Staging PASS của A                | Mỗi release promote từ Staging sang Production            |

### 4.3. Nghiệm thu Production tại `https://argusai.dynv6.net/login`

1. Mở `https://argusai.dynv6.net/login` bằng tài khoản Production hợp lệ → kiểm tra Cognito PKCE redirect `/auth/callback`, đọc `/auth/me`, kiểm tra DevTools không gọi `localhost` hay `argusai-staging.duckdns.org`, kiểm tra logout.
2. Kiểm tra luồng Notification với release ID đã promote (`DRY_RUN` hoặc 1 ca email có kiểm soát tới người nhận cho phép), xác nhận `notifications` cập nhật đúng trạng thái và không có message rơi vào `argusai-production-notification-jobs-dlq` hoặc `argusai-production-results-dlq`.

---

## 5. Bàn giao tổng hợp cho C & Repo Owner

Ghi lại theo từng môi trường (**Dev / Staging / Production**) gồm: commit SHA / `RELEASE_ID`, Cognito Client ID & test user mapping (không ghi mật khẩu), tên SNS topic/subscription/Connect IDs, tên Lambda Function/Alias/Version, SQS Event Source Mapping UUID, các biến SSM đã thêm, danh sách GitHub Variables/Secrets đã yêu cầu **Dương Đại Phát** cập nhật, và bằng chứng E2E (`eventId`, `notificationId`, `attemptId`, `outcomeId`, `providerId` đã che dữ liệu nhạy cảm).
