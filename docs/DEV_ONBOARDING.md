# Hướng dẫn cài đặt môi trường phát triển

> **Task 0.5** · Người phụ trách: **C** (Infra/DevOps) · Sprint 0
> Mục tiêu Sprint 0: mọi thành viên `git clone` + `docker compose up` là chạy được khung rỗng.

## Mục lục

- [1. Cần cài gì](#1-cần-cài-gì)
- [2. Chạy lần đầu](#2-chạy-lần-đầu)
- [3. Cấu trúc monorepo](#3-cấu-trúc-monorepo)
- [4. Các cổng dịch vụ](#4-các-cổng-dịch-vụ)
- [5. Lệnh hay dùng](#5-lệnh-hay-dùng)
- [6. Làm việc trên từng phần](#6-làm-việc-trên-từng-phần)
- [7. Giả lập camera RTSP](#7-giả-lập-camera-rtsp)
- [8. Gỡ rối](#8-gỡ-rối)
- [9. Việc còn lại của Sprint 0](#9-việc-còn-lại-của-sprint-0)

---

## 1. Cần cài gì

| Công cụ            | Phiên bản | Kiểm tra           | Ghi chú                       |
| ------------------ | --------- | ------------------ | ----------------------------- |
| **Docker Desktop** | 24+       | `docker --version` | Bật WSL2 backend trên Windows |
| **Node.js**        | 22 LTS    | `node --version`   | Nên dùng `nvm` / `fnm`        |
| **pnpm**           | 9+        | `pnpm --version`   | `corepack enable` là có       |
| **Python**         | 3.11+     | `python --version` | Chỉ cần nếu làm AI service    |
| **Git**            | 2.40+     | `git --version`    |                               |
| **ffmpeg**         | bất kỳ    | `ffmpeg -version`  | Để giả lập RTSP (task 0.6)    |

### Cài nhanh trên Windows

```powershell
winget install Docker.DockerDesktop
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.11
winget install Git.Git
winget install Gyan.FFmpeg

# Bật pnpm qua corepack (đi kèm Node)
corepack enable
corepack prepare pnpm@9 --activate
```

### Cấu hình Git bắt buộc (Windows)

```bash
git config --global core.autocrlf input
git config --global core.eol lf
git config --global pull.rebase true
git config --global user.email "email-github-cua-ban@example.com"
```

Chi tiết và lý do: [GIT_WORKFLOW.md § 10](conventions/GIT_WORKFLOW.md#10-windows-và-crlf).

### Yêu cầu phần cứng

|              | Tối thiểu | Nên có |
| ------------ | --------- | ------ |
| RAM          | 8 GB      | 16 GB  |
| Ổ cứng trống | 15 GB     | 30 GB  |
| CPU          | 4 nhân    | 8 nhân |

> **Máy 8 GB RAM:** chạy `docker compose up` bình thường (không có Frigate). Frigate nằm
> sau profile `cv` và chỉ bật khi cần — xem [mục 6](#6-làm-việc-trên-từng-phần).

---

## 2. Chạy lần đầu

```bash
# 1. Clone
git clone <url-repo>
cd aws-camera-ai

# 2. Tạo file cấu hình từ mẫu
cp .env.example .env            # Windows CMD: copy .env.example .env

# 3. Khởi động hạ tầng
docker compose up -d

# 4. Chờ mọi container healthy (~60 giây lần đầu vì phải tải image)
docker compose ps
```

Mong đợi:

```
NAME                    STATUS
camerai-postgres        Up (healthy)
camerai-mosquitto       Up (healthy)
camerai-minio           Up (healthy)
camerai-mediamtx        Up
camerai-ai              Up (healthy)
camerai-orchestrator    Up (healthy)
camerai-web             Up
```

### Kiểm tra từng dịch vụ

```bash
curl http://localhost:3001/api/v1/health     # Orchestrator
curl http://localhost:8000/health            # AI service
```

Mở trình duyệt:

| Địa chỉ                        | Là gì                                          |
| ------------------------------ | ---------------------------------------------- |
| http://localhost:3000          | Dashboard                                      |
| http://localhost:3001/api/docs | Swagger UI                                     |
| http://localhost:9001          | MinIO Console (`minioadmin` / `minioadmin123`) |
| http://localhost:8000/docs     | FastAPI docs                                   |

### Cài dependency để code trên máy (ngoài Docker)

```bash
pnpm install
pnpm setup:ai
```

`pnpm setup:ai` tự tạo `services/ai-service/.venv` và cài dependency Python.
Chạy được ở mọi shell (PowerShell, CMD, Git Bash, macOS, Linux).

### Kiểm tra tất cả chạy được

```bash
pnpm check:all
```

Một lệnh chạy hết: Prettier → ESLint → TypeScript → test JS → OpenAPI → ruff → pytest.
Tất cả xanh nghĩa là môi trường của bạn khớp với CI.

Muốn chạy riêng từng phần:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm api:lint   # phần JS/TS
pnpm check:ai                                               # phần Python (AI service)
```

> **Vì sao không gõ thẳng `ruff` và `pytest`?**
> Hai công cụ này chỉ tồn tại **bên trong venv**, không có trên PATH toàn cục.
> Gõ `cd services/ai-service && ruff check .` mà chưa activate venv sẽ báo
> `ruff: command not found` / `'ruff' is not recognized`.
> Các script `pnpm *:ai` tự tìm Python trong venv nên không cần activate.

<details>
<summary>Nếu bạn vẫn muốn activate venv thủ công</summary>

Lệnh activate **khác nhau theo shell** — đây là chỗ hay nhầm nhất:

| Shell                              | Lệnh                            |
| ---------------------------------- | ------------------------------- |
| PowerShell (mặc định trên Windows) | `.venv\Scripts\Activate.ps1`    |
| CMD                                | `.venv\Scripts\activate.bat`    |
| Git Bash (Windows)                 | `source .venv/Scripts/activate` |
| macOS / Linux                      | `source .venv/bin/activate`     |

```powershell
cd services/ai-service
.venv\Scripts\Activate.ps1
ruff check . ; pytest
```

PowerShell chặn script thì chạy một lần:
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

Nhớ rằng activate chỉ có tác dụng **trong terminal hiện tại** — mở tab mới là phải
activate lại. Đây chính là lý do nên dùng `pnpm check:ai`.

</details>

---

## 3. Cấu trúc monorepo

```
aws-camera-ai/
├── apps/
│   ├── orchestrator/          # NestJS — bộ não hệ thống (B)
│   └── web/                   # Next.js — dashboard (A)
├── services/
│   └── ai-service/            # FastAPI — M1 face, M2a pose, M3 fire (D, E)
├── packages/
│   ├── contracts/             # Kiểu dữ liệu chung FE/BE, sinh từ OpenAPI
│   └── eslint-config/         # Cấu hình ESLint dùng chung
├── api/
│   ├── openapi.yaml           # ⭐ Hợp đồng API orchestrator
│   └── openapi-ai-service.yaml
├── db/
│   ├── migrations/            # DDL — chạy tự động khi Postgres khởi tạo
│   └── seeds/                 # Dữ liệu demo (US-07)
├── infra/
│   ├── frigate/               # Cấu hình Frigate (C)
│   ├── mediamtx/              # Giả lập RTSP
│   ├── mosquitto/             # MQTT broker
│   └── minio/                 # Script tạo bucket + lifecycle
├── tools/scripts/             # Script tiện ích
├── docs/                      # 📖 Toàn bộ tài liệu
├── .github/
│   ├── workflows/ci.yml       # CI pipeline
│   ├── pull_request_template.md
│   └── CODEOWNERS
├── docker-compose.yml
└── .env.example
```

### Vì sao monorepo

| Vấn đề với nhiều repo                            | Monorepo giải quyết thế nào                |
| ------------------------------------------------ | ------------------------------------------ |
| Đổi API phải mở 3 PR ở 3 repo, merge đúng thứ tự | Một PR sửa cả spec + backend + frontend    |
| Kiểu dữ liệu FE/BE lệch nhau âm thầm             | `packages/contracts` là một nguồn duy nhất |
| Mỗi repo một CI, cấu hình khác nhau              | Một pipeline kiểm tra toàn bộ              |
| Người mới phải clone 3 chỗ                       | Một lệnh `git clone`                       |

Đánh đổi: CI chạy lâu hơn một chút vì kiểm tra cả repo mỗi lần. Với quy mô này, không đáng kể.

---

## 4. Các cổng dịch vụ

| Dịch vụ               | Cổng | Đổi ở đâu               |
| --------------------- | ---- | ----------------------- |
| Dashboard (Next.js)   | 3000 | `PORT_WEB` trong `.env` |
| Orchestrator (NestJS) | 3001 | `PORT_ORCHESTRATOR`     |
| AI service (FastAPI)  | 8000 | `PORT_AI`               |
| Frigate UI            | 5000 | `PORT_FRIGATE`          |
| PostgreSQL            | 5432 | `PORT_POSTGRES`         |
| MQTT                  | 1883 | `PORT_MQTT`             |
| MinIO API             | 9000 | `PORT_MINIO_API`        |
| MinIO Console         | 9001 | `PORT_MINIO_CONSOLE`    |
| RTSP (mediamtx)       | 8554 | `PORT_RTSP`             |

> **Trùng cổng?** Sửa `PORT_*` trong `.env` của bạn — đừng sửa `docker-compose.yml`,
> vì file đó dùng chung cho cả nhóm.

---

## 5. Lệnh hay dùng

### Docker

```bash
docker compose up -d                    # khởi động nền
docker compose --profile cv up -d       # khởi động kèm Frigate
docker compose ps                       # trạng thái
docker compose logs -f orchestrator     # xem log một service
docker compose restart orchestrator     # khởi động lại
docker compose down                     # dừng (giữ dữ liệu)
docker compose down -v                  # dừng + XÓA SẠCH dữ liệu
docker compose build --no-cache orchestrator
```

### Node / pnpm

```bash
pnpm install                                    # cài toàn workspace
pnpm --filter @cam/orchestrator dev             # chạy một package
pnpm --filter @cam/orchestrator test --watch
pnpm -r lint                                    # lint mọi package
pnpm contracts:generate                         # sinh kiểu từ OpenAPI
pnpm format                                     # Prettier tự sửa
```

### Python

```bash
cd services/ai-service
source .venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
pytest -v
ruff check --fix . && ruff format .
```

### Database

```bash
# Vào psql
docker compose exec postgres psql -U camerai -d camerai

# Liệt kê bảng
docker compose exec postgres psql -U camerai -d camerai -c '\dt'

# Xem cấu trúc một bảng
docker compose exec postgres psql -U camerai -d camerai -c '\d+ events'

# Reset sạch và chạy lại migration
docker compose down -v && docker compose up -d postgres
```

### MQTT

```bash
# Nghe mọi message (rất hữu ích khi gỡ lỗi US-03)
docker compose exec mosquitto mosquitto_sub -t 'frigate/#' -v

# Bắn message giả để test consumer mà không cần Frigate
docker compose exec mosquitto mosquitto_pub -t 'frigate/events' -m '{
  "type":"new",
  "after":{
    "id":"test-123",
    "camera":"cam_kitchen",
    "label":"person",
    "score":0.85,
    "current_zones":["restricted_stove"],
    "frame_time":1726387200.456,
    "start_time":1726387200.123,
    "has_snapshot":true
  }
}'
```

> Mẹo này cho phép B làm US-03 (MQTT → DB) **mà không cần đợi** C dựng xong Frigate.

---

## 6. Làm việc trên từng phần

### A — Frontend (Next.js)

```bash
docker compose up -d postgres mosquitto minio orchestrator
cd apps/web && pnpm dev
```

Backend chưa xong? Chạy mock server theo spec:

```bash
npx --yes @stoplight/prism-cli mock api/openapi.yaml --port 3001
```

### B — Backend (NestJS)

```bash
docker compose up -d postgres mosquitto minio ai-service
cd apps/orchestrator && pnpm dev
```

Bắn message MQTT giả để test consumer — xem lệnh ở [mục 5](#5-lệnh-hay-dùng).

### C — Hạ tầng và Frigate

```bash
# Tạo cấu hình Frigate riêng cho máy mình (file này bị gitignore)
cp infra/frigate/config.example.yml infra/frigate/config.yml

docker compose --profile cv up -d
docker compose logs -f frigate
```

Frigate UI: http://localhost:5000

> **Máy yếu?** Trong `config.yml` hạ `fps` xuống 5 và chỉ bật một camera (rủi ro R4).
> Detector CPU chạy được mọi máy nhưng chậm; máy có CPU Intel gen 6+ thì thử `openvino`.

### D, E — AI service

```bash
docker compose up -d postgres mosquitto minio
cd services/ai-service
source .venv/Scripts/activate
uvicorn app.main:app --reload
```

Thư viện nặng cài riêng theo module, không nằm trong base:

```bash
pip install -e ".[m1]"     # face_recognition + opencv  (D)
pip install -e ".[m2a]"    # mediapipe                  (E)
pip install -e ".[m3]"     # ultralytics YOLO           (D)
pip install -e ".[aws]"    # boto3 — Sprint 4
```

> Mỗi module một file router riêng (`app/routers/face.py`, `pose.py`, `fire.py`)
> nên D và E hầu như không gặp xung đột merge.

---

## 7. Giả lập camera RTSP

Task 0.6 — cho phép cả nhóm dev mà không cần camera IP thật.

### Đẩy webcam thành luồng RTSP

```bash
# Windows — liệt kê thiết bị
ffmpeg -list_devices true -f dshow -i dummy

# Đẩy webcam lên mediamtx
ffmpeg -f dshow -i video="Tên webcam của bạn" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -f rtsp rtsp://localhost:8554/cam_living_room
```

```bash
# Linux
ffmpeg -f v4l2 -i /dev/video0 -c:v libx264 -preset ultrafast \
  -tune zerolatency -f rtsp rtsp://localhost:8554/cam_living_room

# macOS
ffmpeg -f avfoundation -i "0" -c:v libx264 -preset ultrafast \
  -tune zerolatency -f rtsp rtsp://localhost:8554/cam_living_room
```

### Phát file video lặp vô hạn

Cách này quan trọng cho Sprint 3 — phát video té ngã / cháy từ dataset:

```bash
ffmpeg -re -stream_loop -1 -i fall_01.mp4 -c copy \
  -f rtsp rtsp://localhost:8554/cam_test
```

### Xem thử luồng

```bash
ffplay rtsp://localhost:8554/cam_living_room
```

Hoặc mở WebRTC trong trình duyệt: http://localhost:8889/cam_living_room

---

## 8. Gỡ rối

### `pull access denied for minio/mc` hoặc `minio/minio`

**Không phải lỗi máy bạn.** MinIO đã ngừng publish image lên Docker Hub; registry
chính thức bây giờ là `quay.io`. `docker-compose.yml` đã trỏ đúng:

```yaml
image: quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
image: quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z
```

Nếu vẫn gặp lỗi này, bạn đang dùng bản `docker-compose.yml` cũ — `git pull` là xong.

> **Vì sao ghim tag thay vì dùng `latest`:** chính sự cố này là ví dụ. Image `latest`
> đổi dưới chân cả nhóm mà không ai gây ra thay đổi nào. Ngoài ra bản MinIO community
> sau giữa 2025 đã bắt đầu cắt bớt giao diện web — ghim tag giữ cho MinIO Console ở
> cổng 9001 vẫn dùng được suốt kỳ đồ án. Muốn nâng phiên bản thì nâng có chủ đích,
> trong một PR riêng, và chạy thử lại `docker compose up` trước khi merge.

### `docker compose up` báo "port is already allocated"

```bash
# Windows — tìm tiến trình đang giữ cổng
netstat -ano | findstr :3001
taskkill /PID <pid> /F
```

Hoặc đơn giản hơn: đổi `PORT_*` trong `.env` của bạn.

### Container "unhealthy" hoặc restart liên tục

```bash
docker compose logs --tail=100 <tên-service>
```

Nguyên nhân hay gặp:

- Thiếu `.env` → `cp .env.example .env`
- Postgres chưa sẵn sàng → chờ thêm 30 giây, healthcheck sẽ tự xử lý
- Sửa `docker-compose.yml` mà chưa build lại → `docker compose up -d --build`

### Migration không chạy

Migration chỉ chạy **khi volume Postgres trống**. Đã có dữ liệu thì phải xóa volume:

```bash
docker compose down -v
docker compose up -d postgres
docker compose logs postgres | grep -i "0001_init"
```

### `pnpm install` lỗi trên Windows

- Đường dẫn quá dài → đặt repo gần gốc ổ đĩa (`D:\dev\aws-camera-ai`)
- `EPERM` → đóng VS Code và mọi terminal đang mở trong thư mục, chạy lại
- Sai phiên bản Node → `node --version` phải là 22.x

### AI service báo thiếu thư viện

Base image cố ý không cài thư viện CV nặng. Cài theo module:

```bash
pip install -e ".[m1]"
```

Trong Docker thì thêm vào `services/ai-service/requirements.txt` rồi
`docker compose build ai-service`.

### Frigate không thấy luồng camera

1. `ffplay rtsp://localhost:8554/cam_living_room` — luồng có sống không?
2. Trong `config.yml`, host phải là `mediamtx` (tên service), **không phải** `localhost` —
   bên trong container, `localhost` là chính container đó.
3. `docker compose logs frigate | grep -i error`

### Dashboard không gọi được API

1. `curl http://localhost:3001/api/v1/health` — orchestrator sống không?
2. `NEXT_PUBLIC_API_BASE_URL` trong `.env` đúng chưa?
3. Mở DevTools → Console, xem có lỗi CORS không.

### Làm lại từ đầu (khi mọi thứ rối)

```bash
docker compose down -v
docker system prune -af --volumes    # ⚠️ xóa MỌI thứ Docker trên máy, không chỉ dự án này
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
cp .env.example .env
docker compose up -d --build
```

---

## 9. Việc còn lại của Sprint 0

Những task này **không** nằm trong phạm vi công việc đã làm ở tài liệu này:

| #   | Việc                                             | Người    | Trạng thái                                                     |
| --- | ------------------------------------------------ | -------- | -------------------------------------------------------------- |
| 0.1 | Chốt Vision, User Story Map, Product Backlog     | A + nhóm | ✅ Đã có trong `docs/Roadmap_Backlog_UserStory_FR_CameraAI.md` |
| 0.6 | Dựng mediamtx + ffmpeg giả lập RTSP              | C        | ⬜ Cấu hình đã sẵn, cần chạy thử trên máy thật                 |
| 0.7 | **Thu thập bộ dữ liệu test**                     | E, D     | ⬜ **Nằm trên đường găng — bắt đầu ngay**                      |
| 0.8 | Tạo AWS account, IAM user, Budget Alert $10, MFA | C        | ⬜                                                             |

### Nhắc lại về task 0.7 (hay bị quên và làm hỏng tiến độ tuần 3)

| Module    | Nguồn dữ liệu                                                    | Yêu cầu                        |
| --------- | ---------------------------------------------------------------- | ------------------------------ |
| Té ngã    | UR Fall Detection, Le2i Fall Detection (công khai)               | ≥ 30 clip dương + ≥ 30 clip âm |
| Cháy/khói | D-Fire, FireNet — **tuyệt đối không tự tạo lửa để quay**         | ≥ 30 clip dương + ≥ 30 clip âm |
| Người lạ  | Nhóm tự quay: người đã enroll + người lạ, ≥ 3 điều kiện ánh sáng | ≥ 30 clip dương + ≥ 30 clip âm |

> Dataset **không commit vào git** (`.gitignore` đã chặn `datasets/` và `*.mp4`).
> Lưu trên Google Drive dùng chung, ghi link vào `docs/` để cả nhóm tải.

### Cấu hình GitHub cần làm một lần

- [ ] Bật branch protection cho `main` — xem [GIT_WORKFLOW.md § 7](conventions/GIT_WORKFLOW.md#7-bảo-vệ-nhánh-main)
- [ ] Thay `@A-username`… trong [`.github/CODEOWNERS`](../.github/CODEOWNERS) bằng tài khoản GitHub thật
- [ ] Tạo GitHub Project với 6 cột `Backlog → Ready → In Progress → In Review → Testing → Done`
- [ ] Chỉ bật **Squash and merge**, tắt hai lựa chọn còn lại

---

## Xem tiếp

- [Kiến trúc C4](architecture/C4_ARCHITECTURE.md)
- [ERD](database/ERD.md)
- [Hợp đồng API](api/API_GUIDE.md)
- [Quy ước code](conventions/CODING_CONVENTION.md)
- [Quy trình Git](conventions/GIT_WORKFLOW.md)
