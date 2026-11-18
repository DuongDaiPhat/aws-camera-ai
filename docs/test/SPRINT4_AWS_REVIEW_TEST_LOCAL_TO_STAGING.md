# Sprint 4 — Review và test tính năng AWS từ localhost tới staging

Chạy từ thư mục gốc CameraAI. Ví dụ dùng **PowerShell 7** trên Windows. Phần chạy `smoke.sh` dùng **Bash** có `curl`, `jq` và AWS CLI nếu invoke Lambda. A kiểm thử Cognito và toàn bộ luồng thông báo gồm claim/outcome. B kiểm thử dữ liệu, Face và Deadline. C đối chiếu cấu hình AWS và release.

| Môi trường    | Chạy ở đâu                                                                       | Bằng chứng cần có trước khi chuyển bước                                                                   |
| ------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Dev Local** | Docker Compose, PostgreSQL, JWT, MinIO, BullMQ và AI local                       | Unit/contract/DB integration đạt. Web login, đọc đúng dữ liệu và luồng local vẫn chạy.                    |
| **Dev Cloud** | Web/API/DB local hoặc máy dev dùng chung, nối Cognito/S3/SQS/Rekognition của dev | Kiểm tra AWS thật với cùng một backend và DB. Tạo event mới, theo dõi S3 → Face Lambda → Results → DB/UI. |
| **Staging**   | `https://argusai-staging.duckdns.org`, deploy từ `main` qua GitHub Actions       | Release ID đúng, smoke đạt các bước cần thiết và A/B chạy lại các ca nghiệm thu trên staging.             |

Ghi kết quả từng ca bằng `PASS`, `FAIL`, `SKIP` hoặc `BLOCKED`. `SKIP` áp dụng khi cố ý bỏ một bước tùy chọn. `BLOCKED` ghi rõ thiếu code, tài nguyên, cấu hình, fixture hay điều kiện nhà cung cấp. Dùng [hợp đồng G0](../../aws/sprint4/00_HOP_DONG_G0.md) để đối chiếu hành vi và [runbook staging](../SPRINT4_STAGING_TIEN_DO_VA_RUNBOOK.md) để tạo tài nguyên còn thiếu. Giá trị account, role, parameter và môi trường chuẩn nằm trong [CI/CD source of truth](../CI_CD_STAGING_SOURCE_OF_TRUTH.md) của nhóm. File nguồn này được Git ignore, nên người dùng checkout mới lấy bản do nhóm quản lý.

## 1. Review PR trước khi chạy

1. Ghi PR, commit SHA và story cần nghiệm thu. Xác định feature flag, migration, endpoint, queue/role và dependency mà PR chạm tới. Dùng checkout có đúng PR. `pnpm argus` cần nhánh có công cụ Argus. `/internal/smoke` và test CD cần nhánh có PR #41 hoặc mới hơn.
2. Review đường gọi thực tế từ UI/ingestion đến backend và AWS. Đối chiếu OpenAPI, schema G0 và các consumer hiện có. Khi đổi schema/version message, kiểm tra dữ liệu cũ, pending message và hành vi của worker đang chạy trong lúc deploy.
3. Kiểm tra mọi đường auth phân biệt user token với `X-Internal-Token`. Owner/camera/event lấy quyền từ DB. URLs ảnh chỉ phát sau kiểm tra quyền. Kiểm tra role truy cập đúng bucket, prefix, queue, function alias và collection của môi trường đang thử.
4. Review transaction và retry. Intent ghi cùng transaction tạo event, IDs ổn định, retry giữ payload, Results chỉ xóa message sau commit, same ID khác nội dung bị conflict. Với notification, kiểm tra claim/lease trước provider call và cách xử lý khi provider có thể đã nhận nhưng outcome bị mất. Với deadline, kiểm tra đúng một driver cho mỗi deadline.
5. Review cách triển khai và quay lại. Kiểm migration mới có thể chạy với dữ liệu đang dùng, biến thực sự được code đọc, ZIP đóng gói đúng handler/runtime, tham chiếu alias `live` và smoke có ca âm tính. Kiểm tra `git diff` để secret, ảnh thật và log chứa token nằm ngoài PR.

## 2. Chạy kiểm thử tự động trên máy

Chuẩn bị Node 22, pnpm `9.12.0` theo `package.json`, Docker Desktop chạy Linux containers và Python 3.12 cho Face Lambda. Các bước sau chạy với mock hoặc DB test. Giữ cấu hình AWS dev và staging ngoài các suite này.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @cam/contracts build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm api:lint
pnpm contracts:generate
git diff -- packages/contracts/src/generated
pnpm check:secrets
```

Nếu PR sửa OpenAPI, generated diff cần khớp phần đã review. Với checkout PR sạch đã commit generated output, `git diff --exit-code -- packages/contracts/src/generated` phải trả `0`. Chạy test liên quan trước, rồi `pnpm test` và `pnpm test:tools` trước khi gửi review.

```powershell
pnpm --filter @cam/orchestrator run test --runInBand --runTestsByPath test/auth-provider.spec.ts test/cognito-verifier.spec.ts test/jwt-auth.guard.spec.ts test/resource-ownership.spec.ts test/media.service.spec.ts test/known-faces.spec.ts test/cloud-queue.spec.ts test/escalation-deadline-worker.service.spec.ts test/smoke.service.spec.ts
pnpm --filter @cam/web run test src/lib/auth-client.spec.ts src/lib/known-faces-client.spec.ts
pnpm --filter @cam/orchestrator run test:integration --runTestsByPath test/cloud-queue.integration.spec.ts test/ai-results-db.integration.spec.ts
node --test tools/scripts/test/argus.test.mjs tools/scripts/test/smoke-cd.test.mjs
```

Suite `test:integration` dùng PostgreSQL Testcontainers, cần Docker daemon truy cập được. Suite smoke mô phỏng HTTP đầy đủ chạy trên POSIX với Bash, `jq`, `curl`. Trên Node Windows, ca đó `SKIP` theo điều kiện của test.

Tạo venv Python 3.12 riêng cho test Face dưới `artifacts/`, thư mục đã được Git ignore. Nếu máy dùng `python` thay launcher `py`, kiểm tra `python --version` là 3.12 rồi dùng `python -m venv artifacts/face-test-venv`.

```powershell
py -3.12 -m venv artifacts/face-test-venv
$facePython = '.\artifacts\face-test-venv\Scripts\python.exe'
& $facePython -m pip install -r services/aws-workers/face/requirements.txt
& $facePython -m unittest discover -s services/aws-workers/face -p 'test_*.py'
& $facePython aws/sprint4/contracts/validate_fixtures.py
```

Fixture runner kiểm tra cấu trúc JSON. Unit và DB integration mới kiểm tra receipt, ownership, duplicate, stale và atomicity. Khi sửa build Lambda, chạy `python services/aws-workers/build.py` bằng môi trường tương ứng. Build tạo `services/aws-workers/.build/face.zip` cho Linux x86_64. Script yêu cầu `.build/face` chưa tồn tại, nên giữ bản build cũ ở tên khác nếu cần so sánh. [Face worker](../../services/aws-workers/README.md) · [CI hiện hành](../../.github/workflows/ci.yml)

## 3. Dev Local — chạy app và kiểm tra hồi quy

1. Nếu thiếu `.env`, sao chép `.env.example`. Điền `POSTGRES_PASSWORD`, `DATABASE_URL`, `MINIO_ROOT_PASSWORD`, `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN` tối thiểu 32 ký tự, và các token ứng dụng theo [Dev onboarding](../DEV_ONBOARDING.md). `DATABASE_URL` trong Compose dùng host `postgres`. Web mở tại `http://localhost:3000` và API tại `http://localhost:3001/api/v1` theo cổng mặc định. Đặt `WEB_ORIGIN` và `NEXT_PUBLIC_API_BASE_URL` tương ứng nếu đổi cổng. Giữ JWT, MinIO, Face local, `FACE_JOB_TRANSPORT=bullmq` và `APPLICATION_RESULTS_CONSUMER_ENABLED=false`.
2. Khởi động Compose và kiểm tra mode PostgreSQL. Các lệnh `psql` mẫu dùng user/database mặc định `camerai`. Đổi hai giá trị nếu `.env` local đã đổi.

   ```powershell
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   # Điền cấu hình ở bước 1 trước khi chạy tiếp.
   docker compose config --quiet
   docker compose up -d --wait postgres redis mosquitto minio
   docker compose exec -T postgres psql -U camerai -d camerai -c 'SELECT mode FROM cloud_transport_mode WHERE singleton;'
   pnpm argus status
   ```

   Mong đợi DB báo `bullmq`. Nếu đang dùng lại DB local đã ở `sqs`, xử lý job dev đang chờ rồi dùng `pnpm argus local` để đồng bộ `.env` và DB. Volume Postgres mới chạy SQL trong `db/migrations/` khi init. Với DB cũ, kiểm tra bảng/cột thực tế và lịch sử migration trước khi áp dụng migration còn thiếu. Init script và `pnpm db:migrate` có đường ghi lịch sử khác nhau. Tránh chạy lại toàn bộ SQL đã áp dụng trên DB đang giữ dữ liệu.

   ```powershell
   docker compose run --rm --no-deps minio-init
   docker compose up -d --build --wait mediamtx ai-service orchestrator web
   docker compose ps
   ```

3. Chỉ seed DB local dùng riêng cho test bằng `pnpm seed` từ PowerShell trên máy host nếu cần tài khoản demo. Runner đổi `@postgres:5432` thành `@localhost:5432`. Nếu đổi cổng Postgres publish, truyền `DATABASE_URL` trỏ đúng cổng host cho tiến trình seed và giữ URL nội bộ Compose trong `.env`. Dùng tài khoản trong [seed README](../../db/seeds/README.md). Kiểm `GET /api/v1/health` là `200`, `/api/v1/auth/config` báo `jwt` và `/api/v1/auth/me` thiếu token trả `401`.

   ```powershell
   $localApi = 'http://localhost:3001/api/v1'
   Invoke-RestMethod "$localApi/health" | Select-Object status, version
   Invoke-RestMethod "$localApi/auth/config" | Select-Object provider
   (Invoke-WebRequest "$localApi/auth/me" -SkipHttpErrorCheck).StatusCode
   ```

4. Mở `/login`. Thử đăng nhập, xem camera/event của đúng user, thao tác vượt role và logout. Dùng hai phiên trình duyệt độc lập để test chéo quyền. Seed có thể chỉ đủ cho login và dashboard. Ca chéo household cần hai owner và camera/event khác household.
5. Nếu PR chạm camera, media hoặc Face, cấu hình nguồn video thử và bật Frigate profile `cv`. Dùng `pnpm frigate:init` để tạo cấu hình nếu chưa có, kiểm bằng `pnpm frigate:validate`, rồi `docker compose --profile cv up -d --build --wait frigate`. Phát webcam hoặc fixture video qua nguồn đã đăng ký và tạo event mới. Kiểm ảnh mở được bằng URL MinIO, Face local ra kết quả phù hợp, và `cloud_jobs` không có face job cho event đó khi DB dùng `bullmq`. [Lệnh camera và cách thử video](../../CLI_COMMANDS.md)

## 4. Dev Cloud — ứng dụng local dùng AWS dev

### 4.1 Đối chiếu tài nguyên và chuyển mode

1. C bàn giao **bucket, ba queue URL, Cognito client dev, Face function/alias, collection và backend URL**. Xác nhận account/region và tên resource bằng lệnh dưới. Bộ dev và staging có thể ở chung account, nên so cả tên tài nguyên. Dùng queue test riêng hoặc phối hợp C để Results chỉ có consumer thuộc DB đang thử. Nếu dùng Dev App EC2 chung, chạy cả luồng trên app/DB của máy đó.

   ```powershell
   $awsDev = @('--profile', 'camerai-lab', '--region', 'ap-southeast-1', '--no-cli-pager')
   aws @awsDev sts get-caller-identity --query Account --output text
   $devFaceQueue = Read-Host 'URL Face Jobs queue dev do C cung cap'
   aws @awsDev sqs get-queue-attributes --queue-url $devFaceQueue --attribute-names QueueArn VisibilityTimeout RedrivePolicy
   ```

2. Đặt trong `.env` các giá trị AWS dev đã được cấp. Điền `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, thêm `AWS_SESSION_TOKEN` nếu credential tạm, `S3_BUCKET`, `FACE_JOBS_QUEUE_URL`, `NOTIFICATION_JOBS_QUEUE_URL`, `APPLICATION_RESULTS_QUEUE_URL`, ba biến `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN` và `INTERNAL_SERVICE_TOKEN`. Profile CLI trên máy và credential SDK trong container là hai cấu hình riêng. Giữ secret trong cấu hình local của nhóm. Ba queue phải khác nhau, cùng Region và là Standard.
3. Với Face thật, Lambda phải gọi được backend đích qua HTTPS tại `INTERNAL_API_BASE_URL=<origin-dev>/api/v1`, dùng cùng `INTERNAL_SERVICE_TOKEN` với app. Khi DB ở laptop, cần HTTPS tunnel dev đã cấu hình và C xác nhận mapping Face dev trỏ cả API lẫn Results đúng DB/dev test. `localhost` trong Lambda là chính runtime Lambda. Với Cognito, kiểm callback `http://localhost:3000/auth/callback`, sign-out `http://localhost:3000`, scope `openid email profile`. Liên kết `(issuer, sub)` đúng `users.id` trên DB dev. [Thiết lập Cognito](../../aws/sprint4/05_SETUP_COGNITO.md) · [Authorization code + PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
4. Chuyển mode bằng Argus khi không còn job local đang chạy cần giữ. Xem backup trong `artifacts/argus/` nếu Argus thực hiện chuyển hoặc áp migration. Kiểm DB mode `sqs`, web/login vẫn chạy, `auth/config` là `cognito`. Argus có từ nhánh chứa US-29 Dev Mode Switcher. Với nhánh cũ, dùng quy trình chuyển chế độ ở mục 5 của tài liệu CI/CD.

   ```powershell
   pnpm argus status
   pnpm argus cloud
   pnpm argus status
   docker compose ps
   Invoke-RestMethod 'http://localhost:3001/api/v1/auth/config' | Select-Object provider
   ```

5. Với nhánh có internal smoke, chạy một lượt kiểm dependency dev. Nhập token của **app local hiện tại**. Mong đợi `status=ok`, `auth` có Cognito JWKS, `storage` dùng S3 và `cloudQueue` báo `mode=sqs,consumer=true`.

   ```powershell
   $localInternalToken = Read-Host -MaskInput 'INTERNAL_SERVICE_TOKEN cua app local'
   try {
     $localSmoke = Invoke-RestMethod 'http://localhost:3001/api/v1/internal/smoke' -Headers @{ 'X-Internal-Token' = $localInternalToken }
     $localSmoke | Select-Object status, checks | ConvertTo-Json -Depth 5
   } finally {
     Remove-Variable localInternalToken
   }
   ```

### 4.2 Chạy luồng thật một lần trước các ca lỗi

1. **Auth.** Đăng nhập Cognito bằng user đã link. Kiểm `/auth/me`, `/cameras`, `/events?limit=1`. Kiểm scope `openid` với access token phát qua Hosted UI. Tạo ảnh chụp lỗi hoặc ghi HTTP status sau khi che headers/IDs riêng tư. Với user chưa link, kiểm `403`. ID token, token hết hạn hoặc thiếu token phải `401`.
2. **Media.** Tạo event từ camera dev. Dùng user được phép gọi `/api/v1/events/<eventId>/media`. Kiểm response có URL có hạn, tải ảnh được trước `expiresAt` và request không chữ ký vào object private bị từ chối. Dùng user khác household gọi lại chính API theo `eventId` và xác nhận không nhận URL. Presigned URL đang có dùng được bởi bên giữ URL tới khi hết hạn theo điều kiện chữ ký, nên dùng API để kiểm ownership. [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
3. **Face.** B chuẩn bị collection registry khớp UUID chủ camera, version và mapping FaceId → knownFaceId cho ca KNOWN. Dùng prefix của phiên bản code đang test. Baseline đang yêu cầu `camerai-s4-dev-owner-<ownerUuid>`. Tạo event `PERSON_DETECTED` hoặc `RESTRICTED_ZONE` có camera/track/crop từ nguồn camera test. Theo dõi `cloud_jobs`, crop dưới `owners/.../face/...`, Lambda dev CloudWatch log, `cached_result`, `cloud_result_receipts` và kết quả trong UI. Fixture JSON trong G0 chỉ là dữ liệu contract. Worker kiểm job thật, owner, bucket và registry trong DB trước khi xử lý.
4. **Theo dõi một event.** Mở `docker compose exec postgres psql -U camerai -d camerai` trên DB dev, đặt `\set event_id 'UUID_CUA_EVENT_TEST'` rồi chạy các truy vấn chỉ đọc. Dùng CloudWatch logs và `get-queue-attributes` để xem backlog mà không làm message bị ẩn khỏi consumer đang test.

   ```sql
   SELECT id, result_id, status, attempts, cached_result IS NOT NULL AS cached, last_error
   FROM cloud_jobs WHERE event_id = :'event_id'::uuid ORDER BY created_at;

   SELECT r.id, r.job_id, r.disposition, r.received_at
   FROM cloud_result_receipts r JOIN cloud_jobs j ON j.id = r.job_id
   WHERE j.event_id = :'event_id'::uuid ORDER BY r.received_at;

   SELECT o.notification_id, o.attempt_id, o.status, o.provider_called, o.provider_id IS NOT NULL AS has_provider_id
   FROM cloud_notification_outcomes o JOIN cloud_jobs j ON j.id = o.notification_id
   WHERE j.event_id = :'event_id'::uuid;
   ```

   `cloud_jobs.status=SENT` nghĩa job đã được publish lên queue. Ca Face đạt khi có result/receipt đúng job và UI đúng trạng thái. CloudWatch/SQS chỉ số approximate dùng để chẩn đoán. [Thuộc tính SQS](https://docs.aws.amazon.com/cli/latest/reference/sqs/get-queue-attributes.html)

5. **Thử duplicate trên queue test riêng.** Dùng job đã có `cached_result` và receipt, rồi phát lại đúng envelope vào Results queue thuộc cùng DB. B chuẩn bị quyền `sqs:SendMessage` cho Results queue test và kiểm URL với C trước khi chạy. Dùng PowerShell sau với `$awsDev` ở mục 4.1. Kiểm lại truy vấn ở bước 4 và UI sau khi consumer xử lý xong. Kỳ vọng giữ một receipt và một hiệu ứng nghiệp vụ. Các ca payload xung đột chạy bằng test tự động hoặc hạ tầng chuyên cho fault injection.

   ```powershell
   $jobId = [guid](Read-Host 'Job ID da xu ly tren DB dev test')
   $devTestResults = Read-Host 'URL Results queue RIENG cua test nay'
   aws @awsDev sqs get-queue-attributes --queue-url $devTestResults --attribute-names QueueArn
   $cachedResult = docker compose exec -T postgres psql -U camerai -d camerai -At -v ON_ERROR_STOP=1 -c "SELECT cached_result::text FROM cloud_jobs WHERE id = '$jobId'::uuid AND kind = 'face.job';"
   if ($LASTEXITCODE -ne 0 -or -not $cachedResult) { throw 'DB khong co cached face result cho job nay' }
   New-Item -ItemType Directory -Force artifacts | Out-Null
   $resultPath = Join-Path (Get-Location) 'artifacts/aws-face-duplicate.json'
   $cachedResult | Set-Content -LiteralPath $resultPath -Encoding utf8NoBOM
   1..10 | ForEach-Object {
     aws @awsDev sqs send-message --queue-url $devTestResults --message-body "file://$resultPath" --query MessageId --output text
     if ($LASTEXITCODE -ne 0) { throw 'Gui lai result that bai' }
   }
   ```

6. **Dọn lượt dev.** Đối chiếu job test còn chờ, DLQ và kết quả chưa áp dụng cùng người quản lý queue. Chỉ replay đúng message/job đã kiểm tra sau khi sửa nguyên nhân. Sau khi xử lý tải đang chờ, `pnpm argus local` và `pnpm argus status` để về JWT/MinIO/BullMQ. Dọn riêng dữ liệu test đã tạo nếu được phân công. Giữ DB/volume và queue dùng chung.

## 5. Review trên staging sau CD

1. PR phải qua **CI xanh** và review trước khi merge `main`. Trong GitHub Actions, mở CD của **commit cần test**, kiểm package, deploy qua SSM, update alias `live` và smoke. Ghi URL run, expected `RELEASE_ID`, alias version của worker đang thử. Staging đọc `/camerai/staging/runtime-env` lúc deploy. Nếu cần endpoint/worker/flag mới, kiểm release đã có code và tài nguyên đã được cấu hình theo runbook.
2. Chạy public smoke Windows và so phiên bản. Điền release ID từ chính lượt CD cần nghiệm thu.

   ```powershell
   $stage = 'https://argusai-staging.duckdns.org'
   $expectedRelease = Read-Host 'RELEASE_ID cua CD can test'
   $health = Invoke-RestMethod "$stage/api/v1/health"
   if ($health.status -ne 'ok' -or $health.version -ne $expectedRelease) { throw 'Sai trang thai hoac release staging' }
   if ((Invoke-RestMethod "$stage/api/v1/auth/config").provider -ne 'cognito') { throw 'Sai auth provider staging' }
   if ((Invoke-WebRequest "$stage/login").StatusCode -ne 200) { throw 'Login page khong tra 200' }
   foreach ($path in @('/api/v1/auth/me', '/api/v1/internal/smoke')) {
     if ((Invoke-WebRequest "$stage$path" -SkipHttpErrorCheck).StatusCode -ne 401) { throw "Sai auth guard tai $path" }
   }
   ```

3. Chạy smoke chuẩn nếu có quyền hoặc đọc log của CD. Từ Bash, gán các giá trị xác nhận đúng staging và chạy [smoke.sh](../../tools/cd/smoke.sh). Khi chạy invoke Face thủ công, profile phải có quyền đọc cấu hình và invoke đúng function/alias. Nạp secret được cấp qua biến môi trường của shell hiện tại theo kênh nội bộ. Tắt shell tracing trong phiên có token.

   ```bash
   export APP_URL=https://argusai-staging.duckdns.org
   read -r -p 'RELEASE_ID cua CD can test: ' RELEASE_ID
   export RELEASE_ID
   export AWS_PROFILE=camerai-lab AWS_REGION=ap-southeast-1
   export FACE_FUNCTION_NAME=argusai-staging-face FACE_FUNCTION_ALIAS=live
   bash tools/cd/smoke.sh
   ```

   - `SMOKE_INTERNAL_TOKEN` mở chế độ kiểm tra PostgreSQL, Cognito JWKS, ghi/đọc/xóa object smoke và đọc thuộc tính Results queue. Có token, endpoint phải trả `200` và bốn `checks` đều `ok`. `503` là lỗi dependency, xem `checks.<component>`. Phép thử này ghi/xóa key `_smoke/orchestrator-smoke.txt`, nên dùng bước CD hoặc chạy tuần tự theo quyền đã cấp.
   - Để chạy bước authenticated `/auth/me`, `/cameras`, `/events`, dùng `SMOKE_REFRESH_TOKEN` của test user Cognito hoặc `SMOKE_BEARER_TOKEN` khi chạy thủ công. Access token phải có `openid`. Kết quả từ `USER_PASSWORD_AUTH` do script kiểm riêng và không chạy thay bước authenticated API. Ghi `SKIP` nếu log cho thấy bước không chạy.
   - Invoke Face với `Records:[]` kiểm tra alias và handler tải được. Ca Face thật cần một job, một result và trạng thái UI. Giữ logs có event/job/result ID đã được phép dùng.

4. Chạy ma trận dưới đây trên một camera/hộ test staging đã được C xác nhận. Nếu Edge đang dừng, báo `BLOCKED` cho ca phụ thuộc camera và tiếp tục chạy auth/smoke hoặc các ca độc lập. Với email/SMS/Connect, dùng email/số đã đồng ý nhận thử và bật `SENDER_DRY_RUN` trước khi test claim/outcome. Khi code và policy đã sẵn sàng, để A/C thực hiện một lượt gửi thật đã thống nhất.

## 6. Ma trận nghiệm thu chức năng

Chạy ca lỗi có tác động queue/worker trên hạ tầng test hoặc trong khung giờ staging dành cho ca đó. Với PR chỉ chạm một nhóm, chạy nhóm đó và ít nhất public smoke/auth sau deploy. Những hàng có chữ **khi đã triển khai** là ca nghiệm thu cho phần code và AWS còn chờ.

| Ca              | Thao tác và kết quả đạt                                                                                                                                                                                                                                                                              | Evidence                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTH-01**     | Hai user vào từ hai browser profile. User đúng thấy camera/event được phân quyền. `VIEWER` bị chặn thao tác yêu cầu admin. Tài khoản cùng household được phép đúng theo role.                                                                                                                        | HTTP status, role, camera/event test ID                                                                                                                                           |
| **AUTH-02**     | Thiếu/sai/hết hạn token hoặc dùng ID token Cognito trả `401`. Token hợp lệ nhưng chưa map hoặc user bị vô hiệu hóa trả `403`. Refresh thành công hoặc quay lại login khi hết phiên. Logout rồi tải lại, dữ liệu phiên trước không hiện.                                                              | Status và kết quả UI của từng ca                                                                                                                                                  |
| **MEDIA-01**    | Ảnh/clip của event mở được trước hạn, hết hạn bị từ chối, xin URL mới bằng tài khoản được phép thì mở lại được. User khác household không nhận URL.                                                                                                                                                  | Event/media ID, thời hạn, HTTP code. Che query chữ ký.                                                                                                                            |
| **FACE-01**     | Tạo event mới lần lượt với người quen, người lạ, collection rỗng, không mặt/nhiều mặt, ảnh lỗi. Kỳ vọng `KNOWN` với mapping đúng, `UNKNOWN` theo ngưỡng hoặc collection rỗng, `UNDETERMINED` cho ca chất lượng ảnh, lỗi kỹ thuật không thành `KNOWN`.                                                | Job/Result ID, collection version, receipt và UI                                                                                                                                  |
| **FACE-02**     | Dùng `jobId` đã được backend lưu. Replay cùng `resultId` và payload, kể cả 10 bản, chỉ có một hiệu ứng. Đổi payload mà giữ ID hoặc dùng owner sai bị từ chối. Result có version cũ không ghi đè. Dùng suite mock/integration để tái hiện chính xác lỗi sau commit trước delete.                      | Receipt count, disposition và row/UI trước/sau                                                                                                                                    |
| **FACE-03**     | Trên queue test, tạo lỗi retryable với batch response đã bật. Kiểm message quay lại sau visibility timeout và vào đúng DLQ theo redrive policy. Sửa nguyên nhân và thử replay có kiểm soát.                                                                                                          | Mapping `ReportBatchItemFailures`, số lần nhận, DLQ và kết quả sau phục hồi. [Lambda partial batch](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html) |
| **FACE-04**     | **Khi enrollment cloud đã triển khai**, thêm/xóa mặt từ app. Kiểm registry, mapping, version và collection đúng owner. Ca xóa không tiếp tục trả `KNOWN` ở lượt mới với cấu hình đã cập nhật.                                                                                                        | KnownFaceId, version và kết quả test sau xóa                                                                                                                                      |
| **DEADLINE-01** | **Khi API/worker/workflow đã triển khai**, tạo hai event có hạn test. Ack event thứ nhất trước hạn, workflow `NO_OP`. Để event thứ hai hết hạn, chỉ một lần `APPLIED/ESCALATED` và một intent cho lần escalated. Kiểm tra app thực sự tạo execution từ event.                                        | Execution ARN, command/version, receipt và intent                                                                                                                                 |
| **DEADLINE-02** | Gửi command sớm, nhận `409 NOT_DUE` và hẹn lại theo `retryAt`. Thử command lặp/cũ, cùng ID khác payload, ack chạy đồng thời, `429/5xx` và phục hồi. Mỗi command có một quyết định bền vững hoặc hiện rõ cần đối soát.                                                                                | Execution history, mã lỗi, receipt và trạng thái cuối                                                                                                                             |
| **NOTIFY-01**   | **Khi claim/outcome/sender đã triển khai**, tạo intent từ app. Claim rồi xử lý dry-run với `providerCalled=false`, `providerId=null` và UI `SKIPPED`. Case `NO_OP` không gọi provider. `BUSY` retry theo `retryAt`.                                                                                  | Notification/attempt/outcome IDs, trạng thái DB/UI                                                                                                                                |
| **NOTIFY-02**   | Thử lease hết, cap/cooldown, job trùng và mất outcome sau provider call. `UNCERTAIN` giữ pending và khóa tự gửi lại. Email thật dùng intent mới, kiểm provider ID, trạng thái `SENT` và hộp thư nhận. SMS/Connect kiểm theo từng kênh đã được cấp. `SENT` là provider đã nhận. User ack là ca riêng. | Provider ID đã che, log và xác nhận kênh nhận                                                                                                                                     |
| **OPS-01**      | Tạo thử cảnh báo trên hạ tầng test hoặc kiểm một DLQ có lỗi chủ đích. Alarm về ops topic, xác minh email nhận và alarm về trạng thái ổn định sau phục hồi.                                                                                                                                           | Alarm name, timestamp và email nhận                                                                                                                                               |

## 7. Chẩn đoán trước khi kết luận

| Triệu chứng                                     | Kiểm theo thứ tự                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local API/web chưa lên                          | `docker compose ps -a` → `docker compose logs --tail=120 orchestrator web postgres` → token bắt buộc, `.env`, dependency và cổng.                                                        |
| Cấu hình đúng trong file nhưng app dùng mode cũ | `pnpm argus status` và DB mode ở dev → chênh shell/`.env` → recreate container. Staging xem release ID và version parameter đã nạp lúc deploy.                                           |
| Cognito quay lại login hoặc báo token lỗi       | Callback đúng origin/cổng/path → đúng app client → access token có `openid` → cặp issuer/sub có trong DB, user active và role/household đúng.                                            |
| Event có nhưng face job không xuất hiện         | Loại event/camera/track hợp lệ → DB mode `sqs` → trigger migration → kiểm `cloud_jobs` theo event ID.                                                                                    |
| Job `PREPARING` hoặc `FAILED`                   | `last_error` → crop có thật → registry/version → IAM S3, URL queue và network từ app.                                                                                                    |
| Job `SENT` nhưng chưa có kết quả                | Queue/mapping `:live` → log worker → HTTPS nội bộ/token → cached result và `SendMessage` Results → consumer cùng DB → receipt và DLQ.                                                    |
| Ảnh mở thất bại                                 | Quyền API → bucket, key và URL trả về → chữ ký, host và hết hạn → role/KMS nếu có.                                                                                                       |
| Deadline chờ mãi hoặc sender chưa gửi           | Commit có endpoint/handler chưa → code đọc flag chưa → role/alias/queue → execution history, claim/attempt và outcome. Tài nguyên có sẵn nhưng thiếu backend được ghi `BLOCKED` cho E2E. |

## 8. Mẫu bàn giao review

Ghi một dòng cho mỗi ca đã chạy. Với ca thiếu điều kiện, nêu người phụ trách và hiện vật cần bổ sung. Kết luận sẵn sàng demo khi các ca bắt buộc trên staging đều có kết quả, hoặc nhóm đã chốt rõ phần bị loại khỏi lượt demo.

```text
PR / commit SHA:
Môi trường / release ID / CD link:
Ca kiểm / người chạy / thời gian:
Điều kiện và dữ liệu test:
Kỳ vọng / quan sát thực tế:
Kết quả PASS | FAIL | SKIP | BLOCKED:
Evidence đã che token, presigned URL, nội dung ảnh và thông tin người nhận:
Việc cần làm tiếp / người phụ trách:
```
