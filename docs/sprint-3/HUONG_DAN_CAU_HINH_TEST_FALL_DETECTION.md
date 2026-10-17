# Hướng dẫn Cấu hình & Chạy thử Tính năng Phát hiện Té ngã (US-16 & US-17 - Module M2a)

Tài liệu này hướng dẫn chi tiết cho các thành viên trong đội ngũ phát triển cách tải các mô hình AI, cấu hình môi trường, chạy các bộ kiểm thử tự động và thực hiện kịch bản kiểm thử trực tiếp (End-to-End) tính năng **Phát hiện té ngã bất động (M2a Fall Detection)** trên camera/webcam.

---

## 1. Cần tải những gì & Đặt ở đâu?

Hệ thống sử dụng mô hình **Google MediaPipe Pose Landmarker** để trích xuất 33 điểm mốc khớp cơ thể (keypoints) và tính toán góc thân (`torso_angle`), tỷ lệ co giãn (`aspect_ratio`), độ dịch chuyển tâm thân (`center_drop_ratio`) theo thời gian thực.

### Danh sách mô hình cần thiết

| Tên File | Mô tả | Kích thước | Nơi lưu trữ trong dự án |
| :--- | :--- | :--- | :--- |
| **`pose_landmarker_lite.task`** *(Bắt buộc cho M2a)* | Model MediaPipe Pose Landmarker (bản Lite, tối ưu CPU) | ~9.2 MB | `services/ai-service/models/pose_landmarker_lite.task` |
| **`face_detection_yunet_2023mar.onnx`** *(M1)* | Model phát hiện khuôn mặt YuNet OpenCV Zoo | ~350 KB | `services/ai-service/models/face_detection_yunet_2023mar.onnx` |
| **`face_recognition_sface_2021dec.onnx`** *(M1)* | Model nhận diện & trích xuất vector SFace | ~38 MB | `services/ai-service/models/face_recognition_sface_2021dec.onnx` |

### Link tải chính thức và Lệnh tải nhanh

Thành viên có thể tải file mô hình `pose_landmarker_lite.task` từ kho lưu trữ Google Cloud Storage chính thức:

- **URL tải trực tiếp:**  
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`

#### Lệnh tải tự động qua PowerShell (Windows):
```powershell
New-Item -ItemType Directory -Force -Path "services/ai-service/models"
Invoke-WebRequest -Uri "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task" -OutFile "services/ai-service/models/pose_landmarker_lite.task"
```

#### Lệnh tải tự động qua cURL / Wget (Linux/macOS):
```bash
mkdir -p services/ai-service/models
curl -L -o services/ai-service/models/pose_landmarker_lite.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task
```

---

## 2. Cấu hình biến môi trường (`.env`)

Sao chép `.env.example` thành `.env` (nếu chưa có) và đảm bảo các biến sau được thiết lập:

```dotenv
# Bật tính năng phát hiện té ngã M2a trên Orchestrator
M2A_ENABLED=true

# Ngưỡng thời gian bất động cần thiết để xác nhận té ngã (mặc định 15 giây theo AC17-1)
# Mẹo: Khi dev có thể đặt thành 5 để kiểm thử phản ứng nhanh
FALL_IMMOBILITY_SECONDS=15

# Đường dẫn file mô hình Pose trong container AI Service
POSE_MODEL_PATH=/app/models/pose_landmarker_lite.task

# Bật luồng đóng gói binary envelope pose frames từ Frigate Bridge
FRIGATE_POSE_FRAMES_ENABLED=true
FRIGATE_POSE_MAX_FPS=5.0
MQTT_TOPIC_POSE_FRAMES=frigate/camerai/pose/frames
```

---

## 3. Khởi động hệ thống Docker

Khởi động toàn bộ stack dịch vụ bao gồm Frigate và AI Service:

```powershell
# Khởi động kèm profile cv (Frigate)
docker compose --profile cv up -d

# Khởi động lại 3 container cốt lõi để nạp mã nguồn mới nhất:
docker restart camerai-orchestrator camerai-ai camerai-frigate
```

Kiểm tra trạng thái các container bằng lệnh:
```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```
> Tất cả các container `camerai-orchestrator`, `camerai-ai`, `camerai-frigate`, `camerai-web`, `camerai-postgres`, `camerai-mosquitto`, `camerai-mediamtx` phải ở trạng thái **Up** (healthy).

---

## 4. Chạy kiểm thử tự động (Unit Tests)

Trước khi thử nghiệm với camera thực tế, hãy chạy bộ test để xác nhận toàn bộ logic hoạt động chính xác:

### 4.1. Kiểm thử AI Service (MediaPipe, Pose Geometry, Fall Tracker)
```powershell
docker exec camerai-ai pytest /app/tests/test_pose_geometry.py /app/tests/test_fall_tracker.py -v
```
- **Kết quả kỳ vọng:** `11 passed` (100% passed).

### 4.2. Kiểm thử Backend Orchestrator (Fall Detection Module & Media Service)
```powershell
docker exec camerai-orchestrator pnpm test src/fall-detection test/media.service.spec.ts
```
- **Kết quả kỳ vọng:** `6 test suites passed, 34 tests passed` (100% passed).

---

## 5. Quy trình Kiểm thử Trực tiếp (End-to-End Live Test)

### Bước 1: Mở Web Dashboard
- Truy cập trình duyệt: [http://localhost:3000](http://localhost:3000).
- Đăng nhập tài khoản quản trị (hoặc tài khoản giám sát).

### Bước 2: Bật phát luồng Webcam
- Điều hướng vào camera phòng khách (`cam_living_room`).
- Bấm **"Bật xem trước Webcam"** $\to$ sau đó bấm **"Bắt đầu truyền phát WHIP"**.
- Trình duyệt sẽ phát luồng webcam trực tiếp lên MediaMTX thông qua WebRTC (WHIP).

> ⚠️ **LƯU Ý RẤT QUAN TRỌNG:**  
> **Giữ nguyên tab trình duyệt hiển thị trên màn hình trong suốt quá trình test!**  
> Trình duyệt có cơ chế tiết kiệm tài nguyên khi ẩn tab hoặc chuyển sang tab khác sẽ làm ngắt luồng WebRTC $\to$ MediaMTX ngắt stream (báo lỗi 404) $\to$ Frigate mất nguồn cấp video.

### Bước 3: Mô phỏng hành động Té ngã
1. **Giai đoạn nhận diện (2-3 giây đầu):**  
   Đứng hoặc ngồi trước webcam để Frigate phát hiện người, gán `track_id` và bắt đầu theo dõi.
2. **Giai đoạn ngã & bất động ($\ge 15$ giây):**  
   Nằm xuống sàn hoặc nệm (có thể nằm ngửa, nằm sấp hoặc nằm nghiêng một bên) sao cho cơ thể nằm ngang trong khung hình của camera:
   - AI sẽ phát hiện góc thân ngã nằm ngang (`angle < 30°` hoặc `aspect_ratio < 0.8`).
   - Trạng thái chuyển sang `CANDIDATE`.
   - **Giữ nguyên tư thế nằm yên trong ít nhất 15 đến 16 giây.**
   - Sau khi đủ 15 giây bất động, trạng thái chuyển sang `CONFIRMED`.

### Bước 4: Quan sát Kết quả Phản hồi
- Trên **Web Dashboard**: Sự kiện màu đỏ **P1 Khẩn cấp - `FALL_DETECTED` (Phát hiện té ngã)** lập tức xuất hiện ở đầu danh sách sự kiện, kèm chuông âm thanh cảnh báo khẩn cấp.
- **Xem ảnh bằng chứng Snapshot**: Bấm vào sự kiện để mở modal **Chi tiết sự kiện**, bạn sẽ thấy bức ảnh chụp khung hình camera tại thời điểm ngã hiển thị rõ ràng người nằm trên sàn, ngày giờ phát hiện và vị trí camera.
- **Tương tác xác nhận**: Người dùng hoặc người thân có thể bấm nút **"Tôi ổn (An toàn)"** hoặc **"Cần giúp đỡ (Leo thang)"**.
- Trên **Telegram** (nếu đã cấu hình bot): Nhận tin nhắn thông báo P1 khẩn cấp có đính kèm ảnh bằng chứng và vị trí camera.

---

## 6. Lệnh theo dõi Log theo Thời gian thực (Real-time Debugging)

Mở 1 cửa sổ PowerShell riêng để xem hệ thống đếm giây bất động trực tiếp:

### Theo dõi AI Service:
```powershell
docker logs -f camerai-ai | Select-String "POSE_EVAL"
```
*Bạn sẽ thấy log đếm tăng dần:*
```text
[POSE_EVAL] track=... state=CANDIDATE reason=FALL_POSTURE angle=5.2 immobile=3.4s
[POSE_EVAL] track=... state=CANDIDATE reason=FALL_POSTURE angle=4.1 immobile=10.2s
[POSE_EVAL] track=... state=CONFIRMED reason=IMMOBILE_CONFIRMED angle=3.9 immobile=15.1s
```

### Theo dõi Backend Orchestrator:
```powershell
docker logs -f camerai-orchestrator | Select-String "M2A|FALL"
```
*Bạn sẽ thấy log kích hoạt sự kiện P1:*
```text
[FallIncidentCoordinator] [M2A_CONFIRMED] Track ... camera cam_living_room ĐÃ XÁC NHẬN TÉ NGÃ BẤT ĐỘNG! Tạo sự kiện P1 khẩn cấp...
[FallIncidentCoordinator] [FALL_ALERT_TRIGGERED] ĐÃ PHÁT HIỆN VÀ KÍCH HOẠT CẢNH BÁO TÉ NGÃ P1 trên camera cam_living_room
```

---

## 7. Các trường hợp Loại trừ & Tự phục hồi (Negative Test Cases)

1. **Người đứng dậy trước 15 giây (Tự hồi phục):**  
   Nếu bạn nằm xuống nhưng đứng dậy ở giây thứ 8 $\to$ AI ghi nhận `angle > 45°` $\to$ Chuyển trạng thái `CANCELLED (reason: RECOVERED)` $\to$ Không phát chuông báo động sai (AC17-2).
2. **Nằm trong vùng nghỉ ngơi (Vùng Giường/Sofa - REST_AREA):**  
   Nếu camera có cấu hình zone loại `REST_AREA` (ví dụ khu vực ghế sofa `rest_area_sofa`) và người nằm trong vùng này $\to$ Hệ thống tự động lọc bỏ và gắn cờ `inRestArea=true` $\to$ Không kích hoạt báo động ngã (AC17-3).

---

## 8. Kinh nghiệm & Lưu ý khi Kiểm thử Trực tiếp (Troubleshooting & Tips)

1. **Góc đặt Camera & Tránh mất Bounding Box khi nằm:**
   - Các mô hình phát hiện người (như MobileNet SSD trên Frigate) được tối ưu cho người đứng hoặc ngồi. Khi nằm dài trên sàn, tỷ lệ cơ thể chuyển sang chiều ngang ($W \gg H$), độ tin cậy nhận diện có thể bị sụt giảm nếu nằm sát mép camera hoặc ánh sáng yếu.
   - **Mẹo:** Đặt webcam ở góc hơi cao nhìn chéo xuống sàn, đảm bảo camera nhìn thấy trọn vẹn toàn bộ cơ thể (vai, thân và chân).
2. **Cơ chế Tự động Tái kích hoạt (Re-arm):**
   - Sau khi một sự kiện té ngã đã được xác nhận (`CONFIRMED`), hệ thống khóa chống trùng lặp (Dedup) theo episode.
   - Để kiểm thử lượt ngã tiếp theo, bạn cần **đứng thẳng người dậy hẳn (góc thân $> 60^\circ$)** trong vài giây để hệ thống tự động reset (`re-arm MONITORING`), hoặc bước ra khỏi khung hình camera để Frigate cấp Track ID mới.
3. **Mẹo rút ngắn thời gian kiểm thử (Fast Dev Testing):**
   - Thay vì phải nằm đợi đủ 15 giây mỗi lần kiểm thử, bạn có thể chỉnh biến môi trường trong file `.env`:
     ```dotenv
     FALL_IMMOBILITY_SECONDS=5
     ```
   - Sau đó khởi động lại:
     ```powershell
     docker restart camerai-orchestrator camerai-ai
     ```
   - Lúc này hệ thống chỉ cần 5 giây bất động là đã kích hoạt chuông cảnh báo P1.
