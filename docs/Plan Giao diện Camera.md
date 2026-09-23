**Giao diện Camera, quản lý nguồn phát và Debug View**

> Phần giao với Zone, UI shell, Frigate config, contract và migration tuân theo [kế hoạch tích hợp 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md).
> **1\. Mục tiêu**

Khi người dùng bấm NavItem:

<NavItem

label="Camera"

active={activeNav === 'cameras'}

onClick={() => onSelectNav('cameras')}

icon={&lt;CameraIcon /&gt;}

/>

hệ thống phải hiển thị trang quản lý camera với các chức năng:

- Xem camera đang hoạt động và không hoạt động.
- Xem preview hoặc live stream.
- ADMIN có thể bật/tắt camera.
- ADMIN có thể cấu hình nguồn phát:
  - Camera RTSP thật.
  - Webcam của máy đang mở dashboard.
  - File video dùng để test.
- Dev không phải tự chạy lệnh FFmpeg để phát webcam/video.
- Có Debug View với hai toggle độc lập:
  - Person boundary.
  - Zone boundary.
- Thay đổi cấu hình được đồng bộ an toàn xuống Frigate.

**2\. Hiện trạng cần lưu ý**

- Sidebar đã có NavItem Camera.
- DashboardView chỉ thay đổi activeNav, nhưng vẫn luôn render dashboard sự kiện.
- OpenAPI đã có:
  - GET /cameras.
  - POST /cameras.
  - GET /cameras/{cameraId}.
  - PATCH /cameras/{cameraId}.
  - DELETE /cameras/{cameraId}.
  - GET /cameras/{cameraId}/snapshot.
- Bảng cameras đã có cấu hình cơ bản:
  - rtsp_url.
  - detect_width.
  - detect_height.
  - fps.
  - is_enabled.
  - detection_enabled.
  - retention_days.
- Backend chưa có module cameras.
- MediaMTX hiện yêu cầu dev tự chạy FFmpeg để publish webcam/video.
- Frigate đang đọc file cấu hình được mount read-only.
- Chưa có service quản lý tiến trình phát video.
- Chưa có API trạng thái runtime của camera.

**3\. Quyết định kiến trúc nguồn phát**

**3.1. Không lưu lệnh shell do người dùng nhập**

Frontend không gửi lệnh FFmpeg hoặc đối số tùy ý xuống backend. Backend sinh đối số từ cấu hình đã kiểm tra để tránh command injection.

**3.2. RTSP camera thật**

Người dùng nhập URL RTSP. Backend lưu cấu hình và đưa URL vào cấu hình Frigate.

- Không trả credential RTSP cho role không phải ADMIN.
- Không ghi URL chứa credential vào log.
- UI che password khi hiển thị.
- Khi cập nhật URL, response không trả lại password dạng rõ.

**3.3. Webcam**

Dùng API camera của trình duyệt để lấy webcam:

getUserMedia()

→ publish WebRTC/WHIP

→ MediaMTX path theo camera slug

→ Frigate đọc RTSP từ MediaMTX

MediaMTX hỗ trợ browser publish qua WebRTC/WHIP nên dev không phải chạy FFmpeg thủ công. Tham khảo [MediaMTX WebRTC publishing](https://mediamtx.org/docs/publish/webrtc-clients).

Giới hạn phải hiển thị rõ trên UI:

- Trình duyệt cần cấp quyền webcam.
- Webcam stream dừng khi tab bị đóng, máy sleep hoặc quyền bị thu hồi.
- Nếu cần webcam chạy nền độc lập với trình duyệt, đó là một local publisher agent riêng, không tự mở rộng trong story này.

**3.4. File video**

Người dùng chọn và upload video qua dashboard:

Upload video

→ backend kiểm tra file

→ lưu vào thư mục/volume dành cho dev source

→ Source Runner khởi động FFmpeg

→ publish lặp vào MediaMTX

→ Frigate đọc stream

Tiến trình FFmpeg phải được quản lý bởi ứng dụng:

- Tự khởi động khi bật camera.
- Tự dừng khi tắt camera hoặc đổi source.
- Tự khởi động lại sau khi backend restart.
- Có giới hạn số lần retry và backoff.
- Không tạo nhiều publisher cho cùng một camera.
- Không phụ thuộc vào terminal của dev.

Không cho người dùng nhập đường dẫn file tùy ý trên máy chủ. File phải được upload hoặc chọn từ thư viện video đã được backend quản lý.

**4\. Mô hình dữ liệu**

Không sửa migration cũ. Tạo migration mới.

**4.1. Bảng camera_sources**

Đề xuất:

camera_sources

\- id UUID PK

\- camera_id UUID UNIQUE FK cameras

\- source_type ENUM: RTSP | BROWSER_WEBCAM | VIDEO_FILE

\- rtsp_url TEXT NULL

\- video_object_key TEXT NULL

\- video_original_name TEXT NULL

\- video_loop BOOLEAN DEFAULT true

\- transport ENUM: TCP | UDP DEFAULT TCP

\- input_format TEXT NULL

\- webcam_device_label TEXT NULL

\- status ENUM:

NOT_CONFIGURED | STARTING | ONLINE | OFFLINE | FAILED | STOPPED

\- last_error_code TEXT NULL

\- last_error_message TEXT NULL

\- process_id TEXT NULL

\- started_at TIMESTAMPTZ NULL

\- stopped_at TIMESTAMPTZ NULL

\- created_at

\- updated_at

Không lưu browser webcam device ID như định danh bền vững vì trình duyệt có thể thay đổi ID sau khi quyền hoặc profile thay đổi.

**4.2. Cấu hình Frigate theo camera**

Bổ sung cấu hình có cấu trúc, không lưu YAML tùy ý:

camera_frigate_settings

\- camera_id UUID PK

\- detect_width

\- detect_height

\- detect_fps

\- min_initialized_frames

\- max_disappeared_frames

\- person_min_score

\- person_threshold

\- person_min_area

\- snapshots_enabled

\- snapshot_bounding_box

\- recording_enabled

\- detection_retention_days

\- config_version

\- applied_version

\- sync_status: PENDING | SYNCED | FAILED

\- sync_error_code

\- sync_error_message

\- updated_at

Các giá trị mặc định phải tương thích với infra/frigate/config.example.yml.

Không đưa toàn bộ Frigate YAML lên UI. Trang Camera chỉ quản lý các thiết lập liên quan trực tiếp đến camera, nguồn phát, phát hiện person, snapshot và retention. Cấu hình detector/model/global MQTT vẫn thuộc cấu hình hệ thống.

**4.3. Video đã upload**

Nếu video được lưu trong filesystem/volume:

- Dùng UUID làm tên vật lý.
- Lưu tên gốc riêng để hiển thị.
- Kiểm tra file có tồn tại trước khi bật camera.
- Xóa video cũ chỉ khi không camera nào còn tham chiếu.
- Thêm giới hạn dung lượng và quota qua cấu hình môi trường.
- Không commit video vào Git.

**5\. OpenAPI contract**

Sửa api/openapi.yaml trước khi code và chạy generate contracts.

**5.1. Mở rộng Camera**

Bổ sung các trường:

runtimeStatus:

ONLINE | OFFLINE | STARTING | FAILED | DISABLED

source:

type: RTSP | BROWSER_WEBCAM | VIDEO_FILE

displayName

isPublishing

lastError

requiresBrowserPublisher

frigateSync:

status: PENDING | SYNCED | FAILED

configVersion

appliedVersion

debugCapabilities:

personBoundary

zoneBoundary

isEnabled là trạng thái cấu hình mong muốn. runtimeStatus phản ánh trạng thái chạy thực tế. Không dùng một boolean cho cả hai ý nghĩa.

**5.2. API cần bổ sung**

GET /cameras

GET /cameras/{cameraId}

PATCH /cameras/{cameraId}

PUT /cameras/{cameraId}/state

GET /cameras/{cameraId}/runtime-status

GET /cameras/{cameraId}/source

PUT /cameras/{cameraId}/source

POST /cameras/{cameraId}/source/video

DELETE /cameras/{cameraId}/source/video

POST /cameras/{cameraId}/source/start

POST /cameras/{cameraId}/source/stop

POST /cameras/{cameraId}/frigate-sync/retry

GET /cameras/{cameraId}/debug-stream

Nếu dùng browser webcam, bổ sung API lấy thông tin publish:

POST /cameras/{cameraId}/source/browser-session

DELETE /cameras/{cameraId}/source/browser-session

Response chỉ trả publish URL/token ngắn hạn cho đúng camera. Không để người dùng publish tùy ý sang slug khác.

**5.3. Request bật/tắt**

{

"isEnabled": true

}

Luồng bật:

1. Kiểm tra source hợp lệ.
2. Khởi động publisher nếu là video.
3. Với browser webcam, trả trạng thái STARTING và yêu cầu browser publish.
4. Đồng bộ Frigate.
5. Bật camera/detection runtime.
6. Chỉ chuyển ONLINE khi nhận được frame hoặc stats xác nhận.

Luồng tắt:

1. Tắt camera hoặc detection trên Frigate.
2. Dừng publisher video.
3. Đóng browser publisher session nếu có.
4. Chuyển trạng thái DISABLED.

**5.4. Response lỗi**

Bổ sung các mã lỗi ổn định:

CAMERA_NOT_FOUND

SOURCE_NOT_CONFIGURED

SOURCE_UNAVAILABLE

WEBCAM_PERMISSION_DENIED

WEBCAM_PUBLISH_FAILED

VIDEO_INVALID_FORMAT

VIDEO_TOO_LARGE

VIDEO_NOT_FOUND

FFMPEG_START_FAILED

FRIGATE_SYNC_FAILED

FRIGATE_UNAVAILABLE

MEDIAMTX_UNAVAILABLE

CAMERA_ALREADY_TRANSITIONING

**6\. Backend Orchestrator**

**6.1. Cấu trúc module**

apps/orchestrator/src/cameras/

cameras.module.ts

cameras.controller.ts

cameras.service.ts

cameras.repository.ts

camera-runtime.service.ts

dto/

apps/orchestrator/src/camera-sources/

camera-sources.module.ts

camera-sources.controller.ts

camera-sources.service.ts

camera-sources.repository.ts

source-runner.interface.ts

ffmpeg-source-runner.service.ts

media-mtx.service.ts

dto/

apps/orchestrator/src/frigate/

frigate.module.ts

frigate-client.service.ts

frigate-config.service.ts

frigate-sync.service.ts

frigate-debug.service.ts

Controller chỉ nhận request và gọi service. Không chạy process hoặc sinh config trong controller.

**6.2. Source Runner**

FfmpegSourceRunner phải:

- Dùng API tạo process với mảng argument, không ghép chuỗi shell.
- Kiểm tra camera slug theo regex hiện có.
- Chỉ đọc file trong thư mục video được quản lý.
- Ghi PID/instance ID để quản lý lifecycle.
- Thu thập stderr có giới hạn.
- Không log URL có credential.
- Kill đúng process con khi dừng.
- Khôi phục publisher video đang bật sau restart.
- Không restart vô hạn nếu input bị lỗi.

Các ngưỡng phải đọc từ cấu hình:

CAMERA_SOURCE_START_TIMEOUT_MS

CAMERA_SOURCE_STOP_TIMEOUT_MS

CAMERA_SOURCE_MAX_RETRIES

CAMERA_SOURCE_RETRY_DELAY_MS

CAMERA_VIDEO_MAX_BYTES

CAMERA_VIDEO_STORAGE_PATH

MEDIAMTX_RTSP_URL

MEDIAMTX_WEBRTC_URL

Cập nhật .env.example.

**6.3. Đồng bộ Frigate**

- DB là nguồn cấu hình camera của ứng dụng.
- Sinh cấu hình camera từ record đã validation.
- Không ghi đè cấu hình global hoặc camera ngoài phạm vi.
- Validate config trước khi áp dụng.
- Dùng version để chống request cũ ghi đè request mới.
- Có khóa đồng bộ theo Frigate instance.
- Nếu cập nhật config thất bại:
  - Giữ cấu hình DB.
  - Đánh dấu FAILED.
  - Hiển thị nút "Thử lại".
- Không đánh dấu ONLINE chỉ vì thao tác lưu DB thành công.

Frigate có API runtime để bật/tắt camera và detection; Agent phải kiểm tra endpoint trên đúng image 0.18.0 trước khi sử dụng. Tham khảo [Frigate Camera Set API](https://docs.frigate.video/integrations/api/camera-set-camera-camera-name-set-feature-sub-command-put/).

**7\. Debug View**

**7.1. Hành vi giao diện**

Debug View có ba trạng thái:

Debug View: OFF

Debug View: ON + Person boundary OFF/ON

Debug View: ON + Zone boundary OFF/ON

Hai toggle overlay độc lập.

- Person boundary: hiển thị bounding box của object có label person.
- Zone boundary: hiển thị polygon, tên zone và trạng thái có người trong zone.
- Toggle là state của UI, không thay đổi cấu hình cảnh báo.
- Không lưu toggle vào cấu hình Frigate trừ khi có yêu cầu sản phẩm riêng.
- Có thể lưu preference vào localStorage theo camera.

**7.2. Nguồn debug**

Ưu tiên dùng debug stream/frame chính thức của Frigate sau khi kiểm chứng trên image 0.18.0.

Không suy đoán endpoint từ phiên bản khác. Agent phải thử nghiệm:

- Có thể bật riêng bounding box và zone hay không.
- Response là MJPEG, WebRTC hay ảnh cập nhật.
- CORS/auth có cho phép browser gọi trực tiếp hay phải proxy qua Orchestrator.
- Tốc độ refresh và chi phí CPU.

Nếu Frigate không cung cấp hai lớp overlay riêng biệt:

- Orchestrator lấy frame sạch.
- Bounding box person lấy từ MQTT/object state.
- Zone lấy từ DB.
- Frontend vẽ hai lớp bằng SVG/canvas.
- Tọa độ phải chuẩn hóa theo phần ảnh thật.

Frigate xác định người nằm trong zone bằng điểm giữa cạnh dưới của bounding box; Debug View nên vẽ điểm này khi cả hai toggle bật để dev hiểu vì sao zone được kích hoạt. Tham khảo [Frigate Zones](https://docs.frigate.video/configuration/zones/).

**8\. Frontend**

**8.1. Tích hợp điều hướng**

Trong DashboardView:

activeNav === 'dashboard' → Dashboard hiện tại

activeNav === 'events' → màn hình sự kiện

activeNav === 'cameras' → CameraView

activeNav === 'zones' → ZonesView

Không render dashboard sự kiện bên dưới trang Camera.

**8.2. Cấu trúc file**

apps/web/src/components/cameras/

CameraView.tsx

CameraList.tsx

CameraCard.tsx

CameraPreview.tsx

CameraSettingsPanel.tsx

CameraSourceForm.tsx

WebcamPublisher.tsx

VideoSourceUploader.tsx

CameraDebugToolbar.tsx

CameraStatusBadge.tsx

camera-\*.module.css

index.ts

apps/web/src/hooks/

useCameras.ts

useCameraRuntime.ts

useCameraSource.ts

useWebcamPublisher.ts

apps/web/src/lib/

cameras-client.ts

camera-source-client.ts

Kiểu API import từ @cam/contracts.

**8.3. Bố cục**

Web:

![](data:image/png;base64,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)

Responsive cho Mobile:

- Danh sách camera ở trên.
- Preview ở giữa.
- Settings trong drawer/accordion.
- Các toggle có label, không chỉ biểu tượng.

**8.4. Danh sách camera**

Mỗi card hiển thị:

- Tên camera.
- Source: RTSP/Webcam/Video.
- Trạng thái mong muốn: bật/tắt.
- Trạng thái runtime.
- Detection bật/tắt.
- Frigate sync status.
- FPS hiện tại nếu có.
- Lỗi gần nhất đã làm sạch.

Bộ lọc:

Tất cả | Đang hoạt động | Không hoạt động | Có lỗi

**8.5. Cấu hình source**

RTSP:

- URL.
- Transport TCP/UDP.
- Nút "Kiểm tra kết nối".
- Không hiển thị lại password đầy đủ.

Webcam:

- Nút cấp quyền.
- Danh sách thiết bị từ enumerateDevices().
- Preview local trước khi publish.
- Nút "Bắt đầu phát".
- Hiển thị cảnh báo stream phụ thuộc tab hiện tại.

Video:

- Chọn file.
- Hiển thị tên, dung lượng và duration.
- Toggle phát lặp.
- Upload progress.
- Nút thay video.
- Không nhận file không được backend hỗ trợ.

**8.6. Cấu hình Frigate trên UI**

Nhóm "Cơ bản":

- Độ phân giải detect.
- FPS detect.
- Bật/tắt object detection.
- Bật/tắt recording.
- Retention days.

Nhóm "Phát hiện person":

- Minimum score.
- Threshold.
- Minimum area.
- Minimum initialized frames.
- Maximum disappeared frames.

Nhóm "Snapshot":

- Bật/tắt snapshot.
- Hiện bounding box trong snapshot.

Mọi field:

- Có đơn vị và giải thích ngắn.
- Có min/max.
- Có nút khôi phục mặc định.
- Chỉ ADMIN chỉnh sửa.
- Role khác chỉ xem trạng thái.

**9\. Phân quyền**

- ADMIN:
  - Bật/tắt camera.
  - Đổi source.
  - Upload video.
  - Sửa Frigate settings.
  - Retry sync.
- CAREGIVER và VIEWER:
  - Xem danh sách, trạng thái và preview theo quyền hiện có.
  - Không thấy credential hoặc nút thay đổi cấu hình.

Backend phải có role guard. Ẩn nút trên frontend không thay thế kiểm tra backend.

**10\. Kiểm thử**

**Unit test**

- Sinh FFmpeg argument cho video.
- Không cho truyền argument/path tùy ý.
- Chuyển trạng thái camera.
- Mask RTSP credential.
- Sinh cấu hình Frigate.
- Version chống ghi đè.
- Chuyển tọa độ overlay.

**Integration test**

- CRUD camera theo OpenAPI.
- Bật camera chưa có source.
- Upload video hợp lệ/không hợp lệ/quá lớn.
- Một camera chỉ có một publisher.
- Restart Orchestrator khôi phục video publisher.
- Frigate offline trả trạng thái đúng.
- Role không phải ADMIN nhận 403.

**Frontend test**

- Click Camera NavItem mở đúng màn hình.
- Filter active/inactive.
- Toggle camera có loading và rollback khi lỗi.
- Từ chối webcam permission.
- Upload progress và lỗi upload.
- Hai debug toggle hoạt động độc lập.
- Chuyển camera nhanh không bị response cũ ghi đè.
- Responsive tại 360px.

**E2E bắt buộc**

1. Chọn video từ dashboard.
2. Bật camera.
3. Không chạy lệnh FFmpeg thủ công.
4. MediaMTX nhận stream.
5. Frigate nhận frame.
6. Camera chuyển ONLINE.
7. Bật Person boundary và thấy box khi có người.
8. Bật Zone boundary và thấy polygon.
9. Tắt camera và xác minh publisher dừng.

Thực hiện thêm kịch bản webcam bằng Chrome/Edge có cấp quyền camera.

**11\. Trình tự thực hiện**

1. Spike MediaMTX browser publishing và Frigate debug API trên phiên bản thực tế.
2. Cập nhật api/openapi.yaml.
3. Generate @cam/contracts.
4. Thêm migration.
5. Triển khai Cameras API.
6. Triển khai Source Runner và video upload.
7. Triển khai browser webcam publisher.
8. Triển khai Frigate config sync và runtime control.
9. Triển khai CameraView.
10. Triển khai Debug View.
11. Chạy unit, integration và E2E.
12. Cập nhật tài liệu vận hành.

**12\. Definition of Done**

- Bấm "Camera" hiển thị CameraView.
- Xem được camera active/inactive/error.
- ADMIN bật/tắt camera từ dashboard.
- Dev phát webcam mà không phải tự chạy FFmpeg.
- Dev upload và phát lặp video mà không phải tự chạy FFmpeg.
- Video publisher tiếp tục chạy khi đóng trang.
- UI thông báo rõ webcam browser dừng khi đóng tab.
- Cấu hình camera được đồng bộ Frigate.
- Debug View bật/tắt riêng person boundary và zone boundary.
- Không lộ credential RTSP.
- Role không phải ADMIN không sửa được cấu hình.
- Contract, migration, tests và tài liệu được cập nhật.
- pnpm check:all chạy thành công.
