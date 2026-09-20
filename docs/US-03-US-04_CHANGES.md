# Nhánh `feat/US-04-event-media-storage` — Tóm tắt thay đổi & hướng dẫn kiểm thử trực quan

> Phạm vi: **US-03** (Orchestrator subscribe MQTT, ghi sự kiện vào bảng `events`) và
> **US-04** (lưu snapshot/clip vào object storage, trả presigned URL).
> Nền tảng Frigate/MQTT (US-01, US-02) đã merge ở PR #3 — xem [FRIGATE_MQTT_SETUP.md](FRIGATE_MQTT_SETUP.md).

## Mục lục

1. [Tóm tắt thay đổi](#1-tóm-tắt-thay-đổi)
2. [Luồng dữ liệu](#2-luồng-dữ-liệu)
3. [Chuẩn bị](#3-chuẩn-bị)
4. [Kịch bản A — dùng message giả (không cần Frigate)](#4-kịch-bản-a--dùng-message-giả-không-cần-frigate)
5. [Kịch bản B — end-to-end với Frigate thật](#5-kịch-bản-b--end-to-end-với-frigate-thật)
6. [Kiểm tra API presigned URL](#6-kiểm-tra-api-presigned-url)
7. [Unit test](#7-unit-test)
8. [Checklist nghiệm thu](#8-checklist-nghiệm-thu)

---

## 1. Tóm tắt thay đổi

### US-03 — Ingestion MQTT → bảng `events`

| File                                                       | Nội dung                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/orchestrator/src/database/database.module.t`s`       | Provider `PG_POOL` (pg `Pool`), đọc `DATABASE_URL` hoặc các biến `POSTGRES_*`.                  |
| `apps/orchestrator/src/ingestion/dto/frigate-event.dto.ts` | DTO + validate payload `frigate/events` (`type`, `after.id`, `camera`, `label`, `frame_time`…). |
| `apps/orchestrator/src/ingestion/mqtt-consumer.service.ts` | Kết nối broker (`MQTT_URL`), subscribe `MQTT_TOPIC_FRIGATE` (mặc định `frigate/events`).        |
| `apps/orchestrator/src/events/events.repository.ts`        | Tra camera/zone theo slug, `INSERT` vào `events` với `ON CONFLICT` theo `dedup_key`.            |

Quy tắc xử lý:

- Message không phải JSON / thiếu trường bắt buộc → log **dead-letter** (warn), bỏ qua, không crash.
- `type = new` → tạo sự kiện. Có `current_zones` → `RESTRICTED_ZONE` / **P1**; không có → `PERSON_DETECTED` / **P3**.
- `dedup_key = {camera}:{track_id}:{event_type}:{floor(frame_time/10)}` → cùng track trong cửa sổ 10 s không bị ghi trùng.
- Camera chưa có trong DB (hoặc disabled) → vẫn ghi sự kiện với `camera_id = null`.

### US-04 — Media lên MinIO/S3 + presigned URL

| File                                                     | Nội dung                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/orchestrator/src/storage/storage.interface.ts`     | Interface `IStorageService` (`upload`, `getPresignedUrl`) + token `STORAGE_SERVICE`.   |
| `apps/orchestrator/src/storage/minio-storage.service.ts` | Triển khai MinIO (S3 SDK, `forcePathStyle`).                                           |
| `apps/orchestrator/src/storage/s3-storage.service.ts`    | Triển khai AWS S3.                                                                     |
| `apps/orchestrator/src/storage/storage.module.ts`        | Chọn provider theo `STORAGE_PROVIDER=minio\|s3`.                                       |
| `apps/orchestrator/src/media/media.service.ts`           | Tải `snapshot.jpg` / `clip.mp4` từ Frigate API, upload, ghi bảng `event_media`.        |
| `apps/orchestrator/src/media/event-media.repository.ts`  | CRUD bảng `event_media`, tra event theo id / track_id.                                 |
| `apps/orchestrator/src/media/media.controller.ts`        | `GET /api/v1/events/:eventId/media` → danh sách media kèm URL hết hạn sau **15 phút**. |

Quy tắc:

- Sự kiện mới có `has_snapshot = true` → tải snapshot (bất đồng bộ, không chặn ingestion).
- Message `type = end` có `has_clip = true` **và** sự kiện là **P0/P1** → tải clip, lưu `duration_ms = (end_time − start_time)`.
- Object key: `events/{yyyy}/{mm}/{dd}/{event_id}/snapshot.jpg | clip.mp4` (theo ngày UTC).
- Frigate trả lỗi / không có media → log warn, trả `null`, không ảnh hưởng bản ghi `events`.
- `eventId` không phải UUID → **400**; không tồn tại → **404**.

### Khác

- `app.module.ts` đăng ký `DatabaseModule`, `StorageModule`, `EventsModule`, `MediaModule`, `IngestionModule`.
- Dependencies mới: `mqtt`, `pg`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- Unit test: `test/mqtt-consumer.service.spec.ts`, `test/media.service.spec.ts`, `test/media.controller.spec.ts`.
- Mẫu message: `infra/mosquitto/samples/person-lifecycle.jsonl`, `person-invalid.jsonl`.

---

## 2. Luồng dữ liệu

```
Frigate ──MQTT frigate/events──▶ Mosquitto ──▶ MqttConsumerService
                                                  │ new  → INSERT events (dedup)
                                                  │       └─ has_snapshot → MediaService.downloadAndStoreSnapshot
                                                  │ end  → P0/P1 & has_clip → MediaService.downloadAndStoreClip
                                                  ▼
                     Frigate API /api/events/{id}/snapshot.jpg|clip.mp4
                                                  ▼
                           MinIO/S3 (bucket camerai-media) + INSERT event_media
                                                  ▼
            GET /api/v1/events/{eventId}/media ──▶ presigned URL (TTL 900 s)
```

---

## 3. Chuẩn bị

```bash
cp .env.example .env
```

```bash
pnpm install
```

```bash
docker compose up -d postgres mosquitto minio minio-init
```

Kiểm tra migration đã có bảng `events`, `event_media`:

```bash
docker exec camerai-postgres psql -U camerai -d camerai -c "\dt"
```

Chạy Orchestrator — chọn **một** cách:

- Trong Docker: `docker compose up -d orchestrator` rồi `docker compose logs -f orchestrator`.
- Chạy local (hot reload): đổi trong `.env` các host `postgres`/`mosquitto`/`minio`/`frigate` thành `localhost`
  (`DATABASE_URL`, `MQTT_URL`, `MINIO_ENDPOINT`, `FRIGATE_URL=http://localhost:5000`), rồi:

```bash
pnpm --filter @cam/orchestrator dev
```

Log mong đợi khi khởi động:

```
Da ket noi MQTT Broker thanh cong. Dang subscribe topic: frigate/events
Da subscribe topic frigate/events
Orchestrator dang chay tai http://localhost:3001/api/v1
```

Mở sẵn các "cửa sổ quan sát":

| Công cụ       | Địa chỉ / lệnh                                                              |
| ------------- | --------------------------------------------------------------------------- |
| MinIO Console | http://localhost:9001 — đăng nhập `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| Frigate UI    | http://localhost:5000 (chỉ kịch bản B)                                      |
| MQTT          | `docker exec camerai-mosquitto mosquitto_sub -t frigate/events -v`          |
| Postgres      | `docker exec -it camerai-postgres psql -U camerai -d camerai`               |

---

## 4. Kịch bản A — dùng message giả (không cần Frigate)

Mục tiêu: kiểm tra **US-03** (ghi `events`, dedup, dead-letter). Media sẽ **không** tải được vì
Frigate không có track `demo-1` → chỉ thấy log warn, đó là hành vi đúng.

### A1. Gửi vòng đời `new → update → end`

PowerShell:

```powershell
cmd /c "docker exec -i camerai-mosquitto mosquitto_pub -t frigate/events -l < infra\mosquitto\samples\person-lifecycle.jsonl"
```

Git Bash:

```bash
docker exec -i camerai-mosquitto mosquitto_pub -t frigate/events -l < infra/mosquitto/samples/person-lifecycle.jsonl
```

Mong đợi trong log Orchestrator:

- `Da ghi nhan su kien moi vao bang events` (kèm `eventId`, `trackId: demo-1`, `eventType: RESTRICTED_ZONE`).
- Nếu `cam_fake` chưa có trong DB: `Camera "cam_fake" chua co trong DB ... Ghi camera_id=null`.
- `Khong the tai snapshot tu Frigate (...)` hoặc lỗi fetch — **đúng**, vì không có Frigate thật.

Kiểm tra DB:

```sql
SELECT id, track_id, event_type, priority, status, camera_id, dedup_key, detected_at
FROM events ORDER BY detected_at DESC LIMIT 5;
```

→ Có **1** dòng `demo-1`, `RESTRICTED_ZONE`, `P1`.

### A2. Dedup

Gửi lại đúng file ở A1 lần nữa → log `Bo qua su kien trung lap theo dedup_key` (mức debug),
chạy lại câu SQL: số dòng `demo-1` **không tăng**.

### A3. Dead-letter

```powershell
cmd /c "docker exec -i camerai-mosquitto mosquitto_pub -t frigate/events -l < infra\mosquitto\samples\person-invalid.jsonl"
```

```powershell
docker exec camerai-mosquitto mosquitto_pub -t frigate/events -m "khong-phai-json"
```

→ Log `Dead-letter: ...`, Orchestrator vẫn chạy, bảng `events` không đổi.

### A4. Sự kiện ngoài zone (P3)

Sửa một dòng `new` với `id` mới (vd. `demo-2`) và `"current_zones":[]`, gửi bằng `mosquitto_pub -m '<json>'`
→ bản ghi `PERSON_DETECTED` / `P3`.

---

## 5. Kịch bản B — end-to-end với Frigate thật

Mục tiêu: thấy **snapshot và clip** thực sự nằm trong MinIO.

1. Khởi động Frigate và nguồn RTSP theo [FRIGATE_MQTT_SETUP.md](FRIGATE_MQTT_SETUP.md):

   ```bash
   pnpm frigate:init
   ```

   ```bash
   docker compose --profile cv up -d
   ```

2. Đảm bảo camera slug (vd. `cam_test`) và zone (vd. `restricted_stove`) có trong bảng `cameras` / `zones`
   nếu muốn `camera_id`, `zone_id` được điền (không bắt buộc để test media).
3. Cho người xuất hiện trước camera / phát video mẫu có người. Theo dõi Frigate UI → **Review/Explore** thấy sự kiện.
4. Log Orchestrator: `Da ghi nhan su kien moi vao bang events`, không có warn tải snapshot.
5. Vào **MinIO Console → Buckets → `camerai-media` → `events/` → `yyyy/mm/dd/{event_id}/`**:
   - Có `snapshot.jpg` ngay sau khi sự kiện được tạo → bấm **Preview** để xem ảnh.
   - Nếu người đi vào zone (P1): sau khi track kết thúc (người rời khung hình, Frigate gửi `end`), có thêm `clip.mp4`.
   - Nếu ngoài zone (P3): **chỉ** có snapshot, không có clip.
6. Kiểm tra DB:

   ```sql
   SELECT e.track_id, e.priority, m.media_type, m.object_key, m.content_type, m.size_bytes, m.duration_ms
   FROM events e JOIN event_media m ON m.event_id = e.id
   ORDER BY m.created_at DESC LIMIT 10;
   ```

   → `size_bytes` khớp với kích thước file trong MinIO; clip có `duration_ms > 0`.

---

## 6. Kiểm tra API presigned URL

Lấy một `event_id` từ bảng `events` rồi gọi (trình duyệt hoặc terminal):

```bash
curl -s http://localhost:3001/api/v1/events/<event_id>/media
```

Mong đợi:

```json
{
  "data": [
    {
      "id": "…",
      "mediaType": "SNAPSHOT",
      "url": "http://localhost:9000/camerai-media/events/2026/09/18/<event_id>/snapshot.jpg?X-Amz-Algorithm=…&X-Amz-Expires=900&…",
      "expiresAt": "2026-09-18T10:15:00.000Z",
      "contentType": "image/jpeg",
      "sizeBytes": 84213,
      "width": null,
      "height": null,
      "durationMs": null,
      "createdAt": "…"
    }
  ]
}
```

Kiểm tra trực quan:

| Thao tác                                                        | Kết quả đúng                           |
| --------------------------------------------------------------- | -------------------------------------- |
| Dán `url` vào trình duyệt                                       | Hiển thị ảnh / phát video              |
| Bỏ phần query `?X-Amz-...` rồi mở                               | **AccessDenied** — bucket không public |
| Mở lại `url` sau 15 phút                                        | **Request has expired**                |
| `GET /api/v1/events/abc/media`                                  | **400** (không phải UUID)              |
| `GET /api/v1/events/00000000-0000-0000-0000-000000000000/media` | **404** `Khong tim thay su kien ...`   |
| Sự kiện chỉ có bản ghi `events`, không có media (kịch bản A)    | **200** với `"data": []`               |

> Lưu ý: khi Orchestrator chạy **trong Docker**, `MINIO_ENDPOINT=http://minio:9000` nên URL presigned có host
> `minio` — trình duyệt trên máy host không phân giải được. Để mở URL từ trình duyệt, chạy Orchestrator local
> với `MINIO_ENDPOINT=http://localhost:9000`, hoặc thêm `127.0.0.1 minio` vào file hosts.

---

## 7. Unit test

```bash
pnpm --filter @cam/orchestrator test
```

```bash
pnpm --filter @cam/orchestrator lint
```

```bash
pnpm --filter @cam/orchestrator typecheck
```

Các spec bao phủ: parse/validate/dead-letter, phân loại P1/P3, dedup, trigger snapshot/clip theo priority,
build object key, xử lý lỗi Frigate, presigned URL, 404 và `ParseUUIDPipe` của controller.

---

## 8. Checklist nghiệm thu

- [ ] Orchestrator kết nối MQTT và subscribe `frigate/events` khi khởi động.
- [ ] Message `new` hợp lệ → 1 dòng trong `events` với đúng `event_type` / `priority`.
- [ ] Gửi lại cùng message trong 10 s → không tạo dòng trùng.
- [ ] Message sai định dạng → log dead-letter, service không crash.
- [ ] Snapshot xuất hiện trong MinIO theo đường dẫn `events/yyyy/mm/dd/{event_id}/snapshot.jpg`.
- [ ] Sự kiện P1 kết thúc → có `clip.mp4`; sự kiện P3 → không có clip.
- [ ] Bảng `event_media` có bản ghi tương ứng, `size_bytes` đúng.
- [ ] `GET /api/v1/events/:id/media` trả URL mở được, hết hạn sau 15 phút, 400/404 đúng trường hợp.
- [ ] `test`, `lint`, `typecheck` đều pass.
