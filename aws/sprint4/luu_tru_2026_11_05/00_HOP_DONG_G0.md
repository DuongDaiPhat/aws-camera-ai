# Hợp đồng G0 — CameraAI Sprint 4, phiên bản 1

> BẢN CŨ ĐƯỢC LƯU NGÀY 05/11/2026. Không dùng làm hướng dẫn hiện hành. Mở file theo vai trò A/B/C ở thư mục cha.

**Chốt ngày 05/11/2026 theo yêu cầu chủ đồ án.** Đây là quyết định triển khai chung cho A/B/C, áp dụng tới khi có thay đổi contract được ghi và review. Đối chiếu baseline `10e015cb0582ad568057b7b4fbea3c5765df5bb3`. Chưa xác minh account/quyền AWS, chưa merge code auth bổ sung, chưa chạy tích hợp; không dùng tài liệu này làm evidence G0 hạ tầng hoặc Sprint đã PASS.

## 1. Phạm vi, owner và thứ tự triển khai đã chốt

| Quyết định                    | Giá trị chốt                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mục tiêu                      | Tính năng chạy trên ứng dụng để demo đồ án; quy mô lab, một EC2, không yêu cầu HA                                                                                         |
| Môi trường tích hợp           | `dev`, Region `ap-southeast-1`, profile laptop `camerai-lab`                                                                                                              |
| Người deploy tài nguyên chung | C; A/B dùng tài nguyên lab riêng khi học Console                                                                                                                          |
| A                             | Cognito/backend auth/frontend; sender Lambda và kênh thông báo; review UI/ownership của B                                                                                 |
| B                             | Contract/migration/outbox/Results consumer/face/enrollment/deadline/claim/outcome; review auth của A                                                                      |
| C                             | SAM/IAM/EC2/HTTPS/VPN/config/deploy/monitoring/recovery/CD; review quyền và worker deployment                                                                             |
| Auth bản demo cloud           | `AUTH_PROVIDER=cognito`, public client code + PKCE; role/ownership do DB ứng dụng quyết định                                                                              |
| Face cloud                    | `FACE_PROVIDER=rekognition`, `FACE_JOB_TRANSPORT=sqs`; fall/fire tiếp tục chạy ở edge                                                                                     |
| Deadline cloud                | `DEADLINE_DRIVER=stepfunctions`; một operation nghiệp vụ idempotent dùng chung cho command/reconcile                                                                      |
| Notification cloud            | `NOTIFICATION_DRIVER=sqs`, sender bắt đầu dry-run; SNS email thật là ca demo bắt buộc                                                                                     |
| SMS và gọi điện               | Giữ adapter/contract SNS_SMS và CONNECT_CALL; kiểm tra quyền ngay đầu sprint. Thiếu quyền ghi blocker từng kênh, không coi email thay thế tiêu chí SMS/call trong backlog |
| Producer                      | Một đường Frigate/MQTT cho incident trong ca demo; không phát thêm cùng incident bằng fixture/API/model adapter độc lập                                                   |
| Source of truth               | PostgreSQL: user/owner/camera/event/version/deadline/intent/ledger/receipt. AWS message không được tự đổi quyền                                                           |
| Giữ chức năng đang có         | Telegram/local vẫn có thể phục vụ chức năng khác; không để local và cloud gửi cùng notification hoặc xử lý cùng face job/deadline                                         |

Thứ tự PR: **B contract → B outbox/consumer → B face → B deadline → A+B sender**, trong khi **A auth** và **C template/HTTPS** làm song song. Claim/outcome contract đã chốt ở §5 nên A có thể viết adapter với mock ngay; chỉ nối thật sau khi backend và HTTPS hoạt động. C tích hợp từng PR đã review vào bản dev; không deploy nguyên nhánh docs.

Tên nhánh triển khai mặc định `codex/s4-<owner>-<feature>` nếu tạo bằng agent; thành viên dùng quy ước repo. Nhánh tích hợp là `main` sau PR được người khác review; không tạo thêm nhánh sống lâu và không push trực tiếp main. Commit/digest demo được C ghi riêng khi release, không mặc định bằng baseline nêu trên.

## 2. Quy tắc chung cho dữ liệu và quyền

- `eventId`, `cameraId`, `ownerScopeId`, `jobId`, `resultId`, `notificationId`, `commandId`, `attemptId` dùng UUID. `ownerScopeId` của luồng camera là application user ID sở hữu camera, không phải Cognito sub. Sự kiện không gắn camera như wellness giữ contract riêng hiện có, không ép vào face job.
- `observationId` là chuỗi tối đa 200 ký tự, face dùng `track:<trackId>:face`; track ID và source session lấy từ nguồn event. `revision`, `collectionVersion`, `deadlineVersion`, `expectedEventVersion` là số nguyên dương. Timestamp UTC ISO-8601 hậu tố `Z`.
- IDs sinh một lần khi ghi công việc vào DB; dispatcher retry giữ nguyên ID và payload. Result hoàn chỉnh được lưu bền vững trước khi publish/retry, giữ nguyên cả `processedAt`; cùng ID khác nội dung là conflict. Execution name `deadline-<commandId>`; workflow input giữ nguyên khi retry start.
- Consumer kiểm tra event/camera/owner theo DB và pending job, không tin trường owner do message khai báo. Worker kiểm tra bucket/key/collection đúng phạm vi cấu hình và registry đã deploy. Kết quả chỉ được apply nếu khớp job đã chấp nhận, owner và collection version; không gọi API AI result công khai bằng dữ liệu tùy ý.
- Collection tách theo owner: `camerai-s4-dev-owner-<ownerUuid>`; B giữ registry owner → collection ID/version và FaceId → knownFaceId trong DB, đồng bộ cấu hình cần thiết cho worker. Không dùng một collection chung mặc định từ `.env.example` cho nhiều owner. FaceId lạ là lỗi mapping, không tự gán KNOWN.
- Object key do backend sinh: `owners/<ownerUuid>/cameras/<cameraUuid>/events/<eventUuid>/face/<jobUuid>.jpg`. Không gửi ảnh/base64/embedding/token/presigned URL trong message. Bucket private; API media kiểm tra quyền trước khi cấp URL có hạn.
- Queue là Standard, giao ít nhất một lần; không giả định thứ tự hoặc exactly-once. Outbox được ghi trong transaction nghiệp vụ; receipt/result commit trước DeleteMessage. Payload lỗi terminal phải có reason và lưu quarantine/DLQ; lỗi tạm retry hữu hạn. Replay DLQ qua runner được kiểm soát, không đổi ID để né conflict.
- Results Queue dùng chung **một application consumer** route theo `type`. Không tạo hai consumer face/notification tranh cùng queue. Worker face/sender không ghi SQL trực tiếp; nghiệp vụ đi qua service của backend.

## 3. Message v1 đã chốt

Schema và fixtures đi kèm ở [contracts/README.md](../contracts/README.md). Schema là hợp đồng mới cần implement, chưa phải validator đã được gắn vào runtime.

Envelope của cả ba loại queue:

| Field           | Quy định                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Số `1`                                                                                                        |
| `type`          | `face.job`, `face.result`, `notification.job` hoặc `notification.outcome`                                     |
| `messageId`     | UUID stable; face job = jobId, face result = resultId, notification job = notificationId, outcome = outcomeId |
| `correlationId` | Bằng eventId để trace                                                                                         |
| `occurredAt`    | Thời điểm tạo message, giữ nguyên khi retry                                                                   |
| `payload`       | Theo loại dưới đây; từ chối unknown type/version                                                              |

### Face job → face result

`face.job.payload`: `jobId`, `eventId`, `cameraId`, `ownerScopeId`, `trackId`, `sourceSessionId`, `observationId`, `revision`, `collectionVersion`, `collectionId`, `image: {bucket,key}`, `resultId`. Producer cấp resultId trước; worker publish đúng ID đó. Retry không tự tăng revision. Observation mới/revision mới sinh jobId/resultId mới.

`face.result.payload`: `jobId`, `ownerScopeId`, `cameraId`, `body`. `body` giữ nguyên `SubmitAiResultDto` ở `apps/orchestrator/src/ai-results/dto/submit-ai-result.dto.ts`; không nhét envelope vào DTO. Consumer đối chiếu pending job rồi gọi `AiResultsService.submit(body.eventId, body)`; nếu tách process dùng API hiện có `POST /api/v1/internal/events/{eventId}/ai-result`, `X-Internal-Token`, HTTP 202 với ACCEPTED/DUPLICATE/STALE. Envelope schema không thay thế semantic validation của service.

Chốt score policy face `rekognition-normalized-v1`: similarity provider được adapter chuẩn hóa về 0..1; threshold lab `REKOGNITION_MATCH_THRESHOLD=0.90` chỉ là ngưỡng thử, cần báo cáo đo trước khi tuyên bố độ chính xác. Search phải trả được top candidate dưới ngưỡng quyết định để phân biệt unknown. Không thấy match do bộ lọc tìm kiếm không có nghĩa similarity=0. Khi không xác định được similarity, trả UNDETERMINED thay vì bịa confidence.

| Kết quả                                    | personStatus / matchedKnownFaceId        | results / error                                                         |
| ------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Match đủ ngưỡng + mapping hợp lệ           | KNOWN / application knownFace UUID       | Một item KNOWN; confidence=similarity                                   |
| Có top similarity dưới ngưỡng              | UNKNOWN / null                           | Một item UNKNOWN; confidence=1-similarity                               |
| Collection rỗng đã xác nhận                | UNKNOWN / null                           | confidence=1, similarity=null, policy `empty-collection-v1`             |
| No-face/multiple-face/score không xác định | UNDETERMINED / null                      | confidence=null, similarity=null, metadata có qualityReason, error=null |
| Lỗi kỹ thuật cuối cùng                     | Bỏ personStatus; matchedKnownFaceId=null | results=[], error={code,message}; không biến thành UNKNOWN              |

Item có `module=M1_FACE`, label trùng personStatus, `boundingBox=null` hoặc box chuẩn hóa 0..1; metadata có `confidencePolicyVersion`, `similarity`, `provider=rekognition`, `collectionVersion`, `sourceSessionId`, `fellBackToLocal=false`. Không fallback local âm thầm. Kiểm tra các giới hạn metadata/score bằng validator hiện có. Enrollment/delete phải đi từ app, lưu registry và tăng collectionVersion khi thay đổi tập known faces; result version cũ không ghi đè trạng thái mới.

### Notification job → outcome

`notification.job.payload`: `notificationId`, `eventId`, `ownerScopeId`, `expectedEventVersion`, `channel` (SNS_EMAIL/SNS_SMS/CONNECT_CALL). Queue không chứa địa chỉ nhận hoặc nội dung nhạy cảm. Backend claim quyết định recipient/message/topic và trả về qua HTTPS có auth.

`notification.outcome.payload`: `outcomeId`, `notificationId`, `eventId`, `ownerScopeId`, `attemptId`, `status`, `providerCalled`, `providerId` (string hoặc null), `reason` (string hoặc null). Status: DRY_RUN/PROVIDER_ACCEPTED/FAILED/UNCERTAIN. `providerId` bắt buộc khác null khi PROVIDER_ACCEPTED; `providerCalled=false` cho DRY_RUN. Outcome gắn attempt đã claim, không tự tạo notification mới. No-op claim không tạo attempt và sender hoàn tất job sau response no-op đã được backend lưu reason.

Status outcome là contract ledger mới; không insert trực tiếp những chuỗi này vào enum `notifications.status` hiện chỉ có PENDING/SENT/FAILED/CONFIRMED/SKIPPED. B bổ sung ledger/migration và mapping: PROVIDER_ACCEPTED → SENT; FAILED → FAILED; DRY_RUN → SKIPPED kèm reason; UNCERTAIN giữ pending nhưng khóa auto resend bằng ledger. SENT chỉ nghĩa provider nhận request; không tự ghi CONFIRMED/ack. Xác nhận người nhận qua workflow ứng dụng riêng.

## 4. Deadline command và workflow input v1 — B cần triển khai

**Chốt endpoint:** `POST /api/v1/internal/events/{eventId}/deadline`. Dùng HTTPS và `X-Internal-Token` từ `INTERNAL_SERVICE_TOKEN` (tối thiểu 32 ký tự). Không dùng token browser hoặc `AI_INTERNAL_TOKEN` thay thế. Guard phải áp dụng trước service; không mở endpoint không auth để Lambda gọi được.

Request: `{schemaVersion:1, commandId:UUID, eventId:UUID, deadlineVersion:int, expectedDeadlineAt:UTC}`. eventId body phải khớp path. Workflow input giữ nguyên object này; Wait dùng expectedDeadlineAt. Không dùng aggregate version làm deadlineVersion: các cập nhật khác có thể đổi aggregate mà deadline vẫn hợp lệ.

HTTP 200: `{commandId, disposition:"APPLIED"|"NO_OP", reason, aggregateVersion}`. Reason APPLIED=`ESCALATED`; NO_OP gồm ACKNOWLEDGED/RESOLVED/STALE_DEADLINE/ALREADY_APPLIED. Duplicate command cùng payload trả quyết định đã lưu, không tạo thêm intent. Nếu quá sớm, HTTP 409 `NOT_DUE` và `retryAt` bằng deadline trong DB; Lambda/workflow phải retry có chờ, không coi NO_OP kết thúc vĩnh viễn.

Malformed 400; auth 401; event không tồn tại 404; ID dùng lại khác payload 409 `COMMAND_CONFLICT`; lỗi hạ tầng 5xx. Lambda map lỗi terminal và retryable thành kết quả/lỗi riêng; Retry/Catch/reconciler theo R4. NOT_DUE được reschedule, 429/timeout/5xx retry hữu hạn; terminal lỗi vào cảnh báo/đối soát.

Transaction dùng lock và clock DB: kiểm tra command receipt, state, deadlineVersion và deadline đã lưu, sau đó đổi trạng thái + history + notification intent/outbox + command receipt nguyên tử. Ack đã commit trước lock → no escalation. Command commit trước ack → escalation đã tạo giữ lịch sử; sender claim kiểm tra lại trạng thái để không gửi intent đã hết hiệu lực. Không hứa ack thu hồi được request provider đã nhận.

## 5. Sender claim/outcome API v1 — B cần triển khai

**Claim:** `POST /api/v1/internal/notifications/{notificationId}/claim`, cùng service auth ở §4. Body `{schemaVersion:1, claimId:UUID, eventId:UUID, expectedEventVersion:int}`; claimId giữ nguyên qua retry cùng job. Backend kiểm tra DB owner/channel/version/state/recipient policy/cap/cooldown; không tin job chỉ vì schema hợp lệ.

- HTTP 200 CLAIMED: `{notificationId, disposition:"CLAIMED", attemptId, leaseUntil, mode:"DRY_RUN"|"REAL", delivery:{channel, recipientRef, topicArn?, destination?, message, subject?}}`. delivery được backend tạo, chỉ trả về caller đã xác thực; không log nguyên response. SNS_EMAIL chỉ dùng topic đã xác nhận chứa đúng người nhận được phép; nếu nhiều owner không gửi dữ liệu của một owner tới topic chung của người khác.
- HTTP 200 NO_OP: `{notificationId, disposition:"NO_OP", reason}` với ALREADY_SENT/RESOLVED/STALE_VERSION/EXPIRED/CAP_EXCEEDED/CANCELLED. Ghi quyết định bền vững. Cooldown còn hiệu lực/claim đang bận → 409 BUSY với retryAt, không bỏ mất notification bằng NO_OP.
- Claim lặp trả cùng attempt nhưng `mode=REAL` đã cấp quyền gửi mà chưa có outcome thì không cấp quyền gửi lần hai. Ghi ledger UNCERTAIN và yêu cầu reconcile khi không biết provider đã được gọi hay chưa; ưu tiên tránh gửi trùng hơn tự động thử mù. Mode DRY_RUN không gọi provider. Lease mặc định lab 120 giây, kiểm tra lease trước khi gọi; lease hết không tự cấp lại quyền gửi thật.
- 400/401/404/409 conflict/5xx có ý nghĩa tương tự §4. Outcome sai attempt/owner/channel hoặc providerId mâu thuẫn là conflict/quarantine, không bỏ guard để replay.

**Outcome:** đường chính là `notification.outcome` qua Results Queue. Consumer gọi service outcome (**cần tạo**), commit ledger/receipt trước xóa queue. Nếu worker tách process, endpoint chốt `POST /api/v1/internal/notifications/{notificationId}/outcome`, body là payload outcome, cùng service auth; HTTP 202 `{outcomeId,disposition:"ACCEPTED"|"DUPLICATE"}`. Cùng outcomeId khác body trả 409; receipt theo outcomeId và ràng buộc attempt ngăn cập nhật mâu thuẫn.

Sau provider nhận nhưng chưa lưu outcome là cửa sổ không chắc chắn. Sender retry publish outcome đã lưu nếu có; không gọi lại provider để tái tạo outcome. Mất outcome phải đối soát theo attempt/provider logs, không reset notification để gửi lại. Connect dùng notificationId làm ClientToken ổn định; không coi SNS có cùng bảo đảm chống lặp. Dry-run/accepted/delivered phải thể hiện khác nhau trong UI/evidence.

## 6. Tên cấu hình đã chốt

Các biến có nhãn **mới** là yêu cầu PR phải bổ sung validator/reader/Compose, chưa có hiệu lực chỉ bằng cách thêm vào `.env`. Mode cloud thiếu config phải fail startup, không tự chạy local thay thế. Giữ default local của repo cho người chưa làm AWS.

| Biến                                                    | Giá trị/nguồn cloud                        | Nơi đọc / owner                                                                                             |
| ------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| AWS_REGION                                              | ap-southeast-1                             | Backend và workers / C                                                                                      |
| AUTH_PROVIDER                                           | cognito                                    | Auth config cần tích hợp / A                                                                                |
| COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN | Outputs; domain là HTTPS origin            | Backend/auth config / A                                                                                     |
| WEB_ORIGIN                                              | HTTPS origin do C cấp                      | Backend CORS / A,C                                                                                          |
| NEXT_PUBLIC_API_BASE_URL                                | `<WEB_ORIGIN>/api/v1`                      | Web build / A,C                                                                                             |
| STORAGE_PROVIDER, S3_BUCKET                             | s3, MediaBucketName                        | Storage adapter / B,C                                                                                       |
| FACE_PROVIDER                                           | rekognition                                | Face/enrollment routing cần triển khai / B                                                                  |
| FACE_JOB_TRANSPORT **mới**                              | sqs (local: bullmq)                        | Face producer + worker gating / B                                                                           |
| FACE_JOBS_QUEUE_URL **mới**                             | FaceJobsQueueUrl                           | Outbox dispatcher / B                                                                                       |
| APPLICATION_RESULTS_QUEUE_URL **mới**                   | ApplicationResultsQueueUrl                 | Face/sender publish + Results consumer / A,B                                                                |
| APPLICATION_RESULTS_CONSUMER_ENABLED **mới**            | true ở dev                                 | Results consumer lifecycle / B                                                                              |
| REKOGNITION_MATCH_THRESHOLD **mới**                     | 0.90, thang 0..1                           | Face adapter; giữ FACE_MATCH_THRESHOLD cho local / B                                                        |
| DEADLINE_DRIVER **mới**                                 | stepfunctions (local: local)               | Deadline dispatch + local worker gating / B                                                                 |
| DEADLINE_STATE_MACHINE_ARN **mới**                      | DeadlineStateMachineArn                    | Workflow dispatcher / B                                                                                     |
| INTERNAL_API_BASE_URL **mới**                           | `<WEB_ORIGIN>/api/v1`, không có slash cuối | Deadline/sender gọi các path trong §4/5 / A,B,C                                                             |
| INTERNAL_SERVICE_TOKEN                                  | Secret ref riêng của dev                   | API guard, deadline/sender; không log / C                                                                   |
| NOTIFICATION_DRIVER **mới**                             | sqs (local: local)                         | Intent dispatcher + local sender gating theo channel / B                                                    |
| NOTIFICATION_JOBS_QUEUE_URL **mới**                     | NotificationJobsQueueUrl                   | Intent outbox dispatcher / B                                                                                |
| SENDER_DRY_RUN **mới**                                  | true, chỉ false sau test/review kênh thật  | Backend claim quyết định mode; sender chỉ được giảm REAL thành DRY_RUN, không nâng DRY_RUN thành REAL / A,B |
| SNS_TOPIC_ARN                                           | IncidentEmailTopicArn, tách ops topic      | Backend recipient routing/claim; quyền sender / A,C                                                         |
| CONNECT_INSTANCE_ID, CONNECT_CONTACT_FLOW_ID            | Resource đã xác minh khi bật call          | Backend delivery config và sender / A,C                                                                     |

Collection/owner mapping là dữ liệu registry, không dùng một env REKOGNITION_COLLECTION_ID chung làm nguồn quyền. Allowlist/cap/cooldown và cấu hình kênh theo owner lưu DB hoặc config được quản lý, không lấy từ queue. Giá trị lab mặc định: dry-run, cap 5 request provider/ngày/người nhận/kênh, cooldown 60 giây; B áp dụng transaction khi claim. Chủ đồ án có thể điều chỉnh có ghi evidence, không chỉnh bằng message.

File đọc config mới do PR tạo: backend `apps/orchestrator/src/aws/aws.config.ts`; workers `services/aws-workers/<face|sender|deadline>/config.*` (**đích cần tạo**). Điền file thực vào 09 sau merge nếu tổ chức khác, giữ nguyên tên biến. Không sửa `.env.example` gốc thành mode cloud khi code chưa đọc các biến này.

## 7. Naming và Outputs để C triển khai

Stack `camerai-s4-dev`; queues `camerai-s4-dev-face-jobs`, `camerai-s4-dev-notification-jobs`, `camerai-s4-dev-results`, mỗi queue có `-dlq`. Functions `camerai-s4-dev-face`, `camerai-s4-dev-sender`, `camerai-s4-dev-deadline`; workflow `camerai-s4-dev-deadline`; SNS incident `camerai-s4-dev-incident-email`, ops `camerai-s4-dev-ops`. Bucket `camerai-s4-dev-media-<accountId>-<suffix>`; C chọn suffix duy nhất và ghi inventory.

Outputs bắt buộc: `MediaBucketName`, `FaceJobsQueueUrl`, `FaceJobsQueueArn`, `ApplicationResultsQueueUrl`, `ApplicationResultsQueueArn`, `NotificationJobsQueueUrl`, `NotificationJobsQueueArn`, `DeadlineStateMachineArn`, `FaceFunctionArn`, `SenderFunctionArn`, `DeadlineFunctionArn`, `IncidentEmailTopicArn`, `OpsTopicArn`; URLs/ARNs cho từng DLQ. Cognito pool/client/domain và WebOrigin được C/A ghi trong release manifest dù tài nguyên được quản lý ở stack riêng. Template tham chiếu code workers thật, không dùng handler echo cho bản tích hợp.

## 8. Các giá trị chưa thể tự điền và điều kiện qua G0

| Giá trị thực tế còn phải xác minh                                      | Người cung cấp                   | Chặn bước nào                                      |
| ---------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Account alias/ID, role từng người, STS đúng, quyền/PassRole, ngân sách | C và chủ account                 | Tạo/deploy AWS; không chặn viết code/fixtures      |
| Danh tính thành viên A/B/C và người review                             | Nhóm điền tên vào 06             | Phân công cá nhân; trách nhiệm vai trò đã chốt     |
| Pool/client/domain Cognito và hai application user IDs                 | A                                | Auth integration; fixtures chỉ có UUID giả lập     |
| Camera/known face/collection IDs ứng dụng thật                         | B                                | Chạy fixture lên dev; phải seed bằng quy trình app |
| Domain HTTPS/DNS, VPN và secret refs                                   | C                                | Lambda gọi API và E2E cloud                        |
| Email/số nhận đã đồng ý, subscription/Connect/quota                    | A                                | Gửi thật đúng kênh                                 |
| Model artifact/checksum/report                                         | B phối hợp người phụ trách model | E2E model thật                                     |
| Commit/digest deploy và Outputs thực                                   | C sau PR triển khai              | Nghiệm thu bản dev/demo                            |

**G0_CONTRACT=CHỐT_V1. G0_ACCESS=CHƯA_XÁC_MINH.** Nhóm bắt đầu các phần code độc lập ngay theo contract này. Chỉ ghi G0 đầy đủ PASS khi STS/quyền/budget và các giá trị cần cho bài đầu có evidence trong 06; tài liệu không giả lập sự đồng ý của reviewer hoặc quyền của account.

Mọi thay đổi type/field/endpoint/semantics/tên config phải cập nhật tài liệu này, schema/fixtures, OpenAPI/generated contracts nếu liên quan, producer/consumer và test trong cùng chuỗi PR phối hợp. B quản lý contract, A review tương thích sender/auth, C review deploy; ghi version và migration plan trước khi bật. Không một người đổi contract để riêng worker mình chạy xanh.
