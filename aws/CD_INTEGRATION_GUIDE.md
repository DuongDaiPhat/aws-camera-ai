# CameraAI — Hướng dẫn tích hợp CD từ Dev đến Production

**Nếu nhóm ba người đang bắt đầu toàn Sprint 4:** đi từ [bộ hướng dẫn AWS cho người mới](sprint4/README.md). Tài liệu CD này là phần triển khai/phát hành do C phụ trách sau khi các bước ứng dụng và hạ tầng tiên quyết đã đạt.

**Cập nhật:** 03/11/2026. **Đối tượng:** thành viên chưa có kinh nghiệm CD.

Tài liệu hướng dẫn bổ sung **GitHub Actions → ECR → EC2 qua Systems Manager → Staging → duyệt → Production**. Các đoạn mã dưới đây là mẫu tích hợp để bạn tạo thành file trong repository. Việc có tài liệu này không có nghĩa pipeline đã được cài đặt hoặc chạy thành công trên AWS.

## 1. Đọc trước: chúng ta đang triển khai phần nào?

Kiến trúc hiện tại trong [kế hoạch Sprint 4](SPRINT_4_AWS_EXECUTION_PLAN.md) là Hybrid EC2 + Lambda. Vì vậy, bắt đầu CD với phần **web + orchestrator trên EC2**; PostgreSQL và Redis là dịch vụ lưu trạng thái trên máy đó. Frigate, MediaMTX, MQTT và AI ở edge được giữ theo thiết kế mạng/VPN của [Lab 08](labs/08_EC2_EDGE.md).

Không bê nguyên `docker-compose.yml` Dev lên cloud: nó mở cổng database/Redis, mount source, chạy chế độ development và có các tên container cố định.

| Thành phần                        | Vai trò                                      | Có trong pipeline mẫu?                                                   |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Dev local                         | Viết code trên nhánh tính năng               | Có, điểm bắt đầu                                                         |
| CI hiện có                        | Lint, test, contracts, migration, build      | Có, điều kiện bắt buộc                                                   |
| ECR                               | Lưu image production của web và orchestrator | Có                                                                       |
| S3 release bucket                 | Lưu gói cấu hình deploy và các image digest  | Có; khác bucket media                                                    |
| EC2 Staging / Production          | Mỗi môi trường một máy riêng                 | Có                                                                       |
| Parameter Store SecureString      | Cấu hình runtime và secrets từng môi trường  | Có                                                                       |
| SSM Run Command                   | Gửi lệnh deploy tới đúng EC2                 | Có                                                                       |
| Edge và AI                        | Stream, detection, inference                 | Kết nối để kiểm thử; chưa tự deploy edge                                 |
| Lambda/SQS/Step Functions/Cognito | Các thành phần AWS của kiến trúc đích        | Bootstrap riêng; mục 15 hướng dẫn đưa vào CD khi implementation sẵn sàng |

**Phạm vi bản đầu:** chấp nhận gián đoạn ngắn khi thay container, một orchestrator mỗi môi trường. Đây chưa phải hệ thống HA hoặc zero-downtime. Chỉ gọi toàn hệ thống đã release khi phần edge/provider/Lambda tương ứng cũng được kiểm chứng.

## 2. CD hoạt động thế nào?

```mermaid
flowchart TD
    DEV[Dev: sửa code] --> PR[PR: CI xanh và người khác review]
    PR --> MAIN[Merge main]
    MAIN --> CI[CI kiểm tra commit đã merge]
    CI --> BUILD[CD build production images]
    BUILD --> STORE[ECR: images / S3: release bundle]
    STORE --> STAGE[SSM deploy Staging]
    STAGE --> AUTO[Smoke test tự động]
    AUTO --> REVIEW[Kiểm thử nghiệp vụ rồi duyệt release]
    REVIEW --> PROD[SSM deploy cùng release lên Production]
    PROD --> CHECK[Kiểm tra sau deploy]
    CHECK --> OK[Ghi release thành công]
    CHECK --> FAIL[Lỗi: báo thất bại và rollback ứng dụng nếu có bản trước]
```

- **CI** trả lời: code có vượt qua các kiểm tra không?
- **CD** trả lời: bản đã kiểm tra được đóng gói và đưa lên máy chủ như thế nào?
- **Image** là ứng dụng đã đóng gói. **ECR không chạy ứng dụng**; EC2 chạy image đó.
- **Digest** có dạng `sha256:...`, xác định nội dung image. Deploy bằng digest để không vô tình lấy bản khác.
- **Release** gồm commit, digest web/backend, Compose và cấu hình reverse proxy. Secrets không nằm trong release bundle.
- **Promote** là đưa đúng release đã kiểm tra sang Production, không build lại.
- **Rollback ứng dụng** là chạy lại release cũ; không tự quay ngược database hoặc thu hồi cảnh báo đã gửi.

Ví dụ: Staging đang thử B, Production vẫn chạy A. Sau khi nhóm duyệt B, Production mới chuyển sang B. Cả A và B đều có thể xuất phát từ nhánh `main`; ba môi trường không cần ba nhánh Git.

## 3. Những gì đã có và những gì cần làm thêm

| File hiện có                      | Tình trạng quan sát ngày viết                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`        | Có CI; Docker job hiện build AI, orchestrator production và web production; chưa push/deploy             |
| `apps/web/Dockerfile`             | Có target production và build argument `NEXT_PUBLIC_API_BASE_URL`                                        |
| `apps/orchestrator/Dockerfile`    | Có target production và copy contracts; cần thêm migration runner/SQL                                    |
| `apps/web/src/lib/auth-config.ts` | Đọc auth config từ backend lúc chạy                                                                      |
| `tools/scripts/migrate.mjs`       | Có history nhưng tự đổi hostname postgres thành localhost và chưa ghi migration/history cùng transaction |
| `services/ai-service/Dockerfile`  | Còn `--reload`, chưa đóng gói model; xử lý riêng khi bổ sung CD edge                                     |

Các file đang có thay đổi chưa commit cần được nhóm review/merge theo quy trình. Workflow chạy trên GitHub chỉ nhìn thấy commit đã push, không nhìn thấy file đang sửa trên máy bạn.

Làm theo từng chặng, hoàn thành kết quả ở cuối mỗi chặng rồi mới nối tiếp.

## 4. Chặng 1 — Chốt thông tin triển khai

Điền bảng này trước. Các giá trị có `YOUR_` trong ví dụ là chỗ phải thay bằng giá trị thật, không phải tên tài nguyên đã tồn tại.

| Thông tin         | Ví dụ / nơi lấy                                              |
| ----------------- | ------------------------------------------------------------ |
| AWS account ID    | 12 chữ số, AWS Console                                       |
| Region            | `ap-southeast-1`, dùng nhất quán                             |
| GitHub owner/repo | Repository đang chứa CameraAI                                |
| Staging domain    | Tên miền HTTPS riêng của nhóm                                |
| Production domain | Tên miền HTTPS riêng của nhóm                                |
| Staging EC2 ID    | EC2 Console                                                  |
| Production EC2 ID | EC2 Console                                                  |
| Release bucket    | S3 private, tên duy nhất toàn AWS                            |
| Backup bucket     | S3 private khác release bucket, quyền theo prefix môi trường |
| Media buckets     | S3 private riêng cho Staging và Production                   |
| Edge endpoints    | IP/hostname VPN của MQTT, Frigate, AI, MediaMTX              |

Không cần tạo Dev EC2 nếu thầy không yêu cầu Dev dùng chung trên cloud. Không chốt loại EC2 chỉ dựa vào tên dự án: đo RAM/CPU, số camera và tải backend trước. Không mặc định Free Tier đủ chi phí hai máy, EBS, IPv4, S3, logs và traffic.

**GitHub:** mẫu phía dưới dùng Environments `staging` và `production`. Repo public có thể dùng environment protection trên các gói hiện hành; repo private có giới hạn theo gói, đặc biệt required reviewers. Nếu không có required reviewers, đừng bỏ gate rồi coi như đã duyệt: dùng gói phù hợp hoặc thay cổng duyệt bằng CodePipeline manual approval. `workflow_dispatch` chỉ là kích hoạt thủ công, không tự tạo cơ chế hai người duyệt. [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## 5. Chặng 2 — Tạo kho images, release và IAM

### 5.1. ECR và S3

Trong ECR Console, tạo private repositories `camerai/web` và `camerai/orchestrator` tại region đã chọn. Đặt tag immutability là **Immutable**, bật image scanning và chính sách lưu đủ các image đang chạy/cần rollback. Không xóa image cũ ngay khi push bản mới. [ECR immutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html).

Trong S3 Console:

1. Tạo release bucket, Block Public Access, bật encryption và versioning.
2. Tạo backup bucket, Block Public Access, encryption, versioning và retention theo nhu cầu.
3. Tạo media bucket từng môi trường hoặc dùng tài nguyên đã chuẩn bị theo lab.
4. Không dùng release bucket để lưu `.env`, video hoặc database dump.

Mẫu dùng encryption SSE-S3 để giảm cấu hình ban đầu. Nếu dùng customer-managed KMS key, phải thêm key policy và quyền KMS đúng cho các role đọc/ghi, không chỉ bật tùy chọn encryption.

### 5.2. Các role phải tạo

| Role                         | Ai sử dụng?                     | Quyền cần có                                                                                               |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `CameraAI-GitHub-Build`      | Job build của GitHub            | Push/pull hai ECR repo, ghi release objects vào `releases/*` của release bucket                            |
| `CameraAI-GitHub-Staging`    | Job environment staging         | SSM SendCommand tới đúng Staging EC2 và đọc trạng thái command                                             |
| `CameraAI-GitHub-Production` | Job environment production      | Tương tự, chỉ Production EC2                                                                               |
| `CameraAI-EC2-Staging`       | Instance profile của Staging    | SSM managed-node, pull ECR, đọc release, đọc parameter staging, ghi backup staging, quyền S3 media staging |
| `CameraAI-EC2-Production`    | Instance profile của Production | Tương tự, chỉ tài nguyên production                                                                        |

Tạo role bằng IAM Console → Roles → Create role. Các role EC2 chọn trusted service **EC2** và gắn instance profile lên máy. Gắn `AmazonSSMManagedInstanceCore` cho hai role EC2. Quyền ứng dụng bổ sung theo provider thực tế; không cấp `AdministratorAccess` cho pipeline.

Các action/resource để tạo permission policies bằng IAM JSON editor:

| Nhóm                      | Actions                                                                                     | Resource                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ECR login, build và EC2   | `ecr:GetAuthorizationToken`                                                                 | `*` — action này không scope theo repo                                        |
| ECR pull, build và EC2    | `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability`        | Hai ECR repository ARNs                                                       |
| ECR push, chỉ build       | `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage` | Hai ECR repository ARNs                                                       |
| Release upload, chỉ build | `s3:PutObject`                                                                              | `arn:aws:s3:::YOUR_RELEASE_BUCKET/releases/*`                                 |
| Release download, EC2     | `s3:GetObject`                                                                              | Cùng prefix release                                                           |
| Runtime config, EC2       | `ssm:GetParameter`                                                                          | ARN parameter đúng môi trường                                                 |
| Backup upload, EC2        | `s3:PutObject`                                                                              | `arn:aws:s3:::YOUR_BACKUP_BUCKET/staging/*` hoặc `production/*`               |
| Media, EC2                | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`; thêm action theo code dùng thật          | Object ARN của media bucket đúng môi trường                                   |
| SendCommand, deploy role  | `ssm:SendCommand`                                                                           | Cả ARN instance và document `arn:aws:ssm:REGION::document/AWS-RunShellScript` |
| Đọc command, deploy role  | `ssm:GetCommandInvocation`                                                                  | `*` — API này không hỗ trợ resource-level permission                          |

ARN ví dụ của repo là `arn:aws:ecr:REGION:ACCOUNT_ID:repository/camerai/web`. ARN parameter là `arn:aws:ssm:REGION:ACCOUNT_ID:parameter/camerai/staging/runtime-env` (không có dấu `/` trước `camerai` trong phần sau `parameter/`). Kiểm tra policy bằng IAM Access Analyzer trước sử dụng. Bảng trên là baseline cho pipeline mẫu, không bao gồm mọi quyền của kiến trúc Lambda tương lai. [ECR permissions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/security_iam_id-based-policy-examples.html), [SSM và IAM](https://docs.aws.amazon.com/systems-manager/latest/userguide/security_iam_service-with-iam.html).

SSM RunShellScript có thể chạy lệnh với quyền root trên máy được cấp. Vì vậy deploy role là quyền quản trị mạnh đối với đúng máy đó. Giới hạn instance, bảo vệ workflow/nhánh và không cấp role Production cho job build hoặc Staging.

### 5.3. OIDC: để GitHub nhận quyền AWS ngắn hạn

IAM → Identity providers → Add provider → OpenID Connect:

- Provider URL: `https://token.actions.githubusercontent.com`.
- Audience: `sts.amazonaws.com`.

Tạo ba GitHub roles với trusted entity Web identity/provider vừa thêm. Trust policy phải kiểm tra `aud` và **subject đúng repository**. Build role dùng subject của nhánh `main`; hai deploy roles dùng subject của GitHub Environment tương ứng.

Các dạng subject thường gặp:

```text
repo:OWNER/REPO:ref:refs/heads/main
repo:OWNER/REPO:environment:staging
repo:OWNER/REPO:environment:production
```

Không mặc định sao chép các chuỗi này: GitHub có định dạng immutable subject kèm owner/repository IDs với repo thuộc diện áp dụng. Đối chiếu định dạng repo thực tế theo [GitHub OIDC với AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws). Không mở `sub=*` để chữa lỗi AssumeRole.

**Kết quả chặng 2:** bạn có ARN ba GitHub roles, hai EC2 instance roles, hai ECR repo và ba loại bucket; không lưu AWS access key dài hạn trong GitHub.

## 6. Chặng 3 — Chuẩn bị EC2, secrets và kết nối edge

### 6.1. Hai máy riêng

Dùng Linux x86_64, ví dụ Ubuntu 24.04, cho Staging và Production; mẫu build `linux/amd64`. Không chọn ARM rồi dùng nguyên image amd64 mà chưa kiểm chứng.

1. Gắn đúng instance profile.
2. Bật IMDSv2 required. Nếu backend trong Docker cần lấy instance role qua metadata, kiểm tra hop limit 2 và đường truy cập metadata từ container. Quyền instance role là quyền chung của host, chưa cách ly theo container. [EC2 metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html).
3. Cài Docker Engine và Compose plugin theo [hướng dẫn Ubuntu](https://docs.docker.com/engine/install/ubuntu/), cài AWS CLI v2, `curl`, `jq`, `unzip` và `util-linux` cho `flock`.
4. Kiểm tra SSM Agent hoạt động và máy hiển thị **Online** trong Systems Manager.
5. Security Group mở TCP 80/443 cho HTTPS/Caddy; không mở PostgreSQL 5432, Redis 6379 hoặc backend 3001 ra Internet. Staging nên hạn chế nguồn truy cập nếu có thể.
6. Có outbound tới SSM, ECR, S3, Parameter Store và nguồn image hỗ trợ qua Internet hoặc VPC endpoints phù hợp. SSM cần Agent, role và networking; chỉ tạo IAM role chưa đủ.
7. Trỏ DNS domain từng môi trường tới IP ổn định tương ứng. Caddy cần domain thực, cổng 80/443 và kết nối phù hợp để cấp chứng chỉ.
8. Hoàn thành VPN/route/auth giữa backend và edge theo Lab 08. Edge dành cho Staging phải tách dữ liệu/người nhận với Production.

Trong Session Manager trên **mỗi EC2**, chạy:

```bash
sudo install -d -m 700 /etc/camerai /opt/camerai/releases /opt/camerai/backups
sudo install -d -m 750 /opt/camerai/videos
sudo chown 1000:1000 /opt/camerai/videos
sudo docker version
sudo docker compose version
aws --version
```

Không chép source Git hoặc chạy `pnpm install` trên máy deploy. CD sẽ chuyển artifact đã build.

### 6.2. Parameter Store runtime config

Systems Manager → Parameter Store → Create parameter:

- `/camerai/staging/runtime-env` và `/camerai/production/runtime-env`.
- Type **SecureString**.
- Value là nội dung dotenv phù hợp từng môi trường.
- Standard parameter tối đa 4 KB; nếu nội dung vượt giới hạn, tách tham số hoặc chủ động chọn Advanced (tối đa 8 KB và có chi phí). Không dán nguyên mẫu dài mà bỏ qua giới hạn. [Parameter tiers](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html).

Khởi đầu từ các biến thực sự cần trong `.env.example`, thay các giá trị này:

```dotenv
NODE_ENV=production
TZ=Asia/Ho_Chi_Minh
LOG_LEVEL=info
APP_DOMAIN=YOUR_STAGING_DOMAIN
AWS_REGION=ap-southeast-1
POSTGRES_DB=camerai
POSTGRES_USER=camerai
POSTGRES_PASSWORD=YOUR_RANDOM_DATABASE_PASSWORD
DATABASE_URL=postgresql://camerai:YOUR_URL_ENCODED_DATABASE_PASSWORD@postgres:5432/camerai
REDIS_HOST=redis
REDIS_PORT=6379
STORAGE_PROVIDER=s3
S3_BUCKET=YOUR_STAGING_MEDIA_BUCKET
STORAGE_BUCKET=YOUR_STAGING_MEDIA_BUCKET
AUTH_PROVIDER=jwt
JWT_SECRET=YOUR_RANDOM_JWT_SECRET_AT_LEAST_32_CHARS
WEB_ORIGIN=https://YOUR_STAGING_DOMAIN
INTERNAL_SERVICE_TOKEN=YOUR_RANDOM_INTERNAL_TOKEN
AI_INTERNAL_TOKEN=YOUR_RANDOM_AI_TOKEN
AI_SERVICE_URL=http://YOUR_EDGE_VPN_IP:8000
MQTT_URL=mqtt://YOUR_EDGE_VPN_IP:1883
MQTT_CLIENT_ID=camerai-staging-orchestrator
MQTT_USERNAME=YOUR_MQTT_USER
MQTT_PASSWORD=YOUR_MQTT_PASSWORD
FRIGATE_URL=http://YOUR_EDGE_VPN_IP:5000
MEDIAMTX_RTSP_URL=rtsp://YOUR_EDGE_VPN_IP:8554
MEDIAMTX_WEBRTC_URL=https://YOUR_VIDEO_DOMAIN
MEDIAMTX_PUBLISH_USERNAME=YOUR_MEDIA_USER
MEDIAMTX_PUBLISH_PASSWORD=YOUR_MEDIA_PASSWORD
CAMERA_VIDEO_STORAGE_PATH=/workspace/storage/videos
TELEGRAM_ENABLED=false
M5_ENABLED=false
POSTGRES_IMAGE=postgres:16-alpine
REDIS_IMAGE=redis:7-alpine
CADDY_IMAGE=caddy:2
```

Các tag hỗ trợ ở ba dòng cuối chỉ để bootstrap. Trước Production, chọn bản đã kiểm tra và ghim `repo@sha256:digest` cho PostgreSQL/Redis/Caddy; cập nhật chúng bằng đợt bảo trì riêng, không thay theo mọi lần sửa code.

Không đặt `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`: ứng dụng dùng instance role. Password trong DATABASE_URL phải URL-encode; giá trị đưa vào Parameter Store phải tuân thủ dotenv/Compose (đặc biệt `$`, dấu nháy và `#`). Không `source` file secrets vào shell và không in `docker compose config` chứa giá trị secrets vào log.

Nếu đã chọn Cognito cho hệ thống, giữ `AUTH_PROVIDER=cognito`, điền `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`; cấu hình callback `https://DOMAIN/auth/callback`, logout URLs và tài khoản test cho từng môi trường. Không hạ về JWT chỉ để pipeline xanh. [Lab Cognito](labs/05_COGNITO.md) giải thích phần tích hợp. Ví dụ JWT phía trên là lựa chọn bootstrap khi nhóm chưa bật Cognito.

`S3_BUCKET` là biến adapter S3 hiện tại đọc; chỉ đổi `STORAGE_BUCKET` là chưa đủ. Bổ sung các biến riêng cho camera/AI/tính năng đang bật từ `.env.example`. Các endpoint private phải là địa chỉ reachable từ EC2, không phải `localhost` hoặc tên Docker service của máy edge.

### 6.3. Cấu hình deploy của host

Trên mỗi EC2 tạo `/etc/camerai/deploy.conf` bằng editor với quyền root. File này không chứa secrets ứng dụng. Ví dụ Staging:

```bash
APP_ENV=staging
AWS_REGION=ap-southeast-1
RELEASE_BUCKET=YOUR_RELEASE_BUCKET
BACKUP_BUCKET=YOUR_BACKUP_BUCKET
ECR_REGISTRY=YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com
```

Production đổi `APP_ENV=production`; các bucket/registry dùng giá trị đã chọn. Đặt owner root và permission 600 cho file. Host đọc config này để quyết định môi trường; workflow không được tùy ý đổi môi trường bằng một tham số từ PR.

**Kết quả chặng 3:** SSM online, HTTPS/DNS và VPN đã chuẩn bị, host dùng đúng role, hai runtime parameters tách biệt.

## 7. Chặng 4 — Thêm các file deploy vào repository

Tạo các file sau, lưu UTF-8 và LF cho script shell:

```text
deploy/
  compose.yml
  Caddyfile
tools/cd/
  migrate.mjs
  deploy-host.sh
  request-deploy.sh
.github/workflows/
  cd.yml
  deploy-environment.yml
```

Đây là danh sách **file bạn cần tạo từ mẫu trong tài liệu**, không phải xác nhận các file đã được thêm sẵn. Không thay `docker-compose.yml` Dev.

### 7.1. `deploy/compose.yml`

```yaml
name: camerai-${APP_ENV:?APP_ENV is required}
services:
  postgres:
    image: ${POSTGRES_IMAGE:?POSTGRES_IMAGE is required}
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?}
      POSTGRES_USER: ${POSTGRES_USER:?}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"']
      interval: 5s
      timeout: 5s
      retries: 20
  redis:
    image: ${REDIS_IMAGE:?REDIS_IMAGE is required}
    restart: unless-stopped
    command: [redis-server, --appendonly, 'yes']
    volumes:
      - redisdata:/data
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 5s
      retries: 20
  orchestrator:
    image: ${ORCHESTRATOR_IMAGE:?ORCHESTRATOR_IMAGE is required}
    restart: unless-stopped
    env_file: ${RUNTIME_ENV_FILE:?RUNTIME_ENV_FILE is required}
    environment:
      NODE_ENV: production
      PORT: '3001'
      APP_VERSION: ${RELEASE_ID:?}
      REDIS_HOST: redis
      CAMERA_VIDEO_STORAGE_PATH: /workspace/storage/videos
    volumes:
      - /opt/camerai/videos:/workspace/storage/videos
    healthcheck:
      test: [CMD-SHELL, 'wget -qO- http://localhost:3001/api/v1/health || exit 1']
      interval: 10s
      timeout: 5s
      retries: 18
      start_period: 30s
    stop_grace_period: 45s
  web:
    image: ${WEB_IMAGE:?WEB_IMAGE is required}
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOSTNAME: 0.0.0.0
      PORT: '3000'
    healthcheck:
      test: [CMD-SHELL, 'wget -qO- http://127.0.0.1:3000/login > /dev/null || exit 1']
      interval: 10s
      timeout: 5s
      retries: 18
      start_period: 20s
  migrate:
    image: ${ORCHESTRATOR_IMAGE:?ORCHESTRATOR_IMAGE is required}
    profiles: [tools]
    env_file: ${RUNTIME_ENV_FILE:?RUNTIME_ENV_FILE is required}
    working_dir: /workspace/apps/orchestrator
    entrypoint: [node, cd-migrate.mjs]
    restart: 'no'
  caddy:
    image: ${CADDY_IMAGE:?CADDY_IMAGE is required}
    restart: unless-stopped
    environment:
      APP_DOMAIN: ${APP_DOMAIN:?APP_DOMAIN is required}
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
volumes:
  pgdata:
  redisdata:
  caddydata:
  caddyconfig:
```

Không mount `db/migrations` vào `docker-entrypoint-initdb.d`: migration runner sẽ là chủ duy nhất áp dụng schema và ghi history. Network/volume có tên theo Compose project `camerai-staging` hoặc `camerai-production`, ổn định giữa các release. Không dùng `--remove-orphans` tùy tiện với profile tools; không dùng `down -v` trong deploy.

Thêm giới hạn/log rotation cho Docker daemon hoặc từng service trước vận hành lâu dài. Không dùng volume Redis/database của Dev cho hai môi trường này.

### 7.2. `deploy/Caddyfile`

```caddyfile
{$APP_DOMAIN} {
    request_body {
        max_size 550MB
    }
    handle /api/* {
        reverse_proxy orchestrator:3001 {
            flush_interval -1
        }
    }
    handle {
        reverse_proxy web:3000
    }
}
```

Browser gọi API cùng origin qua `/api/v1`; Caddy giữ nguyên path và chuyển tới backend. `flush_interval -1` giúp luồng SSE không bị giữ buffer. Reverse proxy này chưa triển khai WebRTC/video domain ở edge: làm riêng theo lab và kiểm tra ICE/UDP/authorization. Test upload thực tế theo `CAMERA_VIDEO_MAX_BYTES`, đừng chỉ dựa vào giới hạn của proxy.

### 7.3. `tools/cd/migrate.mjs`

Runner dành cho các migration SQL hiện tại, một kết nối, advisory lock và transaction gồm cả SQL lẫn history. Không sửa runner local đang được nhóm sử dụng. File có cặp `BEGIN;`/`COMMIT;` ngoài cùng được bỏ lớp bọc trước khi runner mở transaction; migration không có lớp bọc cũng được chấp nhận.

```javascript
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let locked = false;
try {
  const lock = await client.query('SELECT pg_try_advisory_lock(701103) AS acquired');
  locked = lock.rows[0].acquired;
  if (!locked) throw new Error('Another migration is running');
  const state = await client.query(`SELECT
    to_regclass('public.users') IS NOT NULL AS has_app,
    to_regclass('public.cd_schema_migrations') IS NOT NULL AS has_history`);
  if (state.rows[0].has_app && !state.rows[0].has_history) {
    throw new Error('Existing DB needs reviewed baseline; do not replay initial schema');
  }
  await client.query(`CREATE TABLE IF NOT EXISTS cd_schema_migrations (
    filename text PRIMARY KEY, sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = await client.query('SELECT filename, sha256 FROM cd_schema_migrations');
  const history = new Map(applied.rows.map((row) => [row.filename, row.sha256]));
  const directory = '/workspace/db/migrations';
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = (await readFile(`${directory}/${file}`, 'utf8')).replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(sql).digest('hex');
    if (history.has(file)) {
      if (history.get(file) !== hash) throw new Error(`Applied SQL changed: ${file}`);
      continue;
    }
    const begins = [...sql.matchAll(/^BEGIN;[ \t]*$/gim)].length;
    const commits = [...sql.matchAll(/^COMMIT;[ \t]*$/gim)].length;
    if (!((begins === 0 && commits === 0) || (begins === 1 && commits === 1))) {
      throw new Error(`Review transaction structure: ${file}`);
    }
    const body = sql.replace(/^BEGIN;[ \t]*$/im, '').replace(/^COMMIT;[ \t]*$/im, '');
    await client.query('BEGIN');
    try {
      await client.query(body);
      await client.query('INSERT INTO cd_schema_migrations(filename, sha256) VALUES ($1, $2)', [
        file,
        hash,
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  if (locked) await client.query('SELECT pg_advisory_unlock(701103)');
  await client.end();
}
```

Giới hạn: runner này dành cho tập SQL hiện tại, không phải SQL parser tổng quát. Migration mới có transaction control khác, `CREATE INDEX CONCURRENTLY` hoặc lệnh không chạy trong transaction phải có quy trình riêng. Thử runner với DB sạch, chạy lại và nâng cấp DB có dữ liệu trên Staging trước Production. Các filename trùng số `0007`/`0010` hiện được phân biệt bằng **toàn bộ tên file**, không chỉ phần số.

DB đã được khởi tạo bởi Compose Dev hoặc runner cũ cần kế hoạch baseline: backup, đối chiếu schema/từng file đã áp dụng, rồi ghi history có checksum sau review. Không tự đánh dấu tất cả SQL là đã chạy và không replay `0001_init.sql` lên DB đang có dữ liệu. Mẫu chặng đầu ưu tiên DB Staging mới.

Trong stage `production` của `apps/orchestrator/Dockerfile`, thêm hai lệnh sau **trước** `USER node` và `WORKDIR /workspace/apps/orchestrator`:

```dockerfile
COPY --from=build /workspace/db/migrations /workspace/db/migrations
COPY --from=build /workspace/tools/cd/migrate.mjs /workspace/apps/orchestrator/cd-migrate.mjs
```

Không cần cài pnpm trên server; package `pg` đã có trong dependencies backend của image. Chạy build/khởi động thật để kiểm chứng đường dẫn pnpm symlink và contracts.

## 8. Chặng 5 — Script deploy trên EC2

Tạo `tools/cd/deploy-host.sh` theo mẫu. Script này được người quản trị cài vào host lúc bootstrap, không tự chạy mã shell mới lấy từ PR. Khi đổi script, review và cập nhật host có kiểm soát.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }
source /etc/camerai/deploy.conf
: "${APP_ENV:?}" "${AWS_REGION:?}" "${RELEASE_BUCKET:?}" "${BACKUP_BUCKET:?}" "${ECR_REGISTRY:?}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=''
release=${1:?release ID required}
mode=${2:-apply}
[[ $release =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || exit 2
[[ $mode == apply || $mode == rollback ]] || exit 2
[[ $APP_ENV == staging || $APP_ENV == production ]] || exit 2
exec 9>/opt/camerai/deploy.lock
flock -n 9 || { echo 'Another deploy is running'; exit 3; }
root=/opt/camerai
candidate="$root/releases/$release"
previous=$(readlink -f "$root/current" || true)

dc() {
  local directory=$1
  shift
  APP_ENV="$APP_ENV" RUNTIME_ENV_FILE="$directory/runtime.env" \
    docker compose --project-name "camerai-$APP_ENV" \
    --env-file "$directory/runtime.env" --env-file "$directory/release.env" \
    -f "$directory/deploy/compose.yml" "$@"
}

smoke() {
  local directory=$1
  dc "$directory" exec -T web node --input-type=module -e '
    const r = await fetch("http://orchestrator:3001/api/v1/health");
    if (!r.ok || (await r.json()).version !== process.argv[1]) process.exit(1);
  ' "$(basename "$directory")"
  dc "$directory" exec -T web node --input-type=module -e '
    const r = await fetch("http://orchestrator:3001/api/v1/auth/config");
    if (!r.ok || !["jwt", "cognito"].includes((await r.json()).provider)) process.exit(1);
  '
}

if [[ $mode == apply ]]; then
  [[ ! -e $candidate ]] || { echo 'Release directory exists; inspect prior attempt'; exit 4; }
  install -d -m 700 "$candidate"
  aws s3 cp "s3://$RELEASE_BUCKET/releases/$release/bundle.tgz" "$candidate/bundle.tgz"
  aws s3 cp "s3://$RELEASE_BUCKET/releases/$release/bundle.sha256" "$candidate/bundle.sha256"
  (cd "$candidate" && sha256sum -c bundle.sha256 && tar -xzf bundle.tgz)
  aws ssm get-parameter --name "/camerai/$APP_ENV/runtime-env" --with-decryption \
    --query Parameter.Value --output text > "$candidate/runtime.env"
  chmod 600 "$candidate/runtime.env"
else
  [[ -f $candidate/succeeded && -f $candidate/runtime.env ]] || {
    echo 'Rollback target must be a previously successful retained release'; exit 4;
  }
fi

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"
dc "$candidate" config --quiet
dc "$candidate" pull orchestrator web

if [[ $mode == apply ]]; then
  if [[ ! -f $root/bootstrapped ]]; then
    dc "$candidate" up -d --wait --wait-timeout 180 postgres redis caddy
    touch "$root/bootstrapped"
  fi
  dc "$candidate" exec -T postgres sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$root/backups/$release.dump"
  aws s3 cp "$root/backups/$release.dump" \
    "s3://$BACKUP_BUCKET/$APP_ENV/$release.dump"
  dc "$candidate" run --rm --no-deps migrate
fi

if dc "$candidate" up -d --no-deps --wait --wait-timeout 240 orchestrator web caddy \
  && smoke "$candidate"; then
  ln -sfn "$candidate" "$root/current"
  touch "$candidate/succeeded"
  echo "SUCCESS $APP_ENV $release ($mode)"
else
  echo "FAILED $APP_ENV $release ($mode)"
  if [[ $mode == apply && -n $previous && -f $previous/succeeded ]]; then
    echo 'Restoring previous application release; database is unchanged'
    dc "$previous" up -d --no-deps --wait --wait-timeout 240 orchestrator web caddy
    smoke "$previous"
  fi
  exit 1
fi
```

Mỗi host chỉ có một deploy tại một thời điểm nhờ `flock`. App mới lỗi sẽ thử chạy lại app cũ; SQL đã commit được giữ nguyên. Migration lỗi dừng trước bước cập nhật app, không tự restore DB. Vì vậy mọi migration trong luồng này phải tương thích với phiên bản app đang chạy và phiên bản được phép rollback.

Release giữ bản snapshot runtime config root-only để rollback đúng cấu hình cũ. Snapshot chứa secrets nên không upload vào release bucket và phải bảo vệ EBS/backup host. Sau khi xoay secret, cần đánh giá release cũ còn dùng được không trước rollback.

Backup upload phải thành công mới migrate. Backup S3 chưa được chứng minh sử dụng được cho đến khi thử restore sang một database riêng. Không restore ghi đè Production tự động vì có thể làm mất dữ liệu phát sinh sau backup.

**Cài script:** sau review, chuyển nội dung file lên EC2 qua Session Manager hoặc kênh quản trị được phép, lưu `/opt/camerai/deploy-host.sh`, owner root, mode 700. Chạy `sudo bash -n /opt/camerai/deploy-host.sh` để kiểm tra cú pháp. Không đưa secrets vào nội dung lệnh SSM.

## 9. Chặng 6 — Tạo GitHub Environments và Variables

GitHub repository → Settings → Environments:

1. Tạo `staging`, chỉ cho nhánh `main` deploy.
2. Tạo `production`, chỉ cho `main`, cấu hình required reviewer là thành viên khác; bật prevent self-review nếu phù hợp và không cho bypass tùy tiện.
3. Bảo vệ `main`, yêu cầu PR/review và CI xanh; bảo vệ thay đổi `.github/workflows`, `tools/cd`, `deploy` bằng reviewer phụ trách hạ tầng.

Settings → Secrets and variables → Actions → **Repository variables**:

| Tên                  | Giá trị                     |
| -------------------- | --------------------------- |
| `AWS_REGION`         | Region đã chọn              |
| `AWS_ACCOUNT_ID`     | Account ID                  |
| `AWS_BUILD_ROLE_ARN` | ARN `CameraAI-GitHub-Build` |
| `RELEASE_BUCKET`     | Tên release bucket          |

Trong **mỗi Environment**, tạo variables cùng tên nhưng giá trị riêng:

| Tên                   | Staging / Production                               |
| --------------------- | -------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | ARN deploy role đúng môi trường                    |
| `EC2_INSTANCE_ID`     | Instance ID đúng môi trường                        |
| `APP_URL`             | HTTPS origin của môi trường, không có dấu `/` cuối |

Các biến trên không phải secret credentials. Password/token ứng dụng ở Parameter Store, không nằm trong GitHub variables. Hai job environment cần OIDC subject đúng Environment, không dùng subject nhánh thay thế nếu token thực tế dùng environment.

## 10. Chặng 7 — Tạo workflow CD

### 10.1. `tools/cd/request-deploy.sh`

Script chạy trên GitHub runner, gửi lệnh và đợi kết quả SSM. Khác với script host ở mục 8.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?}" "${EC2_INSTANCE_ID:?}"
[[ $RELEASE_ID =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || exit 2
[[ $EC2_INSTANCE_ID =~ ^i-[0-9a-f]+$ ]] || exit 2
params=$(jq -nc --arg command "/opt/camerai/deploy-host.sh $RELEASE_ID apply" \
  '{commands:[$command],executionTimeout:["1800"]}')
command_id=$(aws ssm send-command --document-name AWS-RunShellScript \
  --instance-ids "$EC2_INSTANCE_ID" --parameters "$params" \
  --timeout-seconds 120 --query Command.CommandId --output text)
echo "SSM command: $command_id"
for ((attempt=1; attempt<=210; attempt++)); do
  if result=$(aws ssm get-command-invocation --command-id "$command_id" \
    --instance-id "$EC2_INSTANCE_ID" --output json 2>ssm-error.txt); then
    status=$(jq -r .Status <<< "$result")
    case "$status" in
      Success) echo 'Host deploy succeeded'; exit 0 ;;
      Failed|Cancelled|TimedOut|Cancelling)
        jq '{Status,StandardOutputContent,StandardErrorContent}' <<< "$result"
        exit 1 ;;
      Pending|InProgress|Delayed) ;;
      *) echo "Unexpected SSM status: $status"; exit 1 ;;
    esac
  elif ! grep -q InvocationDoesNotExist ssm-error.txt; then
    cat ssm-error.txt >&2
    exit 1
  fi
  sleep 10
done
echo 'Timed out waiting; inspect SSM before retrying. Do not assume host stopped.'
exit 1
```

Không dùng nguyên waiter mặc định rồi coi timeout waiter là máy đã dừng deploy. SSM có eventual consistency; mẫu chỉ retry lỗi chưa có invocation, không che lỗi AccessDenied hoặc sai region.

### 10.2. `.github/workflows/deploy-environment.yml`

Reusable workflow giúp hai môi trường chạy cùng quy trình. Nó không có trigger push độc lập.

```yaml
name: Deploy environment
on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
      release_id:
        type: string
        required: true
      source_sha:
        type: string
        required: true
permissions:
  contents: read
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    environment:
      name: ${{ inputs.environment }}
      url: ${{ vars.APP_URL }}
    concurrency:
      group: camerai-deploy-${{ inputs.environment }}
      cancel-in-progress: false
    env:
      AWS_REGION: ${{ vars.AWS_REGION }}
      AWS_DEFAULT_REGION: ${{ vars.AWS_REGION }}
      AWS_PAGER: ''
      RELEASE_ID: ${{ inputs.release_id }}
      EC2_INSTANCE_ID: ${{ vars.EC2_INSTANCE_ID }}
      APP_URL: ${{ vars.APP_URL }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.source_sha }}
          persist-credentials: false
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Deploy and wait for SSM result
        run: bash tools/cd/request-deploy.sh
      - name: Check HTTPS and release version
        run: |
          set -euo pipefail
          curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 5 \
            "$APP_URL/api/v1/health" | jq -e --arg release "$RELEASE_ID" '.status == "ok" and .version == $release'
          curl --fail --silent --show-error "$APP_URL/login" > /dev/null
          curl --fail --silent --show-error "$APP_URL/api/v1/auth/config" | \
            jq -e '.provider == "jwt" or .provider == "cognito"'
      - name: Write release summary
        run: |
          printf 'Release: `%s`\n\nURL: %s\n' "$RELEASE_ID" "$APP_URL" >> "$GITHUB_STEP_SUMMARY"
```

Job gắn `production` sẽ chờ người duyệt theo environment protection trước khi nhận quyền và chạy. Nếu host smoke thành công nhưng kiểm tra HTTPS bên ngoài thất bại, workflow vẫn đỏ; trường hợp này cần kiểm tra DNS/TLS/proxy trước khi quyết định rollback. Mẫu không tự rollback host theo mọi lỗi mạng của runner.

### 10.3. `.github/workflows/cd.yml`

Mẫu bắt đầu khi workflow **CI** đã kết thúc thành công trên push vào `main`. Nó checkout đúng `head_sha` đã được kiểm tra, không checkout `main` mới nhất.

```yaml
name: CD
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
permissions:
  contents: read
concurrency:
  group: camerai-release-main
  cancel-in-progress: false
jobs:
  package:
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main' &&
      github.event.workflow_run.head_repository.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 35
    permissions:
      contents: read
      id-token: write
    outputs:
      release_id: ${{ steps.release.outputs.id }}
    env:
      AWS_REGION: ${{ vars.AWS_REGION }}
      RELEASE_BUCKET: ${{ vars.RELEASE_BUCKET }}
      ECR_REGISTRY: ${{ vars.AWS_ACCOUNT_ID }}.dkr.ecr.${{ vars.AWS_REGION }}.amazonaws.com
      SOURCE_SHA: ${{ github.event.workflow_run.head_sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          persist-credentials: false
      - name: Identify release
        id: release
        run: |
          id="$SOURCE_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          echo "id=$id" >> "$GITHUB_OUTPUT"
          echo "RELEASE_ID=$id" >> "$GITHUB_ENV"
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_BUILD_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Login ECR
        run: |
          aws ecr get-login-password --region "$AWS_REGION" | \
            docker login --username AWS --password-stdin "$ECR_REGISTRY"
      - uses: docker/setup-buildx-action@v3
      - name: Build and publish web
        id: web
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/web/Dockerfile
          target: production
          platforms: linux/amd64
          push: true
          tags: ${{ env.ECR_REGISTRY }}/camerai/web:${{ env.RELEASE_ID }}
          build-args: NEXT_PUBLIC_API_BASE_URL=/api/v1
      - name: Build and publish orchestrator
        id: orchestrator
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/orchestrator/Dockerfile
          target: production
          platforms: linux/amd64
          push: true
          tags: ${{ env.ECR_REGISTRY }}/camerai/orchestrator:${{ env.RELEASE_ID }}
      - name: Create release bundle
        env:
          WEB_DIGEST: ${{ steps.web.outputs.digest }}
          ORCHESTRATOR_DIGEST: ${{ steps.orchestrator.outputs.digest }}
        run: |
          set -euo pipefail
          mkdir -p artifacts/cd
          printf 'RELEASE_ID=%s\nWEB_IMAGE=%s/camerai/web@%s\nORCHESTRATOR_IMAGE=%s/camerai/orchestrator@%s\n' \
            "$RELEASE_ID" "$ECR_REGISTRY" "$WEB_DIGEST" "$ECR_REGISTRY" "$ORCHESTRATOR_DIGEST" > release.env
          tar -czf artifacts/cd/bundle.tgz release.env deploy/compose.yml deploy/Caddyfile
          (cd artifacts/cd && sha256sum bundle.tgz > bundle.sha256)
          aws s3 cp artifacts/cd/bundle.tgz "s3://$RELEASE_BUCKET/releases/$RELEASE_ID/bundle.tgz"
          aws s3 cp artifacts/cd/bundle.sha256 "s3://$RELEASE_BUCKET/releases/$RELEASE_ID/bundle.sha256"
          printf 'Release ready: `%s`\n' "$RELEASE_ID" >> "$GITHUB_STEP_SUMMARY"
  staging:
    needs: package
    permissions:
      contents: read
      id-token: write
    uses: ./.github/workflows/deploy-environment.yml
    with:
      environment: staging
      release_id: ${{ needs.package.outputs.release_id }}
      source_sha: ${{ github.event.workflow_run.head_sha }}
  production:
    needs: [package, staging]
    permissions:
      contents: read
      id-token: write
    uses: ./.github/workflows/deploy-environment.yml
    with:
      environment: production
      release_id: ${{ needs.package.outputs.release_id }}
      source_sha: ${{ github.event.workflow_run.head_sha }}
```

Các major action versions giữ cùng họ với CI hiện tại để dễ tích hợp. Trước bật Production, pin actions theo full commit SHA đã kiểm tra và có quy trình cập nhật; không lấy SHA từ nguồn không xác thực.

`workflow_run` có thể chạy với quyền cao hơn workflow nguồn: tuyệt đối không bỏ điều kiện event push/main/repository và không tải rồi thực thi artifact không tin cậy từ PR. Trong lần triển khai đầu, merge các file CD vào default branch để GitHub nhận workflow trigger. [Workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

Concurrency của **toàn CD run** giữ Staging không bị release khác thay trong lúc chờ duyệt Production. Mặc định GitHub chỉ giữ một run pending trong group; commit mới có thể thay run pending, nhưng không hủy run đang deploy/chờ duyệt vì `cancel-in-progress: false`. Không hứa mọi commit đều sẽ deploy theo FIFO. Hủy thủ công lúc chờ duyệt có thể dùng để bỏ candidate; nếu đã gửi SSM thì phải kiểm tra command/host, vì hủy Actions không đảm bảo dừng lệnh trên máy. [Concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

CI vẫn có thể giữ cơ chế hủy lần kiểm tra PR cũ vì CD là workflow riêng. Điều bắt buộc là **CI thực sự chạy và pass các kiểm tra cần thiết cho source SHA**. Gate `ci-ok` hiện chỉ chặn `failure/cancelled`, chưa chặn mọi trường hợp job bắt buộc bị `skipped`. Trong `ci.yml`, thay job `ci-ok` bằng đoạn này, giữ danh sách `needs` đồng bộ nếu thêm/bớt kiểm tra bắt buộc:

```yaml
ci-ok:
  name: CI xanh
  runs-on: ubuntu-latest
  needs: [node, python, training, openapi, database, docker, commitlint]
  if: always()
  steps:
    - name: Require every mandatory check to pass
      env:
        RESULTS: ${{ toJSON(needs) }}
        EVENT_NAME: ${{ github.event_name }}
      run: |
        jq -e --arg event "$EVENT_NAME" '
          all(to_entries[];
            if .key == "commitlint" and $event != "pull_request"
            then (.value.result == "skipped" or .value.result == "success")
            else .value.result == "success"
            end)
        ' <<< "$RESULTS"
```

## 11. Chặng 8 — Thử lần đầu trên Staging

### Trước khi push

1. Kiểm tra Compose bằng các env sample đầy đủ, không dùng secrets thật trong log. Chạy `docker compose ... config --quiet` với đúng các env files như script.
2. Build hai production images, khởi động trên Linux với DB sạch; kiểm tra migration chạy lần đầu và chạy lại không thay đổi schema.
3. Xác nhận web build với `NEXT_PUBLIC_API_BASE_URL=/api/v1`; biến public Next.js cố định lúc build, đổi env container không thay browser bundle. Auth config hiện được backend cung cấp lúc chạy nên cùng image có thể dùng pool Cognito riêng ở từng môi trường. [Next.js 15](https://nextjs.org/docs/15/app/guides/environment-variables).
4. Chạy lint/test cần thiết; review script, IAM và workflow. Không tự merge PR của mình.

### Chạy và quan sát

1. Merge một thay đổi nhỏ đã review vào `main`.
2. GitHub Actions → CI: các job bắt buộc phải xanh.
3. CD → package: kiểm tra release ID, hai ECR tags và digest, S3 bundle.
4. CD → staging: xem command ID; đối chiếu Systems Manager Run Command tới đúng instance.
5. Trên Staging, `/opt/camerai/current` phải trỏ đúng release; `/api/v1/health` trả `version` chính là release ID.
6. Production phải **chờ reviewer**, chưa tự chạy.

Script tự tạo database/Redis/Caddy trong lần bootstrap đầu, backup database rồi migrate. Nó không tạo tài khoản admin nghiệp vụ. Dùng quy trình quản trị tài khoản đã review hoặc tài khoản Cognito được provisioning/mapping đúng; không chạy seed Dev một cách mặc định trên Production.

Health của orchestrator hiện chỉ phản ánh tiến trình, chưa probe DB/MQTT/model. Smoke tự động trong mẫu chỉ kiểm tra ứng dụng/release/auth config/HTTPS; không thay thế kiểm thử nghiệp vụ dưới đây.

## 12. Kiểm thử Staging và duyệt Production

Reviewer chỉ duyệt khi có evidence gắn với đúng release ID:

- Đăng nhập, refresh, logout theo provider đang dùng; callback Cognito đúng domain nếu bật.
- Dashboard gọi `/api/v1`, không còn request tới localhost hoặc domain Staging từ Production build.
- DB CRUD theo quyền hoạt động, request không có quyền bị chặn.
- Một video/camera test đi qua edge → MQTT → orchestrator → AI/provider → event → dashboard.
- Snapshot/clip lên đúng S3 bucket và mở được bằng presigned URL.
- Telegram hoặc provider test gửi đúng người nhận Staging; xác nhận và escalation đúng trạng thái/deadline.
- Restart orchestrator khi có công việc chờ, kiểm tra phục hồi và không gửi trùng.
- Không có lỗi kết nối kéo dài, backlog bất thường, disk/RAM quá tải.
- Đã thử rollback app và restore backup sang DB riêng.

Ghi lại link CI/CD run, release ID, người test, kết quả và provider/edge version. Các tính năng chưa bật/chưa triển khai ghi rõ không nằm trong phạm vi nghiệm thu, không coi health 200 là đã pass AI/fire/fall.

Sau đó vào pending deployment **production** và approve. Cùng release ID/digest được deploy. Tại Production, kiểm tra đăng nhập, API, media và camera test có kiểm soát; không thử gọi khẩn cấp tới người nhận thật ngoài kế hoạch được phép. Theo dõi thêm logs/error/backlog/CPU/RAM/đĩa sau phát hành, không chỉ một request ngay khi khởi động.

Khi nhóm viết được automated E2E, chèn một job `e2e-staging` sau `staging` và cho `production` cần cả `package`, `staging`, `e2e-staging`. Dùng test secrets riêng, chỉ chạy trong Staging. Cho đến lúc đó, manual review phải bao gồm E2E trên đây.

## 13. Rollback và xử lý lỗi

### Rollback có kiểm soát

1. Chọn release từng thành công, còn image và snapshot config trên host.
2. Kiểm tra schema hiện tại vẫn tương thích với release đó, secrets cũ chưa bị thu hồi và edge/provider contracts vẫn phù hợp.
3. Trên đúng EC2 qua Session Manager, dùng release ID thực đã ghi ở CD:

```bash
sudo /opt/camerai/deploy-host.sh YOUR_PREVIOUS_RELEASE_ID rollback
```

4. Kiểm tra `/api/v1/health`, app/DB/media/queue và ghi lại ai rollback, vì sao, từ release nào sang release nào.

Thay `YOUR_PREVIOUS_RELEASE_ID` bằng chuỗi thực `40-character-sha-run_id-run_attempt`. Script từ chối chuỗi placeholder. Rollback không chạy lại migration và không restore DB. Auto rollback ở mục 8 chỉ xử lý app startup/internal smoke failure; lỗi migration/external HTTPS/E2E cần người phụ trách đánh giá.

### Các lỗi thường gặp

| Lỗi                                                 | Kiểm tra đầu tiên                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| CD không xuất hiện                                  | Workflow đã ở default branch chưa; tên CI/event push/main có khớp không                    |
| AssumeRole AccessDenied                             | Trust `aud/sub`, environment và ARN role; không mở trust wildcard                          |
| ImageTagAlreadyExists                               | Rebuild đang dùng lại tag cũ; chạy lại cả workflow để có run attempt mới                   |
| SSM instance offline                                | Region, Agent, instance profile và outbound/endpoints                                      |
| InvocationDoesNotExist vài giây đầu                 | Eventual consistency, polling có retry giới hạn                                            |
| Docker pull denied                                  | ECR login hết hạn hoặc instance role thiếu quyền pull                                      |
| Metadata credentials không lấy được trong container | IMDSv2, hop limit, metadata route/proxy và instance profile                                |
| Backend cannot find module/contracts                | Production image thiếu runtime dependency/contract dist/symlink                            |
| Migration báo baseline required                     | DB đã có schema từ cách cũ; lập baseline có kiểm chứng, không reset                        |
| Migration changed                                   | SQL đã chạy bị sửa; phục hồi file gốc và thêm migration mới                                |
| Database password mismatch                          | Đổi env không đổi password của PostgreSQL volume đã khởi tạo; xoay password DB có kế hoạch |
| Web gọi localhost                                   | Build arg thiếu hoặc dùng nhầm image; env runtime không sửa public bundle                  |
| Health xanh nhưng không có event                    | VPN/MQTT/AI/model/provider/worker, không chỉ HTTP                                          |
| Cognito callback lỗi                                | Callback URL, app client/pool/domain và provider runtime đúng môi trường                   |
| Upload video Permission denied                      | `/opt/camerai/videos` owner UID 1000 và quyền disk                                         |
| Deploy workflow đỏ nhưng app mới đang chạy          | Đối chiếu SSM/current/release version; external smoke có thể thất bại sau host deploy      |

Không tự chạy `docker system prune --volumes`, `docker compose down -v`, `pnpm db:reset` hay seed demo để chữa lỗi deploy. Không tăng replica orchestrator để chữa thiếu tài nguyên khi chưa kiểm chứng MQTT client IDs, duplicate delivery, leases và worker ownership.

## 14. Checklist nghiệm thu CD

- [ ] PR không có quyền deploy AWS; merge vào main mới có thể phát hành.
- [ ] Source SHA của release khớp CI run thành công.
- [ ] Build role không có quyền deploy Production; Staging role không điều khiển Production EC2.
- [ ] ECR images và release bundle cùng release ID, deploy theo digest.
- [ ] Không đưa secrets/source mount/dev server vào production images.
- [ ] Một deploy mỗi host; không hủy migration đang chạy do commit mới.
- [ ] Staging/Production tách secrets, DB/Redis, media, edge test data và người nhận.
- [ ] Staging thất bại chặn Production; người duyệt thấy đúng release và evidence.
- [ ] Production dùng cùng artifacts đã qua Staging.
- [ ] App reports đúng release ID; lỗi deploy không bị báo thành công.
- [ ] Backup ngoài host, restore đã diễn tập, rollback app đã thử.
- [ ] Có log rotation, giới hạn lưu release/backup và monitoring disk/error/backlog.

Retention phải giữ release/image/model cần rollback. Xóa tài nguyên demo theo kế hoạch nhóm, không chỉ tắt EC2: EBS, snapshots, S3, ECR, public IP và logs vẫn có thể phát sinh chi phí.

## 15. Tích hợp phần AI/edge và Lambda sau bản đầu

### AI và edge

Build AI thành image riêng, bỏ `--reload`, đưa model có checksum/version vào image hoặc artifact cố định. Manifest hiện có trạng thái fire `PENDING_TRAINING`; không coi đó là model sẵn sàng. Smoke phải kiểm tra inference bằng input chuẩn, vì `/health` hiện chưa chứng minh model load được.

Edge cần kênh triển khai quản trị riêng (VPN/managed node/hệ thống quản lý thiết bị). EC2 SSM workflow trên không tự có quyền cập nhật laptop edge. Không mở MQTT/Frigate/AI public chỉ để GitHub runner truy cập. Giữ compatibility với API/contract trong giai đoạn chuyển release; đưa edge/model version vào evidence phát hành.

### Lambda/SQS/Step Functions và hạ tầng

Khi các handlers, event contracts và IaC thật đã được triển khai theo [Lab 04](labs/04_TICH_HOP_NESTJS_SAM.md), bổ sung pipeline riêng hoặc job:

```text
CI kiểm tra handlers/contracts/IaC
  → đóng gói một artifact versioned
  → deploy stack/versions Staging
  → kiểm thử retry, DLQ, idempotency và callback
  → duyệt
  → promote cùng artifacts/versions tới Production
```

Tạo stack/queue/secret/state machine riêng từng môi trường. Deploy IaC qua change set/diff có review; giữ cùng template đã package thay vì build lại từ branch mới nhất. App release phải ghi versions/alias Lambda và schema event nó tương thích. Chỉ chuyển traffic/job ownership sau kiểm chứng, không chạy đồng thời worker cũ và worker mới cho cùng notification/deadline.

Không thêm một lệnh `sam deploy` tượng trưng vào mẫu khi repository chưa có template/handlers tương ứng. CD container hoàn thành là một phần của release Hybrid, không phải bằng chứng Lambda đã được triển khai.

## 16. Thứ tự thực hành gợi ý

1. Hiểu release/digest, điền thông tin ở mục 4 và kiểm tra gói GitHub.
2. Tạo ECR/S3/IAM/OIDC, hai máy và Parameter Store.
3. Tạo Compose/proxy/migration runner; chạy bằng tay trên Staging tới khi ổn.
4. Cài host script, thử backup/migrate/deploy và rollback trên Staging.
5. Thêm workflow, nối CI → ECR/S3 → Staging; thử cố ý làm một smoke test thất bại.
6. Hoàn thành evidence, bật gate Production, diễn tập lần phát hành đầu có người theo dõi.
7. Bổ sung E2E tự động, CD edge/Lambda và IaC khi các thành phần tương ứng sẵn sàng.

## Nguồn chính thức để tra cứu

- [GitHub OIDC với AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).
- [GitHub Environments và giới hạn gói](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- [Reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
- [Workflow run trigger](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
- [ECR push image](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html).
- [ECR immutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html).
- [SSM Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html).
- [Docker Compose cho production](https://docs.docker.com/compose/how-tos/production/).
- [Docker Compose up và wait](https://docs.docker.com/reference/cli/docker/compose/up/).
- [Next.js 15 environment variables](https://nextjs.org/docs/15/app/guides/environment-variables).
