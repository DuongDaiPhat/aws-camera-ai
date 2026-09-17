# Kiểm thử trực quan: xem Frigate phát hiện người và message trên MQTT

> **US-01** · **US-02** · Dùng khi muốn **tận mắt** thấy khung bao người trên video và từng
> message `frigate/events` chạy qua broker — bổ sung cho kiểm thử tự động `pnpm frigate:check`.
> Cài đặt ban đầu: [FRIGATE_MQTT_SETUP.md](FRIGATE_MQTT_SETUP.md).

```text
Video có người → MediaMTX → Frigate ──(xem ở UI, cách 1)
                               └─ MQTT frigate/events → Mosquitto ──(xem ở terminal, cách 2 / GUI, cách 3)
```

Mọi lệnh bên dưới đã chạy thử trên Windows với Frigate 0.18.0. Lệnh viết cho **PowerShell**
(mặc định trên Windows) — những chỗ khác Git Bash có ghi chú riêng.

## Mục lục

- [0. Chuẩn bị](#0-chuẩn-bị)
- [1. Xem trên giao diện Frigate](#1-xem-trên-giao-diện-frigate)
- [2. Xem message bằng terminal](#2-xem-message-bằng-terminal)
- [3. Xem message bằng công cụ GUI](#3-xem-message-bằng-công-cụ-gui)
- [4. Kịch bản kiểm thử trực quan](#4-kịch-bản-kiểm-thử-trực-quan)
- [5. Bắn message giả, không cần Frigate](#5-bắn-message-giả-không-cần-frigate)
- [6. Các topic đáng xem](#6-các-topic-đáng-xem)
- [7. Gỡ rối](#7-gỡ-rối)

---

## 0. Chuẩn bị

Terminal 1 — bật hạ tầng kèm Frigate:

```powershell
pnpm frigate:init
docker compose --profile cv up -d
docker compose ps mosquitto frigate      # cả hai: Up (healthy)
```

Terminal 2 — phát video **có người** vào camera `cam_test` và **giữ terminal này chạy**
(cách lấy clip: [FRIGATE_MQTT_SETUP.md § 2](FRIGATE_MQTT_SETUP.md#2-phát-luồng-có-người)):

```powershell
ffmpeg -hide_banner -re -stream_loop -1 `
  -i .\datasets\SPHAR-Dataset-1.0\videos\walking\caviar_Browse1.mp4 `
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -an `
  -f rtsp -rtsp_transport tcp rtsp://localhost:8554/cam_test
```

Muốn dùng webcam thay video: xem [FFMPEG_MEDIAMTX_SETUP.md § 4](FFMPEG_MEDIAMTX_SETUP.md#4-phát-webcam-thành-rtsp)
và đổi `cam_test` thành `cam_living_room` ở mọi lệnh bên dưới.

---

## 1. Xem trên giao diện Frigate

Mở http://localhost:5000.

### 1.1. Khung bao người theo thời gian thực — Debug View

1. Trang **Live** → bấm vào ô camera **Cam Test** để mở riêng camera đó.
2. Bấm biểu tượng **bánh răng** ở góc trên bên phải → bật công tắc **Debug View**.
3. Ở cột trái, tab **Debugging**, bật các công tắc cần xem:

| Công tắc           | Thấy gì                                              | Dùng để kiểm tra                         |
| ------------------ | ---------------------------------------------------- | ---------------------------------------- |
| **Bounding boxes** | Khung quanh người, kèm nhãn `person` và điểm tin cậy | US-01: có phát hiện, box đúng chỗ        |
| **Zones**          | Viền các zone khai trong config                      | Người có nằm trong zone mong muốn không  |
| **Motion boxes**   | Vùng có chuyển động                                  | Vì sao Frigate chạy/không chạy detector  |
| **Regions**        | Vùng ảnh thật sự được gửi vào detector               | Người quá nhỏ so với region → điểm thấp  |
| **Paths**          | Vết di chuyển của object                             | Track có bị đứt thành nhiều đoạn không   |
| **Timestamp**      | Giờ in trên khung hình                               | Đối chiếu với `frame_time` trong message |

4. Chuyển sang tab **Object List** để xem danh sách object đang được theo dõi và điểm của chúng
   (danh sách cập nhật trễ vài giây so với video).

> Người xuất hiện chưa đủ **1 giây** (`detect.min_initialized: 5` ở 5 fps) thì chưa có track,
> chưa có message `new`. Box có thể nhấp nháy trong Debug View trước khi track được tạo — bình thường.

### 1.2. Sự kiện đã ghi nhận và snapshot

- **Explore** (http://localhost:5000/explore): danh sách tracked object kèm ảnh snapshot. Bấm vào
  một mục để xem chi tiết (điểm, thời gian, zone).
- **Review** (http://localhost:5000/review): các đoạn cảnh báo/phát hiện theo dòng thời gian.

### 1.3. Xem thẳng qua API trong trình duyệt

| URL                                                        | Là gì                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| http://localhost:5000/api/cam_test/latest.jpg?bbox=1       | Khung hình mới nhất có vẽ box (F5 để cập nhật)          |
| http://localhost:5000/api/events?camera=cam_test&limit=5   | 5 sự kiện gần nhất dạng JSON                            |
| `http://localhost:5000/api/events/<track_id>/snapshot.jpg` | Snapshot của một track — lấy `track_id` từ message MQTT |
| http://localhost:5000/api/stats                            | `camera_fps`, `detection_fps`, tốc độ detector          |

---

## 2. Xem message bằng terminal

Không cần cài gì thêm: dùng `mosquitto_sub` có sẵn **bên trong** container mosquitto.

### 2.1. Nghe thô toàn bộ sự kiện

```powershell
docker exec camerai-mosquitto mosquitto_sub -t frigate/events -v
```

Mỗi dòng là `<topic> <JSON một dòng>`. Nhấn `Ctrl+C` để dừng. Thêm `-W 60` để tự dừng sau 60 giây
(khi hết giờ sẽ in `Timed out` — bình thường, không phải lỗi).

### 2.2. Nghe mọi topic của Frigate — nhớ loại ảnh nhị phân

```powershell
docker exec camerai-mosquitto mosquitto_sub -t 'frigate/#' -T 'frigate/+/+/snapshot' -v
```

> ⚠️ **Đừng bỏ `-T 'frigate/+/+/snapshot'`.** Topic `frigate/<camera>/person/snapshot` chứa
> **ảnh JPEG nhị phân**; in ra terminal sẽ thành một màn hình ký tự rác và có thể làm treo terminal.

### 2.3. Bảng tóm tắt trực tiếp — chỉ `new` và `end`

Dễ nhìn nhất khi đứng trước camera hoặc theo dõi video:

```powershell
docker exec camerai-mosquitto mosquitto_sub -t frigate/events | ForEach-Object {
  $m = $_ | ConvertFrom-Json
  if ($m.type -ne 'update') {
    '{0} {1,-6} {2,-9} {3,-28} score={4:N2} box=[{5}] zones=[{6}]' -f (Get-Date -Format HH:mm:ss),
      $m.type, $m.after.camera, $m.after.id, $m.after.score, ($m.after.box -join ','),
      ($m.after.current_zones -join ',')
  }
}
```

Kết quả thật:

```text
13:13:35 new    cam_test  1789625614.505414-feasqx     score=0.95 box=[950,196,1034,320] zones=[]
13:13:36 end    cam_test  1789625602.31519-qy6wv9      score=0.76 box=[864,490,1001,560] zones=[]
13:13:41 new    cam_test  1789625621.303458-90cyqy     score=0.93 box=[686,447,848,576] zones=[]
13:13:45 end    cam_test  1789625614.505414-feasqx     score=0.88 box=[612,198,760,286] zones=[]
```

Để ý: mỗi `track_id` có đúng **một** `new` và **một** `end`; giữa hai dòng đó là nhiều `update` đã bị lọc.

### 2.4. Xem trọn một message dạng JSON dễ đọc

```powershell
docker exec camerai-mosquitto mosquitto_sub -t frigate/events -C 1 |
  ConvertFrom-Json | ConvertTo-Json -Depth 6
```

`-C 1` nhận đúng 1 message rồi thoát. Chỉ lấy các trường mà AC của US-02 yêu cầu:

```powershell
docker exec camerai-mosquitto mosquitto_sub -t frigate/events -C 1 |
  ConvertFrom-Json | Select-Object type -ExpandProperty after |
  Select-Object type, id, camera, label, score, top_score, box, current_zones, has_snapshot, start_time, end_time
```

<details>
<summary>Dùng Git Bash thay PowerShell</summary>

Git Bash không có `ConvertFrom-Json`; dùng Node (máy dev nào cũng có) để in bảng tóm tắt:

```bash
docker exec camerai-mosquitto mosquitto_sub -t frigate/events | node -e "
  require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line);
    if (m.type !== 'update') console.log(new Date().toLocaleTimeString(), m.type.padEnd(6),
      m.after.camera, m.after.id, 'score=' + m.after.score, 'box=' + JSON.stringify(m.after.box));
  });"
```

</details>

### 2.5. Kiểm tra tự động song song

Trong lúc xem bằng mắt, có thể chạy thêm ở terminal khác để máy xác nhận định dạng:

```powershell
pnpm frigate:check -- --camera cam_test
```

---

## 3. Xem message bằng công cụ GUI

Mosquitto mở cổng **1883** ra máy host, không yêu cầu đăng nhập (chỉ ở môi trường dev).

| Thông số kết nối | Giá trị      |
| ---------------- | ------------ |
| Protocol         | `mqtt://`    |
| Host             | `localhost`  |
| Port             | `1883`       |
| Username / Pass  | _(để trống)_ |
| TLS              | Tắt          |

> Broker **không** bật WebSocket, nên các client chạy trong trình duyệt (MQTTX Web, HiveMQ
> Websocket Client…) **không kết nối được**. Dùng ứng dụng desktop.

### MQTT Explorer — xem dạng cây topic

Tải tại https://mqtt-explorer.com. Tạo kết nối với thông số ở bảng trên rồi **Connect**.

- Mở nhánh `frigate` → `events`: khung bên phải hiện message mới nhất dạng JSON, kèm lịch sử
  các message trước đó.
- Nhánh `frigate` → `cam_test` → `person`: **số người** camera đang thấy (`0`, `1`, `2`…) — nhìn số
  này nhảy khi người đi vào/ra khung hình là cách kiểm tra trực quan nhanh nhất.
- Nhánh `frigate` → `cam_test` → `status` → `detect`: `online` / `offline`.

### MQTTX — đăng ký topic cụ thể, định dạng JSON

Tải bản desktop tại https://mqttx.app. Tạo kết nối với thông số ở bảng trên, sau đó
**New Subscription** với topic `frigate/events`, chọn hiển thị payload dạng **JSON**.

---

## 4. Kịch bản kiểm thử trực quan

Mở song song: Frigate **Debug View** (mục 1.1) + **bảng tóm tắt** (mục 2.3) hoặc MQTT Explorer.
Với webcam, tự đóng vai người; với video, quan sát khi người trong clip đi vào/ra.

| #   | Thao tác                             | Frigate UI                           | MQTT mong đợi                                                                          | AC           |
| --- | ------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------- | ------------ |
| 1   | Khung hình không có ai               | Không có box `person`                | Không có `frigate/events`; `frigate/cam_test/person` = `0`                             | —            |
| 2   | Lướt qua camera **dưới 1 giây**      | Box có thể chớp rồi mất              | **Không** có `new`                                                                     | US-01        |
| 3   | Đi vào và ở lại **trên 1 giây**      | Box `person` kèm điểm                | Một `new` với `camera`, `label=person`, `id`, `score`, `box`, `start_time`             | US-01, US-02 |
| 4   | Đi lại trong khung hình              | Box bám theo người, **Paths** vẽ vết | Nhiều `update` **cùng `id`**; `frigate/cam_test/person` = `1`                          | US-02        |
| 5   | Đi vào một zone (camera có zone)     | Bật **Zones** thấy người trong viền  | `current_zones` / `entered_zones` chứa tên zone                                        | US-02        |
| 6   | Rời khỏi khung hình, chờ **~5 giây** | Box biến mất                         | Một `end` **cùng `id`** ở bước 3, `end_time` khác `null` và lớn hơn `start_time`       | US-02        |
| 7   | Mở snapshot của track vừa kết thúc   | Ảnh có người, có box                 | http://localhost:5000/api/events/`<id>`/snapshot.jpg trả ảnh (khi `has_snapshot=true`) | US-02        |
| 8   | Dừng ffmpeg (`Ctrl+C` ở terminal 2)  | Camera báo mất hình sau vài giây     | `frigate/cam_test/status/detect` = `offline`                                           | US-01        |
| 9   | Phát lại ffmpeg                      | Hình quay lại trong ≤ 10–20 giây     | `frigate/cam_test/status/detect` = `online`, sự kiện tiếp tục                          | US-01        |

Theo dõi trạng thái camera cho bước 8–9:

```powershell
docker exec camerai-mosquitto mosquitto_sub -t 'frigate/+/status/detect' -t 'frigate/+/person' -v
```

Song song, xem log Frigate để thấy nó tự thử kết nối lại:

```powershell
docker compose logs -f frigate | Select-String cam_test
```

---

## 5. Bắn message giả, không cần Frigate

Hữu ích khi muốn xem MQTT Explorer/MQTTX hiển thị ra sao, hoặc thử `pnpm frigate:check` báo lỗi
với payload sai, mà không cần bật Frigate hay phát video.

Payload mẫu nằm sẵn trong repo, **mỗi dòng là một message** (định dạng giống hệt Frigate gửi):

| File                                             | Nội dung                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `infra/mosquitto/samples/person-lifecycle.jsonl` | `new` → `update` → `end` của track `demo-1`, có zone `restricted_stove` |
| `infra/mosquitto/samples/person-invalid.jsonl`   | `new` sai: `score = 7.5`, box ngược                                     |

```powershell
# Terminal A — xem, hoặc để máy kiểm tra: pnpm frigate:check -- --camera cam_fake --timeout 60
docker exec camerai-mosquitto mosquitto_sub -t frigate/events -v

# Terminal B (PowerShell) — gửi cả vòng đời new → update → end
cmd /c "docker exec -i camerai-mosquitto mosquitto_pub -t frigate/events -l < inframosquittosamplesperson-lifecycle.jsonl"

# Gửi message sai định dạng
cmd /c "docker exec -i camerai-mosquitto mosquitto_pub -t frigate/events -l < inframosquittosamplesperson-invalid.jsonl"
```

Git Bash dùng redirect trực tiếp:

```bash
docker exec -i camerai-mosquitto mosquitto_pub -t frigate/events -l < infra/mosquitto/samples/person-lifecycle.jsonl
```

Kết quả mong đợi:

- `person-lifecycle.jsonl` → `pnpm frigate:check` báo **THÀNH CÔNG** với track `demo-1`.
- `person-invalid.jsonl` → `pnpm frigate:check` báo **THẤT BẠI** ngay, liệt kê
  `score (after.score) = 7.5` và `bounding box (after.box) = [640,700,412,180]`.

> ⚠️ **Vì sao phải `cmd /c ... <` mà không pipe từ PowerShell?** Đã thử và cả hai cách đều hỏng
> trên Windows PowerShell 5.1:
>
> - `mosquitto_pub -m '{"type":"new"}'`: PowerShell **xóa dấu nháy kép**, broker nhận `{type:new}`.
> - `'{...}' | docker exec -i ... mosquitto_pub -s`: PowerShell **chèn BOM UTF-8** vào đầu payload
>   (kể cả khi đặt `$OutputEncoding` không BOM) và gửi kèm ký tự xuống dòng → không còn là JSON hợp lệ.
>
> Redirect `<` của `cmd` chuyển nguyên byte của file, không thêm bớt gì.
> Muốn thử payload khác: sửa hoặc thêm file `.jsonl`, **mỗi message viết trên một dòng**.

Message giả dùng `cam_fake` để không lẫn với sự kiện thật của `cam_test`. Orchestrator (US-03)
cũng subscribe `frigate/events` — khi orchestrator đã chạy, message giả có thể đi vào DB.

---

## 6. Các topic đáng xem

| Topic                              | Payload                       | Ghi chú                                           |
| ---------------------------------- | ----------------------------- | ------------------------------------------------- |
| `frigate/events`                   | JSON `new` / `update` / `end` | **Topic chính của US-02**, orchestrator subscribe |
| `frigate/<camera>/person`          | Số: `0`, `1`, `2`…            | Số người camera đang thấy (retained)              |
| `frigate/<camera>/person/active`   | Số                            | Số người đang di chuyển                           |
| `frigate/<camera>/person/snapshot` | **Ảnh JPEG nhị phân**         | Không in ra terminal — dùng `-T` để loại          |
| `frigate/<camera>/status/detect`   | `online` / `offline`          | Mất luồng / có luồng lại                          |
| `frigate/reviews`                  | JSON                          | Đoạn review (alert/detection) — US sau mới dùng   |
| `frigate/available`                | `online` / `offline`          | Frigate còn kết nối broker không                  |
| `frigate/stats`                    | JSON lớn, mỗi 60 giây         | `cameras.<camera>.camera_fps`, `detection_fps`    |

Ý nghĩa từng trường trong `frigate/events` và ánh xạ sang AC:
[FRIGATE_MQTT_SETUP.md § 5](FRIGATE_MQTT_SETUP.md#5-payload-mqtt--acceptance-criteria).

---

## 7. Gỡ rối

### Terminal đầy ký tự rác rồi đứng hình

Bạn đã nghe `frigate/#` mà không loại topic ảnh. Đóng terminal, mở lại và dùng lệnh ở mục 2.2
(có `-T 'frigate/+/+/snapshot'`).

### `mosquitto_sub` không in gì

1. Debug View có box `person` không? Không có box → Frigate chưa phát hiện, MQTT đúng là im lặng.
   Kiểm tra luồng video đang phát và video có người.
2. Frigate có nối broker không:
   `docker exec camerai-mosquitto mosquitto_sub -t frigate/available -C 1 -W 5` phải in `online`.
3. Chỉ thấy `update` mà không có `new`: bạn bắt đầu nghe sau khi track đã tạo. Để người rời khung
   hình rồi vào lại.

### Có `new` nhưng mãi không thấy `end`

Người vẫn còn trong khung hình, hoặc video lặp lại quá nhanh nên người "quay lại" trong vòng
5 giây (`detect.max_disappeared: 25`). Chờ lâu hơn hoặc dùng clip dài hơn.

### MQTT Explorer / MQTTX báo không kết nối được

- `docker compose ps mosquitto` phải là `Up (healthy)`.
- Kiểm tra cổng: `Test-NetConnection localhost -Port 1883` → `TcpTestSucceeded : True`.
- Đã đổi `PORT_MQTT` trong `.env` thì dùng cổng đó thay cho 1883.
- Dùng bản **desktop**; bản chạy trong trình duyệt cần WebSocket mà broker chưa bật.

### `ConvertFrom-Json` báo lỗi `Invalid JSON primitive` hoặc `frigate:check` báo "Payload không phải JSON"

Message giả được gửi bằng `-m '...'` hoặc pipe từ PowerShell nên bị mất dấu nháy / dính BOM.
Gửi lại bằng file `.jsonl` theo mục 5.

### In ra `Timed out` và mã thoát 27

Do cờ `-W <giây>` hết giờ — hành vi bình thường của `mosquitto_sub`, không phải lỗi.

---

## Xem tiếp

- [FRIGATE_MQTT_SETUP.md](FRIGATE_MQTT_SETUP.md) — cấu hình Frigate, nghiệm thu tự động, cơ chế kết nối lại
- [DATA_FLOW.md § Luồng 1](architecture/DATA_FLOW.md#luồng-1--phát-hiện-người-walking-skeleton-sprint-1) — orchestrator dùng message này thế nào
- [Frigate — MQTT](https://docs.frigate.video/integrations/mqtt) — danh sách đầy đủ topic
