# Sprint 4 — Tiến độ người A, người B và runbook staging

Kiểm tra ngày **17/11/2026**, tài khoản AWS `926883321040`, Region **Singapore** (`ap-southeast-1`). Staging trả release `cd4029358be501b0468cc6daedd83c919ab0530e-44041590633-1`, khớp GitHub `main`. Checkout ban đầu ở `d57ffdb`. Chênh lệch tới `cd40293` là PR #41 cho staging smoke. Job package, deploy SSM, cập nhật Face Lambda và bước smoke đều báo thành công. Kiểm tra HTTPS độc lập cho kết quả `/api/v1/health`, `/login`, `/api/v1/auth/config` trả `200`, cấu hình báo `cognito`. `/api/v1/auth/me` và `/api/v1/internal/smoke` trả `401` khi thiếu token. Smoke có các nhánh tùy theo secret. Kết quả này chưa xác minh login bằng hai user, xử lý video, enrollment hoặc gửi thông báo thật. [Lượt CD #44041590633](https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/44041590633)

Phạm vi theo [checklist A](../aws/sprint4/02_NGUOI_A_DANG_NHAP_THONG_BAO.md), [checklist B](../aws/sprint4/03_NGUOI_B_DU_LIEU_WORKFLOW.md), [hợp đồng G0](../aws/sprint4/00_HOP_DONG_G0.md) và [nguồn sự thật CI/CD, mục 3–4](CI_CD_STAGING_SOURCE_OF_TRUTH.md). Trạng thái tài nguyên dưới đây đã được đối chiếu chỉ đọc qua AWS CLI.

## 1. Tiến độ

| Người / hạng mục                               | Trạng thái                                                                                                                                                                                                                                                                          | Việc còn lại để nghiệm thu                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Cognito, frontend và phân quyền US-25**  | **Đã có trên staging.** PR #35 đã merge. Có auth config, callback code + PKCE, refresh/logout, access-token verifier, map `(issuer, sub)` và kiểm tra quyền theo household. Pool, domain và staging app client đã cấu hình.                                                         | A và B xác nhận hai user test đã liên kết đúng DB, thử camera/ảnh khác household, 401/403, refresh và logout.                                       |
| **A — SNS email US-26**                        | **Chưa xong.** Chưa có topic/subscription staging. Chưa có `services/aws-workers/sender/` hay Lambda Sender staging.                                                                                                                                                                | C tạo topic. A xác nhận người nhận, viết worker và thử dry-run → email thật với một hộp thư test.                                                   |
| **A — SMS và cuộc gọi US-27**                  | **Chưa xong.** Connect chưa có instance. Truy vấn trạng thái SMS trả `The AWS Access Key Id needs a subscription for the service` từ `PinpointSmsVoiceV2`, nên chưa xác nhận được sandbox hay khả năng gửi tại Singapore.                                                           | C xác minh onboarding/quota/số test. A nối provider và thử từng kênh nếu thuộc phạm vi demo.                                                        |
| **B — DB, kho ảnh S3 và hợp đồng G0**          | **Đã có nền tảng trên staging.** S3 adapter, bucket private có versioning, migration Cognito/household, schema/fixture G0 và migration pipeline. Runtime v7 chọn `STORAGE_PROVIDER=s3`.                                                                                             | Nghiệm thu ảnh thật từ UI bằng hai household, URL có hạn và lifecycle có ngoại lệ giữ ảnh.                                                          |
| **B — Face qua outbox/SQS/Results US-29**      | **Đã merge và deploy.** PR #37 có dispatcher/cached result/receipt. PR #40 đóng gói và deploy Face Lambda. Staging có Face/Notification/Results queue và DLQ. Consumer bật. `argusai-staging-face:live` là version **3**. Mapping `Enabled`, batch `1`, `FunctionResponseTypes=[]`. | Bật partial batch response. Kiểm thử crop → kết quả DB/UI bằng camera, collection và dữ liệu staging.                                               |
| **B — Đăng ký/xóa mặt Rekognition trong app**  | **Chưa xong.** `KnownFacesModule` còn bind `AiFaceInferenceService`. Worker và ràng buộc DB dùng `camerai-s4-dev-owner-`. AWS chỉ liệt kê collection fixture dev.                                                                                                                   | B nối `IndexFaces`/`DeleteFaces`, registry, mapping và version. Sửa prefix đồng bộ bằng migration mới. C cấp quyền và bootstrap collection staging. |
| **B — Deadline US-13**                         | **Chưa xong trên AWS.** Có worker polling deadline nội bộ. G0 có contract. Chưa có API command, driver `StartExecution`, ZIP/Lambda Deadline hoặc state machine staging.                                                                                                            | B triển khai command receipt/transaction, outbox và reconcile. C cấp workflow, role và rollout.                                                     |
| **A — Intent, claim và outcome của thông báo** | **Một phần.** Có `enqueueNotification()` nhưng chưa có call site nghiệp vụ. Results consumer đã nhận và ghi `cloud_notification_outcomes`, còn thiếu claim/lease, kiểm tra attempt đã claim và cập nhật trạng thái thông báo/UI. Queue có sẵn và chưa có sender trigger.            | A nối intent trong transaction, viết claim, ledger, Sender và áp dụng outcome để hiển thị.                                                          |
| **A+B — Camera/model và demo trên staging**    | **Chưa nghiệm thu.** App EC2 chạy. Edge staging `i-0223a06929b9a82b3` đang `stopped`.                                                                                                                                                                                               | C khởi động Edge. B thử event/crop/model. A+B chạy ma trận cuối tài liệu và ghi IDs, release, kết quả.                                              |

Bằng chứng code gồm [auth](../apps/orchestrator/src/auth/cognito-token.service.ts), [frontend callback](../apps/web/src/app/auth/callback/page.tsx), [S3](../apps/orchestrator/src/storage/s3-storage.service.ts), [CloudQueue](../apps/orchestrator/src/cloud-queue/cloud-queue.service.ts), [Face worker](../services/aws-workers/face/handler.py), [enrollment hiện tại](../apps/orchestrator/src/known-faces/known-faces.module.ts), [deadline hiện tại](../apps/orchestrator/src/escalation/escalation-deadline-worker.service.ts) và [migration pipeline](../db/migrations/0018_aws_queue_pipeline.sql).

## 2. Xác nhận môi trường trước khi thao tác

1. Console chọn **Asia Pacific (Singapore)**. Kiểm tra account bằng AWS CLI PowerShell. Các lệnh thay đổi tài nguyên bên dưới dành cho người C hoặc người có quyền quản trị staging tương ứng.

   ```powershell
   $stg = @('--profile', 'camerai-lab', '--region', 'ap-southeast-1', '--no-cli-pager')
   aws @stg sts get-caller-identity --query Account --output text
   ```

2. Dùng app EC2 `i-0bd8c9cf689512b6e`, bucket `argusai-staging-media-926883321040`, repo ECR `camerai/web` và `camerai/orchestrator`, HTTPS `https://argusai-staging.duckdns.org`, parameter `/camerai/staging/runtime-env` và GitHub Environment `staging` hiện có. Bảng sau ghi các queue Standard cần dùng lại.

   | Queue                               | Visibility | DLQ                                     |
   | ----------------------------------- | ---------: | --------------------------------------- |
   | `argusai-staging-face-jobs`         |      720 s | `argusai-face-jobs-dlq`                 |
   | `argusai-staging-notification-jobs` |      180 s | `argusai-staging-notification-jobs-dlq` |
   | `argusai-staging-results`           |      120 s | `argusai-staging-results-dlq`           |

   Queue URL có dạng `https://sqs.ap-southeast-1.amazonaws.com/926883321040/<queue-name>`. Results do orchestrator lấy và định tuyến theo `type` qua chung một consumer. Dùng DLQ thực tế theo redrive policy. Face DLQ hiện không có `staging` trong tên.

3. IAM Console → **Roles → Create role → AWS service** và chọn service sử dụng role. Với các quyền trong các mục sau, vào **Permissions → Add permissions → Create inline policy** và giới hạn theo ARN đã ghi. Trust của Lambda là `lambda.amazonaws.com`, của Step Functions là `states.amazonaws.com`. Người tạo Lambda/state machine cần `iam:PassRole` cho đúng execution role. Các app dùng EC2 instance profile/Lambda execution role, GitHub giữ OIDC. [Các bước cấp quyền PassRole](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)

## 3. Việc dùng tài nguyên hiện có

### 3.1 Người A và B nghiệm thu Cognito

1. Console **Cognito → User pools** → `ap-southeast-1_4WQxu8bnB` → **App clients** → `argusai-staging-web` (`75ao3v25aoscu9nlfjmi8hu7f`). Kiểm tra public client, authorization code + PKCE từ frontend, scopes `openid email profile`, callback `https://argusai-staging.duckdns.org/auth/callback`, sign-out `https://argusai-staging.duckdns.org`. Issuer để map DB là `https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB`. Managed login dùng domain `https://ap-southeast-14wqxu8bnb.auth.ap-southeast-1.amazoncognito.com`. [Cognito OAuth authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
2. A đối chiếu hai tài khoản test đã có. Nếu thiếu, **Users → Create user** trong pool này, dùng hai email nhóm có quyền truy cập. Hoàn tất đổi mật khẩu tạm và xác minh hộp thư. Ghi `sub` của từng user và bàn giao riêng cho B cùng app `users.id`. Hai người test khác household cần hai camera có dữ liệu riêng. Dùng thêm một user chưa liên kết cho ca `403` nếu cần.
3. B vào PostgreSQL staging qua phiên SSM trên app EC2. Kiểm tra `cd_schema_migrations` có `0017_cognito_issuer.sql`, `0018_cognito_email.sql` và `0019_household_access.sql`. Cập nhật đúng một row đã đối chiếu trong transaction, đặt `cognito_issuer`, `cognito_sub` và `cognito_email` nếu đã xác minh. Giữ ID/role/household của tài khoản. Kiểm tra trước khi commit nếu row đã có cặp identity hoặc update trả số dòng khác 1. Migration runner theo **tên file + checksum**. Hai file tên bắt đầu `0018_` hiện khác nội dung và có record riêng. [Migration runner](../tools/cd/migrate.mjs)

   ```bash
   cd /opt/camerai/current
   sudo env APP_ENV=staging RUNTIME_ENV_FILE="$PWD/runtime.env" \
     docker compose --project-name camerai-staging --env-file runtime.env \
     --env-file release.env -f deploy/compose.yml exec postgres sh -c \
     'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

   Dùng `\set app_user_id '...'` và `\set verified_sub '...'` trong `psql` với giá trị đã đối chiếu. Chạy phần update cho user chưa liên kết rồi `COMMIT` nếu đúng một dòng và đúng user. Dùng `ROLLBACK` khi có sai lệch. Nếu cập nhật `cognito_email`, chỉ dùng email Cognito đã xác minh.

   ```sql
   SELECT filename FROM cd_schema_migrations
   WHERE filename IN ('0017_cognito_issuer.sql', '0018_cognito_email.sql',
                      '0019_household_access.sql', '0018_aws_queue_pipeline.sql');

   BEGIN;
   SELECT id, role, household_owner_id, is_active, cognito_sub, cognito_issuer
   FROM users WHERE id = :'app_user_id'::uuid FOR UPDATE;
   UPDATE users
   SET cognito_issuer = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB',
       cognito_sub = :'verified_sub'
   WHERE id = :'app_user_id'::uuid AND is_active AND cognito_sub IS NULL
   RETURNING id, role, household_owner_id;
   ```

4. A mở `/login` trên hai phiên trình duyệt độc lập. Dùng access token có `openid` và kiểm `/auth/me` trả đúng role. Thử thiếu/sai/hết hạn token hoặc ID token để kiểm `401`. Token hợp lệ của user chưa link phải trả `403`. Yêu cầu camera/ảnh khác household phải bị từ chối trước khi phát URL. Thử refresh và logout. Kiểm tra thêm một tài khoản được cấp quyền trong cùng household nếu demo phân quyền chung. Với CD, đặt `SMOKE_REFRESH_TOKEN` nếu muốn smoke OAuth có scope `openid` và kiểm tra thực sự bước authenticated API. Xem log bước này để xác nhận nó chạy.

### 3.2 Sửa trigger Face và chuẩn bị collection

1. Console **Lambda → Functions → argusai-staging-face → Configuration → Triggers**. Edit mapping `427458da-f189-45e5-b141-c6213daca71f`. Chọn **Report batch item failures**. Giữ target `:live`, batch size `1`, batching window `0`. Giữ queue visibility `720s` với Lambda timeout `120s`. Có thể thực hiện bằng AWS CLI.

   ```powershell
   aws @stg lambda update-event-source-mapping --uuid 427458da-f189-45e5-b141-c6213daca71f --function-response-types ReportBatchItemFailures --query '{State:State,Responses:FunctionResponseTypes}'
   aws @stg lambda get-event-source-mapping --uuid 427458da-f189-45e5-b141-c6213daca71f --query '{State:State,Target:FunctionArn,Responses:FunctionResponseTypes}'
   ```

   Đợi `Enabled` và kiểm tra `Responses=["ReportBatchItemFailures"]`. Với mapping hiện tại, Lambda trả danh sách lỗi mà AWS chưa xử lý như partial failure. Thử job fixture có lỗi có chủ đích sau khi có alarm. Lỗi cần xuất hiện lại và vào DLQ khi đạt ngưỡng, hiện là 10 lần nhận. [AWS Lambda và phản hồi lỗi theo item](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)

2. B chốt prefix staging `argusai-staging-owner-<ownerUuid>` trong app, worker và DB. `ownerUuid` là UUID chủ camera trong app. Thêm migration mới để xử lý constraint và chuyển registry/mapping theo collection mới nếu có dữ liệu. Kiểm tra job đang chờ trước khi chuyển prefix vì envelope và FaceId phụ thuộc collection. Điều chỉnh cùng release, giữ compatibility cho pending job hoặc tạm dừng nhận job rồi xử lý backlog theo kế hoạch của B. Giữ nguyên checksum file `0018_aws_queue_pipeline.sql`.
3. C vào **IAM → Roles → ArgusAI-EC2-Staging**. Cấp `rekognition:CreateCollection`, `IndexFaces`, `DeleteFaces`, `DescribeCollection` trên `arn:aws:rekognition:ap-southeast-1:926883321040:collection/argusai-staging-owner-*`. Cấp `DeleteCollection` chỉ cho thao tác quản lý collection nếu B cần. Đối chiếu `SearchFacesByImage`, `DescribeCollection` của execution role Face trên cùng ARN. Giữ `DetectFaces`, đọc crop dưới `owners/*/cameras/*/events/*/face/*` và gửi Results. [Quyền Rekognition theo resource](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonrekognition.html)
4. Sau khi B thống nhất prefix và migration, tạo đúng một collection mỗi owner test. Có thể dùng backend enrollment của B để tạo tự động hoặc chạy CLI để bootstrap rồi ghi registry tương ứng.

   ```powershell
   $ownerUuid = Read-Host 'UUID chủ camera trong DB staging'
   $collectionId = "argusai-staging-owner-$ownerUuid"
   aws @stg rekognition create-collection --collection-id $collectionId
   aws @stg rekognition describe-collection --collection-id $collectionId --query '{Arn:CollectionARN,Count:FaceCount,Model:FaceModelVersion}'
   ```

5. B nối `IndexFaces`/`DeleteFaces` vào UI known faces và cập nhật `cloud_face_collections(owner_user_id, collection_id, version)` cùng `cloud_face_mappings(owner_user_id, face_id, known_face_id)`. Kiểm ảnh chỉ có một mặt lúc enrollment. Lưu FaceId do collection đúng owner trả về. Tăng version khi tập mặt thay đổi. Có đối soát nếu bước AWS thành công nhưng ghi DB lỗi. Trên staging giữ threshold `0.90` cho lượt kiểm thử đầu. Kiểm `cloud_transport_mode` là `sqs` cùng cấu hình app trước khi tạo event mới. Dùng chế độ một producer cho face, và kiểm Results consumer đã bật. [Runbook Face worker](../services/aws-workers/README.md)

### 3.3 Bật Edge khi thử camera

1. Console **EC2 → Instances → argusai-staging-edge** (`i-0223a06929b9a82b3`) → **Instance state → Start instance**. Đợi `running`, status checks đạt và SSM `Online`. Kết nối qua **Connect → Session Manager**. Kiểm tra Compose stack hiện có bằng `docker compose ps` trong thư mục deploy Edge và đưa các service Edge đã cấu hình lên nếu chúng chưa tự khởi động.
2. Từ app EC2 kiểm tra đường riêng tới `172.31.2.246` cho AI `8000`, Frigate `5000`, MQTT `1883` và RTSP `8554`. Đối chiếu SG nguồn `argusai-staging-sg` và SG đích `argusai-edge-sg`. Kiểm tra DNS/TLS `argusai-staging-media.duckdns.org` trỏ tới Edge hiện tại, HTTPS WebRTC proxy và UDP `8189`. Thử webcam/RTSP → Frigate phát event MQTT → orchestrator tạo event → snapshot/crop lấy được → UI xem được stream có quyền. Ghi phiên bản model và một event thực tế để lặp ca face. [Thông số Edge trong nguồn CI/CD](CI_CD_STAGING_SOURCE_OF_TRUTH.md#32-compute-network--storage-ec2-security-groups-eip-ecr-s3-ssm)

## 4. Deadline US-13 — B viết code, C tạo Lambda và Step Functions

1. **B chuẩn bị backend.** Thêm `POST /api/v1/internal/events/{eventId}/deadline` có `X-Internal-Token`. Dùng DB clock và lock event. Trong một transaction, kiểm tra command ID, deadline version và trạng thái rồi ghi receipt, lịch sử và intent/outbox nếu escalated. Ghi yêu cầu chạy workflow bền vững, gọi `StartExecution` ngoài transaction, giữ nguyên input/name `deadline-<commandId>` qua retry và có reconcile. Khi chọn `DEADLINE_DRIVER=stepfunctions`, chuyển từng deadline qua đúng một driver, bao gồm các deadline đang chờ ở worker nội bộ. [G0 phần 4](../aws/sprint4/00_HOP_DONG_G0.md#4-deadline-command-và-workflow-input-v1--b-cần-triển-khai)
2. **C tạo Logs và role.** CloudWatch → **Log groups → Create log group** `/aws/lambda/argusai-staging-deadline`, retention `7 days`. IAM tạo `ArgusAI-Lambda-Staging-Deadline` với `logs:CreateLogStream`, `logs:PutLogEvents` trên `arn:aws:logs:ap-southeast-1:926883321040:log-group:/aws/lambda/argusai-staging-deadline:*`. Dùng log group đã tạo. Cấu hình log theo `commandId/eventId` và kết quả, bỏ header/token.
3. **C tạo Lambda sau khi B giao ZIP.** Console **Lambda → Create function → Author from scratch**, name `argusai-staging-deadline`, Python `3.12`, `x86_64`, role ở bước 2, VPC để trống do Lambda gọi app qua HTTPS. Upload ZIP mà B đã kiểm thử, handler `handler.lambda_handler` nếu ZIP theo convention Face, timeout `25s`. **Configuration → Environment variables** thêm `INTERNAL_API_BASE_URL=https://argusai-staging.duckdns.org/api/v1` và `INTERNAL_SERVICE_TOKEN` từ cùng nguồn bí mật của API. Lambda cung cấp sẵn `AWS_REGION`. **Versions → Publish new version**, **Aliases → Create alias** `live` trỏ đúng version. Mỗi lần đổi code hoặc env, publish version và cập nhật alias để `live` thấy cấu hình mới. [Biến môi trường Lambda](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)
4. **B chốt contract đầu ra Lambda.** Gửi nguyên `{schemaVersion,commandId,eventId,deadlineVersion,expectedDeadlineAt}` tới API. `200 APPLIED/NO_OP` trả kết quả nghiệp vụ. `409 NOT_DUE` trả `code` và `retryAt` hợp lệ. `429`, timeout, `5xx` ném lỗi `DeadlineRetryable` nếu dùng cấu hình retry dưới đây. `400/401/404/COMMAND_CONFLICT` và response sai schema ném lỗi terminal. Đặt HTTP timeout ngắn hơn Lambda timeout.
5. **C tạo Step Functions role.** IAM tạo `ArgusAI-StepFunctions-Staging-Deadline`, trust `states.amazonaws.com`. Cấp `lambda:InvokeFunction` trên `arn:aws:lambda:ap-southeast-1:926883321040:function:argusai-staging-deadline:live`. Có thể giới hạn trust theo `aws:SourceAccount` và ARN state machine ở bước tiếp. Standard có execution history. Nếu bật CloudWatch execution logging, tạo log group `/aws/vendedlogs/states/argusai-staging-deadline` retention `7 days`, thêm quyền delivery theo AWS và tắt **Include execution data** nếu không cần. [Step Functions logging và IAM](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html)
6. **C tạo workflow.** Step Functions → **State machines → Create state machine** → **Standard** → **Code**. Tạo `argusai-staging-deadline`, chọn role bước 5. Với output contract ở bước 4, định nghĩa JSONPath bên dưới chạy theo `expectedDeadlineAt`, thử lại lỗi tạm thời tối đa 3 lần mỗi lần gọi và cho phép 3 lượt hẹn lại `NOT_DUE`. `retryAt` chỉ điều khiển thời gian chờ. Command gửi lại giữ nguyên. Chờ thêm 1 giây sau `retryAt` vì Wait theo timestamp xử lý tới giây. [Wait](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html), [Lambda integration](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html), [Retry và Catch](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)

   ```json
   {
     "StartAt": "Init",
     "States": {
       "Init": {
         "Type": "Pass",
         "Parameters": { "command.$": "$", "notDueRetries": 0 },
         "Next": "WaitUntilDeadline"
       },
       "WaitUntilDeadline": {
         "Type": "Wait",
         "TimestampPath": "$.command.expectedDeadlineAt",
         "Next": "ApplyDeadline"
       },
       "ApplyDeadline": {
         "Type": "Task",
         "Resource": "arn:aws:states:::lambda:invoke",
         "Parameters": {
           "FunctionName": "arn:aws:lambda:ap-southeast-1:926883321040:function:argusai-staging-deadline:live",
           "Payload.$": "$.command"
         },
         "TimeoutSeconds": 30,
         "ResultPath": "$.call",
         "Retry": [
           {
             "ErrorEquals": [
               "DeadlineRetryable",
               "Sandbox.Timedout",
               "States.Timeout",
               "Lambda.ServiceException",
               "Lambda.AWSLambdaException",
               "Lambda.SdkClientException",
               "Lambda.TooManyRequestsException"
             ],
             "IntervalSeconds": 2,
             "MaxAttempts": 3,
             "BackoffRate": 2
           }
         ],
         "Next": "CheckDecision"
       },
       "CheckDecision": {
         "Type": "Choice",
         "Choices": [
           {
             "And": [
               { "Variable": "$.call.Payload.disposition", "IsPresent": true },
               { "Variable": "$.call.Payload.disposition", "StringEquals": "APPLIED" }
             ],
             "Next": "Done"
           },
           {
             "And": [
               { "Variable": "$.call.Payload.disposition", "IsPresent": true },
               { "Variable": "$.call.Payload.disposition", "StringEquals": "NO_OP" }
             ],
             "Next": "Done"
           },
           {
             "And": [
               { "Variable": "$.call.Payload.code", "IsPresent": true },
               { "Variable": "$.call.Payload.code", "StringEquals": "NOT_DUE" },
               { "Variable": "$.call.Payload.retryAt", "IsTimestamp": true },
               { "Variable": "$.notDueRetries", "NumericLessThan": 3 }
             ],
             "Next": "CountRetry"
           }
         ],
         "Default": "NeedsReconciliation"
       },
       "CountRetry": {
         "Type": "Pass",
         "Parameters": {
           "command.$": "$.command",
           "retryAt.$": "$.call.Payload.retryAt",
           "notDueRetries.$": "States.MathAdd($.notDueRetries, 1)"
         },
         "Next": "WaitUntilRetry"
       },
       "WaitUntilRetry": { "Type": "Wait", "TimestampPath": "$.retryAt", "Next": "WaitOneSecond" },
       "WaitOneSecond": { "Type": "Wait", "Seconds": 1, "Next": "ApplyDeadline" },
       "Done": { "Type": "Succeed" },
       "NeedsReconciliation": { "Type": "Fail", "Error": "DeadlineNeedsReconciliation" }
     }
   }
   ```

7. **C cấp quyền runtime cho app.** `ArgusAI-EC2-Staging` cần `states:StartExecution` trên `arn:aws:states:ap-southeast-1:926883321040:stateMachine:argusai-staging-deadline` và `states:DescribeExecution` nếu reconcile trên `arn:aws:states:ap-southeast-1:926883321040:execution:argusai-staging-deadline:deadline-*`. Execution cùng name/input lúc còn chạy trả lại execution cũ. Nếu AWS báo `ExecutionAlreadyExists` sau khi đã đóng, tra execution cũ và đối chiếu DB/receipt trước khi phục hồi. [StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
8. **B test trước khi bật driver.** Dùng một event staging và deadline/version hợp lệ từ DB. Console **Start execution** với dữ liệu đúng [fixture G0](../aws/sprint4/contracts/fixtures/deadline-command.valid.json) đã thay IDs và timestamp. Kiểm tra history `Wait → ApplyDeadline → Done`, receipt và một intent duy nhất. Ack trước hạn phải `NO_OP`. `NOT_DUE` phải đợi lại. Lỗi auth phải fail và vào danh sách đối soát. Sau đó làm rollout mục 8 và thử app tự sinh execution. Test thêm ack chạy đồng thời, command trùng/cũ và API hồi phục sau tạm lỗi.

## 5. SNS email và Sender US-26

1. **C tạo topic.** Amazon SNS → **Topics → Create topic → Standard**, name `argusai-staging-incident-email`. Tạo **Subscriptions → Create subscription**, chọn topic, protocol `Email`, nhập hộp thư staging đã được A xác nhận. Người nhận bấm **Confirm subscription** và A kiểm tra trạng thái `Confirmed`. Nếu thử dữ liệu của nhiều household chỉ dùng chung topic khi mọi subscriber được phép nhận mọi dữ liệu sẽ gửi. Tách topic theo phạm vi người nhận khi cần. Test bằng **Publish message** với nội dung giả và kiểm tra hộp thư để xác nhận kênh SNS. [SNS email subscription](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)
2. **A hoàn thiện backend thông báo.** Đưa `enqueueNotification()` vào transaction tạo intent và thêm `POST /api/v1/internal/notifications/{notificationId}/claim`. Kiểm DB cho owner, event version, trạng thái hiện thời, người nhận, cap, cooldown và lease. Giá trị lab theo G0 là cap 5 request/ngày/người nhận/kênh, cooldown 60 giây và lease 120 giây. Ghi `attemptId`. Kiểm `notification.outcome` khớp attempt rồi cập nhật receipt, ledger và trạng thái app. `PROVIDER_ACCEPTED` → `SENT`, `DRY_RUN` → `SKIPPED`, `FAILED` → `FAILED`, `UNCERTAIN` giữ pending có chặn tự gửi lại. Claim `NO_OP` hoàn tất theo reason đã lưu. Claim `BUSY` chờ tới `retryAt`. [G0 và ca nghiệm thu](../aws/sprint4/00_HOP_DONG_G0.md)
3. **A bàn giao ZIP Sender.** Đọc đúng G0 `notification.job`. Gọi claim với `X-Internal-Token` và `claimId` ổn định. Chỉ gọi provider khi claim cho phép, sender cho phép `REAL` và lease còn hạn. Ghi/publish `notification.outcome` cùng `outcomeId` ổn định vào Results. Thất bại từng record trả `batchItemFailures` dùng SQS `messageId`. Khi provider có thể đã nhận nhưng chưa ghi được outcome, dùng `UNCERTAIN` và quy trình đối soát. Gói kèm test duplicate, mất mạng sau provider call, lỗi Results, lease hết và cap/cooldown. [SQS at-least-once và Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
4. **C tạo log group và role.** `/aws/lambda/argusai-staging-sender`, retention `7 days`. `ArgusAI-Lambda-Staging-Sender` với các quyền dưới đây. Queue đang dùng SSE-SQS. Kiểm tra lại key policy/`kms:Decrypt` nếu đổi sang SSE-KMS.

   | Quyền Sender                                                        | Resource                                                                                                              |
   | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
   | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` | `arn:aws:sqs:ap-southeast-1:926883321040:argusai-staging-notification-jobs`                                           |
   | `sqs:SendMessage`                                                   | `arn:aws:sqs:ap-southeast-1:926883321040:argusai-staging-results`                                                     |
   | `sns:Publish`                                                       | `arn:aws:sns:ap-southeast-1:926883321040:argusai-staging-incident-email` và topic staging khác được cấp cụ thể nếu có |
   | `logs:CreateLogStream`, `logs:PutLogEvents`                         | `arn:aws:logs:ap-southeast-1:926883321040:log-group:/aws/lambda/argusai-staging-sender:*`                             |

5. **C tạo Lambda** `argusai-staging-sender` như Deadline, dùng role Sender, Python `3.12`, `x86_64`, không gắn VPC, timeout `30s`. Upload ZIP của A và đặt handler đúng package. Thêm `INTERNAL_API_BASE_URL`, `INTERNAL_SERVICE_TOKEN` từ cùng nguồn của app, `APPLICATION_RESULTS_QUEUE_URL` trỏ `argusai-staging-results`, `SENDER_DRY_RUN=true`, `SNS_TOPIC_ARN` nếu ZIP đọc biến này làm allowlist. Publish version và tạo alias `live`. Chạy test payload rỗng của handler trước khi dùng trigger.
6. **C tạo trigger cho alias `live`**. Lambda → **Aliases → live → Add trigger → SQS**, queue `argusai-staging-notification-jobs`, batch `1`, batching window `0`, bật **Report batch item failures**, bỏ chọn **Activate trigger** lúc tạo. Nếu Console đang đứng ở `$LATEST`, dùng CLI với tên hàm đã kèm alias.

   ```powershell
   aws @stg lambda create-event-source-mapping --function-name argusai-staging-sender:live --event-source-arn arn:aws:sqs:ap-southeast-1:926883321040:argusai-staging-notification-jobs --batch-size 1 --maximum-batching-window-in-seconds 0 --function-response-types ReportBatchItemFailures --no-enabled --query '{UUID:UUID,State:State,Function:FunctionArn}'
   ```

7. Khi API/ledger đã deploy, xác nhận `/claim` có auth, bật trigger theo UUID. Sau đó bật `NOTIFICATION_DRIVER=sqs` theo mục 8 để app tự phát job. Visibility `180s` khớp `6 × 30s`. Dry-run phải đi hết vòng claim → Results → DB/UI, `providerCalled=false`. Thử một email thật sau khi A/C kiểm policy người nhận và đổi mode theo cả backend lẫn Sender. Publish Lambda version mới nếu đổi env. Kiểm tra provider `MessageId`, outcome `SENT` và hộp thư thực tế. Dùng test intent mới sau khi đổi mode vì intent dry-run cũ đã được xử lý. [Tạo SQS mapping và visibility timeout](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)

## 6. SMS và Amazon Connect US-27

### SMS nếu nằm trong lượt demo

1. Trong Singapore, mở **SNS → Mobile text messaging (SMS)** và **AWS End User Messaging SMS**. C xử lý trạng thái chưa đăng ký dịch vụ đã thấy khi gọi `get-sms-sandbox-account-status`. Kiểm tra origination identity, đăng ký/điều kiện theo quốc gia nhận, hạn mức chi tiêu và sandbox theo account/Region. Nếu đang sandbox, thêm số test E.164, nhập OTP để verify. [SNS SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html), [Gửi SMS qua SNS](https://docs.aws.amazon.com/sns/latest/dg/sms_sending-overview.html)
2. Cho test một nhóm số staging cố định, tạo **SNS Standard topic riêng cho SMS** nếu thiết kế recipient của A/B dùng topic. Subscribe đúng số và kiểm tra luồng xác nhận nếu AWS yêu cầu. Cấp `sns:Publish` trên ARN đó. Nếu sender gọi `Publish(PhoneNumber=...)`, quyền trên topic email không cấp quyền cho kiểu gọi này. Xác nhận quyền direct SMS theo SNS và giới hạn số gửi trong claim/allowlist, theo dõi quota/spend. Thử một SMS ở console đến số được phép trước khi test sender. [IAM của SNS](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonsns.html)
3. A bật kênh `SNS_SMS` cho một intent test và kiểm `MessageId`/outcome cùng việc nhận thực tế. Nếu onboarding, số hoặc origination bị chặn, ghi `BLOCKED_PROVIDER` kèm lỗi chính xác, giữ kênh đó ở dry-run theo G0.

### Amazon Connect nếu nằm trong lượt demo

1. Console **Amazon Connect Customer → Instances → Add an instance** tại Singapore. C chọn alias staging, tạo admin test, bật **Outbound calling**, hoàn tất tạo instance. Mở admin website → **Channels → Phone numbers → Claim a number**. Kiểm tra quy định theo nước và đường gọi outbound tới số đích E.164, kể cả allowlist nước `+84` nếu dùng số Việt Nam. Xin quota/điều chỉnh allowlist khi account yêu cầu. [Tạo Connect instance](https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-instances.html), [Region và khả năng gọi](https://docs.aws.amazon.com/connect/latest/adminguide/regions.html)
2. Trong **Routing → Flows → Create flow**, tạo `argusai-staging-emergency-outbound`, thêm **Play prompt** dùng TTS cho thông điệp test rồi **Disconnect**. **Save → Publish**, ghi `InstanceId`, `ContactFlowId`, số nguồn đã claim hoặc `QueueId` đã cấu hình caller ID. Nếu demo bấm `1`, bổ sung block nhận DTMF và callback ghi nhận có auth vào app. `ContactId` chỉ cho biết Connect đã chấp nhận yêu cầu.
3. Cấp `connect:StartOutboundVoiceContact` cho role Sender riêng. Service Authorization Reference của AWS hiện để trống cột resource cho **voice**. Vì vậy policy dùng `Resource: "*"` cho action này với `aws:RequestedRegion=ap-southeast-1`, và sender/claim giữ allowlist instance, flow và số test. Chỉ dùng quyền này khi kênh Connect được triển khai. Nguồn CI/CD gợi ý ARN contact-flow. ARN đó một mình không đủ để authorize action hiện tại. [Quyền Connect](https://docs.aws.amazon.com/service-authorization/latest/reference/list_connect.html)
4. A nhận `CONNECT_INSTANCE_ID`, `CONNECT_CONTACT_FLOW_ID` và số nguồn/queue đã xác nhận. Chốt tên biến số nguồn trong ZIP và backend. Gọi `StartOutboundVoiceContact` với `InstanceId`, `ContactFlowId`, `DestinationPhoneNumber` và `SourcePhoneNumber` hoặc `QueueId`, theo cấu hình nguồn đã chọn. Dùng `ClientToken` ổn định theo attempt nếu phối hợp retry. Thử một cuộc gọi tới số test đã đồng ý và đối chiếu `ContactId`, outcome, nội dung phát. Nếu account không cấp số/allowlist, báo `BLOCKED_PROVIDER` và giữ kênh đó ở dry-run. [API StartOutboundVoiceContact](https://docs.aws.amazon.com/connect/latest/APIReference/API_StartOutboundVoiceContact.html)

## 7. CloudWatch và lifecycle

### 7.1 Ops topic và cảnh báo US-28

1. **SNS → Topics → Create topic → Standard** `argusai-staging-ops`. Subscribe email đội vận hành, xác nhận thư. Tại **CloudWatch → Alarms → Create alarm → Select metric**, đặt namespace/dimension như bảng và **In alarm → Select an existing SNS topic** `argusai-staging-ops`. Tạo log retention `7 days` cho log group Face đang để vô hạn. Deadline, Sender và State Machine đặt retention khi tạo theo mục trên.

   | Namespace / dimension                                      | Alarm khởi điểm                                                                                                                                                                                                   |
   | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `AWS/SQS`, `QueueName` của từng DLQ ở §2                   | `ApproximateNumberOfMessagesVisible > 0`, `Maximum`, 60 s, 1/1, missing `notBreaching`                                                                                                                            |
   | `AWS/SQS`, `QueueName=argusai-staging-face-jobs`           | `ApproximateAgeOfOldestMessage > 30`, `Maximum`, 60 s. Có thể dùng 2/3 nếu test cho thấy nhiều nhiễu                                                                                                              |
   | `AWS/Lambda`, `FunctionName` từng hàm Face/Deadline/Sender | `Errors > 0` và `Throttles > 0`, `Sum`, 60 s. Bật từng hàm khi đã tồn tại                                                                                                                                         |
   | `AWS/States`, `StateMachineArn` Deadline                   | `ExecutionsFailed > 0` và `ExecutionsTimedOut > 0`, `Sum`, 60 s                                                                                                                                                   |
   | `AWS/EC2`, `InstanceId=i-0bd8c9cf689512b6e`                | `StatusCheckFailed > 0`. `CPUUtilization` theo ngưỡng C chọn, ví dụ `>80%` trong 3 kỳ 5 phút với basic monitoring                                                                                                 |
   | CloudWatch Synthetics hoặc custom metric                   | Thử HTTPS `/api/v1/health` từ bên ngoài. Dùng canary mỗi phút và báo sau 2 lần fail, hoặc custom checker 30 giây nếu cần phát hiện ở ngưỡng 90 giây. Edge heartbeat chỉ active trong thời gian Edge dự kiến chạy. |

2. **Cài CloudWatch Agent** trên app EC2. Gắn `CloudWatchAgentServerPolicy` hoặc policy tối thiểu lên `ArgusAI-EC2-Staging`. Tạo log group `/argusai/staging/app` retention `7 days`. **Systems Manager → Run Command → Run command** dùng `AWS-ConfigureAWSPackage`, action `Install`, name `AmazonCloudWatchAgent`, target `i-0bd8c9cf689512b6e`. Chạy wizard `sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard`, chọn Linux/EC2, metric RAM `mem_used_percent` và disk `used_percent` cho `/`. Kích hoạt cấu hình bằng `amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:<config-path>`. Xem metrics namespace `CWAgent` và đặt alarm theo ngưỡng demo. [Cài và cấu hình Agent với SSM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/installing-cloudwatch-agent-ssm.html)
3. Đưa Docker logs vào CloudWatch bằng driver `awslogs` trong `deploy/compose.yml` của staging hoặc cho agent đọc file log ứng dụng có path cố định mà container ghi ra host. Nếu dùng driver, đặt `awslogs-region=ap-southeast-1`, `awslogs-group=/argusai/staging/app`, stream riêng theo container/service, role EC2 có quyền log group này. Recreate qua CD rồi kiểm tra log mới cho orchestrator, web, Caddy. Sau khi topic xác nhận, dùng một alarm thử trong staging để kiểm email đến. Test thêm một ca Face lỗi qua DLQ. [Docker awslogs](https://docs.docker.com/engine/logging/drivers/awslogs/), [CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
4. **Tạo probe HTTPS** ở **CloudWatch → Synthetics canaries → Create canary**. Chọn **API canary**, name `argusai-staging-health`, endpoint `GET https://argusai-staging.duckdns.org/api/v1/health`, yêu cầu HTTP `200`. Chọn chạy mỗi phút, dùng service role và bucket artifact riêng cho canary. Sau lần chạy đầu, kiểm `SuccessPercent` trong namespace `CloudWatchSynthetics` với dimension `CanaryName`. Đặt alarm `<100`, 2/2 kỳ một phút, gửi về topic ops. Probe Edge chạy độc lập với máy Edge và kiểm được đường app ↔ Edge hoặc tuổi frame mới, tùy ca test. [Tạo canary](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries_Create.html), [Canary blueprints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries_Blueprints.html)

### 7.2 Lifecycle bucket media và ECR

1. **S3 → Buckets → argusai-staging-media-926883321040 → Management → Create lifecycle rule**. Xác nhận B gắn tag dương `retention=expire-7d` tại luồng upload cho ảnh/clip đủ điều kiện xóa. Đối với object giữ `retain=true`, giữ chúng ngoài nhóm `expire-7d` và bỏ tag hết hạn trên các phiên bản được giữ. S3 Lifecycle hỗ trợ lọc tag khớp, không có filter phủ định `retain != true`. Nếu chưa có code gắn tag, có thể thử rule trên prefix test dành riêng cho dữ liệu bỏ được. Giữ bucket private và versioning. [Bộ lọc S3 Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)
2. Trong rule, chọn tag `retention=expire-7d` và giới hạn prefix nếu phù hợp. Chọn **Expire current versions** sau 7 ngày và **Permanently delete noncurrent versions** sau 7 ngày kể từ khi thành noncurrent. Nếu cần dọn expired delete marker, tạo rule riêng theo prefix vì action đó không dùng tag filter. Kiểm kê object/version cũ trước khi gắn tag hàng loạt. Kiểm thử upload và ảnh `retain=true`. Ghi thời điểm dự kiến vì tác vụ lifecycle chạy bất đồng bộ. Smoke S3 chỉ kiểm tra thao tác ghi/đọc/xóa, còn ảnh hiển thị và quyền truy cập cần test riêng. [Cách S3 tính thời điểm hết hạn](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)
3. **ECR → Private registry → Repositories**, lần lượt mở `camerai/web` và `camerai/orchestrator` → **Lifecycle policy**. Tạo rule untagged cũ hơn 7 ngày. Nếu giới hạn tagged releases, giữ khoảng 20 release gần nhất và dùng rule bắt các release tag theo chính sách của repo. Chạy **Preview**, đối chiếu image digest đang chạy và release rollback trong `release.env` trước khi **Apply**. Nếu một digest cần giữ xuất hiện trong preview, điều chỉnh phạm vi rule hoặc tăng số release giữ trước khi áp dụng. [ECR lifecycle preview](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html)

## 8. Đưa thay đổi vào đúng đường CD

1. A làm Notification E2E song song với B làm Face enrollment và Deadline. Mỗi người chạy E2E Dev trong phạm vi của mình. A có thể chuẩn bị sender bằng mock G0, C có thể tạo topic, role, log group và sửa Face mapping song song. B chỉ bật driver sau khi app, backend endpoints, migrations và AWS đích đã có. Nếu đóng gói IaC theo checklist C, repo hiện chưa có `infra/aws/template.yaml`. Đưa tài nguyên mới vào stack và tham chiếu ARN tài nguyên đang có. Quản lý tài nguyên cũ bằng import có kiểm tra change set nếu đưa vào stack sau.
2. B bổ sung CD packaging cho `deadline.zip`, A cho `sender.zip`. C áp dụng cấu hình staging khi các handler đã sẵn sàng. Đóng gói ZIP + SHA256 trong `releases/<RELEASE_ID>/`, verify checksum, update code, chờ cập nhật, publish version, update alias `live`. Gắn `DEADLINE_FUNCTION_NAME`, `SENDER_FUNCTION_NAME` ở GitHub Environment `staging` khi workflow đã đọc chúng. Thêm vào role `ArgusAI-GitHub-Staging` các quyền tương ứng `GetFunction`, `GetFunctionConfiguration`, `UpdateFunctionCode`, `PublishVersion`, `GetAlias`, `CreateAlias`, `UpdateAlias`, `InvokeFunction` nếu dùng smoke, giới hạn đúng function và alias staging. Role chạy CD cần quyền code/version/alias. Cấu hình Lambda ban đầu do C thực hiện. Workflow hiện chỉ có Face. [CD hiện tại](https://github.com/DuongDaiPhat/aws-camera-ai/blob/cd4029358be501b0468cc6daedd83c919ab0530e/.github/workflows/deploy-environment.yml)
3. Khi code đã đọc các biến mới, **Systems Manager → Parameter Store → `/camerai/staging/runtime-env` → Edit**. Giữ nguyên các dòng đang chạy và cập nhật nguyên giá trị `SecureString` qua kênh được cấp. Ghi version trước/sau để truy vết. Thêm từng nhóm biến khi tính năng tương ứng đã sẵn sàng.

   ```dotenv
   DEADLINE_DRIVER=stepfunctions
   DEADLINE_STATE_MACHINE_ARN=arn:aws:states:ap-southeast-1:926883321040:stateMachine:argusai-staging-deadline
   NOTIFICATION_DRIVER=sqs
   SNS_TOPIC_ARN=arn:aws:sns:ap-southeast-1:926883321040:argusai-staging-incident-email
   SENDER_DRY_RUN=true
   ```

   `NOTIFICATION_JOBS_QUEUE_URL` và `APPLICATION_RESULTS_QUEUE_URL` đã có trong v7. Giữ các URL staging. `INTERNAL_API_BASE_URL` cần ở Lambda và có thể truyền vào app nếu code dùng. Biến provider của Connect chỉ thêm khi nối kênh. `SENDER_DRY_RUN` phải khớp mode claim của backend và env alias Sender. Đồng bộ giá trị `INTERNAL_SERVICE_TOKEN` của API với hai Lambda mới, Face và secret `SMOKE_INTERNAL_TOKEN` nếu dùng GitHub smoke có auth. Không ghi giá trị bí mật vào log hoặc Git. Nếu `SecureString` Standard chạm giới hạn 4 KB, C chọn phương án tăng tier theo cấu hình Parameter Store hoặc tách tham số và cập nhật deploy script. [Parameter Store tiers](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html)

4. Deploy qua `PR → CI xanh → merge main → CI push main → CD package → deploy SSM → update Lambda live → smoke`. Deploy host sao lưu DB, chạy migration, nạp lại env và recreate app. Việc sửa Parameter Store tự nó chưa đổi env của container hoặc version Lambda. Kiểm release ID từ `/api/v1/health`, alias versions, mapping, smoke có auth và migration/flags trong app. Nếu cần rollback, dùng phiên bản parameter và alias đã ghi nhận cùng cơ chế release của `deploy-host.sh`. Đối chiếu schema và pending workflow/queue vì rollback code không tự rollback DB hay thu hồi notification đã được provider nhận. [Deploy host](../tools/cd/deploy-host.sh)

## 9. Điều kiện chốt nghiệm thu

| Chủ trì | Ca kiểm trên staging                                                                                                                  | Bằng chứng cần ghi                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A+B     | Hai household đăng nhập, thử access token sai và user chưa link, truy cập chéo, hết hạn/refresh/logout                                | Release, kết quả 200/401/403 và chặn ảnh/URL chéo quyền                                                            |
| B       | S3 private, đọc ảnh đúng quyền. Test enrollment/add/delete và các ca known, unknown, rỗng, không mặt, nhiều mặt, ảnh hỏng, owner khác | Event/Job/Result IDs, collection version, ảnh mẫu được phép, record DB và trạng thái UI                            |
| B+C     | Duplicate 10 lần, cùng ID khác payload, revision/version cũ, mất consumer sau commit trước delete, lỗi qua DLQ                        | Một hiệu ứng nghiệp vụ, receipt đúng, replay an toàn, alarm đến email ops                                          |
| B       | Ack trước hạn, không ack, race ack/deadline, command lặp, quá sớm, API tạm ngừng                                                      | Execution ARN, command ID, một receipt/intent hoặc `NO_OP`, chờ lại đúng và reconcile khi lỗi                      |
| A       | Dry-run, một email thật, retry/lease/cooldown, mất outcome sau provider call và SMS/Connect nếu thuộc phạm vi                         | Notification/attempt/outcome IDs, không gửi trùng, dry-run không gọi provider, provider ID và kiểm chứng nhận thật |
| C       | CI/CD release mới, CloudWatch logs và alarm, Edge chạy trọn luồng                                                                     | URL CD run, alias/version, log/alarms và kết quả probe camera                                                      |

Trong lượt audit này đã kiểm tra public smoke, kết quả job CD và inventory AWS. 55 unit test orchestrator, 2 test auth frontend, 5 test Face Lambda và 12 kỳ vọng fixture G0 đều đạt. AWS `ValidateStateMachineDefinition` trả `OK` cho JSON Standard ở mục 4. Đây là kiểm tra định nghĩa. Ca có credentials, video, provider thật và fault injection thuộc lượt nghiệm thu của A/B/C. Các thao tác kiểm tra AWS đều chỉ đọc.
