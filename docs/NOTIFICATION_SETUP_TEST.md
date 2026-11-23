# Hướng dẫn setup và kiểm thử notification AWS

Hướng dẫn cho backend/UI và Sender trên nhánh có migration 0025. Phạm vi gồm setup
Dev, kiểm thử dry-run/email thật, đối soát và điều kiện triển khai Staging/Production.
Không coi việc tạo tài nguyên hoặc chạy unit test là đã nghiệm thu E2E.

Tham chiếu: [ERD](database/ERD.md), [giao việc Người A](../aws/sprint4/02_NGUOI_A_DANG_NHAP_THONG_BAO.md),
[README Sender](../services/aws-workers/sender/README.md), [bằng chứng và bàn giao](../aws/sprint4/10_NOTIFICATION_IMPLEMENTATION_SETUP_TEST.md).

## 1. Luồng và thuật ngữ

```text
Sự kiện thật từ camera / AI
 → intent trong notifications + cloud_jobs (cùng transaction DB)
 → dispatcher → SQS Notification Jobs → Lambda Sender
 → backend cấp claim → DRY_RUN hoặc provider SNS/Connect
 → lưu cached outcome → Results queue / HTTP fallback
 → receipt + outcome + trạng thái notifications → Web
```

- **Intent:** ý định gửi cảnh báo cho một người nhận qua một kênh.
- **Claim / lease:** quyền xử lý gửi do backend cấp, có thời hạn; REAL lease hết hạn không tự cho phép gửi lại.
- **Route:** cấu hình người nhận đã kiểm tra, gồm owner, user/contact, đích gửi và topic nếu là email.
- **Outcome / receipt:** kết quả gửi chuẩn và bản ghi tiếp nhận để chống áp dụng lặp.
- **DRY_RUN:** chạy hết policy nhưng không gửi tới provider; **DLQ:** queue giữ message xử lý thất bại để điều tra.

## 2. Chọn đúng môi trường và chuẩn bị tài nguyên

| Thành phần     | Dev kiểm thử riêng                            | Staging                                   | Production                                   |
| -------------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| APP_ENV        | dev                                           | staging                                   | production                                   |
| Backend        | localhost + HTTPS tunnel                      | https://argusai-staging.duckdns.org       | https://argusai.dynv6.net                    |
| Sender         | camerai-s4-dev-sender                         | argusai-staging-sender                    | argusai-production-sender                    |
| Jobs           | Queue Dev riêng của người kiểm thử            | argusai-staging-notification-jobs         | argusai-production-notification-jobs         |
| Results        | Queue Dev riêng, chỉ một consumer cho DB test | argusai-staging-results                   | argusai-production-results                   |
| Email topic    | Topic riêng của đúng người nhận               | Topic Staging đã xác minh đúng người nhận | Topic Production đã xác minh đúng người nhận |
| Runtime secret | `.env` local, ngoài Git                       | SSM /camerai/staging/runtime-env          | SSM /camerai/production/runtime-env          |

Kiểm danh tính trước khi thao tác AWS:

```powershell
$awsArgs = @('--profile', 'camerai-lab', '--region', 'ap-southeast-1', '--no-cli-pager')
aws @awsArgs sts get-caller-identity
```

Dùng lại tài nguyên đã có; chỉ tạo phần thiếu sau khi đối chiếu môi trường. Cần Jobs,
Results và DLQ cho từng queue; DLQ redrive phù hợp, Lambda/SQS cùng Region. Với timeout
Lambda 30 giây, Jobs visibility tối thiểu theo khuyến nghị là 180 giây cộng batching window;
batch size 1, batching window 0, `ReportBatchItemFailures`. Xem [AWS SQS/Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).

Role Lambda cần ReceiveMessage/DeleteMessage/GetQueueAttributes trên đúng Jobs,
SendMessage trên đúng Results, Publish trên đúng SNS topic và Logs đúng function.
Log retention: Dev/Staging 7 ngày; Production theo chính sách nhóm. SMS/Connect chỉ
được bật khi tài khoản, số gửi/nhận và contact flow đủ điều kiện.

## 3. Backup và áp dụng migration

Giữ `.env` riêng của máy. Chạy từ root repository, dừng tất cả instance/consumer dùng
chung DB trước khi đổi driver; giữ mapping Sender Disabled trong quá trình chuẩn bị.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @cam/contracts build
docker compose stop orchestrator
```

Backup DB đích bằng `pg_dump` hoặc quy trình backup đã được nhóm xác nhận; kiểm tra
file backup không rỗng và có cách restore trên DB riêng. Không đưa dump vào Git.

```powershell
pnpm db:migrate
pnpm --filter @cam/orchestrator build
```

`pnpm db:migrate` dùng `DATABASE_URL` trong `.env`. Không chạy `db:reset` hoặc xóa volume
để cập nhật DB có dữ liệu. Hai file 0025 là:

- `0025_notification_claim_outcome.sql`: driver, route, attempt, quyết định NO_OP, index và FK outcome.
- `0025_notification_email_rules.sql`: thêm email cho lửa/khói, té/ngã, vùng cấm, người lạ; giữ kênh/threshold cũ, không gửi lại sự kiện cũ.

Công cụ migration theo dõi bằng tên file đầy đủ. Không đổi nội dung/tên file đã áp dụng.
`pnpm argus cloud` áp dụng preset Cloud cho cả Face/storage và migration cần thiết;
chỉ dùng khi các tài nguyên Face/S3 tương ứng đã sẵn sàng. Lệnh này **không tự bật**
notification SQS trong DB. Chỉ bật riêng notification thì giữ Face mode hiện tại.

## 4. Cấu hình backend và driver trong DB

Bổ sung vào `.env` local; với cloud dùng runtime-env của đúng môi trường. Các giá trị
trong dấu `<...>` phải thay bằng tài nguyên thực trước khi dùng.

```dotenv
APP_ENV=dev
NOTIFICATION_DRIVER=sqs
SENDER_DRY_RUN=true
AWS_REGION=ap-southeast-1
NOTIFICATION_JOBS_QUEUE_URL=<JOBS_QUEUE_URL>
APPLICATION_RESULTS_QUEUE_URL=<RESULTS_QUEUE_URL>
APPLICATION_RESULTS_CONSUMER_ENABLED=true
SNS_TOPIC_ARN=<VERIFIED_RECIPIENT_TOPIC_ARN>
INTERNAL_SERVICE_TOKEN=<RANDOM_SECRET_AT_LEAST_32_CHARACTERS>
WEB_ORIGIN=http://localhost:3000
SENDER_NOTIFICATION_CAP=5
SENDER_COOLDOWN_SECONDS=60
SENDER_LEASE_SECONDS=120
SENDER_INTENT_TTL_SECONDS=300
SNS_SMS_ENABLED=false
```

Không in hoặc chụp token. Backend và Lambda phải dùng cùng secret. Giữ nguyên cấu
hình storage hợp lệ; muốn mở ảnh từ điện thoại/máy khác cần URL storage truy cập được,
ví dụ S3 private với URL ký số. MinIO `localhost` chỉ mở được trên máy chạy MinIO.

Sau khi dừng mọi instance dùng DB, kiểm tra và đổi driver bằng kết nối quản trị **đúng DB đích**:

```sql
BEGIN;
SELECT current_database(), mode, notification_driver
FROM cloud_transport_mode WHERE singleton FOR UPDATE;
UPDATE cloud_transport_mode SET notification_driver='sqs' WHERE singleton;
COMMIT;
```

Không thay `mode` Face nếu chỉ bật notification. Backend kiểm driver cấu hình khớp DB.
Không để hai backend khác DB cùng đọc một Results queue. Sau thay env, recreate:

```powershell
docker compose up -d --build --no-deps --force-recreate orchestrator
docker compose ps
Invoke-RestMethod http://localhost:3001/api/v1/health
```

Kết quả mong đợi: backend health `ok`, không báo mismatch driver/queue/APP_ENV.
`restart` đơn thuần không nạp lại env mới của Compose.

## 5. Chọn người giám sát và xác minh email route

Mặc định intent ưu tiên `CAREGIVER` active cùng household; nếu nhiều người thì chọn
theo `created_at,id`, nếu chưa có thì dự phòng chủ thiết bị. Cần kiểm rõ người được
chọn trước khi test; đăng nhập bằng user nào không tự đổi email nhận cảnh báo.

1. Xác định `devices.owner_user_id` của camera và tài khoản người giám sát. Email
   user phải đúng đích dự kiến, user active và có quyền camera.
2. Tạo/dùng SNS **Standard** topic riêng, subscribe email đó; người nhận bấm
   **Confirm subscription** trong thư AWS. [Hướng dẫn xác nhận SNS](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html).
3. Kiểm topic không có subscription của người/hộ khác. SNS publish tới topic không
   tự giới hạn theo email trong route; topic chứa ảnh riêng tư phải có đúng người nhận.
4. Provision route sau khi đã kiểm subscription. Chưa có màn hình quản trị route;
   thao tác này do người vận hành thực hiện trên DB đúng môi trường.

Ví dụ tạo route ở trạng thái chưa bật; thay UUID/email/topic thật, không chạy nguyên placeholder:

```sql
INSERT INTO cloud_notification_routes
  (owner_user_id,recipient_ref,channel,destination,topic_arn,enabled,verified_at)
VALUES
  ('<DEVICE_OWNER_UUID>'::uuid,'user:<CAREGIVER_UUID>','SNS_EMAIL',
   '<CAREGIVER_ACCOUNT_EMAIL>','<VERIFIED_RECIPIENT_TOPIC_ARN>',false,NULL)
ON CONFLICT (owner_user_id,recipient_ref,channel) DO NOTHING;
```

Nếu route đã tồn tại, đọc và đối chiếu trước; không ghi đè cấu hình người khác. Chỉ
sau bước xác minh mới cập nhật `enabled=true`, `verified_at=clock_timestamp()` cho
đúng khóa/đích/topic. Khi claim backend kiểm lại email hiện tại, owner, trạng thái
và quyền camera; đổi email tài khoản cần xác minh lại subscription và route.

## 6. HTTPS tunnel cho Dev localhost

Sender AWS phải gọi được backend qua HTTPS. Nếu đã có tunnel đang dùng thì kiểm tra
lại URL trước khi tái sử dụng; URL Quick Tunnel có thể thay khi khởi động lại.

Tạo `artifacts/DevCloud.Caddyfile` từ mẫu sau nếu chưa có. Caddy chạy **trên host**;
chỉ expose bốn route notification, các route khác trả 404. Mọi route nội bộ vẫn yêu cầu token.

```caddyfile
http://:8787 {
    bind 127.0.0.1
    @context {
        method GET
        path_regexp context ^/api/v1/internal/notifications/[0-9a-fA-F-]{36}$
    }
    @claim {
        method POST
        path_regexp claim ^/api/v1/internal/notifications/[0-9a-fA-F-]{36}/claim$
    }
    @result {
        method PUT
        path_regexp result ^/api/v1/internal/notifications/[0-9a-fA-F-]{36}/result$
    }
    @outcome {
        method POST
        path_regexp outcome ^/api/v1/internal/notifications/[0-9a-fA-F-]{36}/outcome$
    }
    handle @context {
        reverse_proxy 127.0.0.1:3001
    }
    handle @claim {
        reverse_proxy 127.0.0.1:3001
    }
    handle @result {
        reverse_proxy 127.0.0.1:3001
    }
    handle @outcome {
        reverse_proxy 127.0.0.1:3001
    }
    handle {
        respond "Not found" 404
    }
}
```

Chạy ở hai terminal riêng, sau khi đã có Caddy/cloudflared trên máy:

```powershell
caddy validate --config artifacts/DevCloud.Caddyfile --adapter caddyfile
caddy run --config artifacts/DevCloud.Caddyfile --adapter caddyfile
```

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

Lấy origin HTTPS từ output, cấu hình Lambda `INTERNAL_API_BASE_URL=https://<tunnel>/api/v1`.
Nếu chạy Caddy trong Docker, dùng cấu hình upstream host phù hợp (`host.docker.internal`),
không dùng loopback container để gọi backend host; publish proxy chỉ trên loopback host.
Kiểm tra: route context UUID hợp lệ thiếu token trả 401; URL ngoài phạm vi trả 404;
token hợp lệ với UUID không tồn tại trả 404. Không dán token vào Console, command history hay báo cáo.

Tham khảo [Caddy matchers](https://caddyserver.com/docs/caddyfile/matchers) và
[Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/).

## 7. Build và cấu hình Lambda Sender

```powershell
py -3.12 -m venv services/aws-workers/.build/sender-test-venv
& services/aws-workers/.build/sender-test-venv/Scripts/python.exe -m pip install -r services/aws-workers/sender/requirements.txt coverage
& services/aws-workers/.build/sender-test-venv/Scripts/python.exe services/aws-workers/verify_sender.py
py -3.12 services/aws-workers/build.py --worker sender
Get-FileHash services/aws-workers/.build/sender.zip -Algorithm SHA256
```

ZIP cần handler ở root; cấu hình Lambda Python 3.12, x86_64, timeout 30 giây,
handler `handler.lambda_handler`. Lambda còn dùng handler khung phải được cập nhật.
Không commit ZIP/venv/dependencies đã cài lên Git.

```dotenv
APP_ENV=dev
APPLICATION_RESULTS_QUEUE_URL=<RESULTS_QUEUE_URL_SAME_ENVIRONMENT>
INTERNAL_API_BASE_URL=https://<BACKEND_OR_TUNNEL>/api/v1
INTERNAL_SERVICE_TOKEN=<SAME_SECRET_AS_BACKEND>
SENDER_DRY_RUN=true
SNS_TOPIC_ARN=<SAME_VERIFIED_TOPIC_AS_BACKEND>
```

Publish version, trỏ alias `live` đúng version mới. Mapping Jobs phải trỏ tới alias,
batch 1 và `ReportBatchItemFailures`, ban đầu Disabled. Liệt kê theo tên có `:live`
hoặc theo queue ARN để không bỏ sót mapping alias. Reserved concurrency 0 nghĩa là
Lambda chưa thể chạy; kiểm quota trước khi cấp lại capacity cho ca test, không tự
thay quota hoặc tác động function khác. Chỉ bật mapping khi đủ backend/schema/env/route.

### Kênh SMS / cuộc gọi nếu có trong phạm vi nghiệm thu

- SMS: backend cần `SNS_SMS_ENABLED=true`, route `SNS_SMS` có số E.164 đã được phép;
  role Sender có quyền `sns:Publish` phù hợp việc gửi SMS và tài khoản đã đủ điều kiện.
- Connect: backend và Lambda cùng có `CONNECT_INSTANCE_ID`, `CONNECT_CONTACT_FLOW_ID`,
  `CONNECT_SOURCE_PHONE_NUMBER`; role Sender có `connect:StartOutboundVoiceContact`
  theo policy đã review cho môi trường. Flow đọc contact attribute `message` để phát
  nội dung; liên hệ phải đúng owner, enabled và verified.
- Không thêm topic email cho route SMS/Connect: CHECK trong schema chỉ cho `topic_arn`
  khác NULL với `SNS_EMAIL`. Nếu chưa có provider hợp lệ, giữ dry-run và ghi rõ phần bị chặn.

## 8. Ma trận kiểm thử và tiêu chí đạt

### Tự động, không gửi email thật

```powershell
pnpm test:notification
pnpm --filter @cam/web test:notification
node --test tools/scripts/test/argus.test.mjs
pnpm typecheck
pnpm lint
pnpm api:lint
pnpm format:check
pnpm check:secrets
```

Notification integration dùng PostgreSQL testcontainer riêng khi Docker đang chạy.
`CAMERAI_NOTIFICATION_TEST_DATABASE_URL` là opt-in admin URL để tạo/drop database fixture
riêng; không đặt biến này trỏ tới Staging/Production. `verify_sender.py` ở mục 7 đo
Sender với AWS/API clients giả lập; đó là unit tests, không phải thư thực nhận.

| Gate                           | Điều kiện đạt                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Notification backend/transport | Jest gate >=91% lines/branches; tests không fail                                                          |
| Sender                         | >90% line và branch; tests không fail                                                                     |
| Web notification component     | Gate >=91% theo script test:notification của Web                                                          |
| Deploy script                  | Chạy `bash tools/cd/deploy-sender.test.sh` trong Bash/Git Bash, kết thúc `Sender deployment tests passed` |

### E2E từ giao diện và webcam thật

| Ca                   | Cách làm / kết quả mong đợi                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bảo vệ API           | Token nội bộ thiếu/sai trả 401; user không được đọc notification của household khác                                                                       |
| Thiếu route/provider | Tạo sự kiện thật khi chưa đủ cấu hình; nhận DRY_RUN/BLOCKED_PROVIDER và SKIPPED, không gọi provider                                                       |
| Dry-run có route     | Backend và Lambda cùng `SENDER_DRY_RUN=true`; tạo cảnh báo vùng cấm thật qua webcam; SKIPPED/LAB_DRY_RUN, providerCalled=false, có receipt/outcome        |
| Gửi thật             | Sau dry-run đạt, xác minh đúng người nhận và topic; đổi cả backend/Lambda sang false, recreate backend, publish/update alias Lambda; tạo một cảnh báo mới |
| Đối soát             | SNS trả MessageId; notifications=SENT; outcome=PROVIDER_ACCEPTED, providerCalled=true; receipt ACCEPTED; người nhận xác nhận hộp thư                      |
| Web                  | Mở đúng chi tiết sự kiện: Email — Nhà cung cấp đã tiếp nhận; không coi label này là bằng chứng thư đã tới inbox                                           |
| Nội dung/ảnh         | Đúng loại sự kiện, camera, khu vực, thời gian và prefix môi trường; link ảnh mở được trước hạn, chỉ đúng ảnh sự kiện                                      |
| Deadline             | Phối hợp B tạo ca NOTIFIED → ESCALATED, kiểm notification tương ứng và IDs                                                                                |

Nguồn webcam: đăng nhập đúng household → Camera → chọn thiết bị → bật detection và
đồng bộ → xem trước/phát WHIP → tạo vùng cấm ở Khu vực → ra khỏi khung hình rồi vào
vùng đủ thời gian dwell. Không chèn fixture/event giả vào DB để thay ca nghiệm thu.
Test từng loại sự kiện từ nguồn tương ứng nếu cần nghiệm thu lửa, té/ngã hay người lạ;
test rule tạo job không chứng minh model đã nhận diện đúng các loại đó.

Email SNS là văn bản kèm link ảnh, không có ảnh nhúng. URL ảnh tối đa 15 phút, có thể
ngắn hơn theo retention. Nếu ảnh chưa tới hoặc ký link lỗi/quá 500 ms, thư ghi ảnh
chưa sẵn sàng. Link là quyền truy cập tạm thời: che link trong bằng chứng công khai.

Ghi `commit/releaseId`, `eventId`, `notificationId`, `attemptId`, `outcomeId`,
`providerId`, trạng thái Web và xác nhận inbox/ảnh; không ghi mật khẩu, internal token
hoặc link ảnh ký số. Một ca vùng cấm đạt không thay thế mọi ca nhận diện khác.

## 9. Triển khai Staging và Production

1. Push nhánh → PR → review/CI → merge main → CI main đạt → CD. Code phải có packaging
   Sender và step `deploy-sender.sh`; chỉ mở PR chưa deploy Staging.
2. Repo Owner xác nhận GitHub Environment variables: staging dùng
   `SENDER_FUNCTION_NAME=argusai-staging-sender`, production dùng
   `SENDER_FUNCTION_NAME=argusai-production-sender`, cả hai alias `live`.
   Workflow dừng trước khi deploy backend nếu tên hàm thiếu hoặc không khớp môi trường.
3. Phối hợp C cấp CD role quyền GetFunction/GetFunctionConfiguration/UpdateFunctionCode/
   **UpdateFunctionConfiguration**/PublishVersion/GetAlias/CreateAlias/UpdateAlias/InvokeFunction
   đúng ARN Sender; cấp quyền đọc release artifact. Không đổi role dùng chung mà chưa phối hợp.
4. SSM runtime-env, Lambda env, provider route/subscription, token và URLs phải khớp
   từng môi trường. Bắt đầu dry-run; giữ mapping Disabled tới khi migration/backend/worker đạt.
5. Backup, deploy, xác minh release và hai migration 0025. Kiểm API/schema, handler,
   code checksum, alias version, capacity và Results consumer trước khi test.
6. Chạy lại ma trận Cognito/household và notification ở Staging; chỉ promote Production
   khi Staging đạt và có approval theo quy trình nhóm. SMS/Connect chưa đủ điều kiện
   giữ DRY_RUN/BLOCKED_PROVIDER, ghi rõ phần chưa nghiệm thu.

## 10. Chẩn đoán nhanh và kết thúc ca test

`pnpm argus local` giữ Results consumer hoạt động nếu `NOTIFICATION_DRIVER=sqs`.
Dispatcher dừng tự thử lại sau lần lỗi thứ năm. Nếu mọi lần gửi đều bị SQS từ chối
rõ ràng và Sender chưa nhận quyền gửi, Web báo gửi thất bại. Hãy sửa cấu hình
SQS rồi tạo một sự kiện mới để kiểm tra luồng gửi. Nếu Web báo cần đối soát, hãy
đối chiếu notification ID với log của Sender và kết quả gửi trước khi gửi lại.
Kết quả hợp lệ đến muộn vẫn có thể cập nhật trạng thái.

| Hiện tượng                                    | Kiểm tra                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Có event nhưng không có email intent          | Event/rule có đủ điều kiện notify không; bốn risk rules có SNS_EMAIL; PERSON_DETECTED không mặc định gửi email |
| Có intent nhưng không chạy Sender             | Driver cấu hình/DB, dispatcher, Jobs queue, alias mapping Disabled, concurrency 0, IAM và Lambda handler/code  |
| SKIPPED/BLOCKED_PROVIDER                      | Route enabled/verified, user active, quyền camera, email khớp destination và topic được backend cho phép       |
| Gọi claim 401/timeout                         | Token backend/Lambda, origin tunnel còn sống, URL có /api/v1, phạm vi proxy và mạng                            |
| BUSY / CAP_EXCEEDED / EXPIRED / STALE_VERSION | Lease, cap, cooldown, tuổi intent và version event; không xóa ledger để ép gửi lại                             |
| SNS nhận nhưng Web còn PENDING                | Cached outcome, quyền gửi Results, consumer đúng DB, receipt/apply errors và Results DLQ                       |
| UNCERTAIN                                     | Đối soát provider trước; không tự resend hoặc coi chắc chắn chưa gửi                                           |
| Ảnh không mở được                             | Hạn URL, retention, object tồn tại, storage/bucket, hostname truy cập từ thiết bị nhận                         |

Khi kết thúc hoặc điều tra: tắt mapping trước, dừng quyền chạy/gửi thật theo quy trình,
đối soát message đang xử lý, rồi dừng tunnel nếu không còn test. Chỉ đổi driver về
local sau khi mọi instance/consumer liên quan đã dừng và công việc SQS tồn đã được
đối soát. Không xóa attempt/outcome/receipt hoặc tự chuyển intent đang chờ sang sender khác.

Kiểm queue/DLQ và ghi kết quả cuối. Giữ schema 0025 khi quay lại local; rollback code
không đồng nghĩa được phép drop bảng hoặc khôi phục DB đè lên dữ liệu mới.
