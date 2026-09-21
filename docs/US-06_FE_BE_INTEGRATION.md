# Tích hợp FE ↔ BE luồng "phát hiện người" — Tóm tắt thay đổi & cách kiểm thử

> Phạm vi: nối luồng 1 (Frigate → MQTT → Orchestrator → PostgreSQL/MinIO, xem
> [US-03-US-04_CHANGES.md](US-03-US-04_CHANGES.md)) lên dashboard Next.js:
> **ảnh snapshot thật**, cảnh báo **"Phát hiện người"** và các thông số của sự kiện.

## Mục lục

1. [Vấn đề trước khi sửa](#1-vấn-đề-trước-khi-sửa)
2. [Thay đổi hợp đồng API](#2-thay-đổi-hợp-đồng-api)
3. [Thay đổi Orchestrator](#3-thay-đổi-orchestrator)
4. [Thay đổi Dashboard](#4-thay-đổi-dashboard)
5. [Sửa cấu hình và dữ liệu](#5-sửa-cấu-hình-và-dữ-liệu)
6. [Cách kiểm thử](#6-cách-kiểm-thử)
7. [Việc còn lại](#7-việc-còn-lại)

---

## 1. Vấn đề trước khi sửa

| Hiện tượng                                                 | Nguyên nhân                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Dashboard luôn hiện 6 sự kiện mẫu dù DB có sự kiện thật    | `fetchEvents()` bắt mọi lỗi rồi trả `INITIAL_MOCK_EVENTS`, không ai biết backend đang hỏng                      |
| Thẻ sự kiện chỉ vẽ biểu tượng SVG                          | `EventCard` không dùng `thumbnailUrl` mà API đã trả về                                                          |
| Ảnh snapshot không tải được trong trình duyệt              | Presigned URL ký theo `MINIO_ENDPOINT=http://minio:9000` — tên service Docker, trình duyệt không phân giải được |
| Modal chi tiết toàn dữ liệu giả                            | `EventDetailModal` gọi `getMockEventDetail()`; endpoint `GET /events/{id}` có trong spec nhưng **chưa cài đặt** |
| Ba thẻ số liệu trên đầu trang là số cứng (`4/4`, `8`, `1`) | Không có endpoint thống kê nào                                                                                  |
| Sự kiện mới hiện lên không có ảnh và không bao giờ có      | Frigate gửi `has_snapshot=false` ở message `new`; ảnh về ở message sau nhưng SSE chỉ phát khi tạo mới           |
| Mọi sự kiện thật đều mất tên camera                        | Seed đặt `slug = cam_video`, Frigate dùng `cam_test` → `findCameraBySlug` trả null                              |

## 2. Thay đổi hợp đồng API

Sửa `api/openapi.yaml` **trước**, sinh lại kiểu bằng `pnpm contracts:generate`.

| Endpoint            | Trạng thái                             | Ghi chú                                                         |
| ------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `GET /events/stats` | **Thêm mới**                           | Schema `EventStats`, tham số `windowHours` (1…168, mặc định 24) |
| `GET /events/{id}`  | Đã có trong spec, nay **được cài đặt** | Trả `EventDetail` kèm `media`, `aiResults`, `statusHistory`     |

`EventStats` gồm: `totalEvents`, `personDetectedCount`, `pendingCount`, `resolvedCount`,
`falseAlarmCount`, `cameraOnlineCount` / `cameraTotalCount`, `latestEventAt`,
`latestPendingEvent`, `byType`, `byPriority`.

## 3. Thay đổi Orchestrator

| File                                          | Nội dung                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/events/events.controller.ts`             | Thêm `GET /events/stats` và `GET /events/:eventId`. `stats` phải khai báo **trước** `:eventId`. |
| `src/events/events.service.ts`                | `getEvent()` (gộp summary + media + lịch sử, chạy song song), `getStats()`.                     |
| `src/events/events.repository.ts`             | `findEventDetailById`, `listStatusHistoryByEventId`, `getEventStats` (5 truy vấn song song).    |
| `src/events/dto/event-detail-response.dto.ts` | DTO `EventDetailDto`.                                                                           |
| `src/events/dto/event-stats-response.dto.ts`  | DTO `EventStatsResponseDto`.                                                                    |
| `src/events/dto/get-event-stats-query.dto.ts` | Validate `windowHours`.                                                                         |
| `src/events/events.module.ts`                 | Import `MediaModule` để lấy media kèm presigned URL.                                            |
| `src/storage/minio-storage.service.ts`        | Ký presigned URL bằng `MINIO_PUBLIC_ENDPOINT` để trình duyệt tải được ảnh.                      |
| `src/media/media.service.ts`                  | Ép `size_bytes` (BIGINT, driver `pg` trả chuỗi) về số đúng hợp đồng.                            |
| `src/ingestion/mqtt-consumer.service.ts`      | Phát thêm SSE `event.updated` khi snapshot về muộn hơn sự kiện.                                 |

`ai_results` nằm trong cột JSONB nên `EventsService` kiểm tra hình dạng từng phần tử
trước khi trả ra API — phần tử sai định dạng bị bỏ qua thay vì làm hỏng cả response.

## 4. Thay đổi Dashboard

| File                                         | Nội dung                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/events-client.ts`                   | Bỏ fallback mock; `fetchEvents` ném lỗi để UI hiện trạng thái lỗi. Thêm `fetchEventDetail`, `fetchEventStats`. Nhãn AI theo loại sự kiện: **"Phát hiện người 93%"**. SSE nghe cả `event.created` lẫn `event.updated`. |
| `src/hooks/useEvents.ts`                     | Thêm `error` + `reload`. `event.created` chèn lên đầu kèm thông báo; `event.updated` thay tại chỗ để danh sách không nhảy.                                                                                            |
| `src/hooks/useEventStats.ts`                 | Hook mới, tự làm mới mỗi 60 giây và khi có sự kiện mới.                                                                                                                                                               |
| `src/components/events/EventCard.tsx`        | Vẽ `<img>` snapshot thật, tự lùi về biểu tượng khi thiếu ảnh hoặc URL hết hạn. Hiện thêm độ tin cậy AI, người quen khớp, trạng thái.                                                                                  |
| `src/components/events/EventDetailModal.tsx` | Gọi `GET /events/{id}`; hiện snapshot đầy đủ, clip (nếu có), 10 thông số, kết quả AI và lịch sử trạng thái.                                                                                                           |
| `src/components/dashboard/MetricCards.tsx`   | Nhận `EventStats` thay cho số cứng.                                                                                                                                                                                   |
| `src/components/ui/ErrorState.tsx`           | Trạng thái lỗi kèm nút "Thử lại" (CODING_CONVENTION §4).                                                                                                                                                              |

## 5. Sửa cấu hình và dữ liệu

- `.env.example` + `.env`: thêm **`MINIO_PUBLIC_ENDPOINT=http://localhost:9000`**.
  Chữ ký presigned URL gắn chặt với host, nên phải ký bằng đúng địa chỉ trình duyệt gọi tới.
- `db/seeds/0001_demo_data.sql`: `cam_video` → **`cam_test`** cho khớp
  `infra/frigate/config.yml`. Seed dùng `ON CONFLICT (slug) DO NOTHING` nên DB đang chạy
  phải sửa bằng tay:

  ```bash
  docker exec camerai-postgres psql -U camerai -d camerai -c "UPDATE cameras SET slug='cam_test', name='Camera thu nghiem', rtsp_url='rtsp://localhost:8554/cam_test' WHERE slug='cam_video';"
  ```

## 6. Cách kiểm thử

### Tự động

```bash
pnpm api:lint && pnpm typecheck && pnpm lint && pnpm test
```

### Bằng tay — API

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"admin@camerai.local","password":"Admin@12345"}' | jq -r .accessToken)
curl -s "http://localhost:3001/api/v1/events/stats" -H "Authorization: Bearer $TOKEN" | jq
curl -s "http://localhost:3001/api/v1/events?pageSize=1" -H "Authorization: Bearer $TOKEN" | jq '.data[0].thumbnailUrl'
```

`thumbnailUrl` phải bắt đầu bằng `http://localhost:9000/…` và `curl` vào đó trả **200 image/jpeg**.

### Bằng tay — luồng thời gian thực

Mở dashboard, mở một tab nghe SSE, rồi bắn message Frigate giả:

```bash
docker exec camerai-mosquitto mosquitto_pub -h localhost -t frigate/events -m '{"type":"new","after":{"id":"demo-1","camera":"cam_test","frame_time":1789988854,"label":"person","score":0.93,"current_zones":[],"has_snapshot":false,"has_clip":false,"start_time":1789988854}}'
```

Kết quả mong đợi: thẻ "Phát hiện người 93%" xuất hiện ngay trên đầu danh sách, kèm tên
camera. Khi Frigate có ảnh và gửi tiếp message `update` với `has_snapshot: true`,
backend phát `event.updated` và ảnh hiện lên đúng thẻ đó mà không cần F5.

## 7. Việc còn lại

- **49 sự kiện cũ vẫn có `camera_id = NULL`** vì được ingest trước khi sửa slug.
  Muốn dashboard hiện tên camera cho cả dữ liệu cũ thì backfill:

  ```bash
  docker exec camerai-postgres psql -U camerai -d camerai -c "UPDATE events SET camera_id=(SELECT id FROM cameras WHERE slug='cam_test') WHERE camera_id IS NULL AND dedup_key LIKE 'frigate:cam_test:%';"
  ```

- Nút **"Thử sự kiện mới"** ở thanh trên vẫn chèn sự kiện giả ở phía client (không ghi DB).
  Dùng để demo, không phải dữ liệu thật.
- Lọc theo tab và khu vực vẫn chạy phía client trên 50 sự kiện mới nhất tải về.
  Khi dữ liệu lớn hơn cần chuyển sang lọc phía server bằng tham số của `GET /events`.
- `PATCH /events/{id}` và `POST /events/{id}/confirm` chưa cài đặt, nên nút "Tôi ổn" /
  "Cần giúp đỡ" / "Báo động giả" mới chỉ đổi trạng thái trong bộ nhớ trình duyệt (US-13).
