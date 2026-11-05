# Người C — Đưa hệ thống lên máy chủ và chuẩn bị bản demo

Bạn chỉ cần làm theo file này. Mục tiêu là đưa A/B một bản CameraAI mở được bằng HTTPS, có đủ tài nguyên AWS để chức năng chạy thật, có cách khởi động lại và quay về bản trước khi lỗi. Một trang health báo 200 chưa đủ: người dùng phải đăng nhập, xem sự kiện/ảnh, nhận thông báo và xác nhận được.

Tài liệu này chỉ triển khai bản dev dùng chung để hoàn thiện tính năng đồ án, không tạo bộ dịch vụ riêng để học: một EC2 chạy web, API, PostgreSQL và Redis; camera, Frigate, MQTT và model ở máy edge. Chưa cần hệ thống dự phòng nhiều máy. Lambda xử lý face/gửi tin; Step Functions chờ tới hạn. Bạn không phải train model.

**Đi tới phần đang làm (vẫn trong file này):** [Việc nào làm trước, việc nào đợi A/B?](#1-việc-nào-làm-trước-việc-nào-đợi-ab) · [Chuẩn bị quyền, chi phí và sổ tài nguyên](#2-chuẩn-bị-quyền-chi-phí-và-sổ-tài-nguyên) · [Chuẩn bị mạng và quyền máy chủ](#3-chuẩn-bị-mạng-và-quyền-máy-chủ) · [Tạo EC2 và cài môi trường chạy](#4-tạo-ec2-và-cài-môi-trường-chạy) · [Chuẩn bị bộ file triển khai ứng dụng](#5-chuẩn-bị-bộ-file-triển-khai-ứng-dụng) · [Tạo bộ AWS dùng chung, nối code A/B](#6-tạo-bộ-aws-dùng-chung-nối-code-ab) · [Điền biến và đưa bản hoàn chỉnh lên EC2](#7-điền-biến-và-đưa-bản-hoàn-chỉnh-lên-ec2) · [Nối máy camera và model](#8-nối-máy-camera-và-model) · [Báo lỗi cho nhóm và thử phục hồi](#9-báo-lỗi-cho-nhóm-và-thử-phục-hồi) · [Làm quy trình đưa bản mới lên máy chủ](#10-làm-quy-trình-đưa-bản-mới-lên-máy-chủ) · [Tổng duyệt demo cùng A/B](#11-tổng-duyệt-demo-cùng-ab) · [Bàn giao, giữ tài nguyên và dọn](#12-bàn-giao-giữ-tài-nguyên-và-dọn)

## 1. Việc nào làm trước, việc nào đợi A/B?

| Việc của bạn                               | Làm khi nào?                                                     |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Quyền, dự toán chi phí, mạng, máy chủ, DNS | Làm ngay                                                         |
| Bộ file triển khai và trang web HTTPS      | Làm ngay bằng bản ứng dụng local đã kiểm tra                     |
| Bucket/queue/quyền và khung template AWS   | Làm ngay, chưa gắn chương trình chỉ in log vào queue thật        |
| Đóng gói Lambda face/deadline/sender       | Đợi B đưa face/deadline, A đưa sender; viết khung build trước    |
| Đăng nhập Cognito trên HTTPS               | Đợi A đưa code auth và pool/client/domain                        |
| Luồng job/result/deadline/thông báo thật   | Đợi B đưa API/consumer, A đưa sender và kênh nhận                |
| Model/edge và demo trọn đường              | Đợi phần ứng dụng chạy bằng dữ liệu mẫu và model được kiểm chứng |

**Đưa HTTPS cho A/B sớm**, không đợi model hay mọi tính năng AWS xong mới bàn giao. Địa chỉ HTTPS là đầu vào để họ nối Lambda với API.

## 2. Chuẩn bị quyền, chi phí và sổ tài nguyên

1. Nhóm có **một tài khoản AWS do C quản lý và ba IAM User A/B/C trong cùng tài khoản**; dùng Region Singapore `ap-southeast-1`. Không dùng AWS Organizations hay IAM Identity Center/SSO cho bài này. C làm việc hằng ngày bằng IAM User C, chỉ dùng root khi thao tác thật sự cần root. Không tạo/chia sẻ root access key. C là người duy nhất triển khai tài nguyên chung.
2. C tạo và quản lý tài nguyên AWS dùng chung: Cognito, SNS/Connect, S3/SQS/Lambda/workflow, IAM/EC2/SSM/CloudWatch và nơi lưu bản phát hành. A/B viết mã, gửi yêu cầu và kiểm tra tính năng trên bộ này; chỉ cấp quyền đọc/chẩn đoán hoặc quản lý dữ liệu ứng dụng cần cho công việc, không yêu cầu họ tạo thêm bộ riêng. A quản lý các user kiểm thử trong pool C cấp; B viết thao tác collection/face theo owner bằng role backend được cấp. Quyền tạo role, PassRole và quyền của chương trình chạy là ba việc khác nhau; không gắn AdministratorAccess để chữa mọi lỗi.
3. Sau khi cấp quyền, mỗi người tự tạo hoặc dùng lại access key của IAM User mình: **IAM → Users → tên user → Security credentials → Access keys → Create access key → Command Line Interface (CLI)**. Nếu thiếu quyền tự tạo key, C hỗ trợ đúng user; người sử dụng giữ cặp key riêng, không đưa file CSV vào Git/chat. Không tạo key mới nếu đã có key dùng được. Mỗi người cấu hình trên PowerShell máy mình:

   ```powershell
   aws configure --profile camerai-lab
   aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
   ```

   Khi được hỏi, nhập **Access Key ID và Secret Access Key của chính IAM User mình**, Region `ap-southeast-1`, output `json`. Nếu đã có profile này, chỉ cấu hình lại khi cần thay key. Không nhập key vào lệnh để tránh lưu trong lịch sử terminal.

   Ba người kiểm tra kết quả STS: `Account` phải giống nhau, `Arn` phải khác nhau và đúng tên IAM User của từng người. Tên profile `camerai-lab` giống nhau trên ba máy vẫn được; nó chỉ là tên cấu hình local, không phải tài khoản hay key dùng chung. Gửi C Account/Arn để đối chiếu, không gửi key.

   `aws configure` chỉ khai báo danh tính cho CLI, **không cấp quyền**. C cấp quyền cho IAM User trước. Không dùng `aws configure sso` hoặc `aws sso login` trong cách làm hiện tại của nhóm. Nguồn tra cứu: [AWS cấu hình CLI bằng IAM User](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-user.html).

   Bị AccessDenied thì ghi action, ARN, thời điểm để C sửa đúng quyền. User tạo tài nguyên không tự được toàn quyền trên tài nguyên đó. Ba IAM User không tạo ba tài khoản Free Tier riêng; nhóm theo dõi chi phí của tài khoản chung.

4. **Billing and Cost Management → Budgets → Create budget**, chọn ngân sách chi phí theo tháng và email nhóm. Nhập mức nhóm đồng ý, cảnh báo actual/forecast, kiểm tra email. Ngân sách báo chậm và không tự tắt mọi dịch vụ.
5. Ước tính theo giờ demo: EC2, EBS, IPv4, S3, logs, Rekognition, workflow và SMS/cuộc gọi. Không mặc định được miễn phí. Ghi giờ bật/tắt và người trả phí trước khi tạo.
6. Tag nơi hỗ trợ: Project=CameraAI, Environment=dev, Owner=A/B/C, Sprint=4. Dùng bảng này ngay trong sổ nhóm:

   | Tên/loại tài nguyên | Region    | Người quản lý | ARN/URL/ID       | Tạo bằng Console hay template | Giữ tới ngày nào / ai dọn |
   | ------------------- | --------- | ------------- | ---------------- | ----------------------------- | ------------------------- |
   | Điền khi tạo        | Singapore | A/B/C         | Không ghi secret | Điền                          | Điền                      |

**Đưa kết quả cho A/B:** account/Region đã xác minh, cách đăng nhập, quyền được cấp, tên tài nguyên chung và ai tạo. Nếu trước đây nhóm đã tạo pool/topic/bucket, kiểm kê và chọn rõ bộ tiếp tục dùng trước khi triển khai; không tạo thêm một bộ trùng.

**Khi ghép hệ thống:** A/B/C dùng key khác nhau vẫn làm việc với cùng tài nguyên nếu đúng tài khoản, Region và được cấp quyền. Bàn giao tên bucket, queue URL/ARN, API và cấu hình; không bàn giao key cá nhân. Backend trên EC2 dùng role của EC2; Lambda dùng execution role riêng. C cấu hình các role này, nên bản cloud không phụ thuộc key laptop của ai. Việc cấu hình CLI trên laptop cũng không tự truyền quyền vào Docker local; nếu cần chạy SDK trong container local, phải cấu hình riêng mà không đưa key vào image/Git.

## 3. Chuẩn bị mạng và quyền máy chủ

### 3.1. Mạng cho bản dùng chung

1. Vào **VPC → Your VPCs**, chọn VPC nhóm quản lý. Chọn subnet Singapore/AZ; với phương án public dev, subnet có route Internet Gateway và EC2 có public IPv4.
2. Chọn domain/subdomain thật, ai sửa DNS. Có thể dùng nhà cung cấp DNS hiện tại; không cần chuyển sang Route 53 chỉ để demo. IP public có thể đổi khi stop/start; nếu giữ Elastic IP, ghi phí và lịch giải phóng.
3. Tạo security group cho app:

   | Cổng     | Cho phép từ đâu?                                      |
   | -------- | ----------------------------------------------------- |
   | 443      | Người xem ứng dụng qua HTTPS                          |
   | 80       | Khi cần chuyển HTTPS/cấp chứng chỉ theo proxy đã chọn |
   | Cổng VPN | Theo đúng phần mềm/kết nối nhóm cấu hình              |
   | 22       | Chỉ IP quản trị /32 nếu có dùng SSH; ưu tiên SSM      |

   Không mở 3001,5432,6379,1883,5000,8000 ra Internet để chữa lỗi kết nối.

4. Lập vị trí lưu DB bền vững và nơi backup riêng. Một volume cùng máy không thay thế bản backup. Kiểm tra CIDR/VPN không trùng mạng edge.

### 3.2. IAM role cho EC2 và từng chương trình

1. **IAM → Roles → Create role → AWS service**, chọn EC2 thông thường. Thêm `AmazonSSMManagedInstanceCore`, đặt `camerai-s4-dev-ec2`, kiểm tra trust rồi tạo. IAM có thể hiện Global, điều đó bình thường.
2. Bổ sung quyền đúng tài nguyên theo bảng. Deployer là người triển khai, không phải role ứng dụng. Các service role chỉ tin đúng dịch vụ AWS, không mở trust cho tài khoản lạ.

   | Nơi chạy            | Quyền cần                                                                                                                                                                                         |
   | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Backend EC2         | S3 đọc/ghi đúng bucket/prefix; SendMessage face/notification; Receive/Delete/GetQueueAttributes Results; StartExecution đúng workflow; quyền quản lý collection/enrollment theo phần B triển khai |
   | Face Lambda         | Nhận/xóa face queue, đọc ảnh đúng prefix, SearchFacesByImage đúng collection, gửi Results, ghi Logs                                                                                               |
   | Sender Lambda       | Nhận/xóa notification queue, gửi Results, SNS/Connect đúng tài nguyên được phép, ghi Logs                                                                                                         |
   | Deadline Lambda     | Ghi Logs và đọc secret nếu lấy từ secret store; gọi API qua HTTPS, không có quyền DB                                                                                                              |
   | Step Functions      | InvokeFunction đúng Deadline Lambda, quyền logs nếu bật                                                                                                                                           |
   | Giám sát/triển khai | Quyền ghi logs/metrics, đọc cấu hình, ECR/S3 release/SSM theo đúng nhiệm vụ                                                                                                                       |

3. KMS key riêng cần quyền key tương ứng. Các action không hỗ trợ giới hạn ARN phải ghi lý do dùng phạm vi rộng, không sao chép một policy `*` cho mọi việc.
4. Trên EC2 dùng instance role, không chép access key laptop vào image hay user data. S3 adapter hiện có nhánh credentials thủ công chưa truyền session token; bỏ cặp khóa tĩnh để dùng role và kiểm tra từ trong container.

## 4. Tạo EC2 và cài môi trường chạy

### 4.1. Launch máy

1. **EC2 → Instances → Launch instances**, tên `camerai-s4-dev-app`.
2. Chọn Ubuntu Server 24.04 LTS, Canonical, x86_64. Khởi đầu đo với khoảng 4 GiB RAM cho app/DB; duyệt chi phí và đo lại, không coi đây là cấu hình đảm bảo mọi tải.
3. Chọn VPC/subnet/security group ở §3. Nếu đã xác nhận SSM hoạt động, có thể không dùng key pair; nếu dùng SSH thì quản lý private key riêng và chỉ mở IP /32.
4. EBS encrypted; ví dụ 30 GiB là điểm bắt đầu cần duyệt. Ghi Delete on termination, vị trí volumes và backup.
5. **Advanced details → IAM instance profile** chọn role trên. Metadata bật, **V2 only**, thử hop limit 2 cho Docker bridge; không tắt IMDSv2 để chữa lỗi quyền.
6. Review chi phí rồi Launch. Đợi Running và status checks passed, ghi instance ID/AZ/IP/volumes.
7. **Connect → Session Manager → Connect**. Nếu không vào được, kiểm tra instance profile, SSM Agent, outbound HTTPS/DNS. Gắn role không tự cài agent hoặc tạo route mạng.

### 4.2. Cài Docker

Các lệnh dưới đây chạy trong **terminal Ubuntu trên EC2**, không chạy trong PowerShell laptop. Áp dụng trên máy EC2 mới, kiểm tra OS trước:

```bash
cat /etc/os-release
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

Thêm nguồn cài đặt:

```bash
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker version
sudo docker compose version
sudo install -d -m 0750 /opt/camerai
```

Nếu máy đã có Docker khác, kiểm tra xung đột trước, không gỡ mù dữ liệu đang dùng. Nguồn tra cứu: [Docker trên Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Dùng sudo trên máy này, không mở quyền Docker socket cho mọi người.

## 5. Chuẩn bị bộ file triển khai ứng dụng

Phần này **cần viết mã/file cấu hình**, chưa có sẵn trong repo chỉ vì tài liệu nhắc tới. Bạn chịu trách nhiệm tạo `infra/deploy/` và cùng B/A kiểm tra. Không lấy nguyên Compose dev vì nó có thể mở DB và chạy chế độ phát triển.

### 5.1. Những file phải bàn giao

| File chốt cho bộ triển khai | Nội dung phải có                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| compose.yaml                | Proxy, web, orchestrator, postgres, redis và migration runner; chỉ proxy mở cổng public                               |
| Caddyfile                   | Giữ nguyên `/api/*` tới orchestrator:3001, phần còn lại tới web:3000; chứng chỉ lưu bền vững                          |
| .env.example                | Tên biến của bản cloud, không có secret                                                                               |
| deploy.sh                   | Kiểm tra đầu vào, lấy đúng image, backup theo quy trình, chạy migration, khởi động dịch vụ và kiểm tra kết quả        |
| smoke.sh                    | Kiểm tra nhanh bản vừa lên: auth, DB, ảnh, queue/result và gửi thử; không chỉ health                                  |
| backup.sh / restore.sh      | Backup riêng tư; restore chỉ vào DB test riêng, có xác nhận đích                                                      |
| rollback.sh                 | Chạy lại image/config bản trước, không tự reset/restore DB                                                            |
| release.json                | Commit, digest web/backend/worker, version template, mode auth/face/deadline và tham chiếu cấu hình; không lưu secret |

Các script trên là đầu ra bạn phải hoàn thiện rồi mới chạy. PR ghi lệnh thật và kết quả. Không đánh dấu xong bằng file chỉ in thông báo hoặc luôn trả success.

### 5.2. Đóng gói ứng dụng

1. Dùng Dockerfile production của web/orchestrator, kiểm tra app khởi động được, đủ contracts/runtime dependencies. Không mount mã nguồn và không chạy `next dev` trên EC2 demo.
2. Backend và DB/Redis chỉ ở mạng Docker private. PostgreSQL có volume bền vững; pin phiên bản tương thích. Redis giữ dữ liệu theo chức năng đang dùng, không xóa vì face chuyển sang SQS.
3. Tạo migration runner có SQL, dependency và lệnh chạy thật. Runner dùng đúng DATABASE_URL trong mạng cloud; kiểm tra script local có đổi hostname về localhost không trước khi tái sử dụng. Một lần triển khai chỉ một runner; không chạy `db:reset`.
4. Biến `NEXT_PUBLIC_API_BASE_URL` của web cần đúng lúc build. Thay `.env` lúc chạy không tự sửa URL đã đóng trong web bundle. Cloud dùng `https://<domain>/api/v1` hoặc cơ chế URL ổn định được app hỗ trợ và đã thử.
5. `.env` cloud lưu ngoài repo, giới hạn quyền đọc. Compose phải truyền biến cho đúng service. Không in toàn bộ `docker compose config` hoặc env ra log; dùng `config --quiet` khi chỉ cần kiểm tra.
6. Ví dụ Caddyfile cho cấu trúc trên:

   ```caddyfile
   {$APP_DOMAIN} {
       handle /api/* {
           reverse_proxy orchestrator:3001
       }
       handle {
           reverse_proxy web:3000
       }
   }
   ```

   APP_DOMAIN là biến riêng của proxy, bạn phải thêm vào mẫu cloud và truyền đúng domain. Không dùng `handle_path /api/*` làm mất `/api` nếu backend đang cần đường dẫn đó. Kiểm tra SSE/media không bị chặn hoặc mất xác thực.

### 5.3. HTTPS đầu tiên và bàn giao ngay

1. DNS trỏ domain tới IP máy đã chốt. Mở 80/443 theo cách cấp chứng chỉ; lưu dữ liệu chứng chỉ proxy trong volume.
2. Với file bạn đã tạo, ví dụ chạy trên EC2:

   ```bash
   sudo docker compose --env-file /opt/camerai/.env -f /opt/camerai/compose.yaml config --quiet
   ```

3. Chạy script deploy đã hoàn thiện và kiểm tra container/proxy. Trước khi A xong code đăng nhập Cognito, có thể kiểm tra bằng auth local đã chạy ổn; đây chỉ là bước dựng máy, không phải auth cloud đã hoàn thành.
4. Từ PowerShell **máy thứ hai**:

   ```powershell
   $cameraAiOrigin = (Read-Host 'Nhap HTTPS origin cua nhom').TrimEnd('/')
   Invoke-RestMethod "$cameraAiOrigin/api/v1/health"
   ```

   Health mong đợi status=ok và service=orchestrator; API hiện chưa kiểm tra đủ DB/S3/SQS.

**Đưa kết quả HTTPS cho A và B:** origin, `INTERNAL_API_BASE_URL=<origin>/api/v1`, cách lấy secret ref INTERNAL_SERVICE_TOKEN, commit đang chạy và cách báo lỗi. A đưa callback/sign-out cần dùng để bạn cập nhật Cognito; B nối deadline/claim. Không gửi secret trực tiếp trong tài liệu.

## 6. Tạo bộ AWS dùng chung, nối code A/B

### 6.1. Template và tên tài nguyên

Tạo `infra/aws/template.yaml` cùng cấu hình build/workflow. Bạn quản lý toàn bộ hạ tầng dùng chung, gồm pool/topic. Ưu tiên khai báo bằng SAM/CloudFormation để tạo lại được. Phần chưa quản lý bằng template phải có cấu hình, người quản lý và cách dựng lại trong bàn giao; không để hai nơi cùng quản lý một tài nguyên. Nếu đã có tài nguyên nhóm tiếp tục dùng, tham chiếu hoặc đưa vào quản lý có kiểm soát trước khi tạo mới.

| Tài nguyên               | Tên                                                                     |
| ------------------------ | ----------------------------------------------------------------------- |
| Stack dev                | camerai-s4-dev                                                          |
| Bucket ảnh               | camerai-s4-dev-media-<accountId>-<suffix-duy-nhat>                      |
| Face queue / DLQ         | camerai-s4-dev-face-jobs / camerai-s4-dev-face-jobs-dlq                 |
| Notification queue / DLQ | camerai-s4-dev-notification-jobs / camerai-s4-dev-notification-jobs-dlq |
| Results queue / DLQ      | camerai-s4-dev-results / camerai-s4-dev-results-dlq                     |
| Lambda                   | camerai-s4-dev-face, camerai-s4-dev-sender, camerai-s4-dev-deadline     |
| Workflow Standard        | camerai-s4-dev-deadline                                                 |
| SNS email sự kiện        | camerai-s4-dev-incident-email                                           |
| SNS email vận hành       | camerai-s4-dev-ops                                                      |

Bucket private, mã hóa và thời gian giữ ảnh theo B. Các queue Standard có DLQ riêng; queue lỗi giữ đủ lâu hơn queue chính để điều tra. Khởi đầu batch 1, batching window 0; visibility theo timeout thực đã đo, tối thiểu 6 lần timeout Lambda. Nếu code xử lý từng phần thì mapping bật ReportBatchItemFailures. Không gắn Lambda vào Results: backend B có **một** consumer phân loại cả face/outcome.

Collection tách owner theo B, không tạo một collection chung làm nguồn quyền. Lambda ban đầu không gắn VPC, gọi AWS và API qua HTTPS; không cần dựng NAT chỉ cho bài này. Không mở DB public cho Lambda.

**Bàn giao hạ tầng theo hai đợt để A/B không phải chờ toàn bộ:**

- Đợt 1: tạo bucket, queues/DLQ, Cognito, kênh nhận và HTTPS; đưa ngay cấu hình cho A/B. Tách phần tài nguyên chưa cần worker khỏi phần đóng gói Lambda trong cấu trúc template, để thiếu code Lambda không chặn tạo bucket/queue.
- Đợt 2: nhận worker đã build/test từ A/B, triển khai Lambda/workflow, gắn trigger rồi ghép tính năng. Không thay worker chưa có bằng handler giả để báo hoàn tất.

### 6.2. Cấu hình đăng nhập và kênh thông báo cho A

Làm phần này song song với máy chủ; **không đợi code sender xong mới cấp cấu hình**. Nhận yêu cầu callback/người nhận/kênh từ A. Cấu hình dưới đây phục vụ trực tiếp bản dev dùng chung, không phải bài thử dịch vụ.

**Cognito:**

1. Mở **Cognito → User pools → Create user pool** trong Singapore, chọn **Single-page application (SPA)**, app name `camerai-s4-dev-web`. Chọn Email, yêu cầu email, tắt self-registration. Return URL ban đầu `http://localhost:3000/auth/callback`; xác nhận tạo bằng **Create user directory** hoặc nút tạo tương đương. Ghi pool ID, đặt tên hiển thị `camerai-s4-dev-users` nếu cần.
2. **Applications → App clients**, chọn browser client, bảo đảm không có client secret. Trong **Login pages → Managed login pages configuration → Edit**, chọn Authorization code grant, bỏ Implicit, scopes Email/OpenID/Profile; callback local như trên, sign-out `http://localhost:3000`. Save rồi đọc lại giá trị đã lưu.
3. **Branding → Domain**, tạo/lấy domain HTTPS. Ghi origin, không thêm đường dẫn authorize. Kiểm tra gói/branding hỗ trợ trang đăng nhập nhóm chọn; không bật thêm gói tốn phí ngoài dự toán.
4. Khi có HTTPS, thêm `https://<domain>/auth/callback` và sign-out `https://<domain>` theo yêu cầu A. Không đổi client/pool chỉ để sửa callback. Cập nhật template hoặc bản ghi cấu hình quản lý cùng tài nguyên.
5. **Đưa kết quả cho A và B:** pool ID, client ID, domain HTTPS, issuer `https://cognito-idp.ap-southeast-1.amazonaws.com/<pool-id>`, callback/sign-out đã lưu. Cấp A quyền cần để tạo hai user kiểm thử và đọc sub; A tạo user, B liên kết với DB ứng dụng. Không gửi mật khẩu vào Git.

**SNS email sự kiện:**

1. Tạo topic **Standard** `camerai-s4-dev-incident-email`, quyền truy cập riêng. Tạo subscription Email theo người nhận A cung cấp; A mở thư để xác nhận.
2. Topic chỉ chứa người được phép nhận dữ liệu của ca demo. Nếu cần nhiều chủ sở hữu độc lập, cấu hình định tuyến/topic riêng để không lộ thông tin chéo; không cho sender lấy địa chỉ người nhận tùy ý từ queue.
3. **Đưa kết quả cho A/B:** topic ARN, subscription đã confirm hay còn chờ, quyền Publish của sender. A/B điền SNS_TOPIC_ARN, nối claim/delivery và thử email bằng sự kiện ứng dụng. Không dùng gửi tay trên Console làm bằng chứng sender đã xong.

**SMS và Connect khi thuộc yêu cầu đồ án:**

1. Nhận quốc gia/số nhận đã đồng ý và mức chi từ A. Kiểm tra môi trường giới hạn gửi, số nhận đã xác minh, quota và số nguồn. A hỗ trợ OTP/xác nhận người nhận; C xử lý điều kiện tài khoản và quyền AWS.
2. Với Connect, tạo/quản lý instance tại Region đã chốt, bật outbound calling, chuẩn bị số nguồn được phép; tạo flow đọc lời nhắc A cung cấp rồi ngắt, lưu và Publish. Ghi instance ID, flow ID/ARN và source number/queue theo cấu hình thực tế. Không bật outbound campaigns cho luồng gửi cảnh báo này.
3. **Đưa kết quả cho A/B:** CONNECT_INSTANCE_ID, CONNECT_CONTACT_FLOW_ID, nguồn gọi/định tuyến, trạng thái sẵn sàng của từng kênh và quyền sender. Không gửi số đầy đủ/secret vào repo.
4. **Đợi A/B nối sender và nhật ký** để kiểm tra bằng sự kiện app, xác nhận người nhận thực sự nhận SMS/nghe lời nhắc. Nếu tài khoản chưa đủ điều kiện thì ghi rõ phần bị chặn và báo chủ đồ án, không đổi Region hoặc gọi kênh đó đã hoàn thành.

### 6.3. Đợi code, build và triển khai

**Đợi B hoàn thiện worker face/deadline và A hoàn thiện sender để bật các trigger dùng chung.** Trong lúc chờ, hoàn thiện template, quyền, logs, build và API HTTPS; không dùng hàm echo giả thay chức năng thật.

1. Nhận từ A/B: đường dẫn mã, runtime/handler, dependency, lệnh build/test, timeout, queue nguồn/đích và quyền. Pin runtime được hỗ trợ tương thích với gói build; code Python/Node phải khớp runtime đã chọn.
2. Workflow do B cung cấp dùng Standard, input có schemaVersion,commandId,eventId,deadlineVersion,expectedDeadlineAt. Wait dùng TimestampPath theo hạn UTC đã lưu; task gọi Deadline Lambda. Có cách thử lại, báo lỗi và tìm việc chưa xử lý khi phục hồi; không chỉ Wait → log → success.
3. Tại máy dev có AWS CLI/SAM đã cấu hình, sau khi template và worker thật đã có:

   ```powershell
   sam validate --lint --template-file infra/aws/template.yaml
   sam build --template-file infra/aws/template.yaml
   sam deploy --guided --profile camerai-lab --region ap-southeast-1
   ```

   Lần guided dùng stack camerai-s4-dev và bật xem/xác nhận thay đổi trước triển khai. A/B xem những quyền và tài nguyên bị thay thế; không chạy mẫu khi còn đường dẫn giả hoặc file chưa có.

4. CloudFormation → stack → Events: đọc resource FAILED đầu tiên nếu lỗi. Sau thành công, ghi Outputs và nối cấu hình đúng service. Đổi lâu dài bằng template, không sửa Console rồi bỏ quên mã.
5. Outputs phải có: MediaBucketName; FaceJobsQueueUrl/Arn; ApplicationResultsQueueUrl/Arn; NotificationJobsQueueUrl/Arn; DeadlineStateMachineArn; FaceFunctionArn/SenderFunctionArn/DeadlineFunctionArn; IncidentEmailTopicArn/OpsTopicArn; URL/ARN từng DLQ. Pool/client/domain có thể quản lý riêng nhưng phải ghi cùng bản phát hành.

**Đưa kết quả cho B:** bucket name, các queue URL/ARN/DLQ, workflow ARN, quyền EC2 đã thử và đường HTTPS. **Đưa kết quả cho A:** Lambda sender/queue/Results, role đã cấp, URL API, topic tham chiếu và cách xem log. Cùng họ chạy từng luồng ngay sau khi nối, không chờ buổi tổng duyệt.

## 7. Điền biến và đưa bản hoàn chỉnh lên EC2

**Đợi A đưa code auth/sender và B đưa code API/consumer đã gộp.** Pool/client/domain và kênh nhận do bạn đã cấp ở §6.2; A xác minh chúng chạy đúng với ứng dụng. Giữ các cấu hình cũ còn cần; chỉ điền giá trị thật và bật cloud khi code đọc biến đã có.

| Biến                                                          | Bản demo cloud                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| AWS_REGION                                                    | ap-southeast-1                                                   |
| AUTH_PROVIDER                                                 | cognito                                                          |
| COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / COGNITO_DOMAIN     | C lấy từ pool/client/domain đã tạo, A kiểm tra                   |
| WEB_ORIGIN / NEXT_PUBLIC_API_BASE_URL                         | HTTPS origin / origin + /api/v1                                  |
| STORAGE_PROVIDER / S3_BUCKET                                  | s3 / MediaBucketName                                             |
| FACE_PROVIDER / FACE_JOB_TRANSPORT                            | rekognition / sqs                                                |
| FACE_JOBS_QUEUE_URL                                           | FaceJobsQueueUrl                                                 |
| APPLICATION_RESULTS_QUEUE_URL                                 | ApplicationResultsQueueUrl; cả workers và consumer nhận đúng URL |
| APPLICATION_RESULTS_CONSUMER_ENABLED                          | true ở backend B                                                 |
| REKOGNITION_MATCH_THRESHOLD                                   | 0.90 cho lượt kiểm thử ban đầu; thang 0..1                       |
| DEADLINE_DRIVER / DEADLINE_STATE_MACHINE_ARN                  | stepfunctions / ARN tương ứng                                    |
| INTERNAL_API_BASE_URL / INTERNAL_SERVICE_TOKEN                | origin + /api/v1 / secret ref chung                              |
| NOTIFICATION_DRIVER / NOTIFICATION_JOBS_QUEUE_URL             | sqs / NotificationJobsQueueUrl                                   |
| SENDER_DRY_RUN                                                | true khi thử, false sau khi A/B kiểm tra kênh thật               |
| SNS_TOPIC_ARN / CONNECT_INSTANCE_ID / CONNECT_CONTACT_FLOW_ID | C cấp theo §6.2, A/B nối đúng kênh                               |

Không dùng ARN thay URL SQS hoặc client ID thay pool ID. Không dùng AI_INTERNAL_TOKEN thay INTERNAL_SERVICE_TOKEN cho các API nội bộ. Token tối thiểu 32 ký tự, không in vào log. AWS_SESSION_TOKEN để trống khi dùng role; profile access key trên laptop không tự vào container. Không chép key cá nhân của A/B/C lên EC2 hoặc Lambda; chương trình trên cloud dùng role ở §3.2.

API B triển khai gồm POST `/api/v1/internal/events/{eventId}/deadline`, `/api/v1/internal/notifications/{notificationId}/claim` và, nếu cần gọi khác process, `/api/v1/internal/notifications/{notificationId}/outcome`. Các API ấy dùng X-Internal-Token; không bỏ xác thực để Lambda truy cập được. Điểm nhận AI result hiện có cũng dùng token này, không dùng token Cognito của browser.

1. Ghi commit/digest các image, worker và template vào release.json; giữ cấu hình cùng phiên bản đó.
2. Backup DB và chạy migration bằng runner đã kiểm tra, trước khi nhận traffic theo quy trình deploy. Không để startup các container tự tranh nhau chạy migration.
3. Khởi động lại đúng dịch vụ để nạp env; build web đúng API URL. Giữ một backend và một bên xử lý mỗi loại công việc cho tập incident demo.
4. Máy thứ hai chạy: login đúng quyền → đọc DB/camera → upload/xem ảnh → tạo job nhận kết quả → gửi thử có lưu trạng thái. API health không thay thế các bước này.
5. C cập nhật callback `https://<domain>/auth/callback` và sign-out `https://<domain>` theo yêu cầu A; A kiểm tra đăng nhập lại. Thử lại truy cập chéo user, SSE và ảnh. Không chữa CORS bằng `*` kèm credentials.

## 8. Nối máy camera và model

1. Dùng phần mềm VPN được nhóm chốt, tạo peer riêng cho EC2/edge, địa chỉ/route không trùng mạng. Ghi tên công cụ/version, IP và cách bật/tắt ngay trong bàn giao; đây không mặc định là AWS Site-to-Site VPN.
2. Chỉ cho phép các IP/port cần dùng: backend tới MQTT/Frigate/media/AI và edge tới API kiểm tra quyền. Docker service name trên máy edge không tự phân giải từ EC2; dùng IP/DNS reachable qua VPN.
3. **Đợi B cung cấp cách tạo sự kiện và xử lý model đúng hợp đồng.** Thử EC2 nhận sự kiện và lấy được crop/clip theo đường private. A xem ảnh trên HTTPS bằng user đúng quyền.
4. Nhận model từ người giữ artifact trong nhóm: filename, version, checksum, runtime, cách tiền xử lý, báo cáo đánh giá và thiết bị thật. Bạn kiểm tra checksum/startup; B kiểm tra dữ liệu, A kiểm tra ý nghĩa hiển thị. Không cần thêm người thứ tư chỉ để hoàn thành phân công AWS.
5. Bật duy nhất đường Frigate/MQTT đã chốt cho ca video. Đừng phát thêm incident bằng API thử trong cùng ca rồi nhầm hai nguồn thành lỗi trùng.
6. Live video là bài thử riêng: mở từ mạng khác, kiểm tra HTTPS/ICE và TURN nếu cách triển khai cần. Không suy từ API xem ảnh chạy được ra WebRTC cũng chạy được. Nếu TURN cần thiết, cấu hình/kiểm tra rồi mới đánh dấu live hoàn thành.

**Đưa kết quả cho A/B:** địa chỉ edge đi qua VPN, cổng được phép, cách kiểm tra kết nối, video/model đã xác minh và giới hạn còn có. Họ dùng để chạy dữ liệu thật thay mẫu.

## 9. Báo lỗi cho nhóm và thử phục hồi

### 9.1. Email báo lỗi đầu tiên

1. Tạo SNS Standard topic `camerai-s4-dev-ops`, email subscription và confirm. Đây là kênh vận hành, **khác** topic sự kiện của A để sender hỏng vẫn báo được.
2. **CloudWatch → Alarms → Create alarm → Select metric**, chọn SQS/Queue Metrics, `ApproximateNumberOfMessagesVisible` của **DLQ** đúng tên.
3. Chọn Maximum, chu kỳ 1 phút, lớn hơn 0, 1/1 điểm dữ liệu. Với ca DLQ, missing data chọn không vi phạm. Trong **Configure actions**, khi ALARM gửi tới ops topic. Đặt tên, review, tạo.
4. **Đợi B đưa ca lỗi có kiểm soát của một job ứng dụng** trong phiên kiểm thử dev đã hẹn. Theo dõi retry tới đúng DLQ, metric chuyển ALARM và email vận hành thực nhận; ghi jobId và thời điểm để đối chiếu. Với sender, A giữ chế độ không gửi thật trong ca gây lỗi.
5. Sau khi sửa, B/C chạy lại đúng công việc lỗi, kiểm tra receipt/DB và alarm trở lại OK. Không tự xóa hoặc Purge queue chung để hết cảnh báo.

### 9.2. Các tín hiệu còn phải có

| Tín hiệu                       | Cần làm và thử                                                             |
| ------------------------------ | -------------------------------------------------------------------------- |
| Lambda lỗi/quá giờ/bị giới hạn | Native Errors/Throttles/Duration, gây lỗi có kiểm soát                     |
| Queue ùn tắc/lỗi               | Age/backlog/DLQ đúng tên queue; dừng consumer thử rồi khôi phục            |
| Workflow lỗi/hết thời gian     | Metric và lịch sử execution; B gây API lỗi trong môi trường thử            |
| CPU/status EC2                 | Đúng InstanceId                                                            |
| RAM/disk/log app               | Cài CloudWatch Agent hoặc bộ thu đã chốt; EC2 không tự có RAM/disk metrics |
| Mất kết nối edge               | Gửi heartbeat mỗi 30 giây, thử ngưỡng 90 giây và cảnh báo thiếu dữ liệu    |

Cài CloudWatch Agent bằng package Ubuntu tương thích, cấu hình đường log và metrics, role ghi đúng quyền; kiểm tra agent running và dữ liệu thực trên Console. Log group dev giữ 7 ngày hoặc thời gian nhóm thống nhất. Heartbeat cần bộ kiểm tra độc lập với chính app/máy đang đo; app chết thì bộ kiểm tra cùng app cũng chết. Heartbeat còn sống không chứng minh camera còn frame mới, phải kiểm tra tuổi frame riêng.

Thử ngắt VPN/publisher edge trong phiên kiểm thử đã hẹn: cảnh báo mất kết nối, không tạo nhận diện giả; bật lại thì hồi phục. Ghi thời điểm và email đã nhận. Không tạo metric dimension mới cho mỗi eventId; ID chi tiết dùng trong logs để tránh quá nhiều chuỗi đo.

### 9.3. Backup, khôi phục và quay bản trước

1. Hoàn thiện backup.sh: lấy DB consistent bằng công cụ PostgreSQL tương thích, lưu file mã hóa/riêng tư ở nơi độc lập với volume DB, ghi thời gian và checksum. Lấy mật khẩu từ cấu hình bảo vệ, không nhét vào lịch sử lệnh.
2. Hoàn thiện restore.sh: buộc chọn **DB test riêng**, kiểm tra tên/đích trước khi chạy. B đối chiếu users/cameras/events và thử API đọc dữ liệu từ bản phục hồi. Không restore đè DB demo.
3. Cùng A/B thử restart dịch vụ/EC2 trong giờ đã hẹn: volumes còn, containers tự trở lại, credentials role dùng được, B tìm và xử lý được outbox/queue/deadline còn chờ.
4. Giữ digest/config bản trước. Thử rollback app sau một bản lỗi có kiểm soát: bản trước chạy lại và các thao tác chính đạt. Migration phải tương thích với bản trước; không tự rollback DB hoặc `db:reset` khi app lỗi.
5. Ghi cách chạy thật của các script và kết quả trong bàn giao, không chỉ chụp tên file backup.

## 10. Làm quy trình đưa bản mới lên máy chủ

Phần này là công việc triển khai, không phải yêu cầu mua thêm nhiều máy cho bản đồ án. Bản đầu dùng dev để kiểm chứng; staging/production riêng làm khi kế hoạch đồ án và ngân sách yêu cầu. Nếu mới làm dev thì ghi đúng phạm vi, chưa coi các môi trường khác đã xong.

1. Tạo ECR private repositories cho web/backend, tag không bị ghi đè, giữ các image đang chạy và bản rollback. Tạo S3 release bucket private tách bucket ảnh; nơi backup cũng có quyền/lịch giữ riêng.
2. CI của repo chạy kiểm tra/build trước khi gộp. Bạn bổ sung workflow triển khai trong `.github/workflows/`, không chỉ sửa tài liệu. Job AWS dùng danh tính ngắn hạn/quyền đúng repo/môi trường, không commit access key.
3. Workflow build production images từ commit đã kiểm tra, đẩy ECR, ghi digest; đóng gói Compose/proxy/scripts/worker/template version vào release bundle không chứa secret, lưu S3.
4. Cấu hình runtime theo môi trường trong Parameter Store SecureString hoặc secret store nhóm dùng; EC2 lấy bằng role. SSM Run Command chỉ được tới đúng instance/môi trường để lấy bundle và chạy deploy.sh đã kiểm tra.
5. Chạy smoke.sh và các ca nghiệp vụ sau deploy. Nếu có staging/production: người khác duyệt rồi đưa **cùng digest/bundle** sang môi trường kế tiếp, không build lại. Nếu GitHub không có cổng duyệt phù hợp, ghi người duyệt và dùng bước triển khai được kiểm soát; nút chạy thủ công không tự chứng minh hai người đã duyệt.
6. Lỗi thì báo rõ, dùng rollback.sh khi đủ điều kiện; không để script nuốt lỗi rồi báo thành công. Phần AWS Lambda/template thay đổi cũng phải được build/kiểm tra và ghi cùng release, không chỉ web/backend.
7. Thử một lượt đưa bản mới và một lượt quay bản trước. B kiểm DB/migration, A kiểm browser. Đưa cho nhóm lệnh thật để khởi động lại bản demo khi không có bạn.

## 11. Tổng duyệt demo cùng A/B

**Đợi A và B hoàn thiện phần của mình trên cùng bản triển khai.** Chọn một người điều khiển browser, một người xem backend/AWS logs, một người theo dõi kênh nhận. Dùng video/ảnh được phép sử dụng.

| Ca                   | Làm gì?                                                    | Đạt khi                                                                      |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Đăng nhập và quyền   | Hai user mở camera/ảnh của mình rồi thử dữ liệu người khác | Đúng quyền; không lộ ảnh/URL                                                 |
| Video/model thật     | Replay video thuộc phạm vi đã đo                           | Sự kiện, ảnh, kết quả face cùng eventId tới DB/UI                            |
| Xác nhận trước hạn   | Tạo sự kiện và bấm xác nhận                                | Thông báo/nhật ký đúng, không nâng mức sau hạn                               |
| Không xác nhận       | Tạo sự kiện mới, để hết hạn                                | Một quyết định nâng mức, một yêu cầu gửi hợp lệ, kết quả lưu trong app       |
| Email/kênh thật      | Nhận thông báo từ sự kiện app                              | Có providerId và người nhận xác nhận đã nhận; thử SMS/call riêng nếu yêu cầu |
| Chạy lại dữ liệu/lỗi | B chạy lại result/command; A thử cửa sổ lỗi bằng mock      | Không nhân hiệu ứng; kết quả chưa rõ được giữ để đối soát                    |
| Phục hồi             | Mở kết quả restart/restore/rollback đã diễn tập            | Đúng bản code, có bước làm lại và kết quả thực                               |

Health 200 chỉ là kiểm tra đầu tiên. Dùng dữ liệu mẫu thì nói rõ là dữ liệu mẫu; model chưa có báo cáo thì phần model còn chờ. Không gọi handler chỉ log, gửi thử không gửi thật hoặc video quay sẵn là demo hệ thống đang chạy.

Ghi mốc thời gian/eventId/jobId/resultId/executionArn/notificationId/providerId để tìm cả đường đi. Đo thời gian cloud riêng với độ chính xác model. Lưu video dự phòng đúng bản demo; thành viên khác chạy lại được các bước chính mà không nhờ tác giả sửa code giữa chừng.

## 12. Bàn giao, giữ tài nguyên và dọn

```text
Phần của C / ngày / người làm / người kiểm tra:
Account/Region, instance/volume/domain/VPN:
Commit/digest web/backend/workers/template và file triển khai:
Cách lấy cấu hình bằng secret ref, không ghi secret:
Outputs bucket/queues/workflow/functions/topics:
Lệnh build/deploy/smoke/backup/restore-test/rollback thực tế:
Kết quả browser máy thứ hai, auth/storage/job/result/thông báo:
Kết quả alarms/edge/restart/restore/rollback:
Video/model thật hay dữ liệu mẫu; kênh đã gửi thật:
Việc còn chờ A/B, bị chặn quyền hoặc chưa triển khai:
Tài nguyên giữ tới ngày nào / ai trả phí / ai dọn:
```

Bạn xong khi A/B nhận đủ kết quả để chạy tính năng và người khác dùng bộ triển khai để khởi động lại đúng bản demo. Ghi **Đã chạy đạt / Cần sửa / Đang chờ A hoặc B / Bị chặn quyền AWS**, không chỉ ghi đã tạo resource.

Trước khi xóa, đối chiếu inventory, queue/workflow còn chờ và tài nguyên chung. Dừng triggers/các lần chạy thử trước, chỉ dọn tài nguyên đã xác nhận hết dùng và đúng người quản lý. Stop EC2 vẫn có thể tốn phí volume/IP/snapshot; số Connect và logs cũng cần kiểm kê. Xóa collection không tự xóa ảnh S3 và ngược lại. Nếu giữ phục vụ bảo vệ, ghi người nhận bàn giao và ngày kiểm tra lại chi phí.
