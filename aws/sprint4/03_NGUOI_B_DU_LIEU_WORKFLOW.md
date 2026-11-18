# Người B — Hoàn thiện S3, Face và Deadline AWS E2E (Dev → Staging → Production)

Baseline của plan là `c3250bd` trên nhánh `feat/us-29-argus-dev-mode`. Người B được cấp quyền chủ động **tự tạo, cấu hình và vận hành các dịch vụ thuộc phạm vi của B** xuyên suốt **Dev → Staging (`https://argusai-staging.duckdns.org`) → Production (`https://argusai.dynv6.net/login`)**, từ lúc code local đến nghiệm thu E2E trên Production.

- **Phạm vi services B tự chủ:** S3 Media Buckets + Lifecycle Rules, SQS Standard Queues & DLQs (`*-face-jobs`, `*-notification-jobs`, `*-results` và DLQ tương ứng), Lambda Face (`*-face`) & Rekognition Collections/Enrollment, Lambda Deadline (`*-deadline`) & Step Functions Standard State Machines (`*-deadline`), kèm IAM execution role của các Lambda/State Machine đó.
- **Phối hợp với Repo Owner (Dương Đại Phát):** Khi cần thêm hoặc đổi **GitHub Actions Secrets / Variables** hay **duyệt deploy Environment `production`**, B ghi rõ danh sách cần cập nhật trong PR/bàn giao gửi **Dương Đại Phát** thực hiện trên GitHub Settings (không đưa giá trị secret vào Git).
- **Tham chiếu kiểm kê thực tế (local gitignored):** `docs/CI_CD_STAGING_SOURCE_OF_TRUTH.md` và `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md`.

| Luồng       | Đã có ở baseline                                                                                                                                    | Phần B tự chủ hoàn thiện (Dev → Staging → Production)                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Media (S3)  | Adapter S3, API `GET /events/{eventId}/media` và quyền cấp URL.                                                                                     | Tự tạo/cấu hình S3 Media Bucket riêng từng môi trường + tagging `retention=expire-7d` + Lifecycle 7 ngày (giữ `retain=true`) và test quyền chéo household.               |
| Face & Rek. | `CloudQueueService`, migration `0018_aws_queue_pipeline.sql`, Face Lambda và Results consumer. `KnownFacesModule` vẫn dùng AI local để đăng ký/xóa. | Vá `ReportBatchItemFailures` trên Staging, chuẩn hóa prefix collection theo môi trường, nối `CreateCollection/IndexFaces/DeleteFaces`, tạo bộ Face Production tách biệt. |
| Deadline    | Có `EscalationDeadlineWorkerService`, `EscalationRepository` và contract deadline/fixture G0.                                                       | Viết API command, driver Step Functions, `services/aws-workers/deadline/`, tự dựng Lambda & State Machine Standard trên Dev → Staging → Production và nối CD.            |

---

## 1. Chuẩn bị môi trường & Quyền tự tạo services

1. Dùng nhánh riêng từ baseline tích hợp. Chuẩn bị Node 22, pnpm theo `package.json`, Python 3.12 và Docker Compose. Dùng `pnpm argus status`, `pnpm argus cloud`, `pnpm argus local` khi chuyển mode Dev. [Cách chạy Dev Local và Dev Cloud](../../docs/SPRINT4_DEV_CLOUD_LOCALHOST_TO_STAGING.md).
2. Dùng IAM User B (`--profile camerai-lab --region ap-southeast-1`):
   ```powershell
   aws --profile camerai-lab --region ap-southeast-1 sts get-caller-identity
   ```
3. Để chạy event thật từ laptop, dùng Frigate profile `cv` và webcam/video thử hợp lệ. [Cấu hình Frigate và MQTT](../../docs/FRIGATE_MQTT_SETUP.md).
4. Khi cập nhật file dùng chung (SSM `/camerai/<env>/runtime-env`, `ArgusAI-EC2-*-RuntimePolicy`, `ArgusAI-GitHub-*-Policy`, `.github/workflows/*.yml`), luôn tách biệt tuyệt đối tài nguyên giữa Dev / Staging / Production, không dùng lẫn bộ `camerai-s4-dev-*` cho Staging hoặc Production.

---

## 2. Giai đoạn Dev — Tự tạo services Dev & chạy E2E từ Localhost

### 2.1. Media S3 & Face SQS/Rekognition Dev (US-23, US-24)

1. Dùng hoặc tự tạo S3 Media Dev (`camerai-s4-dev-media-093206112026`), 3 SQS/DLQ (`camerai-s4-dev-*`), Lambda `camerai-s4-dev-face`. Nếu hai thành viên A và B chạy 2 DB local song song, B tự tạo bộ queue Results + Face Lambda test riêng để không tranh message của nhau.
2. **Gắn tag hết hạn khi upload S3 & Lifecycle:** Bổ sung tagging `retention=expire-7d` (trừ object `retain=true`) trong luồng upload media, và tạo Lifecycle rule 7 ngày cho bucket Dev.
3. **Enrollment Rekognition & Prefix Collection theo môi trường:**
   - Nối `KnownFacesModule` gọi `CreateCollection` / `IndexFaces` / `DeleteFaces` khi `FACE_PROVIDER=rekognition`, cập nhật `cloud_face_collections` & `cloud_face_mappings`, tăng `collectionVersion` mỗi khi tập mặt thay đổi (giữ nhánh local cho dev offline).
   - Sửa `services/aws-workers/face/handler.py` (line 69) và tạo **migration SQL mới** (tuyệt đối không sửa `0018_aws_queue_pipeline.sql` vì `migrate.mjs` check SHA-256) để collection prefix nhận cấu hình theo môi trường (`camerai-s4-dev-owner-` cho Dev, `argusai-staging-owner-` cho Staging, `argusai-production-owner-` cho Production).
4. **Chạy E2E từ laptop:** `pnpm argus cloud` + mở HTTPS tunnel (`artifacts/DevCloud.Caddyfile` + `cloudflared`/`ngrok`) cho 2 route Face (`GET .../face-jobs/{id}`, `PUT .../result`), trỏ `INTERNAL_API_BASE_URL` của `camerai-s4-dev-face` vào tunnel. Test đủ các ca: thêm/xóa mặt, `KNOWN`, `UNKNOWN`, collection rỗng, không mặt/nhiều mặt, ảnh hỏng, owner khác, duplicate 10 lần và đẩy lỗi qua DLQ. [Hướng dẫn worker và query DB](../../services/aws-workers/README.md).

### 2.2. Deadline Escalation Dev (US-13 / AWS-06)

1. **Backend:** Tạo `POST /api/v1/internal/events/{eventId}/deadline` (`InternalTokenGuard`, kiểm `commandId`, `deadlineVersion`, clock DB, transaction lock chống race với Ack, gọi `EscalationRepository.createNotificationIntent()` khi `ESCALATED`). Hỗ trợ `200 APPLIED | NO_OP`, `409 NOT_DUE` (`retryAt`), `409 COMMAND_CONFLICT`. Thêm `DEADLINE_DRIVER` (`local | stepfunctions`), `StartExecution` (`name: deadline-<commandId>`), reconcile và tắt poller local cho deadline thuộc cloud. [Hợp đồng deadline](00_HOP_DONG_G0.md#4-deadline-command-và-workflow-input-v1--b-cần-triển-khai).
2. **Worker & State Machine:** Tạo `services/aws-workers/deadline/` (Python 3.12, `requirements.txt`, unit tests), tích hợp build `deadline.zip` vào `services/aws-workers/build.py`. Viết ASL Standard `Wait` theo `$.command.expectedDeadlineAt` → `ApplyDeadline` → Retry (`DeadlineRetryable`, `429/5xx`, timeout) & `NOT_DUE` loop.
3. **Tự tạo services Deadline trên AWS Dev:**
   - Log Group `/aws/lambda/camerai-s4-dev-deadline` (retention 7 ngày) & `/aws/vendedlogs/states/camerai-s4-dev-deadline`.
   - Role & Lambda `camerai-s4-dev-deadline` (thay stub 299 bytes hiện tại bằng `deadline.zip` thật, env `INTERNAL_API_BASE_URL`, `INTERNAL_SERVICE_TOKEN`, publish version + alias `live`).
   - Role & Step Functions Standard State Machine `camerai-s4-dev-deadline` trỏ vào `camerai-s4-dev-deadline:live`.
   - Mở thêm route `POST /api/v1/internal/events/<uuid>/deadline` trong `DevCloud.Caddyfile` tunnel, đặt `DEADLINE_DRIVER=stepfunctions` & `DEADLINE_STATE_MACHINE_ARN`, tạo 2 event test kiểm `NO_OP` (ack trước hạn) và `APPLIED/ESCALATED` (hết hạn).

---

## 3. Giai đoạn Staging — Vá & Tự tạo services Staging, Note GitHub & Nghiệm thu E2E

### 3.1. Vá các cấu hình Staging hiện có của B (`argusai-staging-*`)

1. **Bật `ReportBatchItemFailures` cho `argusai-staging-face:live`:**
   ```powershell
   aws --profile camerai-lab --region ap-southeast-1 lambda update-event-source-mapping `
     --uuid 427458da-f189-45e5-b141-c6213daca71f `
     --function-response-types ReportBatchItemFailures
   ```
   _(Đồng bộ `maxReceiveCount` của `argusai-staging-face-jobs`, `argusai-staging-notification-jobs`, `argusai-staging-results` từ `10` về `5` nếu cần DLQ kích hoạt nhanh hơn khi test)._
2. **Đặt Log Retention 7 ngày** cho `/aws/lambda/argusai-staging-face`.
3. **Thêm S3 Lifecycle Rule** cho `argusai-staging-media-926883321040` (xóa sau 7 ngày theo tag dương `retention=expire-7d` + dọn expired delete markers, bảo toàn ảnh `retain=true`).
4. **Cấp quyền Rekognition Enrollment Staging:** Bổ sung `rekognition:CreateCollection`, `DescribeCollection`, `IndexFaces`, `DeleteFaces`, `DeleteCollection` trên `arn:aws:rekognition:ap-southeast-1:926883321040:collection/argusai-staging-owner-*` (và `camerai-*`) vào `ArgusAI-EC2-Staging-RuntimePolicy`.

### 3.2. Tự tạo dịch vụ Deadline trên Staging (`argusai-staging-deadline`)

1. Tạo Log Groups `/aws/lambda/argusai-staging-deadline` và `/aws/vendedlogs/states/argusai-staging-deadline` (retention 7 ngày).
2. Tạo Role `ArgusAI-Lambda-Staging-Deadline` (Logs) và Lambda `argusai-staging-deadline` (`python3.12`, `x86_64`, `25s`, alias `live`, `INTERNAL_API_BASE_URL=https://argusai-staging.duckdns.org/api/v1`, `INTERNAL_SERVICE_TOKEN=<khớp /camerai/staging/runtime-env>`).
3. Tạo Role `ArgusAI-StepFunctions-Staging-Deadline` (`lambda:InvokeFunction` trên `argusai-staging-deadline:live` + log delivery) và Step Functions Standard State Machine `argusai-staging-deadline` theo mẫu ASL đã kiểm chứng tại [SPRINT4_STAGING_TIEN_DO_VA_RUNBOOK.md §4](../../docs/SPRINT4_STAGING_TIEN_DO_VA_RUNBOOK.md#L118-L202).
4. Bổ sung vào `ArgusAI-EC2-Staging-RuntimePolicy` quyền `states:StartExecution` trên `stateMachine:argusai-staging-deadline` và `states:DescribeExecution` trên `execution:argusai-staging-deadline:deadline-*`; bổ sung vào `ArgusAI-GitHub-Staging-Policy` quyền update/alias `argusai-staging-deadline*`.
5. Thêm vào SSM `/camerai/staging/runtime-env`: `DEADLINE_DRIVER=stepfunctions`, `DEADLINE_STATE_MACHINE_ARN=arn:aws:states:ap-southeast-1:926883321040:stateMachine:argusai-staging-deadline` (và `REKOGNITION_COLLECTION_PREFIX=argusai-staging-owner-` nếu dùng biến cấu hình).

### 3.3. Cập nhật CD trong PR & Danh sách gửi Repo Owner (**Dương Đại Phát**) cho `staging`

- Tách 2 PR độc lập (**Media/Face Enrollment** và **Deadline E2E**), kèm migration mới, OpenAPI/generated contracts, worker tests, build `deadline.zip` trong `cd.yml`, và step cập nhật `DEADLINE_FUNCTION_NAME` / `DEADLINE_FUNCTION_ALIAS` trong `deploy-environment.yml`.
- **Note gửi Repo Owner — Dương Đại Phát (GitHub Environment `staging`):**

| Loại trên GitHub (`Environment: staging`) | Tên biến                                     | Giá trị                          | Ghi chú                                                    |
| ----------------------------------------- | -------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| Environment Variable                      | `FACE_FUNCTION_NAME` / `FACE_FUNCTION_ALIAS` | `argusai-staging-face` / `live`  | Đã có trên Staging — chỉ xác nhận giữ nguyên               |
| Environment Variable                      | `DEADLINE_FUNCTION_NAME`                     | `argusai-staging-deadline`       | **Cần thêm mới** trước khi merge PR Deadline CD vào `main` |
| Environment Variable                      | `DEADLINE_FUNCTION_ALIAS`                    | `live` _(mặc định nếu bỏ trống)_ | **Cần thêm mới** cùng lúc với `DEADLINE_FUNCTION_NAME`     |

### 3.4. Nghiệm thu E2E trên Staging (`https://argusai-staging.duckdns.org`)

Sau khi merge `main` → CD Staging xong (và bật `argusai-staging-edge` khi test camera thật):

- Kiểm tra `RELEASE_ID`, alias `live` của Face & Deadline, test S3 presigned URL chéo household, Enrollment thêm/xóa mặt → camera event `KNOWN` / `UNKNOWN` / `UNDETERMINED` / duplicate / DLQ, và Deadline `NO_OP` vs `ESCALATED` (phối hợp A kiểm `notifications.id` đi tiếp qua Sender). [Ma trận test từ localhost tới staging](../../docs/test/SPRINT4_AWS_REVIEW_TEST_LOCAL_TO_STAGING.md).

---

## 4. Giai đoạn Production — Tự tạo services Production, Note GitHub & Nghiệm thu (`https://argusai.dynv6.net/login`)

_(Tuyệt đối không dùng bộ `camerai-s4-dev-*` hay `argusai-staging-*` cho Production; thực hiện khi PR của B đã pass Staging và C đã chuẩn bị host `i-09513ba32b1ee31d0` theo `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md`)._

### 4.1. Tự tạo bộ services của B trên Production (`argusai-production-*`)

1. **S3 Media Production:** Tạo bucket `argusai-production-media-926883321040` (Region `ap-southeast-1`, Block Public Access 4 cờ `true`, SSE-S3 `AES256`, Versioning `Enabled`, Lifecycle rule 7 ngày cho tag `retention=expire-7d` + dọn delete marker).
2. **SQS Queues & DLQs Production (3 cặp riêng, SSE-SQS, `maxReceiveCount: 5`):**
   - `argusai-production-face-jobs` (`VisibilityTimeout=720s`) → `argusai-production-face-jobs-dlq`
   - `argusai-production-notification-jobs` (`VisibilityTimeout=180s`) → `argusai-production-notification-jobs-dlq`
   - `argusai-production-results` (`VisibilityTimeout=120s`) → `argusai-production-results-dlq`
3. **Face Lambda Production (`argusai-production-face`):**
   - Log Group `/aws/lambda/argusai-production-face` (retention 14–30 ngày).
   - Role `ArgusAI-Lambda-Production-Face` (SQS `argusai-production-face-jobs` → `argusai-production-results`, S3 `GetObject` `argusai-production-media-926883321040/owners/*/cameras/*/events/*/face/*`, Rekognition `SearchFacesByImage`/`DescribeCollection`/`DetectFaces`, Logs).
   - Lambda `argusai-production-face` (`python3.12`, `x86_64`, `120s`, `512 MiB`, alias `live`), env: `S3_BUCKET=argusai-production-media-926883321040`, `APPLICATION_RESULTS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/926883321040/argusai-production-results`, `INTERNAL_API_BASE_URL=https://argusai.dynv6.net/api/v1`, `REKOGNITION_MATCH_THRESHOLD=0.90`, `INTERNAL_SERVICE_TOKEN=<khớp /camerai/production/runtime-env>`.
   - Event Source Mapping từ `argusai-production-face-jobs` → `argusai-production-face:live` (`BatchSize: 1`, `FunctionResponseTypes: ["ReportBatchItemFailures"]`, ban đầu `--no-enabled`, chỉ bật sau khi DB/API Production chạy chế độ `sqs`).
4. **Deadline Lambda & Step Functions Production (`argusai-production-deadline`):**
   - Log Groups `/aws/lambda/argusai-production-deadline` & `/aws/vendedlogs/states/argusai-production-deadline` (retention 14–30 ngày).
   - Role `ArgusAI-Lambda-Production-Deadline`, Lambda `argusai-production-deadline:live` (`INTERNAL_API_BASE_URL=https://argusai.dynv6.net/api/v1`), Role `ArgusAI-StepFunctions-Production-Deadline`, State Machine Standard `argusai-production-deadline`.
5. **Cập nhật quyền & SSM Production (phối hợp C kiểm tra `ArgusAI-EC2-Production`):**
   - Đảm bảo `ArgusAI-EC2-Production-RuntimePolicy` có quyền S3 `argusai-production-media-926883321040/*`, SQS trên 3 queue `argusai-production-*`, Rekognition Enrollment trên `collection/argusai-production-owner-*`, và `states:StartExecution` / `DescribeExecution` trên `argusai-production-deadline`.
   - Đảm bảo `ArgusAI-GitHub-Production-Policy` có quyền `s3:GetObject` trên `argusai-releases-926883321040/releases/*` và update/alias cho `argusai-production-face*` & `argusai-production-deadline*`.
   - Cập nhật `/camerai/production/runtime-env`: `S3_BUCKET`, `STORAGE_BUCKET`, 3 queue URLs `argusai-production-*`, `FACE_JOB_TRANSPORT=sqs`, `APPLICATION_RESULTS_CONSUMER_ENABLED=true`, `DEADLINE_DRIVER=stepfunctions`, `DEADLINE_STATE_MACHINE_ARN`, `REKOGNITION_COLLECTION_PREFIX=argusai-production-owner-`.

### 4.2. Note gửi Repo Owner (**Dương Đại Phát**) cho GitHub Environment `production`

| Loại trên GitHub (`Environment: production`) | Tên biến                                             | Giá trị                                   | Khi nào cần thực hiện                          |
| -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Environment Variable                         | `FACE_FUNCTION_NAME` / `FACE_FUNCTION_ALIAS`         | `argusai-production-face` / `live`        | Trước lần deploy CD Production đầu tiên        |
| Environment Variable                         | `DEADLINE_FUNCTION_NAME` / `DEADLINE_FUNCTION_ALIAS` | `argusai-production-deadline` / `live`    | Trước khi bật Deadline AWS trên Production     |
| Approval Gate                                | **Approve deployment `production`**                  | Kèm link CD run + bằng chứng Staging PASS | Mỗi release promote từ Staging sang Production |

### 4.3. Kiểm tra sau khi Production deploy (`https://argusai.dynv6.net`)

1. Xác nhận `cd_schema_migrations` trên Postgres Production đã áp dụng sạch các migration mới mà không lỗi baseline/checksum.
2. Kiểm tra `/api/v1/internal/smoke` (qua `smoke.sh`) báo `database`, `storage` (S3 `argusai-production-media-926883321040`), `cloudQueue` (`mode=sqs,consumer=true`) đều `ok`.
3. Tạo ca thử có kiểm soát (enrollment + ảnh S3 + Face Lambda + Deadline) trên Production, xác nhận không có message lỗi rơi vào 3 DLQ Production và ghi bằng chứng theo ID.

---

## 5. Bàn giao tổng hợp cho C & Repo Owner

Ghi lại cho từng môi trường (**Dev / Staging / Production**): commit SHA / `RELEASE_ID`, danh sách bucket/queues/DLQs/Lambdas/aliases/State Machine ARNs/collection prefix đã tạo, migration mới đã chạy, các biến SSM đã cập nhật, danh sách GitHub Variables đã gửi **Dương Đại Phát**, và bằng chứng E2E (`eventId`, `jobId`, `resultId`, `commandId`, `executionArn`, `notifications.id`).
