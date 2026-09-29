# Frigate phát hiện người và bắn sự kiện lên MQTT

> **US-01** (3 SP) · **US-02** (1 SP) · Epic 1 · Sprint 1 · Người phụ trách: **Duong Dai Phat**
> Yêu cầu: FR-ING-01, FR-ING-02, FR-ING-03, FR-ING-04 · Luồng: [DATA_FLOW.md § Luồng 1](architecture/DATA_FLOW.md#luồng-1--phát-hiện-người-walking-skeleton-sprint-1) bước 1 → 4

```text
Webcam / file mp4 → FFmpeg → MediaMTX (RTSP) → Frigate 0.18 → Mosquitto: frigate/events → Orchestrator (US-03)
```

Tài liệu này bắt đầu từ chỗ [FFMPEG_MEDIAMTX_SETUP.md](FFMPEG_MEDIAMTX_SETUP.md) kết thúc:
luồng RTSP đã phát được lên MediaMTX.

## Mục lục

- [1. Chạy lần đầu](#1-chạy-lần-đầu)
- [2. Phát luồng có người](#2-phát-luồng-có-người)
- [3. Nghiệm thu bằng một lệnh](#3-nghiệm-thu-bằng-một-lệnh)
- [4. Cấu hình quan trọng và lý do](#4-cấu-hình-quan-trọng-và-lý-do)
- [5. Payload MQTT ↔ Acceptance Criteria](#5-payload-mqtt--acceptance-criteria)
- [6. Mất luồng và tự kết nối lại](#6-mất-luồng-và-tự-kết-nối-lại)
- [7. Gỡ rối](#7-gỡ-rối)

---

## 1. Chạy lần đầu

```powershell
# 1. Tạo cấu hình Frigate cho máy mình (infra/frigate/config.yml bị gitignore)
pnpm frigate:init

# 2. Bật hạ tầng kèm Frigate (profile cv)
docker compose --profile cv up -d

# 3. Kiểm tra
docker compose ps frigate          # Up (healthy) — lần đầu mất ~1 phút
docker compose logs -f frigate
```

Log khởi động đúng có các dòng:

```text
frigate.detectors.plugins.openvino INFO : Loading OpenVINO model /openvino-model/ssdlite_mobilenet_v2.xml on device CPU
frigate.camera.maintainer          INFO : Camera processor started for cam_living_room
frigate.camera.maintainer          INFO : Camera processor started for cam_test
```

Frigate UI: http://localhost:5000

> **Phải chạy `pnpm frigate:init` TRƯỚC `docker compose --profile cv up`.** Nếu
> `config.yml` chưa tồn tại, Docker tự tạo một **thư mục** tên `config.yml` và Frigate
> chạy cấu hình mặc định (0 camera, MQTT tắt) mà **không báo lỗi**. Script trên tự
> nhận ra và gỡ thư mục rỗng đó — xem [mục 7](#7-gỡ-rối).

Đã có `config.yml` cũ và muốn lấy bản mẫu mới nhất:

```powershell
pnpm frigate:init --force
docker compose --profile cv up -d --force-recreate frigate
```

## 2. Phát luồng có người

Frigate theo dõi hai camera, khớp với các path của MediaMTX:

| Camera (slug)     | Nguồn phát              | Path RTSP                               |
| ----------------- | ----------------------- | --------------------------------------- |
| `cam_living_room` | Webcam                  | `rtsp://localhost:8554/cam_living_room` |
| `cam_test`        | File video lặp vô hạn   | `rtsp://localhost:8554/cam_test`        |
| `cam_kitchen`     | _(tắt — chưa có nguồn)_ | `rtsp://localhost:8554/cam_kitchen`     |

Camera đang bật mà chưa có nguồn phát sẽ báo lỗi `404 Not Found` liên tục trong log —
**đây là hành vi đúng** (Frigate đang thử kết nối lại, [mục 6](#6-mất-luồng-và-tự-kết-nối-lại)).

**Webcam** — xem lệnh đầy đủ ở [FFMPEG_MEDIAMTX_SETUP.md § 4](FFMPEG_MEDIAMTX_SETUP.md#4-phát-webcam-thành-rtsp).

**File video** — video phải **có người**. Clip đã kiểm tra với cấu hình này là
`caviar_Browse1.mp4` trong bộ SPHAR (camera CCTV sảnh trong nhà, người đi vào rồi đi ra):

```powershell
# Giải nén đúng 1 clip từ bộ dataset (thư mục datasets/ bị gitignore).
# Dùng tar có sẵn trên Windows 10+ — Expand-Archive không giải nén lẻ từng file được.
tar -xf .\datasets\SPHAR-Dataset-1.0.zip -C .\datasets `
  SPHAR-Dataset-1.0/videos/walking/caviar_Browse1.mp4

# Clip là HEVC → mã hóa lại sang H.264
ffmpeg -hide_banner -re -stream_loop -1 `
  -i .\datasets\SPHAR-Dataset-1.0\videos\walking\caviar_Browse1.mp4 `
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -an `
  -f rtsp -rtsp_transport tcp rtsp://localhost:8554/cam_test
```

Mở http://localhost:5000 → camera `cam_test` sẽ thấy khung bao quanh người.

## 3. Nghiệm thu bằng một lệnh

Giữ luồng ở mục 2 đang chạy, mở terminal khác:

```powershell
pnpm frigate:check -- --camera cam_test
```

Script nghe `frigate/events` qua `mosquitto_sub` bên trong container (không cần cài MQTT
client), kiểm tra **mọi** message `person` có đủ trường AC yêu cầu, và chỉ báo thành công
khi thấy trọn vòng đời một track: `new` → `end` cùng `track_id`.

Kết quả thật trên máy dev:

```text
  Đang nghe frigate/events (label=person, camera=cam_test) tối đa 180 s ...

  [NEW] cam_test · person · track 1789625260.447541-kxf91t
      score=0.98 top_score=0.79 box=[780, 198, 911, 296]
      zones=[] start=2026-09-17T06:07:40.447Z snapshot=/api/events/1789625260.447541-kxf91t/snapshot.jpg

  [END] cam_test · person · track 1789625260.447541-kxf91t
      score=0.88 top_score=0.95 box=[602, 198, 770, 287]
      zones=[] start=2026-09-17T06:07:40.447Z snapshot=/api/events/1789625260.447541-kxf91t/snapshot.jpg
      end=2026-09-17T06:08:04.031Z

  THÀNH CÔNG: track 1789625260.447541-kxf91t đi đủ vòng đời new → end, mọi message đúng định dạng.
  Đã nhận 20 message, 0 message sai định dạng.
```

| Tham số     | Mặc định         | Ý nghĩa                                |
| ----------- | ---------------- | -------------------------------------- |
| `--camera`  | _(mọi camera)_   | Chỉ xét message của camera này         |
| `--timeout` | `180`            | Số giây chờ tối đa, hết giờ thì exit 1 |
| `--label`   | `person`         | Nhãn object cần kiểm tra               |
| `--topic`   | `frigate/events` | Topic MQTT                             |

### Kiểm tra config và unit test

```powershell
# Frigate có chấp nhận config không — dùng chính validator của image đang ghim
pnpm frigate:validate                                   # config.yml, chưa có thì file mẫu
pnpm frigate:validate -- infra/frigate/config.example.yml

# Unit test logic nghiệm thu + tính nhất quán config với AC (chạy cả trong CI)
pnpm test:tools
```

> **Không tin mã thoát của `frigate --validate-config`.** Với config sai, Frigate 0.18 in lỗi,
> chuyển sang safe mode rồi **vẫn** in `Your config file is valid.` và thoát 0.
> `pnpm frigate:validate` đọc nội dung output nên không bị lừa.

| File test                                            | Kiểm tra gì                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `tools/scripts/test/frigate-events.test.mjs`         | Tham số dòng lệnh, đủ/sai trường AC, vòng đời `new` → `end`, lỗi dừng ngay |
| `tools/scripts/test/frigate-config-example.test.mjs` | Config mẫu khớp AC (≥1 s, min_score 0.5, ≤30 s), compose, mediamtx, `.env` |
| `tools/scripts/test/frigate-init.test.mjs`           | Tạo/giữ/ghi đè config, gỡ thư mục Docker tạo nhầm, thiếu file mẫu          |
| `tools/scripts/test/frigate-validate.test.mjs`       | Đọc đúng output validator, kể cả trường hợp safe mode in "valid"           |

`pnpm frigate:check` dừng và báo **THẤT BẠI ngay** khi gặp message sai định dạng (điểm ngoài 0..1,
box ngược, `end_time` trước `start_time`, thiếu `after`...), không chờ tới hết giờ.

Muốn **tận mắt** xem khung bao người và từng message trên MQTT (Debug View, MQTT Explorer,
bắn message giả): [MQTT_VISUAL_TEST.md](MQTT_VISUAL_TEST.md).

Xem message thô khi cần gỡ lỗi:

```powershell
docker compose exec mosquitto mosquitto_sub -t 'frigate/events' -v
```

## 4. Cấu hình quan trọng và lý do

File: [`infra/frigate/config.example.yml`](../infra/frigate/config.example.yml)

| Cấu hình                           | Giá trị                 | Vì sao                                                                                                  |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Image                              | `frigate:0.18.0` (ghim) | `version` trong config phải khớp image; tag `stable` tự nhảy phiên bản làm Frigate không khởi động được |
| `version`                          | `0.18-0`                | Phải khớp image đã ghim; config mount read-write để Orchestrator đồng bộ thay đổi đã validation         |
| `detectors`                        | OpenVINO trên CPU       | Model có sẵn trong image, chạy mọi CPU x86, ~20 ms/lần suy luận. CPU thuần để sẵn trong comment         |
| `detect.fps`                       | `5`                     | Đủ cho người đi bộ, giảm tải máy yếu (ghi chú kỹ thuật US-01, rủi ro R4)                                |
| `detect.min_initialized`           | `5`                     | **AC US-01 "quá 1 giây"**: 5 frame liên tiếp × 5 fps = 1 giây mới tạo track                             |
| `detect.max_disappeared`           | `25`                    | Mất dấu 5 giây mới coi là rời khung hình → `end`. Tránh một người bị cắt thành nhiều track              |
| `objects.filters.person.min_score` | `0.5`                   | **AC US-02**: frame có điểm thấp hơn bị bỏ qua                                                          |
| `objects.filters.person.threshold` | `0.7`                   | Trung vị điểm của cả track phải ≥ 0.7 thì Frigate mới publish `new`                                     |
| `objects.filters.person.min_area`  | `1500`                  | Lọc bóng người rất xa/nhỏ                                                                               |
| `ffmpeg.retry_interval`            | `10`                    | Khoảng chờ giữa hai lần thử kết nối lại luồng                                                           |
| `database.path`                    | `/db/frigate.db`        | DB nằm trên volume `frigatedb`, không mất lịch sử event khi tạo lại container                           |
| `detect.width` × `height`          | `1280 × 720`            | `box` trong payload tính theo khung này — orchestrator chia cho đúng hai số này để chuẩn hóa            |

**Máy không chạy được OpenVINO** (CPU ARM, lỗi nạp model): trong `config.yml` xóa hai khối
`detectors` + `model`, bỏ comment khối `cpu1`, rồi `docker compose --profile cv up -d --force-recreate frigate`.

## 5. Payload MQTT ↔ Acceptance Criteria

Frigate publish JSON lên `frigate/events` với ba loại:

| `type`   | Khi nào                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| `new`    | Track lần đầu vượt `min_initialized` + `threshold` — **một lần** mỗi track        |
| `update` | Track thay đổi (điểm, box, zone, snapshot tốt hơn) — **rất nhiều**, có thể bỏ qua |
| `end`    | Frigate kết thúc track, `after.end_time` khác `null`                              |

Ánh xạ trường AC của US-02 sang payload (đọc trong object `after`):

| Trường trong AC | Trường payload                   | Ví dụ                               | Ghi chú                                             |
| --------------- | -------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `camera_id`     | `camera`                         | `"cam_test"`                        | Là **slug**, khớp `cameras.slug` trong DB           |
| `label`         | `label`                          | `"person"`                          |                                                     |
| `track_id`      | `id`                             | `"1789613958.41477-np9fac"`         | Giữ nguyên từ `new` → `update` → `end`              |
| `zones[]`       | `current_zones`, `entered_zones` | `["restricted_stove"]`              | `entered_zones` giữ mọi zone từng đi qua            |
| `score`         | `score`, `top_score`             | `0.89`, `0.89`                      | Confidence của frame hiện tại / cao nhất của track  |
| bounding box    | `box`                            | `[957, 177, 1053, 297]`             | `[x1, y1, x2, y2]` pixel theo khung detect 1280×720 |
| timestamp       | `frame_time`                     | `1789613958.620`                    | Epoch giây, dùng làm `detected_at` và `dedup_key`   |
| `start_time`    | `start_time`                     | `1789613958.414`                    | Epoch giây                                          |
| `end_time`      | `end_time`                       | `null` → epoch giây ở `end`         |                                                     |
| snapshot path   | `has_snapshot` + `id`            | `GET /api/events/{id}/snapshot.jpg` | Xem chú ý bên dưới                                  |

> **Snapshot path:** Frigate không gửi đường dẫn file trong payload. Khi `has_snapshot = true`,
> ảnh lấy qua API nội bộ `http://frigate:5000/api/events/{after.id}/snapshot.jpg`
> (đúng bước US-04 trong DATA_FLOW). Không đọc thẳng file trong `/media/frigate/clips` —
> Frigate 0.18 lưu dạng `{camera}-{id}-clean.webp` và render JPEG khi gọi API, tên file có thể đổi giữa các phiên bản.

Payload một message `new` bắt được trên máy dev (đã lược các trường nhóm chưa dùng như
`path_data`, `score_history`, `snapshot`, `region`, `attributes`):

```json
{
  "type": "new",
  "before": { "id": "1789613958.41477-np9fac", "false_positive": true, "...": "..." },
  "after": {
    "id": "1789613958.41477-np9fac",
    "camera": "cam_test",
    "frame_time": 1789613958.620257,
    "label": "person",
    "sub_label": null,
    "top_score": 0.8903836607933044,
    "score": 0.8903836607933044,
    "false_positive": false,
    "box": [957, 177, 1053, 297],
    "area": 11520,
    "current_zones": [],
    "entered_zones": [],
    "has_snapshot": true,
    "has_clip": true,
    "start_time": 1789613958.41477,
    "end_time": null
  }
}
```

Message `end` có cùng cấu trúc, khác ở `"type": "end"` và `after.end_time` là số
(ví dụ `1789613944.022917`).

Không cần Frigate vẫn test được consumer (US-03) bằng message giả — xem
[DEV_ONBOARDING.md § 5 MQTT](DEV_ONBOARDING.md#5-lệnh-hay-dùng).

## 6. Mất luồng và tự kết nối lại

AC US-01: _mất frame quá 30 giây → ghi log lỗi, tự thử lại, không crash._ Frigate đáp ứng
bằng ba lớp có sẵn, không cần viết thêm code:

| Lớp                  | Ngưỡng                                                 | Log                                                                                                   |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Timeout của ffmpeg   | 10 s không có dữ liệu                                  | `ffmpeg.cam_test.detect ERROR : ... Error opening input`                                              |
| Watchdog của Frigate | ffmpeg thoát, hoặc 20 s không có frame (< 30 s của AC) | `Ffmpeg process crashed unexpectedly for cam_test` / `No frames received from cam_test in 20 seconds` |
| Thử kết nối lại      | Mỗi `retry_interval` = 10 s                            | `watchdog.cam_test INFO : Restarting ffmpeg...`                                                       |

Đã kiểm tra trên máy dev: dừng ffmpeg phát `cam_test` → Frigate ghi `ERROR` và
`Restarting ffmpeg...` mỗi 10 giây, container vẫn `healthy`, `RestartCount = 0`.
Phát lại luồng → trong ≤ 10 giây `camera_fps` về lại 5.

Tự kiểm tra:

```powershell
# 1. Đang phát luồng, nhấn Ctrl+C ở terminal ffmpeg
# 2. Xem log
docker compose logs -f frigate | Select-String cam_test
# 3. Container không chết
docker inspect camerai-frigate --format '{{.State.Health.Status}} restarts={{.RestartCount}}'
# 4. Phát lại luồng, kiểm tra camera_fps > 0
curl.exe -s http://localhost:5000/api/stats | ConvertFrom-Json | ForEach-Object { $_.cameras.cam_test.camera_fps }
```

## 7. Gỡ rối

### Frigate chạy nhưng không có camera, UI hiện trình hướng dẫn thêm camera

`infra/frigate/config.yml` đang là **thư mục** (Docker tạo khi file chưa có):

```powershell
Get-Item infra\frigate\config.yml   # Mode bắt đầu bằng d----- là thư mục
pnpm frigate:init
docker compose --profile cv up -d --force-recreate frigate
```

### `pnpm frigate:check` hết giờ, "Không có sự kiện nào"

1. Luồng có đang phát? http://localhost:5000 → camera có hình không, hay `camera_fps` = 0.
2. Video có người không? Video quay màn hình, cảnh không người thì Frigate đúng là không bắn gì.
3. Người quá nhỏ/mờ → điểm dưới `threshold 0.7`. Xem điểm trong Frigate UI → _Debug_, thử clip khác.
4. MQTT: `docker compose exec mosquitto mosquitto_sub -t 'frigate/#' -v` phải thấy các topic
   `frigate/<camera>/.../state`. Không thấy → xem `mqtt.enabled` và `host: mosquitto` trong `config.yml`.

### Có `new` nhưng không thấy `end`

Người vẫn trong khung hình, hoặc video lặp lại quá nhanh nên người "quay lại" trước 5 giây
(`max_disappeared`). Chờ lâu hơn: `pnpm frigate:check -- --timeout 300`.

### Log ngập `Ffmpeg process crashed unexpectedly for cam_living_room`

Camera đang bật mà không có nguồn phát. Bình thường khi dev chỉ dùng một nguồn. Muốn log gọn,
trong `config.yml` đặt `enabled: false` cho camera không dùng.

### Frigate không khởi động, log báo lỗi validate config

Bạn đang dùng `config.yml` cũ viết cho Frigate 0.14 (`version: 0.14`, `record.retain`):

```powershell
pnpm frigate:init --force
docker compose --profile cv up -d --force-recreate frigate
```

### Máy yếu, CPU 100%

Chỉ bật một camera, giữ `fps: 5`. Frigate UI → _System_ xem `inference_speed`: trên 100 ms
nghĩa là detector không theo kịp (rủi ro R4 trong kế hoạch).

---

## Xem tiếp

- [FFMPEG_MEDIAMTX_SETUP.md](FFMPEG_MEDIAMTX_SETUP.md) — phát webcam/file thành RTSP
- [MQTT_VISUAL_TEST.md](MQTT_VISUAL_TEST.md) — kiểm thử trực quan, xem message trên MQTT
- [DATA_FLOW.md § Luồng 1](architecture/DATA_FLOW.md#luồng-1--phát-hiện-người-walking-skeleton-sprint-1) — orchestrator dùng payload này thế nào
- [Tài liệu Frigate — MQTT](https://docs.frigate.video/integrations/mqtt)
