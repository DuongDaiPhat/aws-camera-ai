# Sprint 4 — bàn giao SQS/face cho C

## Thành phần và cấu hình triển khai

Các queue đã có: giữ nguyên face jobs, notification jobs, Results và DLQ tương ứng. Không tạo thêm stack/queue trong thay đổi này.

| Thành phần                     | Path / runtime / handler                                                                             | Build / test                                                                                                              | Timeout và trigger                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Face Lambda                    | `services/aws-workers/face/handler.py`; Python 3.12, Linux x86_64; `handler.lambda_handler`          | `python services/aws-workers/build.py`; `python -m unittest discover -s services/aws-workers/face -p "test_*.py"`         | 120 giây, 512 MiB khởi đầu; face jobs SQS, batch size 1, batch window 0; `ReportBatchItemFailures` |
| Dispatcher và Results consumer | `apps/orchestrator/src/cloud-queue/cloud-queue.service.ts`; Node 22/NestJS; lifecycle `onModuleInit` | `pnpm --filter @cam/orchestrator build`; `pnpm --filter @cam/orchestrator test -- cloud-queue ai-result face-recognition` | Vòng lặp không chồng nhau; Results visibility 120 giây, mỗi lần tối đa 5 message                   |
| Notification sender            | Do A triển khai theo phần sender; queue đã sẵn sàng                                                  | B cung cấp `enqueueNotification(client,input)` và receiver `notification.outcome`                                         | Chưa nối Lambda sender/claim/outcome của A trong thay đổi này                                      |

Chỉ orchestrator nhận Results chung và phân loại theo type. Không gắn thêm Lambda face/results hoặc sender riêng để cùng đọc queue Results. Có thể có nhiều instance orchestrator dùng chung DB: khóa job/receipt chống chạy trùng, nhưng chỉ một loại consumer sở hữu queue.

Gói ZIP nằm ở `services/aws-workers/.build/face.zip`, nội dung ZIP có `handler.py`, schema và dependencies ở thư mục gốc. Build script tải wheel Linux phù hợp, không đóng gói wheel Windows. Mỗi lần build dùng thư mục `.build/face` mới; nếu đã có, chuyển thư mục build cũ đi trước, script không tự xóa. Dependencies test cần được cài bằng `python -m pip install -r services/aws-workers/face/requirements.txt` trong môi trường Python riêng.

Face Lambda env:

```text
AWS_REGION=ap-southeast-1
S3_BUCKET=<bucket-dev-chung>
APPLICATION_RESULTS_QUEUE_URL=<results-queue-url>
INTERNAL_API_BASE_URL=https://<host>/api/v1
INTERNAL_SERVICE_TOKEN=<token-noi-bo-it-nhat-32-ky-tu>
REKOGNITION_MATCH_THRESHOLD=0.90
```

C cấp token qua cấu hình bí mật của môi trường, không commit giá trị. Endpoint backend phải truy cập được từ Lambda qua HTTPS; không gắn VPC nếu chưa có đường ra dịch vụ AWS/backend. SDK dùng execution role, không dùng access key laptop.

## Quyền cần cấp theo luồng

| Role / luồng               | Actions                                                             | Resource scope                                                                            |
| -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| EC2 orchestrator → jobs    | `sqs:SendMessage`                                                   | Chỉ ARN face jobs và notification jobs                                                    |
| EC2 orchestrator ← Results | `sqs:ReceiveMessage`, `sqs:DeleteMessage`                           | Chỉ ARN Results                                                                           |
| EC2 upload crop            | `s3:PutObject`                                                      | Bucket dev, `owners/*/cameras/*/events/*/face/*`                                          |
| Face Lambda ← jobs         | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` | Chỉ ARN face jobs; event source mapping sử dụng quyền này                                 |
| Face Lambda → Results      | `sqs:SendMessage`                                                   | Chỉ ARN Results                                                                           |
| Face Lambda đọc crop       | `s3:GetObject`                                                      | Chỉ prefix crop trong bucket dev                                                          |
| Face Lambda nhận diện      | `rekognition:SearchFacesByImage`, `rekognition:DescribeCollection`  | Collection ARN `camerai-s4-dev-owner-*` đúng account/Region                               |
| Face Lambda đếm mặt        | `rekognition:DetectFaces`                                           | Action này không có resource-level scope; C cấu hình theo service authorization reference |
| Face Lambda logs           | `logs:CreateLogStream`, `logs:PutLogEvents`                         | Log group riêng do C tạo, retention theo môi trường                                       |
| SSE-KMS nếu có             | Quyền KMS tương ứng cho đọc/ghi S3 và queue                         | Chỉ key cụ thể và key policy phù hợp; C đối chiếu cách mã hóa thực tế                     |

Backend xác minh job/owner/event/camera/collection trong DB. IAM role dùng chung nhiều owner không thay thế được kiểm tra tenant trong ứng dụng. Các quyền media hiện có cho URL xem ảnh vẫn phải giữ.

Queue source của Face Lambda: visibility ít nhất 720 giây với timeout 120 giây; redrive sang DLQ riêng, `maxReceiveCount=5`. Results cũng phải có redrive policy hữu hạn, đề xuất 5. Không filter type trên Results để tránh tự xóa message không khớp. Chỉ bật trigger sau khi endpoint/backend/migration/env đã sẵn sàng. Theo [AWS SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).

## Migration và chọn transport

1. Backup DB dev cần giữ. Kiểm tra nhánh tích hợp chưa có migration khác mang số 0018; nếu có, đổi số migration mới trước khi merge. Không sửa migration đã chạy.
2. Chạy `pnpm db:migrate` với DB dev đã chọn. Migration `0018_aws_queue_pipeline.sql` thêm bảng transport, registry/mapping, job, result receipt và outcome log; giữ nguyên `event_ai_result_receipts`/`outbox_messages` hiện có.
3. Mặc định DB/runtime đều `bullmq`. Muốn bật cloud: dừng toàn bộ orchestrator cũ và xử lý/giữ có kiểm soát các BullMQ face job còn chờ. Sau đó đổi mode trong DB:

```sql
UPDATE cloud_transport_mode SET mode='sqs' WHERE singleton;
```

4. Đặt `FACE_JOB_TRANSPORT=sqs`, `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `AWS_REGION`, `FACE_JOBS_QUEUE_URL`, `NOTIFICATION_JOBS_QUEUE_URL`, `APPLICATION_RESULTS_QUEUE_URL`. Compose truyền các biến này vào orchestrator. Đặt `APPLICATION_RESULTS_CONSUMER_ENABLED=true` để chạy receiver; `false` chủ động dừng receiver khi kiểm tra Console, dispatcher vẫn hoạt động. Queue phải là ba standard queue khác nhau, đúng Region. Thiếu hoặc sai cấu hình sẽ dừng khởi tạo, không fallback local.
5. Registry phải do luồng enrollment/cloud-face được kiểm chứng cung cấp trước khi gửi: `cloud_face_collections(owner_user_id,collection_id,version)` và `cloud_face_mappings(owner_user_id,face_id,known_face_id)`. Collection thuộc owner có tên `camerai-s4-dev-owner-<ownerUuid>`. Không tự tạo mapping từ email hoặc từ FaceId không xác minh. Tăng version khi tập mặt thay đổi. Việc nối enrollment IndexFaces/DeleteFaces vào app là phần §5.2 riêng, chưa được thay thế bằng bảng mapping này.
6. Khởi động bản mới. Startup đối chiếu DB mode; BullMQ producer/processor face không chạy ở mode SQS. Redis vẫn cần cho các module khác. Không đổi mode nóng; rollback cũng dừng các instance, giữ pending cloud jobs/results và quyết định xử lý trước khi bật lại local. Không purge queue.

Trigger `AFTER INSERT events` tạo ý định face job trong cùng transaction cho PERSON_DETECTED/RESTRICTED_ZONE có camera/track khi DB chọn SQS. Không tự backfill event cũ. Dispatcher lấy crop từ Frigate, upload key ổn định, lưu envelope, commit; lượt sau mới gửi queue. IDs và envelope giữ nguyên khi gửi lại. Source session dùng camera slug và thời điểm bắt đầu event theo luồng ingestion hiện có.

Notification producer gọi `CloudQueueService.enqueueNotification(client,input)` trong cùng transaction tạo intent; ID do nghiệp vụ tạo một lần. Import `CloudQueueModule` vào module gọi helper. Helper kiểm owner và event version; claim/lease/cap/cooldown/recipient và gửi thật thuộc sender của A, không được coi bản ghi transport là quyền gửi. Outcome được lưu vào `cloud_notification_outcomes` cho bước API/UI tiếp theo.

## API nội bộ cho Face Lambda

- `GET /api/v1/internal/cloud/face-jobs/{jobId}`: envelope DB, cached result và mapping active cùng owner. Job mất/sai version bị từ chối.
- `PUT /api/v1/internal/cloud/face-jobs/{jobId}/result`: lưu kết quả hoàn chỉnh đầu tiên; lần ghi cạnh tranh trả kết quả đã lưu. Header `X-Internal-Token` bắt buộc cho cả hai.

Lambda đối chiếu toàn bộ job với DB, bucket/key/collection/owner trước khi gọi Rekognition; DetectFaces phân biệt không mặt/nhiều mặt; DescribeCollection xác nhận rỗng; SearchFacesByImage lấy điểm tốt nhất với threshold tìm kiếm 0 rồi áp threshold nghiệp vụ 0.90 trên thang 0..1. FaceId đạt ngưỡng phải có mapping active. Kết quả được lưu DB trước khi gửi Results; retry dùng nguyên resultId/body/processedAt. Không fallback local. Lỗi kỹ thuật giữ message để retry rồi DLQ; không biến lỗi thành UNKNOWN. Xem [SearchFacesByImage](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_SearchFacesByImage.html).

Results consumer kiểm schema, identity, owner và job; face chỉ nhận đúng cached result, version collection cũ được ghi receipt nhưng không apply. AI apply và cloud receipt dùng cùng DB transaction, tái sử dụng validator/receipt/revision của AiResultsService. Commit xong mới DeleteMessage. Notification outcome được lưu receipt/log trong cùng transaction; cùng attempt khác outcome bị conflict. Message lỗi được giữ để redrive, log chỉ ID, không payload.

## Chẩn đoán và thử lại

```sql
SELECT id,event_id,kind,status,attempts,last_error FROM cloud_jobs ORDER BY created_at DESC LIMIT 20;
SELECT id,job_id,received_at FROM cloud_result_receipts ORDER BY received_at DESC LIMIT 20;
SELECT * FROM cloud_notification_outcomes ORDER BY outcome_id LIMIT 20;
```

Job prepare/send thất bại 5 lần chuyển FAILED, giữ nguyên ID và envelope. Sau khi sửa nguyên nhân, replay có kiểm soát:

```sql
UPDATE cloud_jobs
SET status=CASE WHEN envelope IS NULL THEN 'PREPARING' ELSE 'PENDING' END,
    attempts=0,available_at=now(),last_error=NULL
WHERE id='<job-id-da-kiem-tra>' AND status='FAILED';
```

Lỗi provider có thể phát sinh chi phí lặp nếu crash trước khi cache; không cam kết Rekognition exactly-once. Ảnh upload xong nhưng transaction lỗi có thể thành ảnh thừa ở key ổn định; C giữ lifecycle theo chính sách dữ liệu. Cache/receipt chứa metadata, không chứa ảnh hay embedding; retention đi theo event. Event nhiều track/revision nâng cao cần mở rộng khóa job trước khi thay luồng hiện tại một job/face/event.

## Nghiệm thu

Chạy unit tests backend và Python trước. Chạy migration/DB integration trên PostgreSQL dev độc lập hoặc Docker/Testcontainers. Sau đó thử app → crop S3 → face jobs → Lambda → Results → DB/UI với known/unknown/no-face/multiple-face, owner khác, duplicate 10 lần, changed payload, stale version, tắt consumer sau commit/trước delete, lỗi provider và redrive. Ghi eventId/jobId/resultId, commit/environment và bằng chứng. Unit tests và ZIP build không chứng minh AWS thật hoặc toàn bộ phần B hoàn thành.

## Kết quả kiểm tra local — 06/11/2026

- 62 unit tests backend liên quan (6 suites) đạt; sau điều chỉnh tên biến/consumer flag, 9 tests cloud queue được chạy lại và đạt.
- 5 Python worker tests đạt: cached replay, cache-before-publish, owner mismatch, partial batch failure và bảng kết quả nhận diện.
- TypeScript kiểm tra kiểu và build orchestrator đạt. OpenAPI hợp lệ; 6 cảnh báo có sẵn về health/auth responses và unused components. ESLint các file thay đổi không có error, còn warning về độ dài/độ phức tạp và kiểu trả về.
- Đồng bộ generated contracts; kiểm tra secrets và `git diff --check` đạt. ZIP Linux x86_64 đã build và kiểm tra nội dung/native wheel.
- Đã chạy migration `0018_aws_queue_pipeline.sql` trên PostgreSQL local ngày 06/11/2026, xác minh đủ 6 bảng và trigger `cloud_face_intent`; mode giữ `bullmq`. Trước migration đã tạo và kiểm tra archive backup `artifacts/sprint4/before-0018-2026-11-06T09-08-35-172Z.dump`. Kết quả xác minh: `artifacts/sprint4/migration-0018-verification.json`.
- Đã chạy lại 62 unit tests backend và 5 Python tests: đạt. Hai suite PostgreSQL/Testcontainers `ai-results-db.integration.spec.ts` và `cloud-queue.integration.spec.ts`: 26 tests đạt, gồm local/cloud intent, unique constraint, rollback nguyên tử và hành vi AI results hiện có. Các test tích hợp dùng DB container riêng.
- Chưa deploy hoặc nghiệm thu AWS thật; chưa chứng minh enrollment/notification sender/UI hoàn thành. C cần chạy các ca tích hợp ở trên trên bản dev dùng chung.

- Đã build lại image orchestrator để cài dependencies mới. Sau khi điền các giá trị mặc định đang trống trong `.env` local (tham số số Telegram/Wellness, retry delays `2,4,8`, boundaries `[]`, transport `bullmq`), container `healthy`, `GET /api/v1/health` trả HTTP 200. Không đổi token hoặc cờ bật/tắt Telegram. `.env` không đưa vào Git.
- Log sau khởi động còn MQTT `connack timeout` và MediaMTX từ chối publish camera; health không chứng minh luồng camera đã đạt. Chưa kiểm thử/điều chỉnh các tích hợp camera đó trong lần xác minh migration này.
