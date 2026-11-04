# Tìm màn hình Console và xử lý lỗi

Đối chiếu **04/11/2026**. Đã xem trực tiếp các biểu mẫu Cognito, S3, SQS, Lambda, EC2, SNS, SMS, Step Functions, CloudWatch và IAM; xem [chi tiết và giới hạn kiểm chứng](08_THUC_HANH_CONSOLE.md). Các màn hình khác vẫn dựa trên tài liệu chính thức. English là baseline. AWS đang dùng nhãn Lambda **Event Functions** và **Connect Customer** trên một số tài liệu; tài khoản có thể còn tên Lambda/Amazon Connect. Không chuyển sang sản phẩm khác chỉ vì nhãn đổi.

08 là nguồn đối chiếu **nhãn Console đã quan sát**; [09](09_RUNBOOK_GHEP_HE_THONG.md) là nguồn đối chiếu **config và thứ tự ghép R0–R7**. Bảng dưới là đường tìm nhanh, không mở rộng phạm vi đã kiểm chứng. Đã tạo/xóa thử SNS topic; chưa gửi email/SMS/call hoặc chạy workflow/alarm E2E trong khảo sát. Connect chỉ thấy tên Amazon Connect Customer trong Search, chưa xem trang instance.

## 1. Bản đồ màn hình

| Việc               | Đường chính                                                                                         | Nếu không thấy                                   |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| User Pool          | Cognito → User pools → Create user pool                                                             | Get started/Define your application              |
| Callback/scopes    | Pool → Applications → App clients → client → Login pages → Managed login pages configuration → Edit | App integration/Login pages, giữ đúng client ID  |
| Domain             | Pool → Branding → Domain                                                                            | Domain trong menu pool                           |
| Bucket             | S3 → General purpose buckets → Create bucket                                                        | Buckets, không chọn directory bucket             |
| Queue              | SQS → Queues → Create queue                                                                         | Kiểm tra Region/quyền ListQueues                 |
| SQS mapping        | Lambda Function overview → Add trigger → SQS                                                        | Configuration → Triggers                         |
| Timeout/env Lambda | Configuration → General configuration/Environment variables → Edit                                  | Không phải env laptop                            |
| Log Lambda         | Monitor → View CloudWatch logs                                                                      | Logs/Log groups; invoke trước để có stream       |
| Workflow           | Step Functions → Create state machine → Create from blank → Code/Config                             | Wizard template; kiểm tra Standard/JSONPath      |
| SNS email          | Topics → topic → Create subscription                                                                | Subscriptions → Create subscription              |
| SMS                | SNS SMS/AWS End User Messaging SMS                                                                  | Kiểm tra sandbox, Region, quyền                  |
| Connect outbound   | Instance → Channels and communications → Telephony                                                  | Telephony settings trên UI cũ                    |
| Server             | EC2 → Instances → Launch instances                                                                  | Search service EC2                               |
| Quản trị server    | Instance → Connect → Session Manager                                                                | Agent/role/managed node/network                  |
| Alarm              | CloudWatch → Alarms → Create alarm → Metrics → Classic                                              | Classic metric/alarm; chưa chuyển sang Space mới |
| Stack output       | CloudFormation → Stacks → stack → Outputs                                                           | Events để đọc deployment failure                 |

Không thấy nút: kiểm tra account/Region/permission. Ghi tên màn hình/nhãn thực tế vào evidence, cập nhật tài liệu qua PR khi xác minh khác biệt; không chụp secret.

### Nhãn cần đối chiếu chính xác với 08

| Việc                    | Trình tự hiện đã quan sát                                                                                          | Giới hạn                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Kết thúc Cognito wizard | Set up resources for your application → Create user directory                                                      | Chưa tạo pool; application name là tên app client                                         |
| Lambda mới              | Event Functions → Create Event Function → Additional settings → Custom execution role                              | Chưa tạo/deploy/invoke; role mặc định chỉ Logs cơ bản                                     |
| S3 namespace            | General purpose → Global namespace cho bài này                                                                     | Account Regional namespace là lựa chọn khác cần điều chỉnh template                       |
| DLQ queue nguồn         | Dead-letter queue - Optional → Enabled → Choose queue → Maximum receives = 5                                       | Mặc định quan sát 10; Redrive allow policy có ý nghĩa khác                                |
| Workflow mới            | State machines → Create state machine → Create from blank/name/Standard → Continue → Design/Code/Config → Create   | Chưa lưu/execute; chọn JSONPath cho mẫu lab                                               |
| SNS trang giới thiệu    | Topic name → Next step → Details Standard/Name → Create topic                                                      | Đã tạo/xóa topic; subscription/publish mới xem form                                       |
| SMS                     | Mobile → Text messaging (SMS) → Account information                                                                | Có lỗi không xác định sandbox; không kết luận đã ra sandbox                               |
| IAM EC2 role            | Select trusted entity (AWS service/EC2/EC2) → Add permissions (Use existing policy) → Name, review, and create     | Chưa Create role; IAM Region Global là bình thường                                        |
| Alarm SQS               | Alarms → Create alarm → Metrics/Classic → Select metric → Browse SQS/Queue Metrics → chọn một hàng → Select metric | Đã xem điều kiện/Additional configuration/Configure actions; chưa hai bước cuối/tạo alarm |

Upload/presign/lifecycle S3, Lambda Code/trigger/logs, VPC/SSM và CloudFormation vẫn phải đối chiếu nguồn AWS và ghi evidence khi người học thực hiện; không gọi các màn hình này là đã xác minh trực tiếp từ khảo sát 08.

## 2. Nguồn hiện hành

| Nhóm           | Tài liệu chính thức                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cognito wizard | [Create application](https://docs.aws.amazon.com/cognito/latest/developerguide/getting-started-user-pools-application.html) · [App client](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)                                                                                                                    |
| Auth           | [PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html) · [JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html) · [Managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html) |
| Recovery       | [Reset password](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminResetUserPassword.html) · [Set user password](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-set-user-password.html)                                                                                                               |
| S3             | [Getting started](https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html) · [Presigned URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)                                                                                                                                                         |
| SQS            | [Create/send queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/creating-sqs-standard-queues.html) · [DLQ](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)                                                                                                            |
| Lambda         | [Create function](https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html) · [SQS mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html) · [Runtime support](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)                                                                                        |
| Face           | [CreateCollection](https://docs.aws.amazon.com/rekognition/latest/dg/create-collection-procedure.html) · [SearchFacesByImage](https://docs.aws.amazon.com/rekognition/latest/dg/search-face-with-image-procedure.html)                                                                                                                                       |
| Workflow       | [Workflow Studio](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-studio-create.html) · [Wait](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html)                                                                                                                                                                           |
| SNS            | [Topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html) · [Subscription](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html) · [Publish](https://docs.aws.amazon.com/sns/latest/dg/sns-publishing.html) · [SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html)                  |
| Connect        | [Create instance](https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-instances.html) · [Outbound](https://docs.aws.amazon.com/connect/latest/adminguide/enable-outbound-calls.html) · [Voice API](https://docs.aws.amazon.com/connect/latest/APIReference/API_StartOutboundVoiceContact.html)                                              |
| EC2/IAM        | [Launch wizard](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-instance-wizard.html) · [IMDSv2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html) · [Role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html)                                                  |
| Operations     | [SSM requirements](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html) · [CloudWatch alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ConsoleAlarms.html) · [Agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html)                          |
| Cost           | [Cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html)                                                                                                                                                                                                                                                          |

## 3. Chẩn đoán theo triệu chứng

| Thấy gì                         | Kiểm tra đầu tiên                                       | Bước tiếp                                         |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| AccessDenied                    | Caller/action/ARN/Region, boundary/SCP                  | Người quản lý cấp đúng quyền                      |
| Không thấy resource             | Account/Region/name/stack                               | C đối chiếu inventory                             |
| Cognito env thiếu               | Biến trùng/rỗng cuối .env? Container recreate?          | Kiểm tra boolean có giá trị, không in env toàn bộ |
| Login sai sau reset             | User status, email thật, kênh recovery                  | A2, phân biệt password local/Cognito              |
| redirect_mismatch               | Scheme/host/port/path/client                            | Sửa callback, login phiên mới                     |
| Login đúng, API 401             | Access token/issuer/client/scope/expiry/verifier        | A/B xem code thật                                 |
| API 403                         | Provisioning/role/ownership                             | Không bỏ guard                                    |
| Lambda không chạy               | Trigger Enabled/queue Region/execution role/visibility  | B3, đọc mapping reason                            |
| Results trống                   | SendMessage/queue URL/permission/log/DLQ                | Return value Lambda không tự vào Results Queue    |
| No-face/ảnh lỗi                 | Crop/key/Region/quyền/exception                         | Phân loại lỗi, không hạ ngưỡng để ép KNOWN        |
| Workflow xanh, không escalation | Đang chạy lab echo hay command thật?                    | B9 và receipt DB                                  |
| Không vào SSM                   | Agent/role/outbound HTTPS/DNS                           | C4, không mở mọi inbound port                     |
| Container thiếu credentials     | Instance profile/IMDSv2 hop limit/credential precedence | C kiểm tra từ container, không đưa key vào image  |
| UI lên nhưng API fail           | URL trong bundle/proxy giữ /api/CORS/TLS                | C6                                                |
| Alarm không email               | Datapoint/dimension/action/subscription confirmed       | Test từng tầng                                    |
| Không xem live                  | Media path/ICE/TURN                                     | Gate live riêng, Lab 08                           |

Sau khi sửa một tầng, chạy lại test tầng đó rồi test tích hợp liên quan. Một response 200 chưa đủ đánh dấu cả sprint pass.

### Lỗi ghép hệ thống — dùng cùng bảng chẩn đoán của 09

| Triệu chứng                                          | Điểm đối chiếu trước                                                                                     | Kết luận cần tránh                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Có log khởi tạo S3 nhưng object không tới bucket dev | STORAGE_PROVIDER=s3, S3_BUCKET, service dùng STORAGE_SERVICE và key thực                                 | Log constructor không chứng minh adapter được chọn               |
| FACE_PROVIDER đổi nhưng Lambda không có job          | Worker baseline dùng BullMQ; PR transport/outbox/dispatcher SQS của R3                                   | FACE_PROVIDER không tự chuyển queue transport                    |
| CLI được nhưng Docker AccessDenied/credentials lỗi   | Profile không tự vào container; instance role/IMDS và cặp key env ghi đè; xem credential chain §2 của 09 | Không nhúng key vào image để chữa                                |
| AI result 400/401/404/409                            | DTO UUID/schema; X-Internal-Token từ INTERNAL_SERVICE_TOKEN; event tồn tại; resultId/payload conflict    | Không gửi sender outcome vào AI result DTO hoặc đổi ID mỗi retry |
| /health 200 nhưng pipeline hỏng                      | R0/R6: test riêng DB, S3 và job/result                                                                   | HealthService baseline không probe dependencies                  |
| Không có template/worker/command API                 | PR/owner/commit thực và điểm dừng R1/R3/R4/R5                                                            | Ghi NEEDS_IMPLEMENTATION; không cấu hình URL/env giả             |
| Chỉ logger/echo lab thành công                       | Receipt/incident/claim/outcome và evidence chặng thật                                                    | LAB_PASS không tự thành INTEGRATION_PASS/E2E_PASS                |

Ghi trạng thái theo 05/06: PASS kèm phạm vi/chặng, hoặc NEEDS_IMPLEMENTATION/NEEDS_FIX/BLOCKED_ACCOUNT/BLOCKED_AI. Đi theo thứ tự R của 09 khi tìm tầng lỗi, rồi cập nhật mốc G tương ứng trong 05; không chạy lại toàn bộ lab khi chỉ một tầng thay đổi.
