# Người C — Hạ tầng Nền tảng, Mạng, CI/CD, Giám sát & Cutover Production

> **Cập nhật phân quyền Sprint 4:** Người A và B đã được tin tưởng tự tạo và vận hành các dịch vụ thuộc phạm vi nghiệp vụ của họ trên cả 3 môi trường **Dev → Staging → Production** (A tự làm Cognito App Client/Users, SNS/Connect, Sender Lambda; B tự làm S3 Media/Lifecycle, SQS/DLQs, Face/Deadline Lambda, Rekognition, Step Functions).
> **Vai trò của Người C:** Tập trung hoàn thiện **toàn bộ hạ tầng nền tảng và các dịch vụ nằm ngoài phạm vi A/B** xuyên suốt Dev → Staging (`https://argusai-staging.duckdns.org`) → Production (`https://argusai.dynv6.net`), đồng thời phối hợp **Repo Owner (Dương Đại Phát)** thiết lập GitHub Environments/Approval Gate.
> **Nguồn kiểm kê thực tế (local gitignored):** `docs/CI_CD_STAGING_SOURCE_OF_TRUTH.md` và `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md`.

**Đi tới phần đang làm:** [1. Phân ranh giới & việc C làm ngay](#1-phân-ranh-giới-và-việc-c-làm-ngay) · [2. Tài khoản, OIDC & IAM nền tảng](#2-tài-khoản-oidc--iam-nền-tảng) · [3. ECR & S3 Release/Backup dùng chung](#3-ecr--s3-releasebackup-dùng-chung) · [4. Host EC2, Mạng, Elastic IP & SSM Config](#4-host-ec2-mạng-elastic-ip--ssm-config) · [5. Cutover Host Production i-09513ba32b1ee31d0 sang Chuẩn CD](#5-cutover-host-production-i-09513ba32b1ee31d0-sang-chuẩn-cd) · [6. Hoàn thiện Workflow CD & GitHub Gate cho Production](#6-hoàn-thiện-workflow-cd--github-gate-cho-production) · [7. Edge Server & Mạng riêng](#7-edge-server--mạng-riêng) · [8. Giám sát CloudWatch Ops, Alarms, Agent & Canary](#8-giám-sát-cloudwatch-ops-alarms-agent--canary) · [9. Backup, Restore Test, Rollback & Tổng duyệt](#9-backup-restore-test-rollback--tổng-duyệt)

---

## 1. Phân ranh giới và việc C làm ngay

| Nhóm dịch vụ AWS                                                                                                                                                      | Ai tự tạo & chịu trách nhiệm? | Phạm vi công việc của C                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cognito Users/App Clients, SNS Incident, Amazon Connect, Sender Lambda                                                                                                | **Người A**                   | Chỉ hỗ trợ cấp IAM quyền tạo/PassRole cho IAM User A và review thay đổi SSM/CD chung.                                       |
| S3 Media/Lifecycle, SQS/DLQs, Face/Deadline Lambda, Rekognition, Step Functions                                                                                       | **Người B**                   | Chỉ hỗ trợ cấp IAM quyền tạo/PassRole cho IAM User B, gắn quyền runtime cần thiết vào Role EC2 & review SSM/CD chung.       |
| **Account/IAM Users/OIDC, ECR, S3 Release/Backup, EC2/EIP/SG/DNS, SSM Host/Config, Edge EC2/VPN, CD Workflows, CloudWatch Ops/Agent/Canary, Backup/Restore/Rollback** | **Người C (tài liệu này)**    | **C trực tiếp triển khai, hardening và vận hành cho cả Staging & Production; gửi Repo Owner (Dương Đại Phát) phần GitHub.** |

---

## 2. Tài khoản, OIDC & IAM nền tảng

1. **Quản lý IAM Users A/B/C & Ngân sách (`ap-southeast-1`, Account `926883321040`):**
   - Đảm bảo IAM User A và B có đủ quyền trong phạm vi tài nguyên của họ (gồm `iam:PassRole` cho đúng execution role Lambda/Step Functions Dev, Staging, Production) để tự làm E2E mà không phải chờ C ở từng bước nhỏ. Không cấp `AdministratorAccess` bừa bãi cho runtime roles.
   - Thiết lập **AWS Budgets** theo tháng + cảnh báo actual/forecast chi phí EC2, EBS, EIP, ECR, S3, CloudWatch, Rekognition, Connect/SMS.
2. **Quản lý OIDC & 3 GitHub CI/CD Roles:**
   - Provider: `arn:aws:iam::926883321040:oidc-provider/token.actions.githubusercontent.com` (`aud=sts.amazonaws.com`).
   - `ArgusAI-GitHub-Build`: trust `ref:refs/heads/main`, quyền ECR push/pull (`camerai/web`, `camerai/orchestrator`) & `s3:PutObject` (`argusai-releases-926883321040/releases/*`).
   - `ArgusAI-GitHub-Staging`: trust `environment:staging`, quyền SSM `SendCommand` tới `i-0bd8c9cf689512b6e` + `GetCommandInvocation`, đọc `releases/*`, update Lambda Staging (phối hợp thêm `argusai-staging-deadline*` và `argusai-staging-sender*` khi A/B nối CD).
   - **`ArgusAI-GitHub-Production` (Cần bổ sung ngay):** Hiện mới có `ssm:SendCommand` tới `i-09513ba32b1ee31d0` và `ssm:GetCommandInvocation`. Bổ sung `s3:GetObject` trên `argusai-releases-926883321040/releases/*` và quyền update/alias Lambda Production (`argusai-production-face*`, sau này thêm `deadline*`, `sender*`) theo `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md` Mục 4.2.
3. **Chuẩn hóa Role EC2 Production (`ArgusAI-EC2-Production`):**
   - Hiện máy `i-09513ba32b1ee31d0` đang gắn role cũ `camerai-s4-dev-ec2` thiếu quyền pull ECR, đọc S3 release, ghi S3 backup, đọc SSM `/camerai/production/runtime-env` và có bug `sqs:DeleteQueue` trong inline policy `camerai-s4-least-privilege`.
   - C tạo Role mới **`ArgusAI-EC2-Production`** (`AmazonSSMManagedInstanceCore`, `CloudWatchAgentServerPolicy`, và inline policy `ArgusAI-EC2-Production-RuntimePolicy` khớp `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md` Mục 4.2) để thay thế lúc cutover.

---

## 3. ECR & S3 Release/Backup dùng chung

1. **ECR Lifecycle Policy (`camerai/web` và `camerai/orchestrator`):**
   - Hiện cả hai repository đã bật `IMMUTABLE` và `scanOnPush: true`, nhưng **chưa có Lifecycle Policy**.
   - C tạo rule tự động xóa untagged images cũ > 7 ngày và giữ tối đa **20 tagged release images** gần nhất (kiểm tra Preview trước khi Apply để không xóa bản đang chạy hoặc bản rollback của Staging/Production).
2. **S3 Release & Backup Buckets:**
   - `argusai-releases-926883321040` (Block Public Access 4 cờ `true`, `AES256`): cân nhắc bật Versioning hoặc Bucket Policy chặn ghi đè `releases/*`.
   - `argusai-backups-926883321040`: giữ tách biệt prefix `staging/` và `production/`, thiết lập lifecycle retention phù hợp (ví dụ giữ 30 ngày cho dump cũ).

---

## 4. Host EC2, Mạng, Elastic IP & SSM Config

### 4.1. Staging (`i-0bd8c9cf689512b6e` — `https://argusai-staging.duckdns.org`)

- Đã có EIP `175.41.136.219`, SG `argusai-staging-sg` (`sg-0c2a61c0d8f54bb5d`, mở TCP 80/443), IMDSv2 hop limit `2`, SSM `Online`, `ArgusAI-EC2-Staging`, `/camerai/staging/runtime-env` (Version 7).
- **Việc C cần theo dõi:** Khi A/B thêm các biến `DEADLINE_*`, `NOTIFICATION_DRIVER`, `SNS_TOPIC_ARN`, `SENDER_DRY_RUN`, `CONNECT_*`, `REKOGNITION_COLLECTION_PREFIX` vào `/camerai/staging/runtime-env`, kiểm tra giới hạn **4 KB** của Standard Parameter Store (nâng lên **Advanced tier** tối đa 8 KB nếu vượt).

### 4.2. Production (`i-09513ba32b1ee31d0` — `https://argusai.dynv6.net`)

1. **Gắn Elastic IP cho `i-09513ba32b1ee31d0`:** Hiện máy đang dùng Public IP động `47.128.236.23` (chưa có Elastic IP). C cấp 1 EIP trong `ap-southeast-1`, gắn vào `i-09513ba32b1ee31d0`, và cập nhật bản ghi `A` của `argusai.dynv6.net` nếu IP thay đổi.
2. **Tag & Security Group `sg-0b8afd252a0fde3b5`:** Gắn tag `Environment=production`, `Name=argusai-production`. Thu gọn Inbound của `sg-0b8afd252a0fde3b5` chỉ giữ `TCP 80` và `TCP 443` (`0.0.0.0/0`, `::/0`), gỡ `UDP 443` và `ICMP -1` nếu không sử dụng. Không mở `22`, `3001`, `5432`, `6379`.
3. **Tạo SSM Parameter `/camerai/production/runtime-env` (`SecureString`):**
   - Dùng mẫu chuẩn tại `docs/CI_CD_PRODUCTION_SOURCE_OF_TRUTH.md` Mục 4.3 (`APP_DOMAIN=argusai.dynv6.net`, `WEB_ORIGIN=https://argusai.dynv6.net`, `COGNITO_CLIENT_ID=5p3hgqnkmjrdc5ktb99ur46hjr`, `S3_BUCKET=argusai-production-media-926883321040`, 3 queue `argusai-production-*`, endpoint Edge Production riêng, token/password riêng).
   - **Pin image tags:** Trước Production lâu dài, pin `POSTGRES_IMAGE`, `REDIS_IMAGE`, `CADDY_IMAGE` theo `repo@sha256:digest` thay vì floating tag.
   - Không đặt `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` trong Parameter Store (EC2 lấy qua IMDSv2 từ `ArgusAI-EC2-Production`).

---

## 5. Cutover Host Production (`i-09513ba32b1ee31d0`) sang Chuẩn CD

Hiện `https://argusai.dynv6.net` đang chạy bản cài tay `version: "0.0.1"`. C vào **SSM → Session Manager** trên `i-09513ba32b1ee31d0` thực hiện:

1. **Kiểm kê & Backup DB hiện hữu:**
   - Kiểm `sudo docker ps`, `sudo docker compose ls`, `sudo docker volume ls`, `psql` xem `\dt` và `schema_migrations`.
   - Tạo thư mục CD chuẩn (`sudo install -d -m 700 /etc/camerai /opt/camerai/releases /opt/camerai/backups` và `/opt/camerai/videos` owner `1000:1000`).
   - Dump DB hiện tại bằng `pg_dump -Fc` và upload lên `s3://argusai-backups-926883321040/production/pre-cd-baseline.dump` (thử `pg_restore` vào DB test để xác minh bản backup đọc được).
2. **Cài cấu hình & script host:**
   - Tạo `/etc/camerai/deploy.conf` (`APP_ENV=production`, `AWS_REGION=ap-southeast-1`, `RELEASE_BUCKET=argusai-releases-926883321040`, `BACKUP_BUCKET=argusai-backups-926883321040`, `ECR_REGISTRY=926883321040.dkr.ecr.ap-southeast-1.amazonaws.com`, mode `600`).
   - Cài [deploy-host.sh](../../tools/cd/deploy-host.sh) tại `/opt/camerai/deploy-host.sh` (owner `root`, mode `700`, chạy `sudo bash -n /opt/camerai/deploy-host.sh`).
3. **Cửa sổ chuyển đổi (Cutover):**
   - Đổi Instance Profile trên `i-09513ba32b1ee31d0` từ `camerai-s4-dev-ec2` sang `ArgusAI-EC2-Production`.
   - Chạy `sudo docker compose down` (KHÔNG `-v`) ở stack cũ để giải phóng port `80/443`.
   - **Nếu giữ dữ liệu DB cũ:** khởi tạo volume `camerai-production_pgdata` (khớp `POSTGRES_PASSWORD` trong `/camerai/production/runtime-env`), restore `pre-cd-baseline.dump`, đối chiếu từng file SQL đã chạy với `db/migrations/*.sql` và **lập baseline bảng `cd_schema_migrations`** (tên file + SHA-256 LF) để [migrate.mjs](../../tools/cd/migrate.mjs) không dừng vì lỗi `Existing DB needs reviewed baseline`. Đồng bộ `cloud_transport_mode` khớp `FACE_JOB_TRANSPORT` và tạo `/opt/camerai/bootstrapped`.
   - **Nếu dựng DB Production sạch:** bỏ qua restore, để `deploy-host.sh` tự bootstrap DB mới và provision user Cognito theo quy trình quản trị.

---

## 6. Hoàn thiện Workflow CD & GitHub Gate cho Production

1. **Mở PR cập nhật `.github/workflows/cd.yml` & `deploy-environment.yml`:**
   - Thêm job `production` (`needs: [package, staging]`, `environment: production`) vào [cd.yml](../../.github/workflows/cd.yml) để promote đúng `release_id` & `source_sha` từ Staging sang Production mà không build lại.
   - Khi A/B hoàn thiện `services/aws-workers/deadline/` và `sender/`, phối hợp cập nhật `build.py`, `cd.yml` và `deploy-environment.yml` để đóng gói/deploy thêm `deadline.zip` và `sender.zip` theo alias `live`.
   - Khuyến nghị pin toàn bộ GitHub Actions trong `cd.yml` và `deploy-environment.yml` theo full 40-char commit SHA.
2. **Phối hợp Repo Owner (Dương Đại Phát) cấu hình GitHub Environment `production`:**
   - Bật **Required reviewers** + **Prevent self-review** + giới hạn nhánh **`main`** (nếu gói GitHub không hỗ trợ Required reviewers trên private repo, không bật auto-job `production`, giữ deploy có kiểm soát thủ công).
   - Điền Environment Variables (`AWS_DEPLOY_ROLE_ARN=arn:aws:iam::926883321040:role/ArgusAI-GitHub-Production`, `EC2_INSTANCE_ID=i-09513ba32b1ee31d0`, `APP_URL=https://argusai.dynv6.net`, kèm `FACE/DEADLINE/SENDER_FUNCTION_NAME` khi sẵn sàng) và Environment Secrets riêng của Production (`SMOKE_INTERNAL_TOKEN`, và secrets test từ A).

---

## 7. Edge Server & Mạng riêng

1. **Staging (`argusai-staging-edge` — `i-0223a06929b9a82b3`):**
   - Hiện instance đang `stopped`. Start máy khi nhóm vào lượt kiểm thử camera/video, xác nhận Docker Edge (`frigate`, `mediamtx`, `mosquitto`, `ai-service`) chạy, thông tuyến từ `i-0bd8c9cf689512b6e` tới `172.31.2.246` (cổng `8000, 5000, 1883, 8554`) và kiểm tra domain `argusai-staging-media.duckdns.org` + UDP `8189`.
2. **Production Edge:**
   - Tách riêng Edge/VPN peer phục vụ `i-09513ba32b1ee31d0` (`argusai.dynv6.net`), tuyệt đối không trỏ nhầm Edge Dev/Staging vào Production để tránh trộn dữ liệu test. Kiểm tra `MEDIAMTX_AUTH_HTTP_ADDRESS` trên Edge Production trỏ đúng về `https://argusai.dynv6.net/api/v1/mediamtx/authorize`.

---

## 8. Giám sát CloudWatch Ops, Alarms, Agent & Canary (US-28)

Tạo đồng bộ cho **cả Staging (`argusai-staging-*`) và Production (`argusai-production-*`)**:

1. **SNS Ops Topic tách biệt hoàn toàn với Incident Topic của A:**
   - Staging: `argusai-staging-ops` · Production: `argusai-production-ops`. Subscribe email đội vận hành và confirm.
2. **CloudWatch Alarms gửi về Ops Topic tương ứng:**
   - **SQS DLQ Alarms (`ApproximateNumberOfMessagesVisible > 0`, 60s, Maximum, `1/1`, `notBreaching`):**
     - Staging: `argusai-face-jobs-dlq`, `argusai-staging-notification-jobs-dlq`, `argusai-staging-results-dlq`.
     - Production: `argusai-production-face-jobs-dlq`, `argusai-production-notification-jobs-dlq`, `argusai-production-results-dlq`.
   - **SQS Age:** `ApproximateAgeOfOldestMessage > 30s` cho `*-face-jobs`.
   - **Lambda & Step Functions:** `Errors > 0`, `Throttles > 0` cho Face / Deadline / Sender; `ExecutionsFailed > 0`, `ExecutionsTimedOut > 0` cho State Machine `*-deadline`.
   - **EC2:** `StatusCheckFailed > 0` và `CPUUtilization` cho `i-0bd8c9cf689512b6e` (Staging) và `i-09513ba32b1ee31d0` (Production).
3. **CloudWatch Agent & Log Retention:**
   - Đặt log retention **7 ngày** (Staging) và **14–30 ngày** (Production) cho toàn bộ `/aws/lambda/argusai-*`, `/aws/vendedlogs/states/*` và `/argusai/<env>/app`.
   - Gắn `CloudWatchAgentServerPolicy` vào `ArgusAI-EC2-Staging` và `ArgusAI-EC2-Production`, cài `AmazonCloudWatchAgent` qua SSM (`AWS-ConfigureAWSPackage`) để thu thập RAM (`mem_used_percent`), Disk (`used_percent`) và container logs (`awslogs` driver hoặc log file).
4. **External HTTPS Probe (CloudWatch Synthetics Canary):**
   - Tạo API canary chạy mỗi phút kiểm tra HTTP `200` trên `https://argusai-staging.duckdns.org/api/v1/health` và `https://argusai.dynv6.net/api/v1/health`; báo alarm sau 2 lần fail liên tiếp về Ops Topic. _(Thêm probe/heartbeat riêng cho Edge khi Edge đang hoạt động)._

---

## 9. Backup, Restore Test, Rollback & Tổng duyệt

1. **Diễn tập Restore Backup:** Tải file `.dump` từ `s3://argusai-backups-926883321040/staging/` hoặc `production/` và chạy `pg_restore` sang **một DB test riêng** để kiểm chứng dữ liệu phục hồi được trước ngày bảo vệ.
2. **Diễn tập Rollback ứng dụng & Lambda:**
   - Thử chạy `sudo /opt/camerai/deploy-host.sh <PREVIOUS_RELEASE_ID> rollback` trên Staging (và sẵn sàng cho Production), kết hợp `aws lambda update-alias --name live --function-version <PREVIOUS_VERSION>` khi bản trước có thay đổi worker. Kiểm tra lại `/api/v1/health` khớp `<PREVIOUS_RELEASE_ID>`.
3. **Điều phối Tổng duyệt E2E Staging → Approve Production:**
   - Cùng A & B chạy trọn ma trận nghiệm thu trên Staging, lưu `RELEASE_ID` + link CD + bằng chứng, gửi **Dương Đại Phát** duyệt Production, và xác minh sau deploy trên `https://argusai.dynv6.net/login`.

### Mẫu bàn giao hạ tầng của C

```text
Phần của C / ngày / người kiểm tra:
Account/Region, EIP & Instance IDs (Staging/Production/Edge):
ECR Lifecycle & S3 Release/Backup status:
Cutover Production i-09513ba32b1ee31d0 & baseline cd_schema_migrations:
PR cập nhật cd.yml / deploy-environment.yml & GitHub Environments (Dương Đại Phát):
CloudWatch Ops Topics, DLQ Alarms, Agent & Synthetics Canary:
Kết quả diễn tập Restore DB & Rollback release:
Việc còn mở / chi phí & lịch dọn tài nguyên sau demo:
```
