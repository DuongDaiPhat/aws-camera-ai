# Kế hoạch Thực thi Slice CAM — Quản lý Camera, Nguồn phát & Debug View

> **Owner E2E:** Thành viên A  
> **Reviewer:** Thành viên C (US-12 Zone)  
> **Tài liệu tham chiếu:** [PLAN_AGILE_5_MEMBER_EXECUTION.md](PLAN_AGILE_5_MEMBER_EXECUTION.md) và [Plan Giao diện Camera.md](<Plan Giao diện Camera.md>)  
> **Trạng thái:** Kế hoạch thực thi theo từng bước nhỏ (Atomic Chunks) — Dừng review và commit sau mỗi bước.

---

## 1. Mục tiêu và Ranh giới nghiệp vụ

### 1.1. Mục tiêu

Khi người dùng bấm NavItem **"Camera"** trên Sidebar:

1. Hệ thống hiển thị trang quản lý camera (`CameraView`), không render đè lên dashboard sự kiện.
2. Hiển thị danh sách camera theo shape và enum tại mục 5.1 của tài liệu thiết kế trưởng nhóm: `runtimeStatus` gồm `ONLINE`, `OFFLINE`, `STARTING`, `FAILED`, `DISABLED`; trạng thái nguồn lưu nội bộ vẫn theo enum riêng tại mục 4.1.
3. Người dùng `ADMIN` có thể:
   - Bật/tắt camera.
   - Cấu hình 3 loại nguồn phát: **RTSP camera thật** (bảo mật credential), **Webcam trình duyệt** (qua WebRTC/WHIP lên MediaMTX), **File video test** (upload và phát lặp tự động bằng FFmpeg runner).
   - Xem stream trực tiếp / ảnh snapshot preview.
   - Sử dụng **Debug View** với 2 toggle độc lập: **Person boundary** và **Zone boundary** (kèm điểm chân đế foot-point của Frigate).
   - Tinh chỉnh các thông số detect của camera và đồng bộ an toàn xuống Frigate mà **không làm mất cấu hình Zone** của Thành viên C.

### 1.2. Ranh giới Vertical Slice

- **Thành viên A sở hữu E2E:** Database migration, API Backend NestJS, Source Runner (FFmpeg), tích hợp MediaMTX & Frigate, Frontend Next.js (CameraView, Debug View), kiểm thử tự động.
- **Giao diện bàn giao cho Thành viên C (US-12 Zone):** Cung cấp `CameraConfigPortV1` (`getCameraContext`, `getPreview`, `applyConfiguration`) trong [apps/orchestrator/src/contracts/vertical-slice.ports.ts](../apps/orchestrator/src/contracts/vertical-slice.ports.ts).
- **Nguyên tắc đồng bộ:** Lưu cấu hình camera tuyệt đối không ghi đè hoặc làm mất khối `zones` trong Frigate config.

---

## 2. Mô hình Dữ liệu (Database Migration 0005)

Không sửa các migration cũ (`0001`–`0004`). Tạo migration mới: `db/migrations/0005_camera_sources_and_frigate_settings.sql`.

### 2.1. Bảng `camera_sources`

Lưu trữ thông tin chi tiết nguồn phát gắn với từng camera:

```sql
CREATE TYPE camera_source_type_enum AS ENUM ('RTSP', 'BROWSER_WEBCAM', 'VIDEO_FILE');
CREATE TYPE camera_source_status_enum AS ENUM ('NOT_CONFIGURED', 'STARTING', 'ONLINE', 'OFFLINE', 'FAILED', 'STOPPED');
CREATE TYPE camera_transport_enum AS ENUM ('TCP', 'UDP');
CREATE TYPE frigate_sync_status_enum AS ENUM ('PENDING', 'SYNCED', 'FAILED');

CREATE TABLE camera_sources (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id             UUID NOT NULL UNIQUE REFERENCES cameras (id) ON DELETE CASCADE,
    source_type           camera_source_type_enum NOT NULL DEFAULT 'RTSP',
    rtsp_url              TEXT NULL,
    video_object_key      TEXT NULL,
    video_original_name   TEXT NULL,
    video_loop            BOOLEAN NOT NULL DEFAULT TRUE,
    transport             camera_transport_enum NOT NULL DEFAULT 'TCP',
    input_format          TEXT NULL,
    webcam_device_label   TEXT NULL,
    status                camera_source_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED',
    last_error_code       TEXT NULL,
    last_error_message    TEXT NULL,
    process_id            TEXT NULL,
    started_at            TIMESTAMPTZ NULL,
    stopped_at            TIMESTAMPTZ NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2. Bảng `camera_frigate_settings`

Lưu cấu hình detect, snapshot và versioning để đồng bộ Frigate:

```sql
CREATE TABLE camera_frigate_settings (
    camera_id               UUID PRIMARY KEY REFERENCES cameras (id) ON DELETE CASCADE,
    detect_width            INTEGER NOT NULL DEFAULT 1280 CHECK (detect_width > 0),
    detect_height           INTEGER NOT NULL DEFAULT 720 CHECK (detect_height > 0),
    detect_fps              SMALLINT NOT NULL DEFAULT 5 CHECK (detect_fps BETWEEN 1 AND 30),
    min_initialized_frames  INTEGER NOT NULL DEFAULT 5 CHECK (min_initialized_frames > 0),
    max_disappeared_frames  INTEGER NOT NULL DEFAULT 25 CHECK (max_disappeared_frames > 0),
    person_min_score        NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (person_min_score BETWEEN 0 AND 1),
    person_threshold        NUMERIC(4,3) NOT NULL DEFAULT 0.700 CHECK (person_threshold BETWEEN 0 AND 1),
    person_min_area         INTEGER NOT NULL DEFAULT 1500 CHECK (person_min_area >= 0),
    snapshots_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    snapshot_bounding_box   BOOLEAN NOT NULL DEFAULT TRUE,
    recording_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    detection_retention_days SMALLINT NOT NULL DEFAULT 7 CHECK (detection_retention_days >= 0),
    config_version          INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
    applied_version         INTEGER NOT NULL DEFAULT 0 CHECK (applied_version BETWEEN 0 AND config_version),
    sync_status             frigate_sync_status_enum NOT NULL DEFAULT 'PENDING',
    sync_error_code         TEXT NULL,
    sync_error_message      TEXT NULL,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT camera_frigate_settings_synced_version_khop_trang_thai
        CHECK (sync_status <> 'SYNCED' OR applied_version = config_version)
);
```

### 2.3. Backfill, seed và nguồn dữ liệu chuẩn

- Migration 0005 backfill các camera đã tồn tại trước khi nâng cấp. Runtime khởi tạo là `OFFLINE`; sync là `PENDING`, `applied_version = 0` cho tới khi Frigate xác nhận đã nhận cấu hình. `is_enabled = true` không chứng minh camera đang online.
- Trên DB mới, migration chạy trước dữ liệu demo nên không có camera để backfill. Seed dev phải tạo `camera_sources` và `camera_frigate_settings` sau khi thêm ba camera demo. Seed dùng `ON CONFLICT (camera_id) DO NOTHING` để chạy lại không ghi đè cấu hình người dùng.
- Sau migration, `camera_sources` là nguồn chuẩn cho loại nguồn và cấu hình URL RTSP; `camera_frigate_settings` là nguồn chuẩn cho tham số detect, snapshot, recording và retention. `cameras.is_enabled` và `cameras.detection_enabled` vẫn là nguồn chuẩn cho hai công tắc trạng thái mong muốn. Các cột `cameras.rtsp_url`, `detect_width`, `detect_height`, `fps`, `retention_days` được giữ làm trường tương thích với API/consumer cũ trong giai đoạn chuyển đổi; repository phải cập nhật các projection này cùng transaction cho tới khi contract và consumer cũ được gỡ.
- Vì `cameras.rtsp_url` của migration cũ là `NOT NULL`, khi tạo camera webcam/video repository phải lưu URL RTSP relay MediaMTX theo slug vào trường tương thích này; URL nguồn thực tế và loại nguồn nằm trong `camera_sources`. Không yêu cầu người dùng nhập URL RTSP cho webcam/video.
- Thiết kế trưởng nhóm là chuẩn cho contract của Slice CAM: `frigateSync.status` dùng `PENDING | SYNCED | FAILED`; `runtimeStatus` dùng `ONLINE | OFFLINE | STARTING | FAILED | DISABLED`. Enum `camera_sources.status` là trạng thái nội bộ riêng (`NOT_CONFIGURED | STARTING | ONLINE | OFFLINE | FAILED | STOPPED`); khi camera bị tắt, API phải trả `runtimeStatus=DISABLED` theo thiết kế.
- OpenAPI/generated contracts hiện chưa khớp shape lồng nhau `source`, `frigateSync`, `debugCapabilities` và các enum của tài liệu thiết kế. Đây là phần việc của Bước 1.2: cập nhật OpenAPI rồi generate contracts trước khi triển khai API.

---

## 3. Kiến trúc Nguồn phát (Source Runner)

1. **RTSP Camera thật:**
   - Lưu trữ an toàn, che giấu mật khẩu (password masking).
   - Chỉ role `ADMIN` mới được cập nhật; mọi response/log đều không chứa URL đầy đủ hoặc password rõ, ADMIN chỉ xem giá trị đã che.
2. **Browser Webcam:**
   - Dùng WebRTC / WHIP publish trực tiếp từ browser lên MediaMTX (`:8889/<camera_slug>`).
   - Frigate đọc stream RTSP từ MediaMTX (`rtsp://mediamtx:8554/<camera_slug>`).
   - Giao diện hiển thị rõ ràng thông báo: _Luồng phát sẽ dừng khi đóng tab trình duyệt_.
3. **Video File Runner:**
   - Cho phép upload file MP4 qua dashboard vào thư mục lưu trữ (`CAMERA_VIDEO_STORAGE_PATH`).
   - Backend `FfmpegSourceRunner` khởi động tiến trình FFmpeg phát lặp (`-re -stream_loop -1`) vào MediaMTX.
   - Backend quản lý vòng đời (PID/instance ID, timeout, số lần retry qua cấu hình), tự động phục hồi nguồn phát khi backend khởi động lại.
   - Dev hoàn toàn không phải gõ lệnh terminal thủ công.

---

## 4. Kế hoạch Thực thi Chia nhỏ (8 Bước Triển khai + Spike DoR)

Mỗi bước đều là một khối công việc hoàn chỉnh, có kiểm tra xác thực. **Sau mỗi bước, dừng lại để bạn review và commit.**

### 🟢 Giai đoạn 1: Chuẩn bị CSDL & UI Shell (Task A1)

#### Bước 1.0: Xác minh các tích hợp camera (DoR)

- **Nhiệm vụ:**
  1. Xác minh MediaMTX WebRTC/WHIP publish trên image đang dùng và Frigate debug/runtime API trên đúng image `0.18.0`.
  2. Ghi nhận endpoint, CORS/auth, dạng frame/debug output và cách xác định đã nhận frame; dùng kết quả này để chốt contract, không đoán theo tài liệu phiên bản khác.
- **Tiêu chí xong:** Có fixture chạy được, đường apply config được xác minh và danh sách field Frigate được hỗ trợ; chỉ sau đó mới chốt migration/API.

#### Bước 1.1: Migration & Seed CSDL

- **Nhiệm vụ:**
  1. Tạo file migration [0005_camera_sources_and_frigate_settings.sql](../db/migrations/0005_camera_sources_and_frigate_settings.sql).
  2. Bổ sung script khởi tạo nguồn và setting mặc định cho 3 camera hiện có (`cam_living_room`, `cam_test`, `cam_kitchen`) trong script seed.
  3. Chạy migration trên PostgreSQL và kiểm tra `\dt`.
  4. Chạy seed dev; xác nhận mỗi camera demo có đúng một source và một settings row, cả hai đều ở trạng thái chưa được runtime/config xác nhận.
- **Tiêu chí xong:** CSDL tạo thành công hai bảng với FK, enum và constraint; migration backfill camera cũ; seed DB mới tạo đủ rows cho ba camera demo và chạy lại không ghi đè cấu hình.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(db): bổ sung migration camera_sources và camera_frigate_settings"
  ```

#### Bước 1.2: Cập nhật OpenAPI & Khung điều hướng Frontend

- **Nhiệm vụ:**
  1. Cập nhật [api/openapi.yaml](../api/openapi.yaml) theo mục 5 của [thiết kế Camera](<Plan Giao diện Camera.md>) trước khi code backend; sau đó chạy `pnpm contracts:generate`:
     - Mở rộng response `Camera` với `runtimeStatus`, `source` (`type`, `displayName`, `isPublishing`, `lastError`, `requiresBrowserPublisher`), `frigateSync` (`status`, `configVersion`, `appliedVersion`) và `debugCapabilities` (`personBoundary`, `zoneBoundary`). Giữ `isEnabled` cho trạng thái cấu hình mong muốn.
     - Bổ sung `PUT /cameras/{cameraId}/state`, `GET /cameras/{cameraId}/runtime-status`, `GET`/`PUT /cameras/{cameraId}/source`, `POST`/`DELETE /cameras/{cameraId}/source/video`, `POST /cameras/{cameraId}/source/start`, `POST /cameras/{cameraId}/source/stop`, `POST /cameras/{cameraId}/frigate-sync/retry`, `GET /cameras/{cameraId}/debug-stream` và `POST`/`DELETE /cameras/{cameraId}/source/browser-session`. Các route `GET /cameras`, `GET`/`PATCH /cameras/{cameraId}` đã có, cần cập nhật response/request theo schema mới.
     - Khai báo request bật/tắt `{ "isEnabled": true }`, response publish URL/token ngắn hạn chỉ cho đúng camera và đầy đủ mã lỗi của mục 5.4: `CAMERA_NOT_FOUND`, `SOURCE_NOT_CONFIGURED`, `SOURCE_UNAVAILABLE`, `WEBCAM_PERMISSION_DENIED`, `WEBCAM_PUBLISH_FAILED`, `VIDEO_INVALID_FORMAT`, `VIDEO_TOO_LARGE`, `VIDEO_NOT_FOUND`, `FFMPEG_START_FAILED`, `FRIGATE_SYNC_FAILED`, `FRIGATE_UNAVAILABLE`, `MEDIAMTX_UNAVAILABLE`, `CAMERA_ALREADY_TRANSITIONING`.
  2. Cập nhật [apps/web/src/components/dashboard/DashboardView.tsx](../apps/web/src/components/dashboard/DashboardView.tsx):
     - Khi `activeNav === 'cameras'` ➔ render `<CameraView />`.
     - Ẩn danh sách sự kiện khi đang ở view Camera.
  3. Tạo component khung ban đầu: `apps/web/src/components/cameras/CameraView.tsx` và styles đi kèm.
- **Tiêu chí xong:** Contract sinh ra chứa đầy đủ schema, enum, endpoint và mã lỗi ở mục 5; bấm "Camera" trên Sidebar hiển thị trang CameraView, không bị đè dashboard sự kiện. `pnpm typecheck` không lỗi.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(web): tích hợp khung điều hướng CameraView vào Dashboard"
  ```

---

### 🟢 Giai đoạn 2: Backend Core & Danh sách Camera (Task A1 + A2)

#### Bước 2.1: Module Cameras trong Backend & Cung cấp Port cho C

- **Nhiệm vụ:**
  1. Tạo module `apps/orchestrator/src/cameras/`:
     - `cameras.repository.ts`: Truy vấn `cameras`, `camera_sources`, `camera_frigate_settings`.
     - `cameras.service.ts`: Nghiệp vụ CRUD, bảo vệ phân quyền `ADMIN`.
     - `camera-runtime.service.ts`: Khi bật, kiểm tra nguồn, khởi động video publisher hoặc chờ webcam ở `STARTING`, đồng bộ Frigate, bật camera/detection runtime và chỉ báo `ONLINE` khi frame hoặc stats xác nhận. Khi tắt, tắt camera/detection trên Frigate, dừng video publisher, đóng browser session và trả `DISABLED`.
     - `cameras.controller.ts` và `dto/`: Các route REST API theo OpenAPI; controller chỉ nhận request và gọi service.
     - `cameras.module.ts`: Kết nối repository/service và đăng ký module trong Orchestrator.
  2. Hiện thực hóa [CameraConfigPortV1](../apps/orchestrator/src/contracts/vertical-slice.ports.ts):
     - `getCameraContext(cameraId: string)`
     - `getPreview(cameraId: string)`
     - `applyConfiguration(command: ApplyFrigateConfigCommandV1)`
- **Tiêu chí xong:** `GET /api/v1/cameras` trả về shape `Camera` theo mục 5.1 của [thiết kế Camera](<Plan Giao diện Camera.md>): các object `source`, `frigateSync`, `debugCapabilities` và enum tương ứng. OpenAPI cùng generated contracts được cập nhật theo shape đó trước khi triển khai. Port `CameraConfigPortV1` sẵn sàng cho Thành viên C inject.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(orchestrator): xây dựng module cameras và hiện thực hóa CameraConfigPortV1"
  ```

#### Bước 2.2: Frontend Danh sách Camera & Điều khiển Bật/Tắt

- **Nhiệm vụ:**
  1. Viết `apps/web/src/lib/cameras-client.ts` và hook `apps/web/src/hooks/useCameras.ts`.
  2. Xây dựng các component:
     - `CameraList.tsx`
     - `CameraCard.tsx` (thẻ camera hiển thị tên, slug, loại nguồn, FPS, trạng thái).
     - `CameraStatusBadge.tsx` (phân biệt rõ: Active/Inactive theo cấu hình vs Online/Offline theo runtime).
     - Bộ lọc: _Tất cả | Đang hoạt động | Không hoạt động | Có lỗi_.
  3. Nút Switch bật/tắt camera gọi API `/cameras/{id}/state`, có loading spinner và rollback khi lỗi.
- **Tiêu chí xong:** Giao diện hiển thị danh sách camera mượt mà, bấm bật/tắt camera gửi request thành công lên backend.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(web): giao diện danh sách camera và điều khiển bật tắt"
  ```

---

### 🟢 Giai đoạn 3: Quản lý 3 Nguồn phát & Source Runner (Task A3)

#### Bước 3.1: Backend Source Runner (FFmpeg Video Runner + Webcam Session)

- **Nhiệm vụ:**
  1. Tạo module `apps/orchestrator/src/camera-sources/`:
     - `camera-sources.module.ts`, `camera-sources.controller.ts`, `camera-sources.service.ts`, `camera-sources.repository.ts`, `source-runner.interface.ts`, `ffmpeg-source-runner.service.ts`, `media-mtx.service.ts` và `dto/` như mục 6.1 của thiết kế.
     - API lấy/cập nhật nguồn, upload/xóa video, start/stop và tạo/xóa browser session đúng contract; browser session chỉ cấp URL/token ngắn hạn gắn với camera slug.
     - `FfmpegSourceRunner` gọi process bằng mảng argument, kiểm tra slug theo regex và chỉ đọc file trong thư mục được quản lý; lưu PID/instance ID, giới hạn stderr, không log URL có credential, dừng đúng process con, khôi phục publisher sau restart và dừng retry khi input lỗi.
     - Đọc timeout, retry, giới hạn upload, storage path và MediaMTX URL từ `CAMERA_SOURCE_START_TIMEOUT_MS`, `CAMERA_SOURCE_STOP_TIMEOUT_MS`, `CAMERA_SOURCE_MAX_RETRIES`, `CAMERA_SOURCE_RETRY_DELAY_MS`, `CAMERA_VIDEO_MAX_BYTES`, `CAMERA_VIDEO_STORAGE_PATH`, `MEDIAMTX_RTSP_URL`, `MEDIAMTX_WEBRTC_URL`; cập nhật `.env.example`.
- **Tiêu chí xong:** Khi bật camera có nguồn video, backend tự khởi động FFmpeg và đẩy stream lên MediaMTX; các luồng start/stop, restart, upload lỗi và webcam session được kiểm tra, không cần dev gõ lệnh tay.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(orchestrator): source runner quản lý phát video lặp và session webcam"
  ```

#### Bước 3.2: Frontend Cấu hình Nguồn (RTSP, Webcam WebRTC, Video Uploader)

- **Nhiệm vụ:**
  1. Xây dựng component `CameraSourceForm.tsx`:
     - **Tab RTSP:** Form nhập URL, transport (TCP/UDP), che mật khẩu.
     - **Tab Webcam:** Component `WebcamPublisher.tsx` dùng `navigator.mediaDevices.getUserMedia()`, publish WebRTC/WHIP lên MediaMTX, hiển thị cảnh báo stream dừng khi đóng tab.
     - **Tab Video:** Component `VideoSourceUploader.tsx` chọn file, upload progress bar, toggle phát lặp.
- **Tiêu chí xong:** Người dùng cấu hình đổi nguồn phát trực tiếp trên giao diện; phát được webcam máy tính và upload file video thành công.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(web): giao diện cấu hình 3 nguồn phát RTSP, webcam và upload video"
  ```

---

### 🟢 Giai đoạn 4: Debug View, Frigate Sync & DoD (Task A4)

#### Bước 4.1: Đồng bộ Frigate an toàn (Bảo toàn Zone của C)

- **Nhiệm vụ:**
  1. Tạo `apps/orchestrator/src/frigate/` gồm `frigate.module.ts`, `frigate-client.service.ts`, `frigate-config.service.ts`, `frigate-sync.service.ts`, `frigate-debug.service.ts`.
  2. Đọc record camera đã validation từ DB, sinh cấu hình Frigate 0.18.0, giữ nguyên cấu hình global, camera ngoài phạm vi và toàn bộ `zones`; validate trước khi áp dụng.
  3. Dùng `config_version`/`applied_version` chống request cũ ghi đè, có khóa đồng bộ theo Frigate instance. Nếu áp dụng thất bại, giữ cấu hình DB, đánh dấu `FAILED`, trả mã lỗi ổn định và cho phép gọi API retry.
  4. Xác minh API bật/tắt camera và detection trên đúng image Frigate 0.18.0 trước khi sử dụng. Thao tác lưu DB hoặc gọi API thành công chưa đủ để đánh dấu `ONLINE`; phải xác nhận frame/stats.
- **Tiêu chí xong:** Sửa cài đặt camera không làm mất polygon zones hoặc cấu hình ngoài phạm vi; sync thất bại giữ DB và có nút "Thử lại"; version cũ không ghi đè version mới.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(orchestrator): đồng bộ cấu hình camera Frigate bảo toàn zone"
  ```

#### Bước 4.2: Debug View (2 Toggle độc lập) & Hoàn tất Kiểm thử

- **Nhiệm vụ:**
  1. Xây dựng `CameraPreview.tsx` và `CameraDebugToolbar.tsx`:
     - Toggle 1: **Person boundary** (hộp bao đối tượng person).
     - Toggle 2: **Zone boundary** (vùng polygon + điểm chân đế foot-point Frigate).
     - 2 toggle hoạt động hoàn toàn độc lập, lưu trạng thái vào localStorage theo từng camera.
  2. Viết kiểm thử tự động:
     - Backend unit tests (`cameras.service.spec.ts`, `ffmpeg-source-runner.spec.ts`).
     - Frontend spec tests (`CameraView.spec.tsx`).
  3. Chạy `pnpm check:all` đảm bảo 100% xanh.
- **Tiêu chí xong:** Debug View hoạt động chuẩn xác, toàn bộ unit/integration test pass, đạt đầy đủ DoD của Slice CAM.
- 🛑 **Dừng để bạn commit:**
  ```bash
  git commit -m "feat(web): hoàn thiện debug view và kiểm thử tích hợp slice CAM"
  ```

---

## 5. Quy tắc Kiểm tra và Bàn giao (DoD)

1. **Không tự ý commit:** Agent thực hiện xong bước nào sẽ thông báo để người dùng review và tự chạy lệnh `git commit`.
2. **Kiểm tra liên tục:** Sau mỗi bước, chạy `pnpm typecheck` và `pnpm test` liên quan để đảm bảo không gãy build.
3. **Bảo mật:** Không lộ credential RTSP trên UI, response API hoặc log hệ thống.
4. **Không mất cấu hình:** Đồng bộ cấu hình camera phải bảo toàn 100% dữ liệu vùng `zones` của Thành viên C.
