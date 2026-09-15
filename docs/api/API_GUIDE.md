# Hợp đồng API — hướng dẫn sử dụng

> **Task 0.4** · Người phụ trách: **A + B** · Sprint 0
> Spec: [`api/openapi.yaml`](../../api/openapi.yaml) (orchestrator) ·
> [`api/openapi-ai-service.yaml`](../../api/openapi-ai-service.yaml) (AI service)

## Mục lục

- [1. Contract-first nghĩa là gì](#1-contract-first-nghĩa-là-gì)
- [2. Bắt đầu nhanh](#2-bắt-đầu-nhanh)
- [3. Quy ước chung](#3-quy-ước-chung)
- [4. Xác thực](#4-xác-thực)
- [5. Danh mục endpoint](#5-danh-mục-endpoint)
- [6. Mã lỗi](#6-mã-lỗi)
- [7. Sinh code từ spec](#7-sinh-code-từ-spec)
- [8. Quy trình thay đổi API](#8-quy-trình-thay-đổi-api)
- [9. Các đoạn gọi mẫu](#9-các-đoạn-gọi-mẫu)

---

## 1. Contract-first nghĩa là gì

Tình huống quen thuộc: A làm frontend, B làm backend. A đợi B xong API mới làm được giao diện.
B xong thì A mới phát hiện tên trường không như mình tưởng. Mất hai ngày.

Contract-first phá vòng lặp đó:

```
        ┌──────────────────────┐
        │   api/openapi.yaml   │   ← A và B cùng chốt TRƯỚC KHI viết code
        └──────────┬───────────┘
                   │
       ┌───────────┴───────────┐
       ▼                       ▼
  A làm Frontend          B làm Backend
  (mock theo spec)        (hiện thực theo spec)
       │                       │
       └───────────┬───────────┘
                   ▼
           Ghép vào → khớp ngay
```

### Ba quy tắc

1. **Spec sửa trước, code sửa sau.** PR đổi endpoint mà không đổi spec sẽ bị từ chối.
2. **Không viết tay kiểu dữ liệu ở frontend.** Chạy `pnpm contracts:generate`.
3. **Spec là tài liệu cho con người, không chỉ cho máy.** Mỗi endpoint có `description`
   giải thích _tại sao_, kèm mã US/FR tương ứng.

---

## 2. Bắt đầu nhanh

```bash
# Kiểm tra spec hợp lệ (CI cũng chạy đúng lệnh này)
pnpm api:lint

# Mở tài liệu tương tác trong trình duyệt
pnpm api:preview

# Sinh kiểu TypeScript cho frontend
pnpm contracts:generate
```

Sau khi `docker compose up`, Swagger UI của orchestrator ở:

```
http://localhost:3001/api/docs
```

---

## 3. Quy ước chung

### Base URL

| Môi trường     | URL                            |
| -------------- | ------------------------------ |
| Dev local      | `http://localhost:3001/api/v1` |
| AWS (Sprint 4) | `https://<host>/api/v1`        |

Version nằm trong đường dẫn (`/v1`). Khi có thay đổi phá vỡ tương thích, tạo `/v2` chứ
không sửa `/v1` — trong phạm vi đồ án thì chuyện này gần như không xảy ra, nhưng để sẵn.

### Định dạng phản hồi

**Danh sách có phân trang:**

```json
{
  "data": [{ "id": "...", "...": "..." }],
  "meta": { "page": 1, "pageSize": 20, "total": 137 }
}
```

**Danh sách không phân trang** (cameras, zones, escalation-rules — luôn ngắn):

```json
{ "data": [{ "...": "..." }] }
```

**Một đối tượng:** trả thẳng đối tượng, không bọc.

**Lỗi:** luôn luôn theo đúng khuôn này, không có ngoại lệ.

```json
{
  "error": {
    "code": "NO_FACE_DETECTED",
    "message": "Không phát hiện được khuôn mặt nào trong ảnh. Hãy chọn ảnh rõ mặt hơn.",
    "details": { "fileName": "me.jpg" },
    "traceId": "0192f8a1-4c2b-7890-a1b2-c3d4e5f6a7b8"
  }
}
```

- `code` — **mã ổn định** để frontend xử lý bằng logic. Không bao giờ đổi.
- `message` — tiếng Việt, hiển thị thẳng được cho người dùng cuối.
- `traceId` — dán vào lệnh tìm log là ra toàn bộ ngữ cảnh (FR-LOG-02).

### Thời gian

ISO-8601 **có múi giờ**, không có ngoại lệ:

```
2026-09-15T14:20:00.456+07:00
```

Không dùng Unix timestamp, không dùng chuỗi không có offset.

### Tên trường

`camelCase` trong JSON, `snake_case` trong database. Tầng repository chịu trách nhiệm
chuyển đổi — controller và service không bao giờ thấy `snake_case`.

| Database         | JSON API       |
| ---------------- | -------------- |
| `event_type`     | `eventType`    |
| `detected_at`    | `detectedAt`   |
| `is_false_alarm` | `isFalseAlarm` |

### Mã trạng thái HTTP

| Mã    | Khi nào dùng                                                   |
| ----- | -------------------------------------------------------------- |
| `200` | Thành công, có nội dung trả về                                 |
| `201` | Đã tạo tài nguyên mới                                          |
| `202` | Đã tiếp nhận, xử lý bất đồng bộ (callback từ AI service)       |
| `204` | Thành công, không có nội dung (DELETE)                         |
| `400` | Dữ liệu gửi lên sai định dạng                                  |
| `401` | Chưa xác thực hoặc token hết hạn                               |
| `403` | Đã xác thực nhưng không đủ quyền                               |
| `404` | Không tìm thấy                                                 |
| `409` | Xung đột (email trùng, sự kiện đã xác nhận)                    |
| `410` | Tài nguyên đã bị xóa theo chính sách lưu trữ                   |
| `422` | Đúng định dạng nhưng không xử lý được (ảnh không có khuôn mặt) |
| `423` | Tài khoản đang bị khóa tạm thời                                |
| `503` | Phụ thuộc bên ngoài không khả dụng (camera offline)            |

---

## 4. Xác thực

### Sprint 1–3: JWT tự cấp

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

- Access token: 1 giờ
- Refresh token: 7 ngày
- Nhận `401` → frontend tự gọi `/auth/refresh` **đúng một lần**, thất bại thì đưa về trang đăng nhập (US-05).

### Sprint 4: đổi sang Cognito (US-25)

**Frontend không phải sửa gì.** Vẫn là `Authorization: Bearer <token>`, chỉ khác ở chỗ
token do Cognito cấp và backend xác thực bằng JWKS của User Pool. Đây là lý do thiết kế
token dạng bearer ngay từ đầu thay vì dùng session cookie.

### Phân quyền theo vai trò (FR-AUT-05)

| Vai trò     | Được làm                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `ADMIN`     | Mọi thứ, bao gồm xem `rtspUrl` và sửa `escalation_rules`                |
| `CAREGIVER` | Xem sự kiện, xác nhận, quản lý người quen. **Không** xem được `rtspUrl` |
| `VIEWER`    | Chỉ đọc. Không xác nhận, không cấu hình                                 |

### Xác thực nội bộ

AI service và webhook không dùng JWT người dùng:

```http
X-Internal-Token: <secret dùng chung trong docker network>
X-Telegram-Bot-Api-Secret-Token: <secret cấu hình khi đăng ký webhook>
```

---

## 5. Danh mục endpoint

### Xác thực

| Method | Path            | US    | Ghi chú                   |
| ------ | --------------- | ----- | ------------------------- |
| POST   | `/auth/login`   | US-05 | Sai 5 lần → `423`         |
| POST   | `/auth/refresh` | US-05 |                           |
| POST   | `/auth/logout`  | US-05 | Thu hồi refresh token     |
| GET    | `/auth/me`      | US-05 | Hồ sơ người dùng hiện tại |

### Thiết bị, camera, vùng

| Method           | Path                           | US                         |
| ---------------- | ------------------------------ | -------------------------- |
| GET/POST         | `/devices`                     | —                          |
| GET/PATCH/DELETE | `/devices/{deviceId}`          | —                          |
| GET/POST         | `/cameras`                     | US-01                      |
| GET/PATCH/DELETE | `/cameras/{cameraId}`          | US-01                      |
| GET              | `/cameras/{cameraId}/snapshot` | US-12 (ảnh nền để vẽ vùng) |
| GET/POST         | `/cameras/{cameraId}/zones`    | US-12                      |
| PATCH/DELETE     | `/zones/{zoneId}`              | US-12                      |

### Người quen

| Method | Path                | US    | Ghi chú                              |
| ------ | ------------------- | ----- | ------------------------------------ |
| GET    | `/known-faces`      | US-09 |                                      |
| POST   | `/known-faces`      | US-09 | `multipart/form-data`, 1–5 ảnh       |
| DELETE | `/known-faces/{id}` | US-09 | **Xóa vĩnh viễn**, không soft-delete |

### Sự kiện — nhóm quan trọng nhất

| Method | Path                         | US           | Ghi chú                         |
| ------ | ---------------------------- | ------------ | ------------------------------- |
| GET    | `/events`                    | US-06, US-21 | Lọc + phân trang                |
| GET    | `/events/stream`             | US-06        | SSE, cập nhật thời gian thực    |
| GET    | `/events/{id}`               | US-21        | Kèm media, AI results, lịch sử  |
| PATCH  | `/events/{id}`               | US-21        | Đánh dấu báo động giả / giữ lại |
| POST   | `/events/{id}/confirm`       | US-13        | "Tôi ổn" / "Cần giúp đỡ"        |
| GET    | `/events/{id}/media`         | US-04        | Presigned URL 15 phút           |
| GET    | `/events/{id}/history`       | US-21        | Lịch sử chuyển trạng thái       |
| GET    | `/events/{id}/notifications` | US-14        | Kênh nào gửi thành công         |
| GET    | `/media/{mediaId}/url`       | US-04        | Sinh lại presigned URL          |

### Cấu hình

| Method       | Path                            | US    |
| ------------ | ------------------------------- | ----- |
| GET          | `/escalation-rules`             | US-15 |
| PUT          | `/escalation-rules/{eventType}` | US-15 |
| GET/POST     | `/wellness-schedules`           | US-20 |
| PATCH/DELETE | `/wellness-schedules/{id}`      | US-20 |
| GET/POST     | `/emergency-contacts`           | US-27 |
| DELETE       | `/emergency-contacts/{id}`      | US-27 |

### Nội bộ

| Method | Path                              | Ai gọi         |
| ------ | --------------------------------- | -------------- |
| POST   | `/internal/events/{id}/ai-result` | AI service     |
| POST   | `/webhooks/telegram`              | Telegram       |
| POST   | `/webhooks/connect`               | Amazon Connect |

---

## 6. Mã lỗi

Frontend nên xử lý bằng `code`, không phải bằng cách so khớp `message`.

| Code                  | HTTP | Ý nghĩa                                 | Frontend nên làm gì                    |
| --------------------- | ---- | --------------------------------------- | -------------------------------------- |
| `INVALID_CREDENTIALS` | 401  | Sai email/mật khẩu                      | Hiện lỗi dưới ô mật khẩu               |
| `TOKEN_EXPIRED`       | 401  | Access token hết hạn                    | Tự refresh một lần                     |
| `ACCOUNT_LOCKED`      | 423  | Khóa tạm 15 phút                        | Hiện thời gian còn lại                 |
| `FORBIDDEN_ROLE`      | 403  | Vai trò không đủ quyền                  | Ẩn nút, không hiện lỗi đỏ              |
| `NOT_FOUND`           | 404  | Không tìm thấy                          | Trang 404 thân thiện                   |
| `EMAIL_EXISTS`        | 409  | Email đã dùng                           | Hiện lỗi dưới ô email                  |
| `ALREADY_CONFIRMED`   | 409  | Sự kiện đã được xử lý                   | "Sự kiện đã được xử lý bởi \<tên\>"    |
| `NO_FACE_DETECTED`    | 422  | Ảnh không có khuôn mặt                  | "Hãy chọn ảnh rõ mặt hơn"              |
| `MULTIPLE_FACES`      | 422  | Ảnh có nhiều khuôn mặt                  | Hiện các khung để người dùng chọn      |
| `INVALID_THRESHOLD`   | 400  | `tLow > tHigh`                          | Hiện lỗi dưới ô nhập                   |
| `INVALID_POLYGON`     | 400  | Đa giác < 3 đỉnh hoặc tọa độ ngoài 0..1 | Không cho lưu vùng                     |
| `MEDIA_EXPIRED`       | 410  | Media đã bị xóa theo chính sách 7 ngày  | "Ảnh đã hết hạn lưu trữ"               |
| `CAMERA_OFFLINE`      | 503  | Không lấy được frame                    | "Camera đang mất kết nối"              |
| `AI_SERVICE_TIMEOUT`  | 503  | AI service không phản hồi trong 5 giây  | Hiện sự kiện với nhãn "chưa phân tích" |

---

## 7. Sinh code từ spec

### Frontend — kiểu TypeScript

```bash
pnpm contracts:generate
```

Sinh ra `packages/contracts/src/generated/orchestrator.ts`. **Không sửa tay file này** —
lần chạy sau sẽ ghi đè.

```typescript
import type { components } from '@cam/contracts/generated/orchestrator';
import { EVENT_TYPES, type EventType } from '@cam/contracts';

type EventSummary = components['schemas']['EventSummary'];
type EscalationRule = components['schemas']['EscalationRule'];

// Enum dùng được ở runtime (để render dropdown) lấy từ @cam/contracts
const options = EVENT_TYPES.map((t) => ({ value: t, label: nhanTiengViet[t] }));
```

### Backend — DTO

NestJS vẫn viết DTO bằng tay để dùng decorator `class-validator`, **nhưng phải khớp với spec**.
`@nestjs/swagger` sinh ngược ra OpenAPI, và có một test đối chiếu để phát hiện lệch:

```typescript
// apps/orchestrator/test/openapi-contract.spec.ts (thêm ở Sprint 1)
it('spec sinh ra từ code khớp với api/openapi.yaml', () => {
  // So sánh danh sách path và tên schema
});
```

### Mock server cho frontend làm trước

Khi backend chưa xong, A vẫn chạy được giao diện:

```bash
npx --yes @stoplight/prism-cli mock api/openapi.yaml --port 3001
```

Prism đọc `examples` trong spec và trả dữ liệu mẫu. Đây là lý do nên viết `examples` đầy đủ.

---

## 8. Quy trình thay đổi API

```
1. Mở issue / thảo luận  →  A và B thống nhất tên trường, kiểu dữ liệu
2. Sửa api/openapi.yaml  →  chạy `pnpm api:lint`
3. Mở PR CHỈ chứa thay đổi spec  →  cả A và B duyệt (CODEOWNERS bắt buộc)
4. Merge spec
5. A và B làm song song trên nhánh riêng
```

### Thay đổi phá vỡ tương thích

Đổi tên trường, xóa trường, đổi kiểu, hoặc biến trường tùy chọn thành bắt buộc — đều là
thay đổi phá vỡ.

Trong phạm vi đồ án, cách xử lý là: **báo trong nhóm chat trước khi merge**, và người bên kia
xác nhận đã biết. Không cần versioning phức tạp, nhưng cũng không được âm thầm đổi rồi để
người khác phát hiện khi CI đỏ.

### Danh sách kiểm tra khi thêm endpoint mới

- [ ] Có `operationId` (đây là tên hàm được sinh ra ở frontend)
- [ ] Có `tags` đúng nhóm
- [ ] Có `summary` ngắn và `description` giải thích _tại sao_, kèm mã US/FR
- [ ] Mô tả đủ mã lỗi, không chỉ trường hợp thành công
- [ ] Endpoint trả danh sách có phân trang nếu có thể dài
- [ ] Có `examples` để mock server dùng được
- [ ] Đã khai `security` (hoặc `security: []` nếu công khai)

---

## 9. Các đoạn gọi mẫu

### Đăng nhập

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@camerai.local","password":"Admin@12345"}'
```

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "expiresIn": 3600,
  "user": { "id": "0192...", "email": "admin@camerai.local", "role": "ADMIN" }
}
```

### Lấy sự kiện có lọc

```bash
curl -G http://localhost:3001/api/v1/events \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'eventType=UNKNOWN_PERSON' \
  --data-urlencode 'eventType=FALL_DETECTED' \
  --data-urlencode 'from=2026-09-15T00:00:00+07:00' \
  --data-urlencode 'page=1' \
  --data-urlencode 'pageSize=20'
```

### Xác nhận sự kiện

```bash
curl -X POST http://localhost:3001/api/v1/events/$EVENT_ID/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"response":"IM_OK","note":"Là chú hàng xóm sang lấy đồ"}'
```

```json
{
  "id": "0192f8b2-...",
  "eventId": "0192f8a1-...",
  "response": "IM_OK",
  "channel": "DASHBOARD",
  "confirmedByName": "Nguyễn Thị Lan",
  "respondedAt": "2026-09-15T14:21:33+07:00",
  "resultingStatus": "RESOLVED"
}
```

Người thứ hai bấm nút sẽ nhận:

```json
{
  "error": {
    "code": "ALREADY_CONFIRMED",
    "message": "Sự kiện đã được xử lý bởi Nguyễn Thị Lan lúc 14:21.",
    "traceId": "0192f8c3-..."
  }
}
```

### Lắng nghe sự kiện thời gian thực (SSE)

```typescript
// EventSource không đặt được header nên token đi qua query
const source = new EventSource(`${API_BASE_URL}/events/stream?token=${accessToken}`);

source.addEventListener('event.created', (e) => {
  const event: EventSummary = JSON.parse(e.data);
  setEvents((prev) => [event, ...prev]); // chèn lên đầu (FR-DSH-02)
});

source.addEventListener('event.updated', (e) => {
  const event: EventSummary = JSON.parse(e.data);
  setEvents((prev) => prev.map((x) => (x.id === event.id ? event : x)));
});

source.onerror = () => {
  // EventSource tự kết nối lại — không cần xử lý gì thêm
};
```

### Đăng ký người quen (multipart)

```bash
curl -X POST http://localhost:3001/api/v1/known-faces \
  -H "Authorization: Bearer $TOKEN" \
  -F 'personName=Bà Hoa' \
  -F 'relationship=Mẹ' \
  -F 'images=@hoa_1.jpg' \
  -F 'images=@hoa_2.jpg'
```

### Sửa ngưỡng cảnh báo

```bash
curl -X PUT http://localhost:3001/api/v1/escalation-rules/FALL_DETECTED \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "priority": "P1",
    "tLow": 0.60,
    "tHigh": 0.80,
    "tWaitSeconds": 45,
    "notifyChannels": ["TELEGRAM", "SNS_EMAIL"]
  }'
```

Thay đổi có hiệu lực trong vòng 60 giây, không cần restart (FR-ADM-02).

---

## Xem tiếp

- [Spec orchestrator](../../api/openapi.yaml)
- [Spec AI service](../../api/openapi-ai-service.yaml)
- [Kiến trúc C4](../architecture/C4_ARCHITECTURE.md)
- [ERD](../database/ERD.md)
- [Quy ước code](../conventions/CODING_CONVENTION.md)
