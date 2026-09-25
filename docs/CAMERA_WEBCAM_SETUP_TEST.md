# Thiết lập và kiểm thử Camera RTSP, Webcam và Video

Tài liệu này hướng dẫn thành viên trong nhóm cập nhật code, thiết lập môi trường và kiểm thử luồng webcam từ Dashboard đến Frigate.

```text
Chrome Dashboard
  → WebRTC/WHIP
  → MediaMTX
  → RTSP nội bộ có xác thực
  → Frigate 0.18
  → Debug View và sự kiện MQTT
```

Với nguồn `BROWSER_WEBCAM`, không cần chạy FFmpeg thủ công. Trình duyệt là publisher và phải giữ tab Dashboard đang mở trong suốt thời gian phát.

## 1. Chuẩn bị biến môi trường

### 1.1. Máy chạy dự án lần đầu

Chỉ tạo `.env` khi file chưa tồn tại:

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

### 1.2. Máy đã có `.env`

Không ghi đè `.env` bằng `.env.example`, vì thao tác đó có thể làm mất cấu hình local. Mở `.env` và bảo đảm có các giá trị sau:

```dotenv
FRIGATE_URL=http://frigate:5000
MEDIAMTX_WEBRTC_ADDITIONAL_HOSTS=localhost
MEDIAMTX_RTSP_URL=rtsp://mediamtx:8554
MEDIAMTX_WEBRTC_URL=http://localhost:8889
MEDIAMTX_PUBLISH_USERNAME=cam-internal
MEDIAMTX_PUBLISH_PASSWORD=change-this-local-secret
CAMERA_RTSP_TEST_TIMEOUT_MS=8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
WEB_ORIGIN=http://localhost:3000
```

Giá trị `MEDIAMTX_PUBLISH_PASSWORD` có thể đổi trên từng máy, nhưng các container phải nhận cùng một giá trị từ `.env`. Không commit `.env` và không gửi mật khẩu thật vào tài liệu hoặc log.

Hai URL MediaMTX có mục đích khác nhau:

| Biến                  | Giá trị khi chạy Docker | Người sử dụng                             |
| --------------------- | ----------------------- | ----------------------------------------- |
| `MEDIAMTX_RTSP_URL`   | `rtsp://mediamtx:8554`  | Orchestrator và Frigate trong mạng Docker |
| `MEDIAMTX_WEBRTC_URL` | `http://localhost:8889` | Chrome trên máy host                      |

Không đổi `MEDIAMTX_RTSP_URL` thành `localhost` khi Orchestrator chạy trong Docker. Bên trong container, `localhost` trỏ về chính container đó.

## 2. Chuẩn bị cấu hình Frigate

Máy chạy lần đầu hoặc chưa có `infra/frigate/config.yml`:

```powershell
pnpm frigate:init
```

Kiểm tra cấu hình bằng validator của image Frigate đang ghim:

```powershell
pnpm frigate:validate
```

Nếu máy đã có `config.yml`, không dùng `--force` trong quá trình cập nhật bình thường. Lệnh sau ghi đè cấu hình runtime hiện tại và chỉ dùng khi chủ động muốn khởi tạo lại:

```powershell
Copy-Item -LiteralPath 'infra/frigate/config.yml' `
  -Destination 'infra/frigate/config.backup.yml'
pnpm frigate:init --force
```

## 3. Khởi động hoặc cập nhật container

Build lại Web và Orchestrator, đồng thời bật profile Frigate:

```powershell
docker compose --profile cv up -d --build
```

Lần đầu tải image Frigate có thể mất vài phút. Theo dõi trạng thái:

```powershell
docker compose --profile cv ps
```

Các service quan trọng cần ở trạng thái `Up`; những service có healthcheck cần chuyển sang `healthy`:

- `camerai-postgres`
- `camerai-mosquitto`
- `camerai-mediamtx`
- `camerai-frigate`
- `camerai-orchestrator`
- `camerai-web`

Nếu Frigate hoặc Orchestrator vừa khởi động, chờ khoảng 30–60 giây rồi kiểm tra lại.

## 4. Migration và seed dữ liệu local

Chạy migration và seed từ PowerShell ở thư mục gốc dự án:

```powershell
pnpm db:migrate
pnpm seed
```

Không chạy lệnh sau trong container:

```text
docker compose exec orchestrator sh -lc "cd /workspace && pnpm seed"
```

File `.env` không được đưa vào Docker image nên cách trên sẽ báo `node: .env: not found`. Script `pnpm seed` chạy trên máy host sẽ đọc `.env` và tự chuyển kết nối PostgreSQL từ hostname `postgres` sang `localhost`.

Tài khoản demo local:

```text
Email: admin@camerai.local
Mật khẩu: Admin@12345
```

Tài khoản này chỉ dành cho môi trường development.

## 5. Kiểm tra service trước khi thử webcam

```powershell
(Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/login').StatusCode
(Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/api/v1/health').StatusCode
(Invoke-WebRequest -UseBasicParsing 'http://localhost:5000/api/version').StatusCode
```

Cả ba lệnh cần trả về `200`.

Các địa chỉ sử dụng:

| Dịch vụ              | Địa chỉ                        |
| -------------------- | ------------------------------ |
| Dashboard            | http://localhost:3000          |
| Orchestrator Swagger | http://localhost:3001/api/docs |
| Frigate              | http://localhost:5000          |
| MediaMTX WebRTC      | http://localhost:8889          |

## 6. Thử webcam từ Dashboard

1. Mở `http://localhost:3000` và đăng nhập bằng tài khoản demo.
2. Vào mục **Camera**.
3. Chọn camera **Phòng khách** (`cam_living_room`) hoặc camera muốn kiểm thử.
4. Chọn tab **Cấu hình nguồn phát (RTSP)**.
5. Chọn **Webcam Trình duyệt (WHIP)**.
6. Bấm **Bật xem trước Webcam**.
7. Cho phép quyền Camera tại `http://localhost:3000` nếu trình duyệt hỏi.
8. Khi thấy hình xem trước, bấm **Bắt đầu truyền phát WHIP**.
9. Giữ tab Dashboard mở.

Khi kết nối thành công, giao diện hiển thị:

```text
Đang truyền phát trực tiếp lên MediaMTX
```

Dashboard thực hiện tuần tự:

1. Lưu nguồn camera thành `BROWSER_WEBCAM`.
2. Bật desired state của camera.
3. Đồng bộ cấu hình xuống Frigate.
4. Xin token publish ngắn hạn, gắn với đúng camera.
5. Gửi offer WHIP kèm Bearer token tới MediaMTX.
6. Frigate đọc lại luồng RTSP nội bộ từ MediaMTX.

### 6.1. Thử nguồn RTSP

1. Chọn camera rồi mở tab **Cấu hình nguồn phát**.
2. Chọn **Nguồn RTSP Trực tiếp**.
3. Nhập URL RTSP và chọn transport TCP hoặc UDP.
4. Bấm **Kiểm tra kết nối**. Backend dùng `ffprobe` trong container Orchestrator và
   không lưu thay đổi khi chỉ kiểm tra.
5. Khi kết nối thành công, bấm **Lưu cấu hình nguồn** rồi bật camera.

URL có password chỉ được hiển thị ở dạng đã che. Thời gian chờ của phép thử đọc từ
`CAMERA_RTSP_TEST_TIMEOUT_MS`.

Nếu tự dùng FFmpeg để publish vào MediaMTX mà không truyền credential, lỗi
`401 Unauthorized` là đúng theo thiết kế. Luồng webcam/video trên Dashboard tự xin
credential hoặc token ngắn hạn; người dùng không cần chạy FFmpeg thủ công.

### 6.2. Upload video giả lập camera

1. Chọn **Phát lặp từ File Video**.
2. Chọn file MP4 hoặc MKV, tối đa 500 MB theo cấu hình mặc định.
3. Kiểm tra tên file, dung lượng, thời lượng và lựa chọn **Phát lặp video**.
4. Bấm **Tải video lên** và chờ thanh tiến trình đạt 100%.
5. Bật camera. Orchestrator tự chạy FFmpeg và publish vào đúng MediaMTX path.
6. Kiểm tra `camera_fps > 0` trên Frigate và trạng thái `ONLINE` trên Dashboard.

Video upload được đặt tên vật lý bằng UUID trong Docker volume `camera-videos`; file
không được commit vào Git và vẫn còn sau khi container Orchestrator được tạo lại. Có thể
dùng **Thay video** hoặc **Xóa video** ngay trên cùng tab.

### 6.3. Chỉnh cấu hình Frigate

Tab **Cài đặt Frigate & Đồng bộ** cho phép ADMIN chỉnh độ phân giải/FPS detect, ngưỡng
person, snapshot, recording và retention. Bấm **Lưu cấu hình** rồi kiểm tra trạng thái
đồng bộ cùng `configVersion`/`appliedVersion`. Nếu trạng thái là `FAILED`, xử lý lỗi được
hiển thị rồi bấm **Thử lại đồng bộ**.

## 7. Xác nhận luồng đã đến Frigate

Đợi khoảng 10–20 giây sau khi bắt đầu publish, rồi kiểm tra FPS:

```powershell
(Invoke-RestMethod 'http://localhost:5000/api/stats').cameras.cam_living_room.camera_fps
```

Kết quả phải lớn hơn `0`. Với cấu hình mặc định, kết quả thường gần `5`.

Kiểm tra nguồn và trạng thái trong database:

```powershell
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT c.slug, c.is_enabled, cs.source_type, cs.status, fs.sync_status, fs.config_version, fs.applied_version FROM cameras c JOIN camera_sources cs ON cs.camera_id = c.id LEFT JOIN camera_frigate_settings fs ON fs.camera_id = c.id WHERE c.slug = 'cam_living_room';"
```

Các giá trị cần chú ý:

| Cột               | Giá trị mong đợi                                   |
| ----------------- | -------------------------------------------------- |
| `source_type`     | `BROWSER_WEBCAM`                                   |
| `is_enabled`      | `true`                                             |
| `status`          | ban đầu `STARTING`, sau khi nhận frame là `ONLINE` |
| `sync_status`     | `SYNCED`                                           |
| `applied_version` | bằng `config_version`                              |

Mở `http://localhost:5000` để xem hình trực tiếp. Sau đó quay lại Dashboard, bấm **Làm mới** và mở **Luồng xem trực tiếp & Debug View**.

## 8. Kiểm tra MediaMTX và log toàn luồng

Giữ webcam đang publish và chạy:

```powershell
docker compose logs --since=2m mediamtx orchestrator frigate
```

Luồng đúng cần có các dấu hiệu:

- MediaMTX nhận publisher WebRTC/WHIP cho đúng camera slug.
- Frigate mở kết nối RTSP đến MediaMTX.
- Frigate không còn lặp lỗi `401 Unauthorized`.
- `camera_fps` lớn hơn `0`.

Chỉ xem lỗi gần nhất:

```powershell
docker compose logs --since=5m mediamtx orchestrator frigate 2>&1 |
  Select-String -Pattern 'ERROR|WARN|401|422|cam_living_room'
```

## 9. Test tự động trước khi commit

Chạy riêng phần liên quan đến thay đổi camera:

```powershell
pnpm --filter @cam/orchestrator lint
pnpm --filter @cam/orchestrator typecheck
pnpm --filter @cam/orchestrator test
pnpm --filter @cam/orchestrator test:integration

pnpm --filter @cam/web lint
pnpm --filter @cam/web typecheck
pnpm --filter @cam/web test

pnpm frigate:validate
pnpm test:tools
```

Kiểm tra toàn repository trước khi mở Pull Request:

```powershell
pnpm check:all
docker compose --profile cv ps
```

`pnpm check:all` cần dependency Python đã được cài bằng `pnpm setup:ai`.

## 10. Các lỗi thường gặp

### `camera_fps` bằng `0`

Kiểm tra theo thứ tự:

1. Tab Dashboard còn mở không.
2. Giao diện có hiện **Đang truyền phát trực tiếp lên MediaMTX** không.
3. Nguồn trong database đã là `BROWSER_WEBCAM` chưa.
4. `sync_status` đã là `SYNCED` chưa.
5. Log MediaMTX có publisher WHIP cho đúng slug chưa.

Quyền Camera ở Chrome chỉ cho phép trang đọc webcam; quyền đó không tự publish luồng.

### Frigate báo `401 Unauthorized`

Nguyên nhân thường gặp:

- Frigate đang dùng cấu hình cũ chưa có credential RTSP nội bộ.
- `MEDIAMTX_PUBLISH_USERNAME` hoặc `MEDIAMTX_PUBLISH_PASSWORD` không đồng nhất.
- Camera vẫn là nguồn `RTSP` trỏ tới MediaMTX nhưng chưa có publisher.
- Lệnh FFmpeg thủ công publish vào MediaMTX không gửi username/password.

Rebuild Orchestrator, sau đó chọn lại nguồn webcam trên Dashboard để đồng bộ lại Frigate:

```powershell
docker compose --profile cv up -d --build orchestrator
```

### Frigate save config trả `422`

Orchestrator cũ có thể gọi API Frigate 0.18 mà thiếu `save_option`. Rebuild image mới:

```powershell
docker compose build orchestrator
docker compose --profile cv up -d --no-deps orchestrator
```

### Debug View trả HTTP 500 với `IMAGE_SNAPSHOT`

Database dùng enum `SNAPSHOT`. Nếu log còn `invalid input value for enum media_type: "IMAGE_SNAPSHOT"`, Orchestrator vẫn đang chạy image cũ. Rebuild theo lệnh ở trên.

### `node: .env: not found` khi seed

Bạn đang chạy `pnpm seed` bên trong container. Quay về PowerShell tại thư mục gốc và chạy:

```powershell
pnpm seed
```

### Không thấy webcam trong danh sách thiết bị

1. Mở quyền trang của `http://localhost:3000`.
2. Đặt **Camera → Cho phép**.
3. Đóng ứng dụng khác đang giữ webcam.
4. Tải lại trang bằng `Ctrl + F5`.

### Frigate `healthy` nhưng camera vẫn offline

Healthcheck chỉ xác nhận dịch vụ Frigate đang chạy. Nó không xác nhận từng camera đang nhận frame. Luôn kiểm tra `camera_fps` và log của camera cụ thể.

## 11. Dừng môi trường

Dừng các container nhưng giữ database và volume:

```powershell
docker compose --profile cv down
```

Không thêm `-v` nếu muốn giữ dữ liệu PostgreSQL, MinIO và lịch sử Frigate.

## 12. Checklist nghiệm thu

- [ ] Pull đúng nhánh và cài dependency thành công.
- [ ] `.env` dùng hostname Docker cho PostgreSQL, Frigate và MediaMTX RTSP.
- [ ] `pnpm frigate:validate` thành công.
- [ ] Các container quan trọng đang `Up` hoặc `healthy`.
- [ ] Migration và seed chạy thành công trên máy host.
- [ ] Dashboard truy cập được webcam.
- [ ] Nguồn camera chuyển thành `BROWSER_WEBCAM`.
- [ ] RTSP kiểm tra kết nối thành công mà không làm thay đổi cấu hình đã lưu.
- [ ] Video upload hiển thị tiến trình, phát được và còn sau khi tạo lại Orchestrator.
- [ ] Dashboard hiển thị đang truyền phát lên MediaMTX.
- [ ] Frigate `camera_fps > 0`.
- [ ] Cấu hình Frigate lưu đủ field và `appliedVersion` bằng `configVersion` sau khi sync.
- [ ] Debug View không trả HTTP 500.
- [ ] Test backend và frontend đạt.

## Tài liệu liên quan

- [DEV_ONBOARDING.md](DEV_ONBOARDING.md)
- [FRIGATE_MQTT_SETUP.md](FRIGATE_MQTT_SETUP.md)
- [FFMPEG_MEDIAMTX_SETUP.md](FFMPEG_MEDIAMTX_SETUP.md)
- [GIT_WORKFLOW.md](conventions/GIT_WORKFLOW.md)
- [CODING_CONVENTION.md](conventions/CODING_CONVENTION.md)
