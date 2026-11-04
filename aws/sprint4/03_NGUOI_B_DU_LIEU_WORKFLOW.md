# Người B — S3, hàng đợi, face và deadline

Đầu vào: G0 và profile CLI đúng tài khoản. A/C chưa hoàn thành vẫn làm được B1–B5 với ảnh lab và worker riêng. B sở hữu `api/`, contracts và DB migrations; A/C gửi thay đổi qua PR để B review, tránh ba người cùng sửa một schema.

## B1. Tạo kho ảnh private

1. Search **S3 → General purpose buckets/Buckets → Create bucket**.
2. Region Singapore; bucket type General purpose nếu có lựa chọn. Name `camerai-s4-lab-b-media-<suffix-duy-nhat>`.
3. Giữ Object Ownership: ACLs disabled; **Block all public access** bật. Default encryption chọn SSE-S3 cho lab. Không bật public ACL để sửa AccessDenied.
4. Create bucket. Trên máy đặt tên bốn ảnh như bước 5. Mở bucket → **Objects → Create folder**, nhập `lab`, Create folder; mở folder đó → **Upload → Add files**, chọn ảnh đã được đồng ý và Upload. Như vậy object key có prefix `lab/`, không nằm nhầm ở root bucket.
5. Chuẩn bị bốn object dưới `lab/`: `known.jpg`, `query.jpg` (hai ảnh cùng người), `unknown.jpg` (người khác), `no-face.jpg` (không có người). Dùng ảnh crop một mặt rõ. Không đưa ảnh vào Git.

[AWS S3 getting started](https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html).

6. Mở object, thử Object URL trong browser chưa đăng nhập: không được tải public. Trong Console chọn object → **Object actions → Share with a presigned URL** nếu có; thời gian 5 phút → Create/Copy. Browser tải bằng URL này được. Không ghi đầy đủ signed URL vào evidence.
7. Trong **Management → Lifecycle rules → Create lifecycle rule**, chỉ áp dụng prefix `lab/`, đặt expire phù hợp vòng đời ảnh thử được đồng ý. Nếu bật versioning, phải cân nhắc cả noncurrent versions; không coi expiry current version là xóa mọi bản.

[Presigned URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html), [lifecycle rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html).

**Bàn giao:** bucket name, Region, prefix, chính sách retention; chưa gửi signed URL dài hạn. C dùng các giá trị này tạo bucket dev trong SAM ở bước tích hợp, không nhận quyền sở hữu bucket lab bằng cách đổi tên.

## B2. Tạo SQS và DLQ theo thứ tự

Với mỗi luồng tạo DLQ trước, queue chính sau. Các queue đều **Standard**:

| Queue chính lab                      | DLQ riêng                           | Consumer cuối cùng                            |
| ------------------------------------ | ----------------------------------- | --------------------------------------------- |
| `camerai-s4-lab-b-echo-jobs`         | `camerai-s4-lab-b-echo-dlq`         | Echo Lambda học tập, không dùng cho face thật |
| `camerai-s4-lab-b-face-jobs`         | `camerai-s4-lab-b-face-dlq`         | Face Lambda                                   |
| `camerai-s4-lab-b-results`           | `camerai-s4-lab-b-results-dlq`      | NestJS result worker                          |
| `camerai-s4-lab-a-notification-jobs` | `camerai-s4-lab-a-notification-dlq` | A tạo, Sender Lambda                          |

1. Search **SQS → Queues → Create queue**; Type Standard; nhập tên DLQ face, retention 4 ngày; giữ encryption SQS-managed và quyền private, Create queue.
2. Create queue face-jobs; Configuration: visibility 60 giây, retention 1 ngày, receive wait 20 giây.
3. Expand **Dead-letter queue → Enabled**, chọn ARN DLQ face, Maximum receives `5`. Nếu UI chỉ cho nhập ARN, copy từ Details DLQ. Create queue.
4. Tạo cặp echo-jobs/echo-dlq và results/results-dlq tương tự; lab chưa có consumer nên không gắn Lambda vào results.
5. Mở mỗi queue → Details: ghi **URL và ARN riêng**; URL dùng SDK, ARN dùng IAM/trigger.

[AWS tạo Standard queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/creating-sqs-standard-queues.html), [DLQ](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).

**Tránh tranh consumer:** chỉ poll results thủ công khi application consumer đang tắt. Poll queue làm message tạm ẩn; Delete message là thao tác xóa thật. Không poll job queue trong lúc kiểm tra Lambda nếu muốn quan sát delivery tự nhiên.

## B3. Tạo Lambda và thử queue → log

1. Search **Lambda → Functions → Create function → Author from scratch**. Name `camerai-s4-lab-b-echo`.
2. Chọn Python 3.12 để khớp code lab có sẵn, x86_64. Đây là runtime chủ động chọn, không phải tuyên bố runtime mới nhất. Kiểm tra còn được AWS hỗ trợ; nếu nhóm chọn runtime khác thì cập nhật code/build/test đồng bộ.
3. Permissions: dùng role lab có Logs; tạo function. Vào **Code**, dán handler học tập từ [Lab 02](../labs/02_LAMBDA_SQS.md), giữ file/handler đúng (`lambda_function.lambda_handler` nếu dùng file `lambda_function.py`), bấm **Deploy**.
4. **Configuration → General configuration → Edit**: Timeout 10 giây, Memory 128 MB cho echo; Save. Face thực đo lại memory/timeout.
5. **Configuration → Permissions → Execution role**, mở IAM role. C cấp quyền `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes` cho đúng queue nguồn, Logs cho log group của function. Role sender còn cần `SendMessage` đúng results ARN.
6. Quay **Function overview → Add trigger → SQS**, chọn queue học riêng dùng cho echo, batch size 1, batching window 0, Enable trigger → Add. Không để echo và face cùng consume face-jobs.
7. SQS queue nguồn → **Send and receive messages → Message body**, gửi payload đúng handler lab 02; Send message.
8. Lambda → **Monitor → View CloudWatch logs**, mở stream mới nhất. Phải thấy ID vừa gửi. Log group thường chỉ xuất hiện sau lần invoke đầu tiên.

[Tạo Lambda](https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html), [SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).

Visibility 60 giây cho timeout 10 giây khớp hướng dẫn ít nhất 6×; tăng timeout phải tăng visibility, cộng batching window khi có. Nếu handler trả partial failures, mapping cần bật **Report batch item failures/FunctionResponseTypes**. Nếu Console không có mục này, cấu hình bằng SAM ở Lab 04; không chỉ sửa return value.

## B4. Chứng minh retry và DLQ

1. Dùng input controlled failure của handler lab 02, ID mới. Ghi MessageId và mốc gửi.
2. Đợi đủ các lần retry theo visibility; maxReceiveCount 5 không có nghĩa chờ đúng 5 giây.
3. Theo dõi DLQ có message, log có lỗi tương ứng; kiểm tra message chưa bị mất.
4. Ghi nguyên nhân trước khi redrive. Sau khi sửa, redrive đúng message lab; không Purge queue để dashboard hết cảnh báo.
5. Nếu muốn thử alarm ngay, gửi message trực tiếp vào DLQ lab riêng và nói rõ đó là **alarm test**, không thay thế bằng chứng retry/redrive.

**Bàn giao C:** queue ARN, MessageId lỗi và thời điểm để C dựng DLQ alarm. Bàn giao A schema notification/results để A tạo queue riêng đúng contract.

## B5. Rekognition thật, không suy ra từ Console demo

Face matching của dự án dùng collection API. Không tìm nút trong demo Face analysis rồi coi đã enrollment/search đúng collection.

1. Làm [Lab 03 phần A](../labs/03_REKOGNITION.md): tại PowerShell nhập bucket bằng Read-Host, tạo collection lab riêng bằng CLI `create-collection` với đúng profile/Region.
2. Dùng block PowerShell tạo `index.json` trong Lab 03, index `lab/known.jpg` một lần. Lưu FaceId và ExternalImageId vào ghi chép được bảo vệ.
3. Dùng `search.json` search `lab/query.jpg`; lặp với unknown và no-face. Sửa request file thay vì dán JSON nhiều lớp escape vào PowerShell.
4. Ghi similarity và false match nếu có; ngưỡng 90 của lab là minh họa, không phải giá trị đã đánh giá cho CameraAI.
5. Tạo Face Lambda riêng theo Lab 03 phần B; dùng face-jobs/results. Role phải có GetObject đúng prefix, SearchFacesByImage đúng collection, consume face queue và SendMessage results.
6. Test known/unknown/no-face → results hoặc controlled DLQ như handler lab mô tả. Handler lab chưa có owner isolation và phân loại production; không gắn camera thật vào handler này.

[CreateCollection](https://docs.aws.amazon.com/rekognition/latest/dg/create-collection-procedure.html), [SearchFacesByImage](https://docs.aws.amazon.com/rekognition/latest/dg/search-face-with-image-procedure.html).

Trong adapter sản phẩm: phân biệt KNOWN, UNKNOWN và lỗi/no-face không đủ kết luận; cô lập collection/mapping theo owner; enrollment/delete và xóa S3/vector có vòng đời riêng. SearchFacesByImage chọn mặt lớn nhất, nên crop một người trước. Không nhập local embedding vào Rekognition rồi mong tương thích.

## B6. Chuyển từ Console lab sang stack dev tái tạo được

1. B và C cùng làm [Lab 04 phần A](../labs/04_TICH_HOP_NESTJS_SAM.md) để deploy SAM stack echo riêng. Dán **toàn bộ template của bài**, không deploy một nửa resource.
2. Console **CloudFormation → Stacks → stack → Events**: đợi CREATE_COMPLETE; lỗi thì đọc resource FAILED đầu tiên. Tab Outputs phải có queue URL và function name.
3. C sở hữu `infra/aws/template.yaml` cho dev; B cung cấp handler paths, timeout, queue mapping và quyền tối thiểu. A cung cấp sender config. Tên lab không trùng tài nguyên stack dev.
4. Validate/build/change set/review trước deploy. Sau khi resource thuộc stack, mọi thay đổi lâu dài quay về template. Không tạo lại thủ công resource bị drift rồi báo stack tái tạo được.

## B7. Các PR ứng dụng cần viết, theo thứ tự

| PR                  | Vị trí cần làm                                         | Điều kiện kiểm tra trước khi chuyển PR tiếp                                              |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Contract            | `api/*.yaml`, generated contracts; job/result fixtures | Version, loại message, stable ID, owner/camera/observation/revision, các lỗi được review |
| Durable dispatch    | Migration + orchestration service                      | DB transaction ghi outbox; upload S3 trước publish; dispatcher retry không mất job       |
| Result consumer     | Worker long-poll results + AI result service           | Validate schema/owner; commit receipt và kết quả rồi delete SQS                          |
| Face adapter        | `services/aws-workers/face/` và mapping app            | Known/unknown/no-face, owner isolation, partial failure, enrollment/delete               |
| Deadline command    | Service/controller/contract cần tạo nếu chưa có        | Lock/check state/version; stale/resolved no-op; duplicate command không nhân intent      |
| Workflow dispatcher | Workflow-start outbox + execution mapping              | Retry/restart không tạo workflow hoặc escalation trùng                                   |

Đây là việc lập trình cần thực hiện, không phải file đã có chỉ vì tên xuất hiện ở bảng. Điểm nhận AI result đã thấy trong snapshot main là controller `internal/events` với POST `:eventId/ai-result`; base API là `/api/v1`. B đọc DTO/service/OpenAPI của commit code thực tế trước khi dùng, không bypass service bằng SQL. Deadline/claim chưa được xác nhận có sẵn ở snapshot tài liệu; B tạo hoặc đối chiếu trong branch code rồi công bố đúng path/auth/schema tại G1.

**Test bắt buộc:** gửi cùng result ID 10 lần; stale revision đến sau mới; dừng sau commit trước delete rồi restart; invalid owner; payload sai schema; mất mạng giữa publish và ack. Invalid result phải vào quarantine/DLQ có log, không xóa im lặng hoặc retry vô hạn thiếu phân loại.

## B8. Tạo workflow chờ nhìn thấy được

1. Tạo deadline Lambda học tập bằng code hoàn chỉnh ở [Lab 06 phần A](../labs/06_STEP_FUNCTIONS.md); Deploy. Code chỉ log, chưa gửi thông báo.
2. Search **Step Functions → State machines → Create state machine → Create from blank**. Name `camerai-s4-lab-b-deadline` → Continue.
3. **Code**: dùng định nghĩa JSON trong Lab 06. Bài đó dùng JSONPath (`SecondsPath`, `Payload.$`); không đổi sang JSONata trong wizard rồi dán code JSONPath. Nếu có Query language, chọn JSONPath hoặc giữ định nghĩa JSONPath hợp lệ ở cấp workflow.
4. Thay FunctionName bằng ARN function thật. **Config** chọn **Standard**, kiểm tra execution role chỉ được InvokeFunction đúng ARN. Create.
5. **Start execution** với `{"eventId":"lab-deadline-01","waitSeconds":10,"forceError":false}`. Graph đi Wait → Task → Succeeded. Xem input/output từng state.
6. Execution mới với forceError true: phải quan sát retry rồi Failed. Lambda không sleep trong suốt thời gian Wait.

[Workflow Studio hiện hành](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-studio-create.html), [Wait state](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html).

## B9. Nối deadline thật sau khi C có HTTPS

1. Transaction chuyển NOTIFIED ghi deadline timestamp/version và workflow-start outbox. Dispatcher gọi StartExecution với tên ổn định theo event/version, lưu execution ARN để đối soát.
2. Workflow dev dùng **TimestampPath** tới deadline UTC đã lưu, không luôn đợi thêm N giây từ lúc nhận message.
3. Deadline Lambda gọi service command HTTPS do B công bố; không gọi localhost của laptop và không truy cập DB trực tiếp.
4. Service xác minh command, lock incident, đối chiếu version/trạng thái và thời gian DB; resolved/stale no-op, due mới commit ESCALATED + intent.
5. Disable deadline owner cũ hoặc biến thành reconciler qua cùng operation. A nhận notification intent sau bước này.
6. Test ack đến trước deadline, ack cạnh tranh deadline, command lặp, API down rồi phục hồi, workflow failed rồi reconcile. Standard workflow không thay thế business idempotency.

**B hoàn thành:** G1 pipeline thật; G2 deadline và sender hợp tác; receipt/outbox/race/recovery có test. Chưa có HTTPS thì giữ B8 pass và B9 chờ C, không tự ghi deadline E2E pass.
