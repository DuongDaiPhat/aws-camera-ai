# CameraAI — Hệ thống camera giám sát hành vi ứng dụng AI và AWS

> Đồ án môn Project 1 · 5 sinh viên · 30 ngày · Agile/Scrum

Hệ thống giám sát an toàn tại nhà: tự động phát hiện tình huống nguy hiểm bằng AI,
cảnh báo theo cấp độ, và leo thang lên cuộc gọi khẩn khi không ai phản hồi.

**Mục tiêu:** giảm thời gian từ lúc sự cố xảy ra đến lúc có người can thiệp xuống dưới 3 phút.

---

## Chạy thử trong 3 lệnh

```bash
cp .env.example .env
docker compose up -d
docker compose ps
```

| Địa chỉ                        | Là gì           |
| ------------------------------ | --------------- |
| http://localhost:3000          | Dashboard       |
| http://localhost:3001/api/docs | Swagger UI      |
| http://localhost:8000/docs     | AI service docs |
| http://localhost:9001          | MinIO Console   |

Hướng dẫn đầy đủ (yêu cầu phần cứng, gỡ rối, giả lập camera RTSP):
**[docs/DEV_ONBOARDING.md](docs/DEV_ONBOARDING.md)**

---

## Tài liệu

Toàn bộ mục lục: **[docs/README.md](docs/README.md)**

|                                                                          |                                              |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| 🏗️ [Kiến trúc C4](docs/architecture/C4_ARCHITECTURE.md)                  | Hệ thống gồm những gì, vì sao chia như vậy   |
| 🔄 [Luồng dữ liệu](docs/architecture/DATA_FLOW.md)                       | Dữ liệu chảy thế nào, kèm payload thật       |
| 🗄️ [ERD](docs/database/ERD.md)                                           | 14 bảng, giải thích từng quyết định thiết kế |
| 🔌 [Hợp đồng API](docs/api/API_GUIDE.md)                                 | Contract-first, mã lỗi, ví dụ gọi            |
| 🛠️ [Cài đặt môi trường](docs/DEV_ONBOARDING.md)                          | Từ máy trắng đến chạy được                   |
| ✍️ [Quy ước code](docs/conventions/CODING_CONVENTION.md)                 | Đặt tên, log, test, comment                  |
| 🌿 [Quy trình Git](docs/conventions/GIT_WORKFLOW.md)                     | Nhánh, commit, PR, review                    |
| 📋 [Kế hoạch Agile](docs/KE_HOACH_AGILE_CameraAI_AWS.md)                 | 5 sprint, MoSCoW, rủi ro                     |
| 📝 [Backlog & User Story](docs/Roadmap_Backlog_UserStory_FR_CameraAI.md) | 38 story, yêu cầu chức năng                  |

---

## Kiến trúc tóm tắt

```
Webcam ─ffmpeg→ mediamtx ─RTSP→ Frigate ─MQTT→ Orchestrator (NestJS)
                                                    ├→ PostgreSQL       (nguồn sự thật)
                                                    ├→ MinIO / S3       (ảnh, clip)
                                                    ├→ AI Service       (FastAPI: face, pose, fire)
                                                    └→ Telegram / SNS / Connect
                                                              ↑
                                                    Dashboard (Next.js)
```

**Nguyên tắc cốt lõi:** mọi dịch vụ AWS nằm sau một interface (`IStorageService`,
`IFaceService`, `INotificationService`). Đổi provider = đổi một biến môi trường,
không sửa business logic — và unit test chạy được mà không cần credential AWS.

---

## Năm module AI

| Module  | Chức năng                                           | Ưu tiên | Sprint |
| ------- | --------------------------------------------------- | ------- | ------ |
| **M1**  | Nhận diện người lạ (face recognition → Rekognition) | MUST    | 2      |
| **M2a** | Phát hiện té ngã (MediaPipe Pose + ngưỡng bất động) | SHOULD  | 3      |
| **M3**  | Phát hiện cháy/khói (YOLO pretrained)               | SHOULD  | 3      |
| **M4**  | Vùng cấm (Frigate zone)                             | MUST    | 2      |
| **M5**  | Wellness check (scheduler, không dùng CV)           | MUST    | 3      |

Module 2c (nhận diện đánh nhau, RWF-2000) **nằm ngoài phạm vi 30 ngày** — xem mục
Hướng phát triển trong kế hoạch.

---

## Cơ chế leo thang cảnh báo

```
DETECTED ──confidence < T_low──────────→ LOGGED_ONLY   (chỉ ghi log)
    │
    └────confidence ≥ T_low────────────→ NOTIFIED
                                            ├─ "✅ Tôi ổn"      → RESOLVED
                                            ├─ "🆘 Cần giúp đỡ" → ESCALATED
                                            └─ hết T_wait       → ESCALATED → CLOSED
```

| Loại sự kiện     | Ưu tiên | T_wait   |
| ---------------- | ------- | -------- |
| Cháy / khói      | P0      | 30 giây  |
| Té ngã           | P1      | 60 giây  |
| Vùng cấm         | P1      | 60 giây  |
| Người lạ         | P2      | 120 giây |
| Wellness timeout | P2      | 300 giây |

Mọi tham số đều cấu hình được qua API, không hard-code.

---

## Công nghệ

| Lớp      | Công nghệ                                               |
| -------- | ------------------------------------------------------- |
| Edge     | mediamtx · ffmpeg · Frigate · Mosquitto (MQTT)          |
| Backend  | NestJS 10 · TypeScript · PostgreSQL 16                  |
| AI       | FastAPI · MediaPipe · YOLO · face_recognition           |
| Frontend | Next.js 14 · React 18                                   |
| Lưu trữ  | MinIO (dev) → Amazon S3 (prod)                          |
| AWS      | S3 · Rekognition · Cognito · SNS · Connect · CloudWatch |
| DevOps   | Docker Compose · GitHub Actions · pnpm workspace        |

---

## Trạng thái dự án

| Sprint       | Ngày  | Mục tiêu                             | Trạng thái  |
| ------------ | ----- | ------------------------------------ | ----------- |
| **Sprint 0** | 1–3   | Khởi tạo: thiết kế, monorepo, CI     | 🔵 Đang làm |
| Sprint 1     | 4–10  | Walking skeleton: luồng E2E thông    | ⬜          |
| Sprint 2     | 11–17 | Nhận diện người lạ + escalation      | ⬜          |
| Sprint 3     | 18–24 | Té ngã + cháy/khói, có số đo P/R/FAR | ⬜          |
| Sprint 4     | 25–30 | Lên AWS, hardening, bàn giao         | ⬜          |

### Sprint 0 — chi tiết

| #   | Việc                                      | Người    | Trạng thái |
| --- | ----------------------------------------- | -------- | ---------- |
| 0.1 | Vision, User Story Map, Product Backlog   | A + nhóm | ✅         |
| 0.2 | Sơ đồ kiến trúc C4 + luồng dữ liệu        | B        | ✅         |
| 0.3 | Thiết kế ERD                              | B        | ✅         |
| 0.4 | OpenAPI spec (contract-first)             | A, B     | ✅         |
| 0.5 | Monorepo + docker-compose + CI            | C        | ✅         |
| 0.6 | mediamtx + ffmpeg giả lập RTSP            | C        | ⬜         |
| 0.7 | **Thu thập bộ dữ liệu test** (đường găng) | E, D     | ⬜         |
| 0.8 | AWS account, IAM, Budget Alert $10, MFA   | C        | ⬜         |
| 0.9 | Coding convention, quy trình Git, mẫu PR  | B        | ✅         |

---

## Nhóm

| Ký hiệu | Vai trò        | Phụ trách                                         | Vai trò Scrum |
| ------- | -------------- | ------------------------------------------------- | ------------- |
| **A**   | Team Lead      | Frontend Next.js                                  | Product Owner |
| **B**   | Backend Lead   | NestJS, PostgreSQL, escalation engine             | Scrum Master  |
| **C**   | Infra/DevOps   | Frigate, Docker, CI/CD, AWS                       | —             |
| **D**   | AI Engineer #1 | Module 1 (face), Module 3 (fire)                  | —             |
| **E**   | AI Engineer #2 | Module 2a (fall), Module 5 (wellness), đo metrics | —             |

Mỗi người có một backup: A↔B (web), D↔E (AI), C↔B (hạ tầng).
**Cấm merge PR của chính mình.**

---

## Đóng góp

Đọc [quy trình Git](docs/conventions/GIT_WORKFLOW.md) và
[quy ước code](docs/conventions/CODING_CONVENTION.md) trước khi mở PR đầu tiên.

```bash
git checkout -b feat/US-XX-mo-ta-ngan
# ... làm việc, commit theo Conventional Commits
pnpm lint && pnpm typecheck && pnpm test
git push -u origin feat/US-XX-mo-ta-ngan
# Mở PR, điền mẫu, chờ 1 approve + CI xanh
```

---

## Quyền riêng tư và giới hạn

Hệ thống xử lý dữ liệu sinh trắc học và hình ảnh trong nhà riêng:

- Chỉ giám sát **trong nhà riêng**, có sự đồng ý của người sống trong nhà.
  Không hướng camera ra không gian công cộng.
- Chỉ lưu **face embedding** (vector), không lưu ảnh gốc dài hạn. Cho phép xóa hoàn toàn.
- Media tự xóa sau **7 ngày**, trừ sự kiện được đánh dấu giữ lại.
- Đối chiếu **Nghị định 13/2023/NĐ-CP** về bảo vệ dữ liệu cá nhân.

> **Giới hạn:** đây là công cụ hỗ trợ, **không thay thế thiết bị y tế hay dịch vụ cứu hộ**.
> Báo động giả và bỏ sót đều có thể xảy ra.

---

## Giấy phép

Dự án học tập trong khuôn khổ môn Project 1.
