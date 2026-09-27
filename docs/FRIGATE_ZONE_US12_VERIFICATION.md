# Kiểm chứng Frigate cho US-12

## Cơ chế đã chốt

- Image được ghim ở `ghcr.io/blakeblackshear/frigate:0.18.0`.
- `infra/frigate/config.yml` được mount `rw`; Orchestrator dùng API
  `POST /api/config/save?save_option=restart`, không dùng Docker socket.
- Zone ứng dụng quản lý dùng `slug` làm key, tọa độ chuẩn hóa và
  `loitering_time = minDwellSeconds` cho loại `RESTRICTED`.
- Backend chỉ nâng M4 từ `current_zones`; `entered_zones` chỉ là lịch sử.
- Sau khi lưu, worker đọc lại `/api/config/raw` và chỉ đánh dấu `SYNCED` khi các key mong
  đợi đã xuất hiện và các key bị xóa đã biến mất.

Fixture `infra/mosquitto/samples/zone-dwell-us12.jsonl` ghi lại vòng đời tối thiểu dùng cho
test: ở 1,9 giây zone chỉ có trong `entered_zones`; sau 2 giây mới có trong
`current_zones`. Fixture không chứa ảnh, URL RTSP hoặc credential.

## Cách nghiệm thu trên máy có Docker và nguồn video

1. Chạy `pnpm frigate:init` rồi `pnpm frigate:validate`.
2. Chạy `docker compose --profile cv up -d` và kiểm tra container healthy.
3. Tạo zone RESTRICTED ngưỡng 2 giây trên giao diện.
4. Quan sát một người đi qua dưới 2 giây, đứng trên 2 giây, ra/vào lại và đi qua nhiều
   zone; lưu payload MQTT đã làm sạch nếu hành vi khác fixture.
5. Xác nhận config qua `/api/config/raw`, event trong PostgreSQL và cập nhật SSE trên
   dashboard.

Kiểm chứng live phụ thuộc camera/video và Docker của máy nghiệm thu. Không đánh dấu đạt
nếu chỉ chạy mock hoặc replay fixture.

## Kết quả chạy local ngày 2026-09-27

- Migration `0009_zone_configuration.sql` đã áp dụng thành công trên PostgreSQL đang có dữ liệu.
- Validator của image `0.18.0` chấp nhận cấu hình.
- CRUD zone tạm qua REST đã làm thay đổi config chạy thật; log xác nhận cả tạo và xóa được
  áp dụng. Worker phục hồi lần restart chồng nhau và đưa camera `cam_test` về
  `SYNCED`, `appliedVersion/configVersion = 7/7`.
- Zone tạm đã được xóa khỏi DB và config.
- Bốn kịch bản chuyển động người thật (đi lướt, đứng yên, ra/vào lại, nhiều zone) chưa có
  nguồn video kiểm soát trong lần chạy này; fixture và unit test không thay thế bước nghiệm
  thu vật lý đó.
