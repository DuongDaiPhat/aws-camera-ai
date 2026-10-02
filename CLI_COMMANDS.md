# BẢNG TỔNG HỢP TOÀN BỘ LỆNH CLI DỰ ÁN CAMERA AI

> **Dự án:** CameraAI — Hệ thống giám sát hành vi ứng dụng AI và AWS (Đồ án Project 1)  
> **Nền tảng hỗ trợ:** Windows (PowerShell / CMD), Linux, macOS  
> **Mục tiêu:** Tra cứu nhanh tất cả các câu lệnh thao tác Docker, CSDL, Test, AI, Edge CV và Quy trình phát triển.

---

## 📌 MỤC LỤC TRA CỨU NHANH

1. [Khởi Tạo Môi Trường Lần Đầu (Initial Setup)](#1-khởi-tạo-môi-trường-lần-đầu-initial-setup)
2. [Quản Lý Docker & Container Services](#2-quản-lý-docker--container-services)
   - [2.1. Khởi động các dịch vụ](#21-khởi-động-các-dịch-vụ)
   - [2.2. Kiểm tra trạng thái & Log](#22-kiểm-tra-trạng-thái--log)
   - [2.3. Khởi động lại & Tắt container](#23-khởi-động-lại--tắt-container)
   - [2.4. Build & Rebuild Container](#24-build--rebuild-container)
   - [2.5. Reset sạch Docker & Dọn dẹp tài nguyên](#25-reset-sạch-docker--dọn-dẹp-tài-nguyên)
3. [Cơ Sở Dữ Liệu PostgreSQL (Migration, Reset & Seed)](#3-cơ-sở-dữ-liệu-postgresql-migration-reset--seed)
   - [3.1. Chạy từ máy Host (qua pnpm / node)](#31-chạy-từ-máy-host-qua-pnpm--node)
   - [3.2. Chạy bên trong Docker Container](#32-chạy-bên-trong-docker-container)
   - [3.3. Thao tác trực tiếp qua psql CLI](#33-thao-tác-trực-tiếp-qua-psql-cli)
4. [Lệnh Monorepo & Quy Trình Phát Triển (pnpm Workspace)](#4-lệnh-monorepo--quy-trình-phát-triển-pnpm-workspace)
5. [Hợp Đồng API & Sinh Kiểu Dữ Liệu (OpenAPI / Contracts)](#5-hợp-đồng-api--sinh-kiểu-dữ-liệu-openapi--contracts)
6. [Làm Việc Riêng Trên Từng Phân Hệ](#6-làm-việc-riêng-trên-từng-phân-hệ)
   - [6.1. Backend Orchestrator (NestJS)](#61-backend-orchestrator-nestjs)
   - [6.2. Frontend Dashboard (Next.js)](#62-frontend-dashboard-nextjs)
   - [6.3. AI Service (FastAPI / Python)](#63-ai-service-fastapi--python)
7. [Edge, Frigate, MQTT & Giả Lập RTSP](#7-edge-frigate-mqtt--giả-lập-rtsp)
   - [7.1. Cấu hình & Kiểm thử Frigate](#71-cấu-hình--kiểm-thử-frigate)
   - [7.2. Tương tác MQTT Broker (Mosquitto)](#72-tương-tác-mqtt-broker-mosquitto)
   - [7.3. Giả lập Camera RTSP (FFmpeg & MediaMTX)](#73-giả-lập-camera-rtsp-ffmpeg--mediamtx)
8. [Kiểm Tra Nhanh & Gỡ Rối Lỗi Thường Gặp (Troubleshooting)](#8-kiểm-tra-nhanh--gỡ-rối-lỗi-thường-gặp-troubleshooting)
9. [Quy Trình Git Chuẩn Agile](#9-quy-trình-git-chuẩn-agile)

---

## 1. KHỞI TẠO MÔI TRƯỜNG LẦN ĐẦU (INITIAL SETUP)

### Cài đặt công cụ nền tảng (Windows PowerShell Admin)

```powershell
winget install Docker.DockerDesktop
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.11
winget install Git.Git
winget install Gyan.FFmpeg

# Bật pnpm qua corepack
corepack enable
corepack prepare pnpm@9.12.0 --activate
```

### Cấu hình Git bắt buộc cho Windows

```powershell
git config --global core.autocrlf input
git config --global core.eol lf
git config --global pull.rebase true
```

### Khởi tạo cấu hình môi trường (.env)

```powershell
# Copy file mẫu cấu hình
Copy-Item .env.example .env    # Linux/Git Bash: cp .env.example .env

# Sinh chuỗi JWT Secret ngẫu nhiên an toàn
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# Copy kết quả dán vào JWT_SECRET trong file .env
```

### Cài đặt dependencies toàn bộ dự án

```powershell
# Cài đặt toàn bộ packages monorepo
pnpm install

# Khởi tạo virtualenv Python và cài đặt thư viện cho AI Service
pnpm setup:ai
```

---

## 2. QUẢN LÝ DOCKER & CONTAINER SERVICES

Danh sách các service trong compose:

- Core: `postgres`, `redis`, `mosquitto`, `minio`, `minio-init`, `mediamtx`, `ai-service`, `orchestrator`, `web`
- CV Profile: `frigate` (chạy khi cần xử lý thị giác máy tính / detector)

### 2.1. Khởi động các dịch vụ

```powershell
# 1. Khởi động toàn bộ cụm dịch vụ mặc định (chạy ngầm -d)
docker compose up -d

# 2. Khởi động bao gồm cả Frigate (yêu cầu máy đủ tài nguyên)
docker compose --profile cv up -d

# 3. Khởi động một hoặc nhiều service cụ thể
docker compose up -d postgres redis mosquitto minio
docker compose up -d orchestrator
docker compose up -d ai-service
docker compose up -d web
docker compose up -d mediamtx
```

### 2.2. Kiểm tra trạng thái & Log

```powershell
# Xem danh sách và trạng thái (healthy/running) của tất cả containers
docker compose ps

# Xem chi tiết một container
docker compose ps orchestrator

# Xem tài nguyên tiêu thụ (CPU, RAM) theo thời gian thực
docker stats

# Theo dõi log thời gian thực (follow) toàn bộ hệ thống
docker compose logs -f

# Theo dõi log của một service cụ thể
docker compose logs -f orchestrator
docker compose logs -f ai-service
docker compose logs -f frigate
docker compose logs -f postgres

# Xem 100 dòng log gần nhất của một service
docker compose logs --tail=100 orchestrator
```

### 2.3. Khởi động lại & Tắt container

```powershell
# Khởi động lại toàn bộ dịch vụ
docker compose restart

# Khởi động lại một service cụ thể
docker compose restart orchestrator
docker compose restart ai-service
docker compose restart frigate

# Tạm dừng container (không xóa container và mạng)
docker compose stop
docker compose stop orchestrator

# Tiếp tục chạy lại container đã stop
docker compose start

# Tắt và xóa container + network (DỮ LIỆU VOLUMES VẪN ĐƯỢC GIỮ NGUYÊN)
docker compose down

# Tắt bao gồm cả Frigate profile
docker compose --profile cv down
```

### 2.4. Build & Rebuild Container

```powershell
# Build lại tất cả images có Dockerfile nội bộ (orchestrator, ai-service, web)
docker compose build

# Build một service cụ thể
docker compose build orchestrator
docker compose build ai-service
docker compose build web

# Build sạch hoàn toàn không dùng cache (khi thêm package nặng hoặc đổi base image)
docker compose build --no-cache orchestrator
docker compose build --no-cache ai-service

# Khởi động lại đồng thời tự động rebuild nếu có thay đổi code/Dockerfile
docker compose up -d --build

# Bắt buộc tạo lại container (hữu ích khi sửa file volume mapping hoặc config.yml)
docker compose up -d --force-recreate orchestrator
docker compose --profile cv up -d --force-recreate frigate
```

### 2.5. Reset sạch Docker & Dọn dẹp tài nguyên

```powershell
# ⚠️ XÓA SẠCH containers, network VÀ TOÀN BỘ VOLUMES (mất toàn bộ DB, S3 media, MQTT data)
docker compose down -v
docker compose --profile cv down -v

# Xóa các container, image không còn dùng (tiết kiệm ổ cứng)
docker system prune -f

# ⚠️ LỆNH TRIỆT ĐỂ: Xóa sạch toàn bộ cache, image rác và volumes không dùng trên máy
docker system prune -af --volumes
```

---

## 3. CƠ SỞ DỮ LIỆU POSTGRESQL (MIGRATION, RESET & SEED)

### 3.1. Chạy từ máy Host (qua pnpm / node)

Yêu cầu: Container `postgres` đang chạy (`docker compose up -d postgres`) và file `.env` đã có `DATABASE_URL`.

```powershell
# 1. Chạy các file migration mới chưa áp dụng (db/migrations/*.sql)
pnpm db:migrate
# Lệnh tương đương trực tiếp bằng node:
node --env-file=.env tools/scripts/migrate.mjs up

# 2. Kiểm tra trạng thái danh sách migration đã chạy / chưa chạy
node --env-file=.env tools/scripts/migrate.mjs status

# 3. Nạp dữ liệu giả lập mẫu (db/seeds/*.sql)
pnpm seed
# Lệnh tương đương trực tiếp bằng node:
node --env-file=.env tools/scripts/seed.mjs

# 4. RESET TOÀN BỘ CSDL: Xóa sạch schema public, áp dụng lại toàn bộ migration và nạp seed
pnpm db:reset
# Lệnh tương đương trực tiếp bằng node:
node --env-file=.env tools/scripts/migrate.mjs reset && pnpm seed

# 5. Chỉ reset schema và chạy lại migrations (KHÔNG nạp seed)
node --env-file=.env tools/scripts/migrate.mjs reset
```

### 3.2. Chạy bên trong Docker Container

Sử dụng khi máy host chưa cài Node.js / `pg` package hoặc muốn đảm bảo môi trường mạng nội bộ Docker:

```powershell
# Chạy migration bên trong container Orchestrator
docker compose exec orchestrator sh -lc "cd /workspace && pnpm db:migrate"

# Chạy seed bên trong container Orchestrator
docker compose exec orchestrator sh -lc "cd /workspace && pnpm seed"

# Reset và nạp seed bên trong container Orchestrator
docker compose exec orchestrator sh -lc "cd /workspace && pnpm db:reset"

# Reset CSDL bằng cách xóa sạch Volume của PostgreSQL rồi dựng lại từ đầu
docker compose down -v
docker compose up -d postgres
```

### 3.3. Thao tác trực tiếp qua psql CLI

Truy cập trực tiếp vào CSDL bên trong container `postgres` (User: `camerai`, Database: `camerai`):

```powershell
# 1. Mở cửa sổ dòng lệnh psql tương tác trực tiếp
docker compose exec -it postgres psql -U camerai -d camerai

# 2. Liệt kê toàn bộ các bảng trong CSDL
docker compose exec postgres psql -U camerai -d camerai -c "\dt"

# 3. Xem cấu trúc chi tiết của một bảng cụ thể (ví dụ: events, users, cameras)
docker compose exec postgres psql -U camerai -d camerai -c "\d+ events"
docker compose exec postgres psql -U camerai -d camerai -c "\d+ escalation_rules"
docker compose exec postgres psql -U camerai -d camerai -c "\d+ event_confirmations"

# 4. Xem lịch sử các file migration đã được áp dụng
docker compose exec postgres psql -U camerai -d camerai -c "SELECT * FROM schema_migrations ORDER BY applied_at;"

# 5. Chạy thủ công một file SQL đơn lẻ từ thư mục docker-entrypoint-initdb.d
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U camerai -d camerai -f /docker-entrypoint-initdb.d/0003_auth_refresh_tokens.sql
```

---

## 4. LỆNH MONOREPO & QUY TRÌNH PHÁT TRIỂN (PNPM WORKSPACE)

### Cài đặt & Khởi chạy tổng thể

```powershell
# Cài đặt toàn bộ dependencies trong workspace
pnpm install

# Khởi động cụm Docker ngầm + chạy song song dev mode cho cả Web và Orchestrator
pnpm dev

# Build toàn bộ packages và applications trong workspace
pnpm build

# Cài đặt lại Husky git hooks
pnpm prepare
```

### Kiểm tra chất lượng mã nguồn (Linter, Formatter, Typecheck)

```powershell
# 1. LỆNH TỔNG HỢP TOÀN DIỆN (CI Checklist):
# Chạy tuần tự: Prettier -> ESLint -> TypeScript -> Tests JS -> Test Tools -> OpenAPI -> Ruff -> Pytest
pnpm check:all

# 2. Kiểm tra và định dạng bằng Prettier
pnpm format            # Tự động sửa format toàn bộ dự án
pnpm format:check      # Chỉ kiểm tra format (không sửa file)

# 3. Kiểm tra ESLint cho toàn bộ TypeScript/JavaScript
pnpm lint              # Kiểm tra linting
pnpm lint:fix          # Tự động sửa các lỗi linting có thể fix

# 4. Kiểm tra kiểu dữ liệu TypeScript (không phát sinh mã biên dịch)
pnpm typecheck

# 5. Chạy toàn bộ Unit Tests JS/TS trong monorepo
pnpm test
pnpm test:cov          # Chạy test kèm báo cáo coverage

# 6. Kiểm tra các test nội bộ của công cụ trong tools/scripts
pnpm test:tools
```

---

## 5. HỢP ĐỒNG API & SINH KIỂU DỮ LIỆU (OPENAPI / CONTRACTS)

Dự án áp dụng triệt để nguyên tắc **Contract-First**: OpenAPI spec là nguồn sự thật duy nhất.

```powershell
# 1. Lint kiểm tra cú pháp và quy chuẩn của OpenAPI Specs
pnpm api:lint

# 2. Mở giao diện xem trước tài liệu API (Redocly preview)
pnpm api:preview

# 3. Sinh mã TypeScript types cho @cam/contracts từ OpenAPI specs
pnpm contracts:generate

# 4. Build package contracts sau khi sinh types mới
pnpm --filter @cam/contracts build

# 5. Chạy Mock Server độc lập dựa trên openapi.yaml (dành cho FE khi chưa có BE)
npx --yes @stoplight/prism-cli mock api/openapi.yaml --port 3001
```

---

## 6. LÀM VIỆC RIÊNG TRÊN TỪNG PHÂN HỆ

### 6.1. Backend Orchestrator (NestJS)

Thư mục: `apps/orchestrator`

```powershell
# Khởi động các hạ tầng phụ trợ cần thiết
docker compose up -d postgres redis mosquitto minio ai-service

# Chạy Orchestrator ở chế độ watch trên máy host
pnpm --filter @cam/orchestrator dev

# Build ứng dụng
pnpm --filter @cam/orchestrator build

# Chạy bản build production
pnpm --filter @cam/orchestrator start:prod

# Kiểm tra code style & types
pnpm --filter @cam/orchestrator lint
pnpm --filter @cam/orchestrator lint:fix
pnpm --filter @cam/orchestrator typecheck

# Chạy Unit Tests
pnpm --filter @cam/orchestrator test
pnpm --filter @cam/orchestrator test:watch
pnpm --filter @cam/orchestrator test:cov

# Chạy Integration Tests (sử dụng Testcontainers cho PostgreSQL)
pnpm --filter @cam/orchestrator test:integration

# Chạy một file integration test cụ thể
pnpm --filter @cam/orchestrator test:integration -- --runInBand telegram-db.integration.spec.ts
pnpm --filter @cam/orchestrator test:integration -- --runInBand ai-results-db.integration.spec.ts
```

### 6.2. Frontend Dashboard (Next.js)

Thư mục: `apps/web`

```powershell
# Khởi động backend và hạ tầng
docker compose up -d postgres mosquitto minio orchestrator

# Chạy giao diện Next.js trên máy host (cổng 3000)
pnpm --filter @cam/web dev

# Build Next.js
pnpm --filter @cam/web build

# Chạy server production của Next.js
pnpm --filter @cam/web start

# Kiểm tra code style & types
pnpm --filter @cam/web lint
pnpm --filter @cam/web lint:fix
pnpm --filter @cam/web typecheck

# Chạy Unit Tests với Vitest
pnpm --filter @cam/web test
pnpm --filter @cam/web test:cov
```

### 6.3. AI Service (FastAPI / Python)

Thư mục: `services/ai-service`

#### Cách 1: Sử dụng bộ script pnpm (Không cần kích hoạt venv)

```powershell
# Thiết lập môi trường ảo và cài dependencies dev
pnpm setup:ai

# Kiểm tra cú pháp và định dạng mã nguồn Python (Ruff)
pnpm lint:ai
pnpm lint:ai:fix
pnpm format:ai
pnpm format:ai:check

# Chạy kiểm thử tự động với Pytest
pnpm test:ai

# Chạy toàn bộ kiểm tra chất lượng của AI Service
pnpm check:ai
```

#### Cách 2: Thao tác trực tiếp với Virtualenv

```powershell
# Chuyển vào thư mục service
cd services/ai-service

# Kích hoạt venv (PowerShell Windows)
.venv\Scripts\Activate.ps1
# (CMD Windows: .venv\Scripts\activate.bat)
# (Git Bash / Linux: source .venv/Scripts/activate hoặc source .venv/bin/activate)

# Chạy FastAPI server trực tiếp với uvicorn (cổng 8000)
uvicorn app.main:app --reload --port 8000

# Cài đặt bổ sung các module nặng tùy nhu cầu:
pip install -e ".[m1]"     # Module M1: Face Recognition + OpenCV
pip install -e ".[m2a]"    # Module M2a: MediaPipe Pose (Té ngã)
pip install -e ".[m3]"     # Module M3: Ultralytics YOLO (Cháy/Khói)
pip install -e ".[aws]"    # AWS Boto3 SDK
pip install -e ".[dev]"    # Công cụ dev (pytest, ruff, mypy)

# Chạy pytest kèm đo độ phủ (coverage)
pytest -v --cov=app --cov-report=term-missing

# Lint và Format bằng Ruff
ruff check --fix .
ruff format .
```

---

## 7. EDGE, FRIGATE, MQTT & GIẢ LẬP RTSP

### 7.1. Cấu hình & Kiểm thử Frigate

```powershell
# 1. Khởi tạo file cấu hình config.yml an toàn từ config.example.yml
pnpm frigate:init

# Ghi đè file cấu hình bằng bản mẫu mới nhất
pnpm frigate:init --force

# 2. Xác thực tính hợp lệ của cấu hình bằng image Frigate chính thức
pnpm frigate:validate

# 3. Khởi động Frigate container (bật profile cv)
docker compose --profile cv up -d frigate

# 4. Kiểm thử nghiệm thu tự động: lắng nghe MQTT sự kiện nhận diện người (US-01, US-02)
pnpm frigate:check
pnpm frigate:check -- --camera cam_test --timeout 300
```

### 7.2. Tương tác MQTT Broker (Mosquitto)

Sử dụng lệnh bên trong container `camerai-mosquitto` (không cần cài MQTT client ngoài máy):

```powershell
# 1. Lắng nghe TOÀN BỘ các topic của Frigate
docker compose exec mosquitto mosquitto_sub -t "frigate/#" -v

# 2. Lắng nghe riêng topic sự kiện (events)
docker compose exec mosquitto mosquitto_sub -t "frigate/events" -v

# 3. Bắn (publish) một bản tin JSON giả lập để kiểm thử Orchestrator Consumer
docker compose exec mosquitto mosquitto_pub -t "frigate/events" -m '{"type":"new","after":{"id":"test-123","camera":"cam_kitchen","label":"person","score":0.85,"current_zones":["restricted_stove"],"frame_time":1726387200.456,"start_time":1726387200.123,"has_snapshot":true}}'
```

### 7.3. Giả lập Camera RTSP (FFmpeg & MediaMTX)

Chạy MediaMTX: `docker compose up -d mediamtx`

#### A. Phát Webcam máy tính thành luồng RTSP (Windows)

```powershell
# Liệt kê danh sách webcam kết nối trên máy
ffmpeg -hide_banner -list_devices true -f dshow -i dummy

# Đẩy luồng webcam lên RTSP MediaMTX (thay đúng tên webcam của bạn)
ffmpeg -hide_banner -f dshow -i video="Tên webcam của bạn" `
  -c:v libx264 -preset ultrafast -tune zerolatency `
  -pix_fmt yuv420p -f rtsp -rtsp_transport tcp `
  rtsp://localhost:8554/cam_living_room
```

#### B. Phát file video MP4 lặp vô hạn (Dùng cho test té ngã, cháy nổ)

```powershell
ffmpeg -re -stream_loop -1 -i datasets/sample_fall.mp4 `
  -c copy -f rtsp rtsp://localhost:8554/cam_test
```

#### C. Xem kiểm tra luồng phát

```powershell
# Xem qua ffplay (mở cửa sổ phát video)
ffplay rtsp://localhost:8554/cam_living_room

# Hoặc mở trực tiếp trên trình duyệt qua WebRTC HTTP:
# http://localhost:8889/cam_living_room
```

---

## 8. KIỂM TRA NHANH & GỠ RỐI LỖI THƯỜNG GẶP (TROUBLESHOOTING)

### 8.1. Kiểm tra trạng thái sức khỏe (Healthchecks)

```powershell
# Orchestrator Health
curl http://localhost:3001/api/v1/health

# AI Service Health
curl http://localhost:8000/health

# MinIO Healthcheck
docker compose exec minio mc ready local

# PostgreSQL Health
docker compose exec postgres pg_isready -U camerai -d camerai
```

### 8.2. Danh sách cổng mặc định (Default Ports)

| Dịch Vụ              | Cổng Cục Bộ | Biến Môi Trường (.env) | URL Truy Cập / Ghi Chú                         |
| :------------------- | :---------- | :--------------------- | :--------------------------------------------- |
| **Web Dashboard**    | `3000`      | `PORT_WEB`             | http://localhost:3000                          |
| **Orchestrator API** | `3001`      | `PORT_ORCHESTRATOR`    | http://localhost:3001/api/docs (Swagger UI)    |
| **AI Service**       | `8000`      | `PORT_AI`              | http://localhost:8000/docs (FastAPI Docs)      |
| **Frigate UI**       | `5000`      | `PORT_FRIGATE`         | http://localhost:5000                          |
| **PostgreSQL**       | `5432`      | `PORT_POSTGRES`        | CSDL chính của hệ thống                        |
| **Redis**            | `6379`      | `PORT_REDIS`           | Queue cho BullMQ                               |
| **Mosquitto MQTT**   | `1883`      | `PORT_MQTT`            | Broker giao tiếp sự kiện                       |
| **MinIO API**        | `9000`      | `PORT_MINIO_API`       | Object Storage API                             |
| **MinIO Console**    | `9001`      | `PORT_MINIO_CONSOLE`   | http://localhost:9001 (User/Pass trong `.env`) |
| **MediaMTX RTSP**    | `8554`      | `PORT_RTSP`            | Luồng nhận / phát RTSP                         |
| **MediaMTX WebRTC**  | `8889`      | `PORT_WEBRTC_HTTP`     | http://localhost:8889/cam_name                 |

### 8.3. Xử lý xung đột cổng trên Windows

Nếu báo lỗi `port is already allocated`:

```powershell
# Tìm PID tiến trình đang chiếm cổng (ví dụ cổng 3001)
netstat -ano | findstr :3001

# Buộc tắt tiến trình gây chiếm dụng
taskkill /PID <PID_tìm_được> /F
```

### 8.4. Xóa sạch và dựng lại môi trường từ đầu (Clean Slate Reset)

Khi gặp xung đột môi trường không rõ nguyên nhân:

```powershell
# 1. Tắt toàn bộ container và xóa toàn bộ volumes dữ liệu
docker compose --profile cv down -v

# 2. Xóa các node_modules bị lỗi cache (nếu cần)
Remove-Item -Recurse -Force node_modules, apps/*/node_modules, packages/*/node_modules

# 3. Cài đặt lại thư viện
pnpm install

# 4. Khởi tạo lại cấu hình Frigate
pnpm frigate:init --force

# 5. Build và khởi động lại toàn bộ
docker compose up -d --build

# 6. Chạy migration và nạp seed dữ liệu mẫu
pnpm db:reset
```

---

## 9. QUY TRÌNH GIT CHUẨN AGILE

```powershell
# 1. Tạo và chuyển sang nhánh tính năng mới theo quy ước
git checkout -b feat/US-XX-ten-tinh-nang

# 2. Kiểm tra chất lượng mã trước khi commit (bắt buộc phải xanh hết)
pnpm check:all

# 3. Thêm file và commit theo chuẩn Conventional Commits
git add .
git commit -m "feat(orchestrator): tóm tắt tính năng ngắn gọn [US-XX]"

# 4. Đẩy nhánh lên Remote Repository và mở Pull Request
git push -u origin feat/US-XX-ten-tinh-nang
```
