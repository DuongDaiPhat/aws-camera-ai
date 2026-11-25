# BÁO CÁO KỸ THUẬT & HƯỚNG DẪN TRIỂN KHAI PRODUCTION: MODULE PHÁT HIỆN TÉ NGÃ (M2a)

> **Dự án:** Hệ thống camera giám sát thông minh ứng dụng AI và AWS (ARGUS-AI)  
> **Module:** M2a — Phát hiện và cảnh báo té ngã bất động (US-16, US-17)  
> **Đối tượng sử dụng:** Đội ngũ DevOps / Backend / QA thực hiện triển khai và vận hành Production  
> **Tài liệu liên quan:**
>
> - [BAO_CAO_AI_TE_NGA_GIUA_KY.md](./BAO_CAO_AI_TE_NGA_GIUA_KY.md)
> - [CHUNG_MINH_NGUONG_VA_THUAT_TOAN_TE_NGA.md](./CHUNG_MINH_NGUONG_VA_THUAT_TOAN_TE_NGA.md)
> - [GIAI_THICH_TRUC_QUAN_CONG_THUC_TE_NGA.md](./GIAI_THICH_TRUC_QUAN_CONG_THUC_TE_NGA.md)

---

## 1. Thông tin Model AI sử dụng & Cách tải

Module M2a **không tự huấn luyện mạng neural nặng** mà sử dụng mô hình trích xuất khung xương chính thức của Google: **MediaPipe Pose Landmarker Lite**, kết hợp thuật toán động học hình học và máy trạng thái hữu hạn (Kinematic FSM).

### 1.1. Đặc tả Model (`services/ai-service/model-manifest.json`)

| Thuộc tính              | Giá trị chính thức                                                                                                         |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Tên model**           | MediaPipe Pose Landmarker Lite (`float16`, v1)                                                                             |
| **Tên file**            | `pose_landmarker_lite.task`                                                                                                |
| **Model Version**       | `pose-landmarker-lite-v1`                                                                                                  |
| **Dung lượng**          | `5,777,746 bytes` (~`5.51 MiB`)                                                                                            |
| **Giấy phép (License)** | `Apache-2.0 (MediaPipe)`                                                                                                   |
| **Mã kiểm tra SHA-256** | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`                                                         |
| **URL tải chính thức**  | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` |
| **Đầu ra của model**    | 33 landmarks 3D $(x, y, z, \text{visibility})$ trên mỗi người, chạy hoàn toàn trên CPU (`RunningMode.IMAGE`)               |

### 1.2. Cách tải & Xác thực Model khi triển khai

> **Lưu ý quan trọng:** File `pose_landmarker_lite.task` **không được commit vào Git** và **không được đóng gói sẵn bên trong Docker image** (`services/ai-service/Dockerfile`). Khi chạy container `camerai-ai`, thư mục `./services/ai-service/models` trên máy chủ được mount vào `/app/models:ro`.

**Cách 1 (Khuyên dùng — tự động tải và kiểm tra SHA-256 theo manifest):**

```bash
python services/ai-service/scripts/fetch_models.py --output-dir services/ai-service/models
```

_(Script tự động đọc `services/ai-service/model-manifest.json`, tải `pose_landmarker_lite.task` cùng 2 model Face, kiểm tra SHA-256 và bỏ qua nếu file đã hợp lệ.)_

**Cách 2 (Tải thủ công khi không chạy Python trên host):**

```bash
mkdir -p services/ai-service/models
curl -L -o services/ai-service/models/pose_landmarker_lite.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
sha256sum services/ai-service/models/pose_landmarker_lite.task
# Phải khớp: 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
```

---

## 2. Kiến trúc triển khai & Các thành phần liên quan

### 2.1. Phân bổ Edge vs Cloud trong Production

- **Cloud Production (`deploy/compose.yml`):** Chạy các dịch vụ trung tâm gồm `postgres`, `redis`, `orchestrator`, `web`, `migrate`, `caddy`.
- **Edge Gateway / Máy cục bộ (`docker-compose.yml` với `--profile cv`):** Chạy `mediamtx` (RTSP), `mosquitto` (MQTT), `frigate` (phát hiện người & track ID), và `ai-service` (`camerai-ai`, FastAPI chạy MediaPipe Pose + FallTracker).

### 2.2. Bản đồ mã nguồn của Module M2a

| Tầng xử lý               | Thành phần / Đường dẫn                                      | Vai trò                                                                                                                                                                          |
| :----------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edge Frame Bridge**    | `infra/frigate/frame-metadata/bridge.py`                    | Lấy frame + bbox `person` + `track_id` từ Frigate ở `5 FPS`, publish lên MQTT `frigate/camerai/pose/frames`.                                                                     |
| **API Endpoint**         | `services/ai-service/app/routers/pose.py`                   | Nhận `POST /pose/fall` (multipart ảnh + metadata), giới hạn đồng thời & timeout.                                                                                                 |
| **Pose Estimator**       | `services/ai-service/app/services/pose_estimator.py`        | Chạy `PoseLandmarker` (`num_poses=2`, `min_pose_detection_confidence=0.3`), có fallback quét toàn khung hình nếu crop ROI trượt.                                                 |
| **Hình học & Động học**  | `services/ai-service/app/services/pose_geometry.py`         | Tính $\theta_{2D}$, $\theta_{3D}$, `centerDropRatio`, `torso_shrink_ratio`, `aspect_ratio`, `motionScore`.                                                                       |
| **Máy trạng thái (FSM)** | `services/ai-service/app/services/fall_tracker.py`          | Quản lý vòng đời `MONITORING` $\rightarrow$ `CANDIDATE` $\rightarrow$ `CONFIRMED` / `CANCELLED`, sinh `episodeId` chuẩn UUIDv5.                                                  |
| **Registry & Sweeper**   | `services/ai-service/app/services/fall_tracker_registry.py` | Quản lý bộ nhớ tối đa `128` track, quét timeout/TTL mỗi `250ms`.                                                                                                                 |
| **Cấu hình**             | `services/ai-service/app/config.py`                         | Định nghĩa & validate toàn bộ tham số `M2A_*`, `POSE_*`, `FALL_*`.                                                                                                               |
| **Orchestrator**         | `apps/orchestrator/src/fall-detection/`                     | Lọc vùng `REST_AREA`, gọi AI Service, tạo `events` (`FALL_DETECTED`, mức `P1`) & `fall_incidents`, lưu snapshot, kích hoạt `EscalationEngineService` gửi **Telegram** & **SSE**. |

---

## 3. Cấu hình biến môi trường Production (`.env` & `docker-compose.yml`)

### 3.1. Công tắc kích hoạt & Frigate Edge

| Biến môi trường                        | Giá trị Production khuyến nghị | Mô tả                                                                             |
| :------------------------------------- | :----------------------------: | :-------------------------------------------------------------------------------- |
| `M2A_ENABLED`                          |             `true`             | Bật/tắt toàn bộ tính năng phát hiện té ngã trên cả `orchestrator` và `ai-service` |
| `FRIGATE_POSE_FRAMES_ENABLED`          |             `true`             | Cho phép Frigate bridge gửi frame sang MQTT pose topic                            |
| `FRIGATE_FRAME_OBJECT_MAX_AGE_SECONDS` |             `2.0`              | Tuổi tối đa của object frame trước khi bị loại                                    |
| `MQTT_TOPIC_POSE_FRAMES`               | `frigate/camerai/pose/frames`  | Topic MQTT truyền frame pose                                                      |
| `POSE_SAMPLE_FPS`                      |              `5`               | Tần suất lấy mẫu frame gửi sang AI Service ($200\text{ ms/frame}$)                |

### 3.2. Cấu hình Model & Ngưỡng thuật toán AI (`ai-service`)

| Biến môi trường                    |           Giá trị Production            |         Giá trị mặc định `config.py`         | Ý nghĩa                                               |
| :--------------------------------- | :-------------------------------------: | :------------------------------------------: | :---------------------------------------------------- |
| `POSE_MODEL_PATH`                  | `/app/models/pose_landmarker_lite.task` | `artifacts/models/pose_landmarker_lite.task` | Đường dẫn file model trong container                  |
| `POSE_MODEL_VERSION`               |        `pose-landmarker-lite-v1`        |          `pose-landmarker-lite-v1`           | Nhãn phiên bản model lưu vào DB/event                 |
| `POSE_MIN_VISIBILITY`              |                 `0.30`                  |           `0.30` (cap $\le 0.30$)            | Ngưỡng visibility tối thiểu của landmark              |
| `POSE_MIN_ASSOCIATION_IOU`         |                 `0.30`                  |                    `0.30`                    | IoU tối thiểu ghép pose với bbox Frigate              |
| `POSE_ROI_PADDING_RATIO`           |                 `0.20`                  |                    `0.10`                    | Mở rộng vùng crop $20\%$ tránh cắt khớp               |
| `FALL_HISTORY_FRAME_COUNT`         |                   `5`                   |                     `10`                     | Số frame tối thiểu trong bộ đệm baseline              |
| `FALL_HISTORY_MAX_SECONDS`         |                  `4.0`                  |                    `3.0`                     | Cửa sổ thời gian tối đa của baseline                  |
| `FALL_TORSO_ANGLE_THRESHOLD_DEG`   |                  `30`                   |                    `30.0`                    | Ngưỡng góc thân 2D/3D để vào `CANDIDATE`              |
| `FALL_CENTER_DROP_RATIO`           |                 `0.20`                  |                    `0.20`                    | Tỷ lệ hạ trọng tâm tối thiểu ($\ge 20\%$)             |
| `FALL_TORSO_SHRINK_RATIO`          |                 `0.55`                  |                    `0.55`                    | Co ngắn thân phối cảnh ($< 55\%$) cho ngã dọc         |
| `FALL_ASPECT_RATIO_THRESHOLD`      |                 `0.90`                  |                    `0.90`                    | Tỷ lệ $H/W < 0.90$ cho tư thế nằm bẹp                 |
| `FALL_IMMOBILITY_SECONDS`          |                  `15`                   |                    `3.0`                     | Thời gian nằm bất động để xác nhận `CONFIRMED`        |
| `FALL_MOTION_SPEED_THRESHOLD`      |                 `0.20`                  |                    `0.05`                    | Ngưỡng chuyển động dưới `0.20` coi là bất động        |
| `FALL_RECOVERY_ANGLE_DEG`          |                  `60`                   |                    `60.0`                    | Góc thân $\ge 60^\circ$ hủy `CANDIDATE` (`RECOVERED`) |
| `FALL_MAX_VALID_FRAME_GAP_SECONDS` |                 `5.00`                  |                    `0.60`                    | Khoảng trống tối đa trước khi reset bộ đếm            |
| `FALL_MISSING_POSE_GRACE_SECONDS`  |                  `10`                   |                    `5.0`                     | Thời gian chờ tối đa khi mất pose trong `CANDIDATE`   |
| `FALL_CANDIDATE_MAX_SECONDS`       |                  `60`                   |                    `60.0`                    | Thời gian tối đa giữ `CANDIDATE`                      |

### 3.3. Giới hạn tài nguyên & An toàn hệ thống

| Biến môi trường                |            Giá trị            | Vai trò                                                  |
| :----------------------------- | :---------------------------: | :------------------------------------------------------- |
| `POSE_MAX_CONCURRENT_REQUESTS` |              `2`              | Giới hạn số request suy luận song song (tránh nghẽn CPU) |
| `POSE_MAX_TRACKS`              |             `128`             | Số track tối đa giữ trong RAM                            |
| `POSE_TRACK_TTL_SECONDS`       |             `60`              | Thời gian dọn track không còn dữ liệu                    |
| `POSE_TRACK_SWEEP_INTERVAL_MS` |             `250`             | Chu kỳ quét timeout của background sweeper               |
| `POSE_MAX_IMAGE_BYTES`         |   `1048576` ($1\text{ MB}$)   | Giới hạn dung lượng ảnh đầu vào                          |
| `POSE_MAX_IMAGE_PIXELS`        | `2073600` ($1920\times 1080$) | Giới hạn độ phân giải ảnh đầu vào                        |
| `POSE_REQUEST_TIMEOUT_MS`      |            `2000`             | Timeout xử lý mỗi frame                                  |

---

## 4. Tóm tắt hiệu năng & Độ tin cậy đã kiểm chứng

### 4.1. Độ chính xác trên 3 bộ dữ liệu chuẩn (795 video tổng cộng)

- **Tập Test quy mô lớn (`Test_Dataset_70_30` — 500 video, pha `CANDIDATE`):**
  - Precision = **96.31%** (95% CI: `93.98% – 98.33%`)
  - Recall = **82.00%** (95% CI: `77.81% – 85.76%`)
  - F1-Score = **88.58%** (95% CI: `85.85% – 91.05%`)
- **Tập Le2i (`Dataset_Classified` — 103 video):**
  - Pha `CANDIDATE`: Precision = **82.05%**, Recall = **88.89%**, F1 = **85.33%**.
  - Pha `CONFIRMED` (`3.0s`, `motion=0.20`): Precision = **100.0% (`FP = 0`)**.
- **Tập Multiple Cameras (`Fall_dataset` — 192 video, kiểm chứng `FALL_RECOVERY_ANGLE_DEG = 60°`):**
  - **68/149** ca vào `CANDIDATE` tự hủy về `RECOVERED` với thời gian đứng dậy trung vị **`1.7s`** và góc thân trung bình **`69.47°`**.

### 4.2. Hiệu năng phần cứng (CPU only, không cần GPU)

- Độ trễ suy luận trung vị (`p50`): **`50.61 ms`**; tối đa (`p95`): **`110.65 ms`** (nằm gọn trong chu kỳ `200 ms` của `5 FPS`).
- Thông lượng: **`16.77 samples/sec`** (đủ tải đồng thời 3 camera `5 FPS` trên 1 nhân CPU).

---

## 5. Checklist nghiệm thu trước & sau khi Deploy Production

1. **Kiểm tra file Model trên máy chạy `ai-service`:**
   - Đảm bảo `services/ai-service/models/pose_landmarker_lite.task` tồn tại và khớp SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
2. **Kiểm tra Healthcheck của `ai-service`:**
   - Gọi `GET http://<ai-service-host>:8000/health` $\rightarrow$ trả về `200 OK` và xác nhận model pose đã load thành công.
3. **Kiểm tra cấu hình Zone (`REST_AREA`):**
   - Khai báo polygon giường ngủ / sofa trên giao diện Web cho các camera trong nhà để tránh báo động giả khi nằm nghỉ.
4. **Kiểm tra liên kết Telegram của người nhận cảnh báo:**
   - Hệ thống gửi cảnh báo `FALL_DETECTED` (P1) ưu tiên theo thứ tự: tài khoản **`CAREGIVER`** đang active trong hộ gia đình $\rightarrow$ nếu không có mới fallback về chủ thiết bị (**`ADMIN`**).
   - Bắt buộc tài khoản nhận cảnh báo phải hoàn tất liên kết Telegram (`telegram_linked_at IS NOT NULL`), tránh lỗi `TELEGRAM_LINK_NOT_VERIFIED` khi phát sự kiện.
5. **Kiểm tra End-to-End sau deploy:**
   - Test thực tế 1 ca té ngã và nằm yên $> 15\text{ giây}$ ngoài vùng `REST_AREA` $\rightarrow$ xác nhận xuất hiện event P1 trên Web Dashboard (SSE + chuông), ảnh snapshot lưu được trên MinIO/S3, và tin nhắn Telegram kèm 2 nút `[✅ Tôi ổn]` / `[🆘 Cần giúp đỡ]` gửi về đúng người nhận.
