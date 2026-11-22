# Notification Sprint 4 — implementation, setup and verification

Updated: 22/11/2026. Assignment: [Person A](02_NGUOI_A_DANG_NHAP_THONG_BAO.md), contract: [G0](00_HOP_DONG_G0.md).

Hướng dẫn thao tác để chạy lại trên máy/môi trường khác: [Setup và test notification](../../docs/NOTIFICATION_SETUP_TEST.md).
Schema và ràng buộc: [ERD](../../docs/database/ERD.md). Các bằng chứng có ngày bên dưới là kết quả tại thời điểm ghi nhận.

## 1. Kết quả đã xác minh

Đã bổ sung code cho luồng notification và kiểm thử email thật trên **AWS Dev**, với DB, Redis, hàng đợi và SNS topic riêng cho đợt test. Người dùng đã xác nhận nhận thư có tiền tố `[ArgusAI][DEV]` trong hộp thư. Bàn giao code trên nhánh `feat/us-25-auth-notifications`; chưa push hoặc deploy phần code mới lên Staging/Production.

Luồng chạy:

```text
EscalationRepository.createNotificationIntent()
  → transaction PostgreSQL: notification + cloud_jobs (outbox)
  → dispatcher gửi notification.job vào SQS
  → Lambda Sender đọc job chuẩn từ backend
  → Claim: kiểm tra quyền/người nhận/version/cap/cooldown/lease
  → DRY_RUN hoặc gọi SNS/Connect
  → lưu canonical outcome qua API nội bộ
  → gửi outcome vào Results queue
  → Results consumer commit receipt + outcome + notification
  → xóa message SQS sau commit
  → Web đọc trạng thái tại chi tiết sự kiện
```

- **Outbox**: bản ghi công việc được lưu cùng transaction với ý định gửi, tránh lưu intent thành công nhưng mất job.
- **Claim**: backend cấp quyền thực hiện một lần gửi; queue không được tự quyết định người nhận.
- **Lease**: khoảng thời gian giữ quyền xử lý. Lease REAL hết hạn không tự cấp lại để tránh gửi trùng.
- **Canonical outcome**: kết quả chuẩn lưu ở backend trước khi đưa vào Results; gửi lại message sẽ dùng kết quả đã lưu.
- **Receipt**: bản ghi đã tiếp nhận outcome, giúp xử lý message lặp mà không cập nhật lại sai trạng thái.
- **DLQ**: hàng đợi giữ message thất bại sau số lần retry đã cấu hình để điều tra.

## 2. Những phần code đã thêm

| Phần          | File/thư mục chính                                                       | Công việc                                                               |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Contract      | `api/openapi.yaml`, generated contracts, G0                              | Claim, context/cache, outcome và API trạng thái notification            |
| DB            | `db/migrations/0025_notification_claim_outcome.sql`                      | Driver, route đã xác minh, attempts, decisions và ràng buộc outcome     |
| Backend       | `apps/orchestrator/src/notification-cloud/`                              | Claim/Outcome/cache, policy người nhận, budget, lease và chống gửi lặp  |
| Intent        | `apps/orchestrator/src/escalation/`                                      | Tạo job trong cùng transaction tạo notification                         |
| Transport     | `apps/orchestrator/src/cloud-queue/`                                     | SQS notification độc lập với Face; apply outcome trước khi acknowledge  |
| Web           | `EventNotifications.tsx`, `EventDetailModal.tsx`, events API             | Hiển thị trạng thái gửi theo quyền truy cập sự kiện                     |
| Sender        | `services/aws-workers/sender/`                                           | Lambda Python 3.12, SNS Email/SMS, Connect, cache/replay và time budget |
| Build/CD      | `build.py`, `tools/cd/deploy-sender.sh`, CD workflows                    | Đóng gói ZIP Linux, SHA-256, version/alias và kiểm tra môi trường       |
| Local tooling | `tools/argus/cli.mjs`                                                    | Áp dụng migration 0025 trước khi recreate backend                       |
| Verification  | `jest.notification.config.js`, `verify_sender.py`, notification workflow | Gate line và branch, minimum 91% cho phạm vi code notification          |

`NOTIFICATION_DRIVER=local` và `SENDER_DRY_RUN=true` là mặc định. Telegram tiếp tục dùng luồng hiện có. Các intent SNS/Connect ở SQS có driver riêng; Face có thể tiếp tục chạy local/BullMQ.

## 3. Cập nhật DB và build local

Chạy từ thư mục gốc repository. Giữ `.env` hiện có và bổ sung biến còn thiếu từ `.env.example`; không chép đè thông tin kết nối hoặc token đang dùng.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @cam/contracts build
docker compose stop orchestrator
```

Backup đúng DB đang kết nối trước khi migrate. Có thể dùng `pg_dump`/công cụ backup hiện có; kiểm tra file backup không rỗng, lưu ngoài Git. Sau đó chạy migration bằng môi trường đã có `DATABASE_URL`:

```powershell
pnpm db:migrate
pnpm --filter @cam/orchestrator build
docker compose up -d --build --force-recreate orchestrator
docker compose ps
docker compose logs --tail=80 orchestrator
```

Nếu chạy migration bên trong container, dùng công cụ migration với biến môi trường đã được Compose truyền vào. Script root hiện dùng `--env-file=.env`, nên phải có file `.env` ở thư mục thực thi khi dùng `pnpm db:migrate`. Không dùng `db:reset` để cập nhật DB có dữ liệu.

Migration mới là **0025**; không sửa migration đã áp dụng, không dùng các số 0023/0024 nhóm đã dành riêng. `pnpm argus local/cloud` có xử lý migration 0025, nhưng không tự bật notification SQS hay đổi driver notification trong DB.

## 4. Bật notification SQS có kiểm soát

Trước khi chuyển driver: dừng **tất cả** orchestrator/consumer kết nối cùng DB; tắt mapping Sender; kiểm tra các job đang chờ và kết quả chưa xử lý. Chỉ một consumer được đọc Results queue của một môi trường. Không nối DB test riêng vào Results queue dùng chung với backend khác.

Trong `.env` của backend:

```dotenv
APP_ENV=dev
NOTIFICATION_DRIVER=sqs
SENDER_DRY_RUN=true
AWS_REGION=ap-southeast-1
NOTIFICATION_JOBS_QUEUE_URL=<jobs queue của đúng môi trường>
APPLICATION_RESULTS_QUEUE_URL=<results queue của đúng môi trường>
APPLICATION_RESULTS_CONSUMER_ENABLED=true
SNS_TOPIC_ARN=<topic của người nhận đã xác minh>
SENDER_NOTIFICATION_CAP=5
SENDER_COOLDOWN_SECONDS=60
SENDER_LEASE_SECONDS=120
SENDER_INTENT_TTL_SECONDS=300
SNS_SMS_ENABLED=false
```

Giữ `FACE_JOB_TRANSPORT` đúng mode hiện tại của DB. `pnpm argus cloud` còn chuyển cấu hình Face/storage theo preset Cloud, vì vậy chỉ chạy khi cần chuyển cả preset và đã chuẩn bị tài nguyên Face tương ứng.

Sau khi dừng các instance, cập nhật DB mục tiêu bằng kết nối quản trị của môi trường đó:

```sql
SELECT current_database(), mode, notification_driver
FROM cloud_transport_mode WHERE singleton;

UPDATE cloud_transport_mode
SET notification_driver = 'sqs'
WHERE singleton;
```

Backend sẽ từ chối khởi động nếu driver trong `.env` khác driver DB. Chạy build/recreate sau khi thay biến; `restart` không nạp lại cấu hình Compose mới.

## 5. Chuẩn bị người nhận và Sender

1. SNS topic email phải có **đúng một subscriber được xác minh**, khớp email của user/contact được phép nhận. Tạo subscription rồi người dùng bấm Confirm. Không dùng topic có người nhận lạ để thử dữ liệu của household.
2. Kiểm tra quyền truy cập camera và user còn active; với contact phải thuộc đúng owner, enabled và verified.
3. Provision một record `cloud_notification_routes` cho đúng `owner_user_id`, `recipient_ref` (`user:<uuid>` hoặc `contact:<uuid>`), channel, destination và topic. Chỉ bật `enabled`/`verified_at` sau khi đã kiểm tra subscription thật. Đây là thao tác provisioning DB; chưa có màn hình quản trị route trong thay đổi này.
4. Role Lambda chỉ được consume jobs, publish Results, publish đúng topic và ghi log của môi trường tương ứng. Bổ sung Connect khi có provider thực tế.
5. Secret nội bộ phải khớp backend và Lambda, dài ít nhất 32 ký tự; lưu ngoài Git, không dán vào log/tài liệu.

Build Sender:

```powershell
py -3.12 services/aws-workers/build.py --worker sender
Get-FileHash services/aws-workers/.build/sender.zip -Algorithm SHA256
```

`build.py` không có `--worker` sẽ build cả Face và Sender. ZIP nằm trong `.build` và không đưa binary/dependency đã cài lên Git. Máy khác cài lại từ requirements và chạy script build.

Lambda phải có Python 3.12, x86_64, timeout 30 giây, handler **`handler.lambda_handler`**. Biến môi trường:

```dotenv
APP_ENV=dev
APPLICATION_RESULTS_QUEUE_URL=<results queue cùng môi trường>
INTERNAL_API_BASE_URL=https://<backend hoặc tunnel>/api/v1
INTERNAL_SERVICE_TOKEN=<secret khớp backend>
SENDER_DRY_RUN=true
SNS_TOPIC_ARN=<topic đã xác minh>
```

Publish version và trỏ alias `live` vào version đó. Event Source Mapping phải trỏ tới **alias**, batch size 1 và `ReportBatchItemFailures`; ban đầu Disabled. Khi liệt kê mapping, truyền tên function có qualifier `:live` để thấy mapping của alias. Các tham số mapping theo [AWS SQS event source documentation](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html).

Nếu backend chạy localhost, dùng HTTPS tunnel chỉ mở bốn route Sender bên dưới, vẫn bắt buộc `X-Internal-Token`; không mở rộng toàn bộ API quản trị:

| Method | Route dưới `/api/v1`                               |
| ------ | -------------------------------------------------- |
| GET    | `/internal/notifications/{notificationId}`         |
| POST   | `/internal/notifications/{notificationId}/claim`   |
| PUT    | `/internal/notifications/{notificationId}/result`  |
| POST   | `/internal/notifications/{notificationId}/outcome` |

## 6. Cách test và điều kiện đạt

### Gate tự động

```powershell
pnpm test:notification
pnpm --filter @cam/web test:notification
py -3.12 -m venv services/aws-workers/.build/sender-test-venv
& services/aws-workers/.build/sender-test-venv/Scripts/python.exe -m pip install -r services/aws-workers/sender/requirements.txt coverage
& services/aws-workers/.build/sender-test-venv/Scripts/python.exe services/aws-workers/verify_sender.py
pnpm test:tools
pnpm typecheck
pnpm lint
pnpm api:lint
pnpm format:check
pnpm check:secrets
```

`pnpm test:notification` cần Docker đang chạy để tạo PostgreSQL 16 testcontainer. Chạy regression deploy script bằng Bash/Git Bash: `bash tools/cd/deploy-sender.test.sh`. Các lỗi giả lập AccessDenied/checksum trong bộ test là ca âm; kết quả cuối phải là `Sender deployment tests passed` và exit code 0.

Coverage đo riêng code nghiệp vụ notification/Sender và component trạng thái gửi. Không dùng các số này để tuyên bố toàn repository đạt >90%.

Hook Python của repository dùng môi trường AI theo `services/ai-service/.python-version` (hiện là 3.11.13), còn Lambda Sender dùng Python 3.12. Trong đợt bàn giao, môi trường AI mới được cài riêng từ lockfile Windows tại `%LOCALAPPDATA%\CameraAI\ai-python-3.11.13`; môi trường cũ được giữ nguyên. Trên máy đã có môi trường này, chọn nó trong PowerShell trước khi chạy hook/AI checks hoặc commit:

```powershell
$env:CAMERAI_VENV = Join-Path $env:LOCALAPPDATA 'CameraAI\ai-python-3.11.13'
pnpm check:ai
```

Máy khác chuẩn bị Python/venv theo `docs/sprint-3/DEPENDENCY_BASELINE.md` rồi chạy `pnpm setup:ai`; không chép thư mục venv hoặc ZIP đã build vào Git.

| Gate đã chạy lại ngày 22/11                             | Tests | Line | Branch |
| ------------------------------------------------------- | ----- | ---- | ------ |
| Notification backend + SQS transport + PG16 integration | 122   | 100% | 98.40% |
| Sender handler                                          | 51    | 100% | 100%   |
| EventNotifications component                            | 5     | 100% | 100%   |

Regression toàn app: 634 tests backend và 373 tests frontend đều đạt. Tooling: 119 pass, một test phụ thuộc POSIX được skip trên Windows. Typecheck, lint, OpenAPI, secret scan và regression script deploy đã đạt; lint còn warnings, OpenAPI có 6 warnings. Review độc lập không phát hiện blocker quan trọng; reviewer không tự chạy lại AWS/test suites.

Kiểm tra trước commit ngày 22/11: đã chạy lại các gate Node ở trên và kiểm tra AI bằng môi trường Python 3.11.13 đúng lockfile Windows: 132 tests đạt, line coverage 90.80% của app AI. Đây là regression AI hiện có, không phải số branch coverage của Sender. Toàn bộ commit chạy qua hook lint-staged, secret scan và commitlint; không bỏ qua hook.

### Ca runtime theo thứ tự

1. Thiếu/sai internal token trả 401; route ngoài phạm vi tunnel không được expose.
2. Chưa có route được xác minh: `DRY_RUN`, `SKIPPED`, `BLOCKED_PROVIDER`, không gọi provider.
3. Có route hợp lệ, `SENDER_DRY_RUN=true`: `SKIPPED / LAB_DRY_RUN`, có receipt/outcome.
4. Chuyển cả backend và Lambda sang `SENDER_DRY_RUN=false`, publish/alias đúng version, chỉ tạo **một** notification có kiểm soát: SNS trả MessageId, DB `SENT`, xác nhận thư thực nhận.
5. Message lặp phải dùng cached outcome. Kiểm thử tự động bao gồm cache mismatch, REAL lease hết hạn, cap/cooldown, version/owner thay đổi, rollback và uncertainty.
6. Để nghiệm thu từ UI: đăng nhập đúng household, tạo sự kiện qua luồng ứng dụng, mở chi tiết sự kiện và kiểm tra mục trạng thái gửi. User khác household không được đọc dữ liệu. Ca cloud trong đợt này tạo intent bằng repository thật trên fixture riêng, **chưa thay thế bằng chứng UI xuyên suốt trên release tích hợp**.
7. Sau test, tắt mapping, đưa Sender về dry-run và đóng tunnel. `PROVIDER_ACCEPTED` chỉ chứng minh provider nhận yêu cầu; cần xác nhận hộp thư như bước 4 để chứng minh email đã tới.

`UNCERTAIN` giữ trạng thái PENDING và khóa tự gửi lại. Người vận hành phải đối soát provider trước khi xử lý; không tự đổi thành FAILED rồi resend.

### Cognito Dev — kiểm thử trình duyệt ngày 22/11/2026

Các kết quả dưới đây được xác nhận từ ảnh Network/Console do người dùng cung cấp trên localhost, với code làm việc hiện tại. Đây là bằng chứng Dev, không thay thế nghiệm thu Staging/Production.

| Ca kiểm tra                                            | Kết quả quan sát                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Access token hợp lệ / không token / token sai          | 200 / 401 / 401, cả ba pass                                                       |
| ID token dùng thay access token                        | 401, pass                                                                         |
| Hộ A đọc camera test A/B                               | 200 / 403, pass                                                                   |
| Hộ B đọc camera test A/B                               | 403 / 200, pass                                                                   |
| Danh sách camera của từng hộ A và B                    | Có camera test của mình, không có camera test của hộ kia, pass                    |
| Frontend khôi phục sau một request có token bị làm sai | API 401 → Cognito token endpoint 200 → retry API 200; giữ phiên                   |
| Logout                                                 | Cognito revoke 200, quay về login; access token, OIDC user và cookie phiên đã xóa |
| Cognito user hợp lệ chưa liên kết DB                   | /auth/me trả 403, USER_NOT_PROVISIONED, pass                                      |
| Truy cập không có cookie phiên                         | Agent gọi HTTP tới /, /cameras, /events: đều 307 với Location /login              |

Tài khoản test: hộ A `anhnksss6@gmail.com`, hộ B `anhnksss5+dev@gmail.com`; tài khoản chưa liên kết `anhnksss5+argus-dev-unlinked@gmail.com`. Kiểm tra DB read-only xác nhận hai camera test không được chia sẻ chéo và tài khoản unlinked không có bản ghi mapping.

Ca refresh chủ động làm sai token ở đúng một request GET để tạo 401 thật, sau đó frontend refresh thật. Chưa đo thời điểm token tự hết hạn theo thời gian, chưa thử nhánh refresh thất bại hoặc khẳng định mọi endpoint đều có cùng hành vi.

Quan sát UI còn lại: tài khoản USER_NOT_PROVISIONED vẫn thấy khung Dashboard và frontend tiếp tục poll camera với kết quả 403. Trong bằng chứng được gửi không có dữ liệu camera; đây là điểm cần xử lý trải nghiệm/tần suất gọi lại, không phải bằng chứng API đã cho truy cập. Chưa sửa source UI cho quan sát này.

Sau các ca trên, backend thông thường vẫn NOTIFICATION_DRIVER=local, SENDER_DRY_RUN=true; Sender Dev concurrency 0 và mapping test Disabled (đã đọc lại AWS ngày 22/11). Chưa chạy ca UI tạo notification qua SQS trong lượt kiểm thử này.

## 7. Bằng chứng AWS Dev ngày 21/11/2026

- Function có sẵn: `camerai-s4-dev-sender`; đã cập nhật từ stub sang Sender thật.
- Topic tạo riêng: `camerai-s4-dev-incident-email-anhnk`, một subscription email đã confirm.
- Bốn queue tạo riêng: `camerai-s4-dev-anhnk-notification-jobs`, `...-notification-jobs-dlq`, `...-results`, `...-results-dlq`.
- Policy bổ sung trên execution role Dev: `DevNotificationE2EAnhnkAccess`, chỉ cho tài nguyên test riêng.
- DB fixture: `camerai_sender_e2e_20261121`; Redis fixture riêng. DB ứng dụng thường giữ notification driver local.
- Mapping test tạo mới: `8e287073-21b0-42fb-9af1-bace3c37109d`. Mapping Dev dùng chung `fce03d2a-fb34-4145-a30f-4f02d8b17789` giữ Disabled.
- ZIP chạy trên Dev (version 2/3) SHA-256: `a81af86fc2cdd8853f5787fec17d72d2baa8a9e1eb2483771619ff7360047244`.
- Version 2: dry-run. Version 3: một ca REAL email. Sau test alias `live` đưa lại version 2, concurrency 0, mapping tắt.
- Tài khoản AWS có concurrency limit 10; không reserve 1 vì sẽ thấp hơn minimum unreserved 10. Trong ca test dùng unreserved capacity với mapping concurrency tối đa 2; sau test đặt lại reserved concurrency 0.
- Log retention Dev 7 ngày. Chưa thử SMS/Connect thật; provider chưa sẵn sàng thì BLOCKED_PROVIDER/dry-run.

| Ca          | Notification ID                        | Kết quả                                                                       |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| Thiếu route | `3ca6d290-f7f8-40ac-9727-82f970e6f13d` | SKIPPED, BLOCKED_PROVIDER, providerCalled=false                               |
| Dry-run     | `a890f21e-018f-4fc4-adab-e0f9caa8fdc7` | SKIPPED, LAB_DRY_RUN, providerCalled=false                                    |
| Email thật  | `f8ab45c5-d4f4-4148-8c00-8f11f3494215` | SENT, PROVIDER_ACCEPTED, providerCalled=true; người dùng xác nhận đã nhận thư |

Ca REAL: event `ba5995cf-2a7a-4546-85de-37ec5393597e`, provider ID `99e85357-fbec-5610-82fd-302c4d675a47`. Receipt ACCEPTED và cached outcome đã có trong DB.

Attempt `3a064341-32bd-4eba-8b11-bdf4b221b0cf`, outcome `5de3e210-ee59-451b-aff6-de462333c9ea`. Sau test, cả bốn queue/DLQ riêng đều có 0 message visible và 0 in-flight. Backend test, proxy, tunnel và Redis fixture đã dừng; backend thường tại cổng 3001 vẫn health `ok`.

Sau nghiệm thu, source Python được chuẩn hóa bằng Ruff và bổ sung giải thích cho hai exception boundary. Trước khi commit, hook Python của repo còn yêu cầu đặt tên `BlockedProviderError`, dùng `datetime.UTC` và tách phần xử lý phản hồi provider sang `invoke_provider` để đáp ứng giới hạn độ phức tạp. Đã chạy lại 51 test Sender với line/branch 100%; bản source sau chuẩn hóa chưa được gửi email thật lại trên AWS. Version Dev 2/3 vẫn là bản đã nghiệm thu email ở trên.

ZIP local đã build lại từ source chuẩn hóa trước commit có SHA-256 `5870d4b28ebc51356bfb7f4eae46d820e1de4c4f4e4b3ea958d95c1089398edf`. Đây là artifact local mới; version Dev 2/3 vẫn giữ artifact đã nghiệm thu ở trên.

Báo cáo/log chi tiết của máy chạy nằm tại `artifacts/notification-dev-e2e-2026-11-21/` (Git ignore). Secret, URL tunnel tạm và cấu hình riêng của máy lưu ngoài repository; không đưa chúng vào PR.

## 8. Bàn giao Staging và Production

Code CD đã chuẩn bị đóng gói/upload Sender, kiểm checksum, update handler nếu còn stub, publish version và update alias. Script giữ nguyên dry-run, concurrency và trạng thái mapping; release code không tự bật gửi thật.

Repo Owner thêm vào **Settings → Environments → môi trường tương ứng → Environment variables**:

| Environment | SENDER_FUNCTION_NAME      | SENDER_FUNCTION_ALIAS |
| ----------- | ------------------------- | --------------------- |
| staging     | argusai-staging-sender    | live                  |
| production  | argusai-production-sender | live                  |

IAM CD cần GetFunctionConfiguration, UpdateFunctionCode, **UpdateFunctionConfiguration** (đổi handler), PublishVersion, GetAlias, CreateAlias và UpdateAlias; các bước smoke/kiểm tra function còn cần quyền tương ứng theo pipeline. Quyền phải giới hạn function đúng môi trường. Cập nhật Lambda configuration là thao tác riêng, theo [AWS CLI documentation](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-configuration.html).

Phối hợp C để rà soát SSM `/camerai/<env>/runtime-env`, token nội bộ, Cognito client/origin và queue URLs đúng môi trường trước khi bật SQS. Tài liệu này không xác nhận trạng thái hiện tại của SSM/IAM/GitHub environments trên Staging/Production; phải kiểm tra trực tiếp khi triển khai.

Các bước còn chờ:

- Merge PR/CI xanh rồi deploy Staging, migration 0025 có backup.
- Chạy lại ma trận Cognito trên release Staging/Production mới. Các ca Dev đã có kết quả ngày 22/11 ở mục trên; kết quả refresh hiện dùng một request có token bị làm sai, chưa đo hết hạn tự nhiên hoặc nhánh refresh thất bại.
- Chạy UI → intent → Sender → trạng thái trên Web; ghép ca Deadline của B và ghi RELEASE_ID, event/notification/attempt/outcome/provider IDs.
- Chỉ promote Production sau Staging đạt và có approval theo quy trình nhóm.
- SNS SMS/Connect thật cần quyền/subscription, số gọi và flow hợp lệ; chưa nghiệm thu thì giữ dry-run/BLOCKED_PROVIDER.

## 9. Hoàn nguyên chế độ test

Tắt mapping trước; giữ concurrency 0/dry-run trong khi điều tra. Dừng mọi instance dùng DB đó rồi mới đổi `NOTIFICATION_DRIVER` và `cloud_transport_mode.notification_driver` về local. Không tự chuyển các notification SQS đang PENDING sang sender khác, không xóa cached outcome/attempt/receipt để ép gửi lại. Đối soát hoặc đóng từng công việc theo quy trình.

Migration 0025 là thay đổi cộng thêm. Giữ schema khi quay lại driver local; nếu cần phục hồi DB, dùng backup đã kiểm tra với kế hoạch downtime và xác định đúng DB, không chạy reset hàng loạt.

## 10. Nhánh và nhóm commit bàn giao

Nhánh `feat/us-25-auth-notifications` theo format lowercase `feat/<story-id>-<short-description>`. US-25 là story Cognito được nêu trong file giao việc của A; nhánh này bàn giao phần notification cùng bằng chứng xác thực Dev của A.

Commit dùng tiêu đề/body tiếng Anh và scope thuộc danh sách trong `docs/conventions/GIT_WORKFLOW.md`. Chia các thay đổi theo nhóm logic; phần giải thích tiếng Việt để đối chiếu:

| Commit                                                            | Diễn giải tiếng Việt                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `feat(db): add notification claims and delivery policies`         | Thêm migration 0025 lưu policy, claim và quyết định gửi      |
| `feat(api): define notification delivery contracts`               | Bổ sung OpenAPI và sinh contract notification                |
| `feat(orchestrator): add notification claim and outcome policies` | Nối intent và kiểm soát claim/outcome theo policy            |
| `feat(orchestrator): dispatch and consume notification SQS jobs`  | Bổ sung dispatcher/Results và coverage cho SQS               |
| `feat(orchestrator): expose event notification delivery status`   | Thêm API trạng thái gửi có kiểm tra quyền                    |
| `feat(infra): implement notification sender worker`               | Thêm Sender Python, kiểm thử coverage và build ZIP           |
| `feat(web): show event notification delivery status`              | Hiển thị trạng thái gửi trong chi tiết sự kiện               |
| `ci(ci): package and deploy notification sender releases`         | Thêm đóng gói, checksum, deploy alias và gate kiểm thử       |
| `chore(repo): apply notification migration in dev presets`        | Đồng bộ migration 0025 trong công cụ chuyển mode local/cloud |
| `docs(docs): record notification setup and Dev verification`      | Ghi lại setup, test, kết quả Dev và các phần chưa nghiệm thu |

Xem commit thực tế sau khi bàn giao:

```powershell
git branch --show-current
git log --oneline 8495cf2..HEAD
git status
```

Chưa push hoặc mở PR trong đợt tạo commit này. Kích thước thay đổi cần được tách thành các PR phù hợp rule khi chuyển sang bước review, không coi nhiều commit trên một nhánh là đã tự đáp ứng giới hạn kích thước PR.

## 11. Email SNS chi tiết và liên kết ảnh — cập nhật 22/11/2026

Theo lựa chọn của người dùng, tiếp tục dùng SNS email dạng văn bản, không thêm SES. Nội dung gửi thật được lấy từ đúng event khi claim đã qua kiểm tra owner, người nhận, phiên bản, hạn mức và cooldown.

Email mới gồm:

- Tiêu đề `[ArgusAI][DEV|STAGING|PRODUCTION] <loại sự kiện> — <tên camera>`.
- Loại sự kiện, mức độ P0–P3, thời gian theo timezone của camera, tên camera, khu vực, độ tin cậy AI nếu có và mã sự kiện.
- Link ký số tới snapshot/thumbnail của đúng sự kiện, cùng kho và bucket đang cấu hình. Link có hạn tối đa 15 phút và không vượt hạn lưu ảnh.
- Nếu chưa có ảnh hoặc tạo link lỗi/quá 500 ms, vẫn gửi thông báo với dòng ảnh chưa sẵn sàng. Link ảnh không đi vào job/outcome/receipt hoặc log ứng dụng.
- Link mở ứng dụng lấy từ `WEB_ORIGIN`; localhost được ghi rõ chỉ mở trên máy chạy dự án. Link ảnh MinIO localhost trong môi trường khác cũng chỉ dùng được trên máy đó; ca Dev này đã xác minh ảnh S3 qua HTTPS.

Giữ nguyên nội dung DRY_RUN không chứa chi tiết sự kiện. Điểm quan sát người từ Frigate không được thay thế điểm AI của sự cố. Không thêm xử lý video, hạ độ phân giải hoặc thay đổi luồng xem trực tiếp.

Lưu ý người nhận: SNS gửi tới mọi subscription của topic. Chỉ bật nội dung/ảnh chi tiết trên topic riêng đã kiểm tra đúng người nhận; không dùng topic chung nhiều household. Link ký số là quyền truy cập tạm thời: người có link có thể mở ảnh trước khi hết hạn.

Kết quả kiểm tra mới:

- Notification gate: 163/163 tests; lines 100%, branches 98.71%; module email lines/branches 100%.
- Toàn bộ unit test backend: 664/664, 81 suites.
- TypeScript, ESLint (0 errors, còn warnings), Prettier và secret scan kiểm tra riêng trong log của đợt chạy.
- Backend Dev đã recreate và health OK. Topic riêng household A có đúng 1 subscription email đã xác nhận; Sender alias `live` version 11 được bật lại với REAL, gửi tới email đã cấu hình `anhnksss7@gmail.com`.
- Kiểm tra đọc trên một sự kiện thật có sẵn: dựng mẫu mới, ký và tải ảnh S3 thành công HTTP 200, image/jpeg, 54456 bytes. Đây là kiểm tra đọc, không tạo claim/job và không gửi lại sự kiện cũ.
- Người dùng đã duyệt mẫu cảnh báo mới ngày 22/11/2026. Chưa có xác nhận riêng về việc mở link ảnh từ một email mới; không coi preview là bằng chứng đã nhận email mới.

Bằng chứng đã ẩn link ảnh nằm trong `artifacts/notification-webcam-real-2026-11-22/email-preview-redacted.log`; log test cùng thư mục bị Git ignore. Người dùng đã yêu cầu chia nhỏ và commit các thay đổi trên nhánh `feat/us-25-auth-notifications`; chưa push hoặc triển khai Staging/Production.
