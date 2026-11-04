# Người C — EC2, HTTPS, triển khai, giám sát và bàn giao

Bạn bắt đầu cùng A/B sau G0: kiểm tra quyền/kênh báo lỗi, dựng EC2 và production Compose bằng app local đã review. Chưa cần chờ face model hoặc Cognito. Dùng [mẫu inventory](06_MAU_BAN_GIAO.md) để không tạo trùng tài nguyên.

**Khi ghép:** C là người deploy stack chung duy nhất ở R1, hỗ trợ config/credentials R0–R5, triển khai cloud/edge R6 và vận hành/CD R7 trong [runbook 09](09_RUNBOOK_GHEP_HE_THONG.md). Không dùng Compose dev hoặc SAM echo như bộ triển khai tích hợp đã hoàn chỉnh. VPC/SSM/Docker/agent và các bước sau launch chưa được kiểm tra trực tiếp trong 08; wizard EC2/IAM mới được xem tới trước nút tạo.

## C1. Chốt mạng và nơi lưu dữ liệu trước khi bấm Launch

Mục tiêu demo: public reverse proxy HTTPS; app/DB/Redis trong mạng Docker private; edge qua VPN. Lambda ban đầu không gắn VPC, gọi AWS SDK và HTTPS API. Không cần dựng NAT Gateway chỉ để Lambda đọc S3/SQS.

1. Search **VPC → Your VPCs**, chọn VPC nhóm đã duyệt. Nếu không có, dùng **Create VPC** theo mẫu mạng nhóm review; ghi CIDR không trùng mạng edge/VPN.
2. **Subnets**: chọn một subnet trong Singapore/AZ đã ghi. **Route tables** của subnet phải có default IPv4 route tới Internet Gateway nếu dùng public subnet.
3. Chốt domain/subdomain thật và người sửa DNS. IP public có thể đổi khi stop/start; nếu dùng Elastic IP thì ghi cả chi phí IPv4 và lịch giải phóng.
4. Tạo Security group app với inbound 443; thêm 80 nếu dùng Caddy HTTP redirect/challenge. VPN port theo cấu hình thực; SSH 22 chỉ từ IP quản trị /32 nếu thật sự dùng SSH. Không mở 3001, 5432, 6379, 1883, 5000 hoặc 8000 ra Internet.
5. Chọn dung lượng EBS theo images, DB, logs và dữ liệu test; cần volume cho DB, backup riêng. Không coi volume cùng EC2 là backup.

VPC/subnet chưa có người review thì làm IAM/SAM/ops topic trước. Không triển khai public network bằng cấu hình ngẫu nhiên chỉ để vượt màn hình.

## C2. Chuẩn bị EC2 instance role

Xem [ba bước IAM wizard đã kiểm tra](08_THUC_HANH_CONSOLE.md#c--iam-tạo-ec2-role-bằng-ba-bước-rõ-ràng), từ trusted entity tới review policy.

1. **IAM → Roles → Create role → Select trusted entity → AWS service**. Trong **Service or use case** chọn EC2, rồi radio **EC2** thông thường; Next. IAM hiển thị Global; không mở IAM Identity Center hoặc Roles Anywhere.
2. **Add permissions → Use existing policy**, tìm `AmazonSSMManagedInstanceCore` và chọn checkbox. Next → **Name, review, and create**, đặt role riêng `camerai-s4-dev-ec2`, kiểm tra trust/policy/tags rồi Create role. Quyền ECR, đọc cấu hình và ghi CloudWatch được thêm theo tài nguyên thực, không gắn AdministratorAccess.
3. Quyền app cần: S3 upload/read/presign đúng bucket/prefix, SendMessage jobs, Receive/Delete/GetQueueAttributes results, StartExecution đúng workflow; quyền có thể chia role/cơ chế cấp credentials rõ ràng khi tách service.
4. CloudWatch agent cần quyền ghi metrics/logs tương ứng. Customer-managed KMS key còn cần key permissions; policy IAM không thay thế key policy.

Instance profile đưa role cho EC2; user role của người bấm Launch là danh tính khác. [SSM instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-instance-profile.html).

## C3. Launch một EC2 dev bằng Console

Đối chiếu [hướng dẫn từng khung EC2 đã kiểm tra](08_THUC_HANH_CONSOLE.md#c--ec2-đọc-từng-khung-trước-khi-launch), đặc biệt SSH Anywhere, encryption và Advanced details.

1. Search **EC2 → Instances → Launch instances**.
2. Name `camerai-s4-dev-app`; thêm tags Project/Environment/Owner/Sprint.
3. **Application and OS Images**: chọn Ubuntu Server 24.04 LTS, publisher Canonical, x86_64. Bản LTS này là baseline được chọn, không phải lời khuyên bấm AMI mới nhất mà chưa kiểm thử.
4. **Instance type**: chọn cấu hình có khoảng 4 GiB RAM làm điểm đo ban đầu của app tier, xem giá đúng Region trước khi duyệt; không chạy model training trên máy này. Đo RAM/CPU sau deploy để điều chỉnh.
5. **Key pair**: nếu đã xác nhận đủ điều kiện SSM, có thể chọn proceed without key pair. Nếu chưa, tạo key pair riêng và giữ file private; chỉ dùng SSH giới hạn /32 làm phương án quản trị đã duyệt.
6. **Network settings → Edit**: chọn VPC/subnet C1, public IPv4 cho phương án public dev, security group C1. Không chấp nhận rule SSH Anywhere mặc định.
7. **Configure storage → Advanced**: đặt root EBS encrypted; mặc định quan sát trong 08 ghi Not encrypted. Ví dụ 30 GiB là số khởi đầu cần duyệt, không phải sizing đảm bảo. Ghi Delete on termination và vị trí DB backup. File systems giữ None cho bài Compose.
8. **Advanced details → IAM instance profile**: chọn profile C2, refresh nếu vừa tạo. **Metadata accessible = Enabled**, **Metadata version = V2 only (token required)**; với SDK trong Docker bridge kiểm tra **Metadata response hop limit = 2** và thử credentials từ chính container. Không tắt IMDSv2 để chữa lỗi.
9. Review summary/chi phí → **Launch instance**. Đợi Running và status checks passed; mở instance Details để ghi instance ID, AZ, IP, role và volumes.

[Launch wizard](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-instance-wizard.html), [IMDSv2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html).

## C4. Kết nối và cài Docker

1. Chọn instance → **Connect → Session Manager → Connect**. Nếu không được: kiểm tra role, SSM Agent, instance là managed node và outbound HTTPS/DNS tới SSM endpoints. Gắn role không tự cài agent hoặc tạo network route.
2. Nếu AMI chưa có SSM Agent, cài theo [SSM prerequisites](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html) qua phương án quản trị đã duyệt; không mở SSH toàn Internet.
3. Session Manager mở terminal trên EC2. Các lệnh ở terminal này là Linux, không dùng PowerShell ở đây.
4. Cài Docker Engine và Compose plugin theo [Docker Ubuntu apt repository](https://docs.docker.com/engine/install/ubuntu/), mục **Install using the apt repository**: cài prerequisites → thêm Docker apt key/repository đúng codename → install `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`. Trước khi chạy, kiểm tra OS bằng `cat /etc/os-release`; không dán script cho Amazon Linux lên Ubuntu.
5. Kiểm tra `sudo docker version` và `sudo docker compose version`. Lỗi permission khi bỏ sudo không phải daemon đã hỏng; dùng sudo cho bài này thay vì chmod socket thành public.
6. Tạo thư mục `/opt/camerai` cho compose/release và vị trí persistent data/backup do nhóm quản lý. Credentials không đưa vào user data hoặc Git.

## C5. Chuẩn bị Compose cloud thật

Không dùng nguyên Compose development. C tạo `infra/deploy/` qua PR; B kiểm tra migration/DB, A kiểm tra API URL. [Lab 08](../labs/08_EC2_EDGE.md) có mẫu Caddyfile giữ nguyên path `/api`.

| Service/file        | Yêu cầu trước khi deploy                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Caddy/reverse proxy | Publish 80/443; TLS certificate volume bền vững; `/api/*` tới orchestrator:3001, phần còn lại tới web:3000              |
| Web                 | Image production; build API base URL phù hợp hostname đích; không mount source hoặc chạy next dev                       |
| Orchestrator        | Image production; healthcheck; role credentials từ EC2; không publish 3001; quyền ghi video/temp path phù hợp user node |
| PostgreSQL          | Named volume/bind mount được bảo vệ; không publish 5432; version được pin và backup                                     |
| Redis               | Private network, không publish 6379; persistence theo vai trò được nhóm chọn                                            |
| Migration           | One-shot runner/script có SQL và dependencies; chạy một lần trước traffic; không chạy db:reset                          |
| Edge Compose        | Frigate/MQTT/MediaMTX/AI ở máy camera, không vô tình chạy trong app EC2                                                 |

`infra/deploy/` chưa có trong snapshot được kiểm tra. C phải viết/review các file này trước khi chạy lệnh deploy; không có lệnh deploy production hoạt động sẵn chỉ vì tài liệu nhắc tên. Dùng [CD guide](../CD_INTEGRATION_GUIDE.md) làm mẫu triển khai chi tiết, kiểm tra các phần còn phải bổ sung như migration runner và secrets. Mẫu trong docs chưa được tính là implementation.

Ghi digest/commit của hai image và xác minh Dockerfile production tìm được entrypoint, workspace contracts và runtime dependencies. Nếu chưa có ECR, có thể thử build/pull có kiểm soát trong dev; trước CD phải có registry và image digest ổn định.

Trước deploy điền bảng §2 của 09: **STORAGE_PROVIDER=s3**, **S3_BUCKET** đúng Name của bucket dev, auth config của provider đã chọn, queue URLs/ARNs và tên biến thực trong PR. API AI result dùng X-Internal-Token từ INTERNAL_SERVICE_TOKEN; command deadline/claim phải có contract/auth riêng đã review. Không tự dùng token Cognito làm service token. Trên EC2 bỏ cặp key tĩnh để dùng instance role; S3 adapter baseline chưa truyền session token trong nhánh credentials thủ công.

## C6. HTTPS và smoke test trên hai máy

1. Người quản lý DNS tạo bản ghi app domain tới public IP đã chốt. Không cần chuyển DNS sang Route 53 nếu nhóm đã có DNS khác.
2. Deploy reverse proxy/Compose đã review; đặt domain cho Caddy và truyền đúng environment vào container; kiểm tra certificate issuance logs.
3. Dùng browser máy khác mở `https://<domain>`: certificate hợp lệ và `/api/v1/health` trả đúng app.
4. A thêm callback `https://<domain>/auth/callback` và sign-out URL `https://<domain>` ở Cognito app client. Đặt `WEB_ORIGIN` và frontend API base URL cùng phương án proxy.
5. A/B kiểm tra login, `/auth/me`, quyền camera, media signed URL và SSE. Không sửa CORS thành `*` kèm credentials để vượt lỗi.
6. Gửi HTTPS base URL cho A/B để nối claim/deadline. Service API phải có authentication riêng; không dùng một public endpoint bỏ guard.

Theo R0/R6, health hiện trả `status=ok`/`service=orchestrator` nhưng không probe dependencies. Sau health, thử auth/ownership, một thao tác DB, upload S3 và job/result qua app; health 200 chưa đủ smoke hệ thống.

Với Next.js, biến `NEXT_PUBLIC_*` thường được đóng vào bundle lúc build. Auth provider có thể đổi runtime qua `/auth/config` trong code lab, nhưng điều đó không làm API base URL tự đổi theo environment. Chọn URL gateway ổn định hoặc build riêng với URL đã chốt và ghi rõ release semantics. [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables).

## C7. VPN và dữ liệu edge

1. Chọn phần mềm VPN cùng nhóm, tạo peer riêng, IP/route không trùng subnet. Ghi công cụ/version và ACL thực tế vào inventory; đây không mặc định là AWS Site-to-Site VPN.
2. Chỉ cho phép cặp IP/port cần thiết: orchestrator tới MQTT/Frigate/media/AI theo kiến trúc; edge tới service authorization. VPN không tự có nghĩa mọi peer được xem mọi camera.
3. B replay một event fixture qua đường chính đã chốt. Kiểm tra EC2 nhận event và lấy được crop/clip qua private path.
4. Tắt kết nối edge có chủ đích trong khung giờ lab: hệ thống báo mất heartbeat, không tạo nhận diện giả. Khôi phục rồi kiểm tra reconnect.
5. Remote live WebRTC/WHIP cần HTTPS, ICE và có thể TURN; không suy từ HTTP API pass sang mọi browser Internet xem live được. Ghi riêng gate live media.

## C8. Tạo ops email và alarm đầu tiên

Xem [chi tiết CloudWatch đã kiểm tra tới Configure actions](08_THUC_HANH_CONSOLE.md#c--cloudwatch-chọn-đúng-metric-và-cấu-hình-actions).

1. Tạo SNS Standard topic `camerai-s4-dev-ops-alerts` và email subscription như A4; confirm. Topic này độc lập incident notification để sender hỏng vẫn báo được.
2. Mở **CloudWatch → Alarms → Create alarm → Data source: Metrics → Type: Classic → Select metric**.
3. Trong Browse chọn **SQS → Queue Metrics**; có thể lọc SQS rồi nhấn Enter. Lọc `ApproximateNumberOfMessagesVisible`, kiểm tra đúng tên nguyên vẹn (không phải InQuietGroups) và QueueName của **DLQ** B bàn giao. Chọn checkbox đúng một hàng → **Select metric**.
4. Đổi mặc định Average/5 minutes sang **Maximum/1 minute**, Conditions Static → Greater → ô **than… = 0**. Mở **Additional configuration**: Datapoints to alarm 1 out of 1, Missing data treatment chọn không vi phạm (notBreaching). Giữ Evaluation window Default (Sliding window), warm-up tắt cho bài cơ bản; không áp dụng missing policy này cho heartbeat.
5. **Next → Configure actions → Notification → In alarm → Select an existing SNS topic → Send a notification to…**, chọn ops topic. Next → Add alarm details → Preview and create. 08 mới kiểm tra tới Configure actions; hai trang cuối/tạo alarm chưa được mở thực tế trong khảo sát.
6. B gửi một message trực tiếp vào DLQ lab riêng để test alarm; đợi metric, xem chuyển ALARM và email nhận được. Xóa đúng message test khi được phép; không Purge queue chung.

[CloudWatch static alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ConsoleAlarms.html), [SNS alarm notification](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html).

## C9. Bổ sung quan sát đủ cho sprint

| Tín hiệu                         | Cách có metric/log                                               | Bài test                                                   |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Lambda Errors/Throttles/Duration | Native metrics, log group từng function                          | Controlled failure, không dùng lỗi chứa token              |
| Queue age/backlog + DLQ          | SQS metrics đúng QueueName                                       | Pause consumer rồi gửi job lab                             |
| Workflow failed/timed out        | Step Functions metrics + execution history                       | forceError và API unavailable                              |
| EC2 CPU/status                   | Native EC2 metrics                                               | Kiểm tra metric đúng InstanceId                            |
| RAM/disk/log ứng dụng            | Cài/configure CloudWatch Agent hoặc cơ chế metrics/log được chốt | Chứng minh dữ liệu thật tới CloudWatch                     |
| Edge heartbeat                   | Publisher gửi Heartbeat=1 định kỳ theo camera/edge ID            | Ngắt publisher, alarm coi missing là breaching theo policy |

Native EC2 không tự có RAM/disk, Docker logs không tự xuất hiện trong CloudWatch. [Cài CloudWatch Agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html) và làm [Lab 09](../labs/09_CLOUDWATCH.md) cho custom metrics/heartbeat. Với Ubuntu x86_64 dùng package deb đúng OS theo trang AWS, cấu hình agent thực tế để thu log app/metrics, gắn role ghi logs/metrics và kiểm tra agent running. Mỗi log group đặt retention 7–14 ngày theo policy nhóm; không để default forever không chủ đích.

Dashboard nối eventId → jobId → Lambda requestId → resultId → executionArn → notificationId → providerId. Không log password, Bearer token, signed URL, ảnh hoặc số điện thoại đầy đủ. Alarm trên metric không có datapoint chưa phải bài monitoring đã pass.

## C10. Backup/restore và CD

1. B/C chốt database backup method, thời điểm và nơi lưu riêng private; volume không nằm chung với bản duy nhất của backup. Secrets DB đọc từ nơi bảo vệ, không ghi literal password vào shell history.
2. Tạo backup dev, ghi checksum/timestamp. Restore vào **database test riêng**, so số users/cameras/incidents và thử đăng nhập/đọc dữ liệu; không restore đè DB đang demo để học thao tác.
3. Restart EC2 trong giờ được nhóm thống nhất; kiểm tra volumes, private credentials, containers và workflow/queue reconcile sau phục hồi.
4. Làm [CD guide](../CD_INTEGRATION_GUIDE.md) theo chặng: ECR/release bundle → SSM staging → smoke → người review duyệt → cùng release production → kiểm tra/rollback. Chưa có budget production thì chỉ staging và ghi rõ phạm vi.
5. Kiểm tra GitHub environment protections theo plan tài khoản. Manual trigger không tự tương đương review hai người. Chưa merge thì dùng branch/commit thử được nhóm chấp thuận; không push trực tiếp main.
6. Thử một release lỗi có kiểm soát, rollback app về digest trước; schema migration phải tương thích ngược. Không tự rollback DB để sửa healthcheck.

Đối chiếu **R7 của 09** và 05 trước phát hành: cùng release digest, config provider giữ nhất quán, migration runner có thật, smoke không chỉ health, recovery có receipt/reconcile. Thiếu file deploy/runner là NEEDS_IMPLEMENTATION; ghi PR/owner và tiếp tục phần độc lập, chưa đánh dấu deploy pass.

## C11. Dọn hoặc bàn giao

Trước buổi cuối ghi inventory và owner giữ tài nguyên. Stop EC2 không xóa EBS, snapshot, public IP hay phí giữ số Connect. Với stack lab, disable triggers/stop executions trước khi dọn đúng stack; kiểm tra S3 objects/versions và log groups còn lại. Chỉ xóa resource lab đã đối chiếu owner; không dọn pool chung hoặc queue incident còn pending.

**C hoàn thành:** HTTPS từ máy thứ hai, private DB/Redis/edge, role credentials trong container, alarm đã kích thử, restore đã thử, deploy/rollback có evidence và inventory chi phí có người nhận bàn giao.
