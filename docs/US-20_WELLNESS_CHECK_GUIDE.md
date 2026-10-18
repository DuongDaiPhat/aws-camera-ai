# Hướng dẫn Kiểm thử và Tổng quan Chức năng Nhánh US-20 (Wellness Check)

> **Cập nhật bản sửa 18/10/2026:** dùng [hướng dẫn manual US20 và Telegram](test/US20_FIX_2026-10-18/MANUAL_US20_TELEGRAM.md) cho nhánh `fix/US-20-wellness-check`. Các ví dụ seed, observation và SQL bên dưới thuộc phiên bản cũ: không dùng để chèn run/SENT hoặc kết luận E2E PASS. Lịch mới phải đặt giờ tương lai; deadline bắt đầu từ lần gửi thành công đầu tiên; face-only chưa đủ bằng chứng hoạt động.

> Tài liệu này mô tả chi tiết chức năng và quy trình kiểm thử cho nhánh `feat/US-20-wellness-check` (User Story 20 — M5: Wellness check định kỳ, cảnh báo quá hạn).

---

## 1. Nhánh này làm được gì? (Tổng quan Chức năng)

Nhánh `feat/US-20-wellness-check` giải quyết bài toán: **Người thân ở nhà một mình, camera không thấy bất thường (không ngã, không cháy) nhưng thực tế người đó có thể gặp sự cố (bất tỉnh, đột quỵ trong phòng kín, v.v.)**.

Hệ thống bổ sung cơ chế kiểm tra định kỳ theo lịch (ví dụ 09:00 sáng và 18:00 chiều) để đảm bảo người được giám sát vẫn an toàn và phản hồi kịp thời.

### Các khối chức năng chính:

1. **Quản lý lịch kiểm tra (Wellness Schedules CRUD)**:
   - **Phân quyền chặt chẽ**: Chỉ `CAREGIVER` hoặc `ADMIN` của hộ gia đình mới có quyền tạo, sửa, xóa mềm (soft-delete) lịch. Người được giám sát (`VIEWER`) chỉ có thể xem lịch của chính mình.
   - **Cấu hình chi tiết**: Giờ kiểm tra (`checkAt`: HH:mm), các ngày trong tuần (`daysOfWeek`: 1–7), múi giờ (`timezone`, mặc định `Asia/Ho_Chi_Minh`), khoảng thời gian nhìn lại (`lookbackHours`, mặc định 6 giờ), thời gian chờ phản hồi (`graceSeconds`, 300 giây = 5 phút), danh sách camera áp dụng.
   - **Chống trùng lặp**: Ngăn chặn tạo 2 lịch cùng giờ cho một người trong cùng hộ gia đình (trả về `409 Conflict`).

2. **Dịch vụ Scheduler tự động (Wellness Scheduler Service)**:
   - Chạy nền chu kỳ `5000ms`, dùng **PostgreSQL lease token** và **row lock (`FOR UPDATE SKIP LOCKED`)** đảm bảo chạy an toàn trong môi trường nhiều instance, không bao giờ bị race condition.
   - **Sinh lượt kiểm tra (Materialize Occurrence)**: Đúng giờ hẹn, tự động sinh bản ghi trong `wellness_check_runs`.
   - **Đánh giá thông minh (Evaluation Engine)**:
     - **Bỏ qua khi vắng nhà (`SKIPPED_AWAY`)**: Nếu hệ thống camera Module 1 ghi nhận người đó đã rời nhà (`DEPARTURE` hợp lệ), scheduler sẽ ghi nhận `SKIPPED_AWAY`, không làm phiền và không tạo cảnh báo giả.
     - **Ghi nhận đã hoạt động (`VERIFIED_ACTIVE`)**: Trong cửa sổ lookback (ví dụ 6 tiếng trước giờ hẹn), nếu phát hiện camera ghi nhận chuyển động hoặc nhận diện đúng khuôn mặt người đó (`KNOWN face`), scheduler ghi nhận an toàn và kết thúc lượt kiểm tra.
     - **Phát hiện không có hoạt động (`NO_ACTIVITY`)**: Khi không có bất kỳ bằng chứng hoạt động nào của đúng người đó, hệ thống lập tức tạo sự kiện `WELLNESS_TIMEOUT`, nguồn `SCHEDULER`, mức ưu tiên **P2**, đồng thời gửi thông báo yêu cầu người được giám sát xác nhận.

3. **Cơ chế xác nhận 2 chiều và Tự động leo thang (Confirmation & Escalation)**:
   - **Chính chủ xác nhận**: Chỉ tài khoản của người được giám sát (`residentUserId`, JWT claim `sub == resident_user_id`) mới được bấm xác nhận.
   - **Xác nhận "Tôi ổn" (`IM_OK`)**: Nếu bấm trước deadline 5 phút (300s), sự kiện chuyển sang `RESOLVED`, lưu lịch sử và hủy bỏ tiến trình leo thang.
   - **Xác nhận "Cần giúp đỡ" (`NEED_HELP`)**: Lập tức chuyển sự kiện sang `ESCALATED`, gửi cảnh báo khẩn cấp tới Caregiver.
   - **Quá hạn 5 phút (Deadline Expired)**: Nếu hết 5 phút mà người đó không phản hồi, scheduler tự động chuyển trạng thái sự kiện sang `ESCALATED` và bắn thông báo Telegram tới Caregiver của hộ.
   - **Idempotency**: Đảm bảo gửi lại cùng `commandId` sẽ trả về kết quả ban đầu, không tạo bản ghi trùng lặp.

4. **Tiếp nhận dữ liệu quan sát nội bộ (Internal Observations)**:
   - Endpoint nội bộ `POST /api/v1/internal/wellness-observations` (bảo vệ bằng `X-Internal-Token`, `@Public()`) tiếp nhận metadata quan sát (`MOTION`, `ARRIVAL`, `DEPARTURE`) từ pipeline camera Module 1 để cập nhật trạng thái hiện diện (`HOME` / `AWAY`).

---

## 2. Danh sách API Endpoint được thêm mới

> **Base URL Backend**: `http://localhost:3001/api/v1`  
> **Swagger UI Documentation**: `http://localhost:3001/api/docs`

| Phương thức | Đường dẫn API                              | Xác thực / Quyền               | Mục đích                                                     |
| ----------- | ------------------------------------------ | ------------------------------ | ------------------------------------------------------------ |
| `GET`       | `/api/v1/wellness-schedules`               | Bearer JWT                     | Lấy danh sách lịch kiểm tra theo hộ / cá nhân                |
| `POST`      | `/api/v1/wellness-schedules`               | Bearer JWT (Caregiver / Admin) | Tạo lịch kiểm tra định kỳ mới                                |
| `PATCH`     | `/api/v1/wellness-schedules/:scheduleId`   | Bearer JWT (Caregiver / Admin) | Cập nhật cấu hình lịch                                       |
| `DELETE`    | `/api/v1/wellness-schedules/:scheduleId`   | Bearer JWT (Caregiver / Admin) | Xóa mềm lịch kiểm tra                                        |
| `GET`       | `/api/v1/wellness-checks`                  | Bearer JWT                     | Xem lịch sử các lượt kiểm tra và trạng thái hiện tại         |
| `POST`      | `/api/v1/wellness-checks/:checkId/confirm` | Bearer JWT (Resident VIEWER)   | Xác nhận "Tôi ổn" (`IM_OK`) hoặc "Cần giúp đỡ" (`NEED_HELP`) |
| `POST`      | `/api/v1/internal/wellness-observations`   | Header `X-Internal-Token`      | Nhận bằng chứng chuyển động/vào/ra từ camera Module 1        |

---

## 3. Hướng dẫn Chạy Automated Tests (Unit Tests)

Toàn bộ logic nghiệp vụ (Controller, Service, Scheduler) đã được bao phủ bởi bộ unit test Jest độc lập với mock repository.

### 3.1. Chạy từng file test chuyên biệt

Mở terminal tại thư mục gốc dự án và chạy:

```bash
# 1. Test nghiệp vụ logic chính: CRUD lịch, xác nhận IM_OK, timeout, idempotency
pnpm --filter @cam/orchestrator exec jest test/wellness.service.spec.ts --runInBand

# 2. Test bộ lập lịch tự động: Materialize, kiểm tra AWAY, phát hiện chuyển động, leo thang 5 phút
pnpm --filter @cam/orchestrator exec jest test/wellness-scheduler.service.spec.ts --runInBand

# 3. Test HTTP Controller và định dạng phản hồi Swagger
pnpm --filter @cam/orchestrator exec jest test/wellness.controller.spec.ts --runInBand
```

### 3.2. Chạy toàn bộ các test case liên quan đến Wellness

```bash
pnpm --filter @cam/orchestrator exec jest test/wellness --runInBand
```

**Kết quả mong đợi:**

- `test/wellness.service.spec.ts`: 12/12 passed.
- `test/wellness-scheduler.service.spec.ts`: 4/4 passed.
- `test/wellness.controller.spec.ts`: 4/4 passed.
- Tổng cộng: **20 tests passed**, 0 errors.

---

## 4. Hướng dẫn Test Thủ công / E2E (Manual Testing Flow)

### Thông tin Môi trường & Tài khoản mẫu

- **Giao diện Web**: [http://localhost:3000](http://localhost:3000)
- **Swagger API Docs**: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
- **Token nội bộ dev (`INTERNAL_SERVICE_TOKEN`)**: `dev-internal-token-change-me-at-least-32`
- **Tài khoản Caregiver/Admin mẫu (trong seed DB)**:
  - Email: `caregiver@camerai.local` (hoặc `admin@camerai.local`)
  - Mật khẩu: `Admin@12345`
  - User ID: `00000000-0000-0000-0000-000000000002` (Caregiver) hoặc `11111111-1111-4111-8111-111111111111` (Admin)

> 💡 **Lưu ý khi chạy với Docker Compose**:
> Nếu Orchestrator đang chạy trong container Docker và bạn có chỉnh sửa mã nguồn, hãy khởi động lại container để tải code mới nhất:
>
> ```bash
> docker restart camerai-orchestrator
> ```
>
> Trên trình duyệt Swagger, nhấn **`Ctrl + F5`** để làm mới cache giao diện Swagger.

---

### Bước 1: Lấy Token xác thực trên Swagger

Hệ thống có 2 nhóm quyền khi test Wellness:

- **Caregiver / Admin (`admin@camerai.local` hoặc `caregiver@camerai.local`)**: Dùng để tạo, xem, cập nhật, xóa lịch (`wellness-schedules`).
- **Resident (`resident@camerai.local`)**: **Bắt buộc dùng tài khoản này** khi test xác nhận "Tôi ổn" (`POST /wellness-checks/:checkId/confirm`).

**Cách lấy và dán Token vào Swagger:**

1. Mở [http://localhost:3001/api/docs](http://localhost:3001/api/docs).
2. Tìm đến endpoint: `POST /api/v1/auth/login` $\rightarrow$ bấm **Try it out**.
3. Điền body đăng nhập (chọn tài khoản tùy theo endpoint bạn chuẩn bị test):
   ```json
   {
     "email": "admin@camerai.local",
     "password": "Admin@12345"
   }
   ```
   _(Để test xác nhận confirm của người nhà, đăng nhập với `email: "resident@camerai.local"`, cùng mật khẩu `Admin@12345`)_.
4. Bấm **Execute** $\rightarrow$ Copy chuỗi `accessToken` trong JSON phản hồi.
5. Kéo lên góc trên bên phải trang Swagger, bấm nút **Authorize** (hình ổ khóa màu xanh lá), dán chuỗi token vào ô `Value` rồi bấm **Authorize** $\rightarrow$ **Close**.

> 💡 **Phân biệt "Server response" vs "Bảng mô tả mã lỗi Swagger":**
>
> - Khi bấm **Execute**, hãy nhìn vào khung **`Server response`** (mã `Code: 200` hoặc `201` kèm `Response body`). Đó mới là kết quả thực tế của server!
> - Các dòng mô tả mã HTTP ở dưới cùng (ví dụ `201 Lịch đã tạo thành công`, `400 Bad Request`) chỉ là **bảng tài liệu của Swagger**, không phản ánh lệnh của bạn đã chạy thành công hay chưa.

---

### Bước 2: Tạo lịch kiểm tra Wellness (Caregiver / Admin)

Tại Swagger, tìm đến `POST /api/v1/wellness-schedules` $\rightarrow$ bấm **Try it out**.

Dán JSON mẫu sau:

```json
{
  "residentUserId": "22222222-2222-4222-8222-222222222222",
  "name": "Kiểm tra sức khỏe ông nội",
  "checkAt": "21:40",
  "daysOfWeek": [1, 2, 3, 4, 5, 6, 7],
  "lookbackHours": 6,
  "graceSeconds": 300,
  "cameraIds": [],
  "timezone": "Asia/Ho_Chi_Minh",
  "isEnabled": true
}
```

> ⚠️ **Lưu ý các trường:**
>
> - `cameraIds`: Để mảng rỗng `[]` để hệ thống tự động theo dõi trên **tất cả camera** của nhà. Không nhập chuỗi sai chuẩn UUID.
> - `checkAt`: Đặt giờ kiểm tra (HH:mm). Khi test thực tế, bạn có thể đặt bằng giờ hiện tại hoặc trước đó vài phút để scheduler kích hoạt ngay lập tức.
> - `residentUserId`: ID tài khoản người được giám sát (`22222222-2222-4222-8222-222222222222` = Ông Nội).

_Kết quả thành công:_ Khung `Server response` trả về **`Code: 201`** kèm thông tin lịch và ID lịch vừa tạo (`id`).

---

### Bước 3: Xem danh sách lịch và quản lý lịch

- **`GET /api/v1/wellness-schedules`**:
  - Bấm **Try it out** $\rightarrow$ **Execute**.
  - Trả về danh sách tất cả lịch đang hoạt động.
- **`PATCH /api/v1/wellness-schedules/{scheduleId}`**:
  - Dùng `id` lấy từ API GET để cập nhật tên lịch, giờ kiểm tra hoặc bật/tắt `isEnabled`.
- **`DELETE /api/v1/wellness-schedules/{scheduleId}`**:
  - Xóa mềm lịch (vẫn lưu lại toàn bộ lịch sử các lượt kiểm tra trước đó để đối soát).

---

### Bước 4: Lấy `checkId` và kiểm thử các Kịch bản Scheduler

> **❓ `checkId` lấy ở đâu?**
> `checkId` chính là `id` của một lượt kiểm tra trong bảng `wellness_check_runs`.
>
> 1. Mở endpoint `GET /api/v1/wellness-checks` $\rightarrow$ Bấm **Try it out** $\rightarrow$ **Execute**.
> 2. Copy trường `"id"` trong mảng `data` trả về.
>
> _Nếu `data` rỗng (`[]`):_ Là do chưa có lịch nào đến hạn kiểm tra. Bạn có thể:
>
> - Tạo lịch ở Bước 2 với `checkAt` là giờ hiện tại để scheduler tự sinh.
> - **Hoặc tạo nhanh 1 bản ghi test** bằng lệnh terminal sau:
>
> ```bash
> docker exec -it camerai-postgres psql -U camerai -d camerai -c "
> DO \$\$
> DECLARE v_event_id uuid; v_run_id uuid := '55555555-5555-4555-8555-555555555555';
> BEGIN
>   INSERT INTO events (event_type, status, priority, source, detected_at, notified_at, wellness_owner_user_id, wellness_resident_user_id, zone_name, escalation_deadline_at)
>   VALUES ('WELLNESS_TIMEOUT', 'NOTIFIED', 'P2', 'SCHEDULER', now(), now(), '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Kiểm tra định kỳ', now() + interval '300 seconds')
>   RETURNING id INTO v_event_id;
>   INSERT INTO wellness_check_runs (id, schedule_id, owner_user_id, resident_user_id, local_date, scheduled_for, status, event_id, request_sent_at, confirmation_deadline_at, grace_seconds, available_at, schedule_snapshot)
>   VALUES (v_run_id, gen_random_uuid(), '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', CURRENT_DATE, now(), 'ALERT_CREATED', v_event_id, now(), now() + interval '300 seconds', 300, now(), '{}'::jsonb)
>   ON CONFLICT (id) DO UPDATE SET event_id = v_event_id, request_sent_at = now(), confirmation_deadline_at = now() + interval '300 seconds';
> END \$\$;"
> ```
>
> _(Khi dùng lệnh này, `checkId` của bạn là: `55555555-5555-4555-8555-555555555555`)_.

---

#### Kịch bản A: Người nhà đã rời khỏi nhà (AWAY) — Không báo động sai

Mục tiêu: Đảm bảo scheduler không báo động giả khi người đó đã đi ra ngoài.

> **📌 Quy tắc `observationId` — Phải đọc trước khi test:**
>
> - Mỗi `observationId` là **UUID dùng một lần duy nhất** (cơ chế idempotency).
> - Nếu bạn gửi **lại đúng `observationId` + đúng payload** đã gửi trước đó, hệ thống sẽ trả về `"status": "DUPLICATE"` — đây là **hành vi đúng và có chủ ý**, không phải lỗi.
> - Nếu bạn gửi lại **cùng `observationId` nhưng khác payload** → trả về `409 Conflict`.
> - **Để test một lần mới**: Thay `observationId` bằng một UUID khác (ví dụ đổi cụm cuối: `...-444444444401` → `...-444444444402`).

1. Trên Swagger, tìm đến endpoint nội bộ: `POST /api/v1/internal/wellness-observations` $\rightarrow$ bấm **Try it out**.
2. Điền header:
   - **`X-Internal-Token`**: `dev-internal-token-change-me-at-least-32`
3. Điền request body:
   ```json
   {
     "observationId": "33333333-3333-4333-8333-444444444401",
     "ownerUserId": "11111111-1111-4111-8111-111111111111",
     "residentUserId": "22222222-2222-4222-8222-222222222222",
     "sourceSessionId": "sess-1",
     "trackId": "trk-1",
     "kind": "DEPARTURE",
     "observedAt": "2026-10-16T08:30:00.000Z",
     "directionalEvidence": {
       "boundaryId": "door_front",
       "direction": "EXIT",
       "policyVersion": "v1"
     }
   }
   ```
4. Bấm **Execute**.
   - Kết quả đúng lần đầu: `"status": "ACCEPTED", "presenceUpdated": true`.
   - Gửi lại lần 2: `"status": "DUPLICATE", "presenceUpdated": false` (đúng chuẩn idempotency).
5. Kiểm tra log của orchestrator:
   ```bash
   docker logs --tail 30 camerai-orchestrator
   ```
   Scheduler sẽ log: `Bỏ qua kiểm tra wellness: Người nhà đã rời khỏi nhà (AWAY)`. Trạng thái chuyển thành `SKIPPED_AWAY`.

---

#### Kịch bản B: Không có hoạt động trong 6 giờ $\rightarrow$ Phát cảnh báo P2

1. Để trống không gửi bất kỳ quan sát nào của người này trong vòng 6 giờ qua.
2. Đến giờ kiểm tra, scheduler kích hoạt:
   - Log: `Phát hiện không có hoạt động cho resident=... Tạo sự kiện WELLNESS_TIMEOUT (P2)`.
   - Tạo sự kiện với `event_type = WELLNESS_TIMEOUT`, `priority = P2`.
   - Thiết lập thời hạn 5 phút xác nhận (`confirmation_deadline_at = now() + 300s`).
   - Trên Web Dashboard ([http://localhost:3000](http://localhost:3000)), sự kiện nhảy lên đầu danh sách với nhãn **"Bất động quá thời gian"**.
3. Gọi `GET /api/v1/wellness-checks` $\rightarrow$ Thấy check có `status = ALERT_CREATED` và lấy được `checkId`.

---

#### Kịch bản C: Người được giám sát bấm "Tôi ổn" (`IM_OK`)

> 🚨 **QUAN TRỌNG VỀ XÁC THỰC:**
> Điểm cuối này chỉ cho phép **chính người được giám sát** xác nhận.
> Trước khi thực hiện, bạn phải:
>
> 1. Gọi `POST /api/v1/auth/login` với `email: "resident@camerai.local"`, `password: "Admin@12345"`.
> 2. Lấy `accessToken` của resident dán lại vào nút **Authorize** trên Swagger.
>    _(Nếu giữ nguyên token của Admin/Caregiver bấm sẽ nhận lỗi `403 Forbidden`!)_

Gửi yêu cầu tại: `POST /api/v1/wellness-checks/{checkId}/confirm`

1. Điền `{checkId}` vào path parameter (ví dụ `55555555-5555-4555-8555-555555555555` hoặc lấy từ Bước 4).
2. Request body:
   ```json
   {
     "commandId": "44444444-4444-4444-8444-444444444444",
     "response": "IM_OK",
     "note": "Con vừa ngủ dậy, con ổn ạ"
   }
   ```
3. Bấm **Execute**.

_Kết quả:_

- `Server response`: `Code: 200 OK` kèm thông tin xác nhận.
- Sự kiện trên Web Dashboard chuyển sang trạng thái `RESOLVED`.
- Tiến trình leo thang bị hủy bỏ, Caregiver không bị làm phiền.

---

#### Kịch bản D: Quá hạn 5 phút không phản hồi $\rightarrow$ Tự động Leo thang (Escalation)

1. Giả lập một lượt kiểm tra phát sinh nhưng Resident không bấm xác nhận.
2. Sau 5 phút (300 giây), scheduler chu kỳ tiếp theo quét và phát hiện:
   - Log: `Sự kiện wellness ... đã hết 5 phút mà người nhà không xác nhận. Tự động ESCALATE tới Caregiver!`.
   - Sự kiện chuyển sang trạng thái `ESCALATED`.
   - Hệ thống tự động tạo bản ghi thông báo trong bảng `notifications` với kênh `TELEGRAM` gửi tới Caregiver của hộ.

---

## 5. Danh sách File thay đổi trong nhánh

- **Contracts / DTOs**:
  - `apps/orchestrator/src/wellness/dto/create-wellness-schedule.dto.ts`
  - `apps/orchestrator/src/wellness/dto/update-wellness-schedule.dto.ts`
  - `apps/orchestrator/src/wellness/dto/list-wellness-schedules-query.dto.ts`
  - `apps/orchestrator/src/wellness/dto/list-wellness-checks-query.dto.ts`
  - `apps/orchestrator/src/wellness/dto/confirm-wellness-check.dto.ts`
  - `apps/orchestrator/src/wellness/dto/wellness-observation.dto.ts`
  - `apps/orchestrator/src/wellness/dto/index.ts`
- **Core Implementation**:
  - `apps/orchestrator/src/wellness/wellness.types.ts`
  - `apps/orchestrator/src/wellness/wellness.controller.ts`
  - `apps/orchestrator/src/wellness/wellness.service.ts`
  - `apps/orchestrator/src/wellness/wellness-scheduler.service.ts`
  - `apps/orchestrator/src/wellness/wellness.repository.ts`
  - `apps/orchestrator/src/wellness/wellness.module.ts`
  - `apps/orchestrator/src/app.module.ts` (đăng ký WellnessModule)
- **Unit Tests**:
  - `apps/orchestrator/test/wellness.service.spec.ts`
  - `apps/orchestrator/test/wellness-scheduler.service.spec.ts`
  - `apps/orchestrator/test/wellness.controller.spec.ts`
