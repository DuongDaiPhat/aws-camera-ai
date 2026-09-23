# Tài liệu dự án CameraAI

Mục lục toàn bộ tài liệu. Bắt đầu từ [Hướng dẫn cài đặt](DEV_ONBOARDING.md) nếu bạn là
người mới vào dự án.

## Plan thực thi cho AI Agent

Mỗi tính năng có một plan riêng; các file mô tả công việc cần làm, không xác nhận tính năng đã triển khai.

- [Giao diện Camera, nguồn phát và Debug View](<Plan Giao diện Camera.md>)
- [US-09 — Đăng ký khuôn mặt người quen](US_09_FACE_REGISTER.md)
- [US-10 — Crop person và so khớp người quen](PLAN_US-10_PERSON_CROP_FACE_MATCH.md)
- [US-11 — Gắn nhãn AI, confidence và tổng hợp ưu tiên](PLAN_US-11_EVENT_AI_LABELS.md)
- [US-12 — Cấu hình vùng theo camera](PLAN_US_12_ZONE_CONFIGURATION.md)
- [US-13 — Escalation state machine](PLAN_US-13_ESCALATION_STATE_MACHINE.md)
- [US-14 — Cảnh báo Telegram](PLAN_US-14_TELEGRAM_ALERTS.md)
- [US-15 — Cấu hình ngưỡng confidence và thời gian chờ](PLAN_US-15_ESCALATION_RULE_SETTINGS.md)
- [Kế hoạch tích hợp và phân công Agile cho 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md)

Khi các plan đề xuất trùng module hoặc hạ tầng, dùng quyết định ownership và thứ tự tích hợp trong kế hoạch 5 thành viên. Có thể kiểm thử từng module bằng adapter/fixture; nghiệm thu end-to-end phải dùng các thành phần thật mà acceptance criteria yêu cầu.

---

## Đọc theo thứ tự nào

### Người mới vào nhóm (30 phút đầu tiên)

1. [DEV_ONBOARDING.md](DEV_ONBOARDING.md) — cài môi trường, chạy được hệ thống
2. [C4_ARCHITECTURE.md § C2](architecture/C4_ARCHITECTURE.md#2-c2--container) — hệ thống gồm những gì
3. [GIT_WORKFLOW.md](conventions/GIT_WORKFLOW.md) — cách làm việc chung
4. [CODING_CONVENTION.md](conventions/CODING_CONVENTION.md) — quy ước viết code

### Trước khi nhận task đầu tiên

5. [Roadmap_Backlog_UserStory_FR_CameraAI.md](Roadmap_Backlog_UserStory_FR_CameraAI.md) — tìm user story của bạn
6. [DATA_FLOW.md](architecture/DATA_FLOW.md) — dữ liệu chảy thế nào
7. [API_GUIDE.md](api/API_GUIDE.md) — hợp đồng API
8. [ERD.md](database/ERD.md) — cấu trúc dữ liệu

---

## Danh mục tài liệu

### Kế hoạch và yêu cầu

| Tài liệu                                                                             | Nội dung                                                                     | Task |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---- |
| [KE_HOACH_AGILE_CameraAI_AWS.md](KE_HOACH_AGILE_CameraAI_AWS.md)                     | Kế hoạch SDLC Agile/Scrum 30 ngày, MoSCoW, phân công, rủi ro                 | —    |
| [Roadmap_Backlog_UserStory_FR_CameraAI.md](Roadmap_Backlog_UserStory_FR_CameraAI.md) | Roadmap, Product Backlog, 38 user story, yêu cầu chức năng, ma trận truy vết | 0.1  |

### Thiết kế

| Tài liệu                                                           | Nội dung                                                   | Task | Người |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ---- | ----- |
| [architecture/C4_ARCHITECTURE.md](architecture/C4_ARCHITECTURE.md) | Sơ đồ C1/C2/C3, kiến trúc AWS, state machine, ADR          | 0.2  | B     |
| [architecture/DATA_FLOW.md](architecture/DATA_FLOW.md)             | 6 luồng dữ liệu, payload thật, ngân sách độ trễ, xử lý lỗi | 0.2  | B     |
| [database/ERD.md](database/ERD.md)                                 | ERD 14 bảng, giải thích từng cột, chỉ mục, truy vấn mẫu    | 0.3  | B     |
| [api/API_GUIDE.md](api/API_GUIDE.md)                               | Contract-first, quy ước, mã lỗi, ví dụ gọi API             | 0.4  | A, B  |

### Quy trình

| Tài liệu                                                             | Nội dung                                                     | Task         | Người |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | ------------ | ----- |
| [DEV_ONBOARDING.md](DEV_ONBOARDING.md)                               | Cài đặt môi trường, cấu trúc monorepo, lệnh hay dùng, gỡ rối | 0.5          | C     |
| [FFMPEG_MEDIAMTX_SETUP.md](FFMPEG_MEDIAMTX_SETUP.md)                 | Phát webcam / file video thành luồng RTSP qua MediaMTX       | 0.6          | C     |
| [FRIGATE_MQTT_SETUP.md](FRIGATE_MQTT_SETUP.md)                       | Frigate phát hiện người, sự kiện MQTT, tự kết nối lại        | US-01, US-02 | C     |
| [MQTT_VISUAL_TEST.md](MQTT_VISUAL_TEST.md)                           | Kiểm thử trực quan: Debug View Frigate, xem/bắn message MQTT | US-01, US-02 | C     |
| [conventions/CODING_CONVENTION.md](conventions/CODING_CONVENTION.md) | Đặt tên, quy ước TS/Python/SQL, log, test, comment           | 0.9          | B     |
| [conventions/GIT_WORKFLOW.md](conventions/GIT_WORKFLOW.md)           | Mô hình nhánh, commit message, PR, review, xử lý xung đột    | 0.9          | B     |

---

## Tài nguyên thực thi (không phải tài liệu)

| Đường dẫn                                                                                         | Là gì                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`api/openapi.yaml`](../api/openapi.yaml)                                                         | ⭐ Hợp đồng API orchestrator — **nguồn sự thật**  |
| [`api/openapi-ai-service.yaml`](../api/openapi-ai-service.yaml)                                   | Hợp đồng API AI service                           |
| [`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql)                                   | DDL khởi tạo — **nguồn sự thật về schema**        |
| [`db/migrations/0002_seed_escalation_rules.sql`](../db/migrations/0002_seed_escalation_rules.sql) | Giá trị mặc định cho ngưỡng cảnh báo              |
| [`docker-compose.yml`](../docker-compose.yml)                                                     | Môi trường dev đầy đủ                             |
| [`.env.example`](../.env.example)                                                                 | Mẫu cấu hình — mọi biến môi trường đều khai ở đây |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)                                         | CI pipeline                                       |
| [`.github/pull_request_template.md`](../.github/pull_request_template.md)                         | Mẫu PR kiêm checklist DoD                         |
| [`.github/CODEOWNERS`](../.github/CODEOWNERS)                                                     | Tự động gán người review                          |

---

## Nguồn sự thật — khi tài liệu mâu thuẫn nhau

Thứ tự ưu tiên khi hai nơi nói khác nhau:

| Chủ đề                         | Nguồn sự thật                                   |
| ------------------------------ | ----------------------------------------------- |
| Cấu trúc database              | `db/migrations/*.sql`                           |
| Hợp đồng API                   | `api/openapi.yaml`                              |
| Cấu hình môi trường            | `.env.example`                                  |
| Kiến trúc và ranh giới service | `docs/architecture/C4_ARCHITECTURE.md`          |
| Phạm vi và ưu tiên             | `docs/KE_HOACH_AGILE_CameraAI_AWS.md`           |
| Yêu cầu chức năng              | `docs/Roadmap_Backlog_UserStory_FR_CameraAI.md` |

Phát hiện mâu thuẫn thì **sửa ngay trong PR đang làm**, đừng để đó. Tài liệu sai còn tệ
hơn không có tài liệu.

---

## Ba nơi phải đồng bộ khi đổi ENUM

```
db/migrations/*.sql  ←→  packages/contracts/src/enums.ts  ←→  api/openapi.yaml
```

Đây là một mục bắt buộc trong [mẫu PR](../.github/pull_request_template.md).
