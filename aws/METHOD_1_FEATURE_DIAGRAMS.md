# CameraAI — Luồng AWS chi tiết cho Sprint 4

**Cập nhật 21/10/2026.** Đây là thiết kế mục tiêu theo file draw.io mới; không khẳng định code/resources AWS đã hoàn tất. Đi cùng [kế hoạch thực thi](SPRINT_4_AWS_EXECUTION_PLAN.md) và [file kiến trúc nguồn](diagrams/CameraAI_Hybrid_EC2_Lambda.drawio).

## Quy ước

Trong sequence diagram, `->>` là request/lệnh gửi, `-->>` là response. Queue job vẫn bất đồng bộ dù dùng nét liền. Trong sơ đồ monitoring, nét đứt là telemetry. PostgreSQL giữ trạng thái nghiệp vụ; Lambda gọi NestJS qua HTTPS service auth, không truy cập DB trực tiếp. Reverse proxy được lược bỏ ở các mũi tên API để dễ đọc, nhưng request ngoài EC2 vẫn đi qua nó.

## 2. Đăng nhập bằng Cognito

```mermaid
sequenceDiagram
    autonumber
    actor U as Người dùng
    participant B as Browser / Dashboard
    participant C as Cognito
    participant A as NestJS qua HTTPS proxy
    participant D as PostgreSQL
    U->>B: Đăng nhập
    B->>B: Tạo state, nonce và PKCE verifier/challenge
    B->>C: Authorization code request với S256 challenge
    C-->>B: Trang login
    U->>C: Đăng nhập và MFA nếu có
    alt Đăng nhập thành công
        C-->>B: Redirect callback với code và state
        B->>B: Kiểm tra state
        B->>C: Đổi code với code_verifier
        C-->>B: Access, ID và refresh tokens
        B->>B: Validate ID token và nonce qua thư viện OIDC
        B->>A: Request API với access token
        opt JWKS chưa cache hoặc kid mới
            A->>C: Lấy signing keys của issuer được cấu hình
            C-->>A: JWKS
        end
        A->>A: Verify chữ ký, issuer, exp, token_use, client_id và scope
        alt Token hợp lệ
            A->>D: Map issuer/sub và kiểm tra user, role, ownership
            D-->>A: Quyền truy cập tài nguyên
            alt Được phép
                A-->>B: 200 và dữ liệu đúng phạm vi
            else Không có quyền
                A-->>B: 403 Forbidden
            end
        else Token không hợp lệ
            A-->>B: 401, refresh hoặc login lại
        end
    else Đăng nhập bị hủy hoặc lỗi
        C-->>B: Login error
        B-->>U: Thông báo lỗi
    end
```

**Giải thích:** chọn browser PKCE, không nhúng client secret. API dùng access token; mapping user và quyền vẫn ở PostgreSQL. Cache JWKS, không hỏi Cognito mỗi request. Refresh/logout, token storage và reset password phải có implementation/test riêng. G0 chốt có dùng BFF hay browser mode; không trộn hai cách trong cùng contract. Có thể làm luồng này trước khi bất kỳ model fire/fall nào sẵn sàng.

Tham khảo: [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).

## 3. Nhận diện khuôn mặt qua S3, SQS, Lambda và Rekognition

```mermaid
sequenceDiagram
    autonumber
    participant E as Edge / Frigate / MQTT
    participant A as NestJS và Outbox Dispatcher
    participant D as PostgreSQL
    participant S as Private S3
    participant Q as Face Jobs SQS
    participant L as Face Lambda
    participant R as Rekognition
    participant O as Application Results SQS
    participant X as Face Jobs DLQ
    E->>A: Detection metadata qua private VPN
    A->>D: Upsert incident theo identity
    A->>E: Lấy crop theo track
    E-->>A: Ảnh crop
    A->>S: Upload ảnh immutable key
    S-->>A: Upload thành công
    A->>D: Transaction media pointer và job outbox
    D-->>A: COMMIT
    A->>Q: Publish job với stable messageId và bucket/key
    Q-->>A: Đã nhận message
    A->>D: Ghi publish receipt
    Q->>L: Lambda event source mapping invoke
    L->>L: Validate schema, owner, collection và media prefix
    L->>R: SearchFacesByImage với S3Object
    R->>S: Đọc input image
    S-->>R: Ảnh
    alt Phân tích thành công
        R-->>L: FaceMatches / similarity
        L->>O: Publish KNOWN hoặc UNKNOWN theo policy
        O-->>L: Đã nhận result
        L-->>Q: Handler thành công, mapping xóa input
    else Không có mặt sử dụng được
        R-->>L: No-face error được phân loại
        L->>O: Publish UNDETERMINED và qualityReason
        O-->>L: Đã nhận result
        L-->>Q: Handler thành công
    else Provider hoặc result publish thất bại
        L-->>Q: Record failure để retry hữu hạn
        opt Vượt redrive limit
            Q->>X: Chuyển job lỗi tới DLQ
        end
    end
    A->>O: Long-poll ReceiveMessage
    O-->>A: Kết quả với resultId và revision
    A->>D: Transaction receipt, AI result và escalation outbox
    Note over A,D: Duplicate/stale là no-op theo policy, không ghi đè kết quả mới
    D-->>A: COMMIT hoặc no-op thành công
    A->>O: DeleteMessage sau commit
```

**Giải thích:** crop ở S3 trước khi job được publish; S3 không gửi recognition result. Known faces cần được enroll bằng `IndexFaces` và FaceId ánh xạ theo owner; search chỉ dùng mặt lớn nhất nên phải chọn crop phù hợp. Local embedding không nhập thẳng vào Rekognition. Result consumer dedup không loại bỏ mọi chi phí gọi model trùng khi retry. Kết quả lỗi ở Results Queue cũng cần quarantine/alert, không xóa im lặng.

**Làm song song:** AWS dùng ảnh fixture để kiểm tra pipeline; D/E tiếp tục train/evaluate fire/fall. Sau khi model đạt gate, thay nguồn fixture bằng result thật đúng contract, không đổi flow AWS. Hợp đồng UNKNOWN/UNDETERMINED và fallback do B/D review trước.

Tham khảo: [Rekognition API](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_SearchFacesByImage.html), [SQS Lambda mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).

## 4. Cảnh báo và escalation theo deadline

```mermaid
sequenceDiagram
    autonumber
    actor U as Người dùng / liên hệ
    participant A as NestJS và Dispatcher
    participant D as PostgreSQL
    participant Q as Notification Jobs SQS
    participant N as Sender Lambda
    participant P as SNS / Connect
    participant O as Application Results SQS
    participant W as Step Functions Standard
    participant L as Deadline Lambda
    A->>D: Commit NOTIFIED, deadline, rule snapshot và intents/outbox
    D-->>A: COMMIT
    A->>Q: Publish initial notification job
    A->>W: StartExecution với stable name và deadlineVersion
    W-->>A: Execution ARN
    A->>D: Lưu publish receipts / execution mapping
    Q->>N: Invoke initial sender
    N->>A: Authenticated HTTPS claim intent
    A->>D: Kiểm tra state, lease, recipient và cap
    D-->>A: Claim decision
    A-->>N: Cho phép gửi hoặc no-op
    opt Initial intent còn hợp lệ
        N->>P: SNS Publish SMS hoặc email
        P-->>N: MessageId / submission outcome
    end
    N->>O: Publish outcome
    O-->>N: Đã nhận result
    N-->>Q: Handler thành công
    A->>O: Consume outcome, commit receipt rồi delete
    par Có thể xác nhận trong lúc workflow chờ
        opt Người dùng chọn Tôi ổn
            U->>A: HTTPS acknowledgement với access token
            A->>D: Lock và ghi RESOLVED nếu transition còn hợp lệ
            D-->>A: COMMIT
            A-->>U: Trạng thái hiện tại
        end
    and Chờ deadline
        W->>W: Wait tới deadline timestamp
        W->>L: Invoke deadline command
        L->>A: HTTPS commandId, incidentId và deadlineVersion
        A->>D: Lock, kiểm tra status/version/deadline
        alt Resolved, stale hoặc duplicate
            D-->>A: Không tạo intent mới
            A-->>L: No-op thành công
        else Vẫn due và được phép escalate
            A->>D: Commit ESCALATED và call intent/outbox
            D-->>A: COMMIT
            A-->>L: Đã commit escalation
        end
        L-->>W: Kết quả hoặc lỗi retryable
        Note over W,L: Retry/Catch hữu hạn, API down phải báo lỗi và có reconcile
    end
    opt Có call intent mới
        A->>Q: Publish Connect call job
        Q->>N: Invoke emergency sender
        N->>A: Claim và validate intent hiện tại
        A-->>N: Quyết định gửi / bỏ qua
        opt Được phép gọi
            N->>P: StartOutboundVoiceContact với stable ClientToken
            P-->>N: ContactId
            P-->>U: Phát contact flow qua cuộc gọi
        end
        N->>O: Publish submission hoặc skipped result
        O-->>N: Đã nhận result
        N-->>Q: Handler thành công
        A->>O: Consume, commit receipt, rồi delete
    end
```

**Giải thích:** Step Functions chỉ điều phối việc chờ; NestJS/DB quyết định có escalate hay không. NOTIFIED không chứng minh SMS đã được đọc. Ack và deadline cạnh tranh bằng transaction, không bằng thời gian bấm ở browser. Có race sau claim trước provider call; phải chốt cancellation policy, không hứa dừng được call đã submit. Connect ContactId/SNS MessageId chưa chứng minh answered/delivered; DTMF và delivery-status callback là việc bổ sung.

**Nhánh lỗi:** job sender retry bounded rồi tới notification DLQ; timeout sau submit cần xử lý trạng thái không chắc chắn. Workflow/queue/outbox có stable IDs, nhưng SNS SMS không có cam kết exactly-once. Tắt deadline owner cũ khi chuyển cloud hoặc chỉ giữ reconciler qua cùng conditional operation. Dry-run là bằng chứng pipeline, không phải bằng chứng call/SMS thật.

Tham khảo: [Standard workflow](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html).

## 5. Giám sát hệ thống và cảnh báo vận hành

```mermaid
flowchart TB
    EDGE["Edge heartbeat + last frame timestamp"] --> CHECK["Freshness checker / HTTPS probe độc lập"]
    EC2["EC2 / proxy / app logs và OS metrics"] -.-> AGENT["CloudWatch Agent hoặc container log driver"]
    AGENT -.-> LOGS["CloudWatch Logs"]
    AGENT -.-> METRICS["CloudWatch Metrics"]
    L["Face / Deadline / Sender Lambda"] -.-> LOGS
    L -.->|"Errors / Duration / Throttles"| METRICS
    Q["SQS jobs / results / DLQ"] -.->|"Age / visible / DLQ depth"| METRICS
    SF["Step Functions Standard"] -.->|"Failed / TimedOut"| METRICS
    SF -.->|"Execution logging nếu bật"| LOGS
    APP["NestJS: outbox / receipts / provider outcomes"] -.-> LOGS
    APP -.->|"Custom metrics / EMF"| METRICS
    CHECK -.->|"HeartbeatAge / API availability"| METRICS
    LOGS --> VIEW["Dashboard / Logs Insights"]
    METRICS --> VIEW
    METRICS --> ALARM["CloudWatch Alarms"]
    ALARM --> TOPIC["SNS ops topic riêng"]
    TOPIC --> TEAM["Email nhóm đã confirm"]
    TEAM --> RUN["Runbook: điều tra, sửa, replay có kiểm soát"]
    RUN --> Q
```

**Giải thích:** monitoring không nằm trong đường commit nghiệp vụ. EC2 cần agent/log driver để chuyển application logs; EBS không làm việc đó. Logs không tự biến thành alarms nếu thiếu metric/filter/EMF phù hợp. Checker độc lập giúp phát hiện cả lúc NestJS/EC2 chết; edge heartbeat không tự chứng minh camera còn frame.

| Tín hiệu                  | Ngưỡng thử ban đầu               | Phản ứng                                          |
| ------------------------- | -------------------------------- | ------------------------------------------------- |
| DLQ visible               | Lớn hơn 0                        | Điều tra payload/IAM/provider trước redrive       |
| Oldest face job           | Trên 30 giây                     | Kiểm tra backlog/throttle; điều chỉnh theo đo E2E |
| Workflow failed/timed out | Có execution lỗi                 | Sửa API, reconcile deadline từ DB                 |
| Heartbeat age             | Trên 90 giây nếu gửi mỗi 30 giây | Kiểm tra edge/mạng; cấu hình missing data         |
| Outbox oldest pending     | Trên 30 giây                     | Kiểm tra dispatcher/queue permissions             |
| EC2/API unavailable       | Probe thất bại liên tiếp         | Khôi phục server và kiểm tra DB                   |

Đây là ngưỡng khởi đầu, không phải SLA; tính cả CloudWatch period/độ trễ. Ops SNS topic tách incident SNS để Sender lỗi vẫn báo được. Kích alarm thật và xác nhận email nhận được. Logs retention dev đề xuất 7 ngày; mask PII, không log token/ảnh/embedding; event ID là log field, không phải metric dimension duy nhất mỗi event. Dashboard metrics không thay bộ đo precision/recall/FAR của AI.

Tham khảo: [CloudWatch Agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html), [CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html).
