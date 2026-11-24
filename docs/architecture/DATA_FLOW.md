# Luồng dữ liệu

> **Task 0.2** (phần 2) · Người phụ trách: **B** · Sprint 0
> Tài liệu đi kèm [C4_ARCHITECTURE.md](C4_ARCHITECTURE.md). Ở đây mô tả **dữ liệu chảy như thế nào**,
> kèm payload thật để FE/BE/AI khớp nhau mà không phải đoán.

## Mục lục

- [Luồng 1 — Phát hiện người (walking skeleton, Sprint 1)](#luồng-1--phát-hiện-người-walking-skeleton-sprint-1)
- [Luồng 2 — Người lạ → cảnh báo → leo thang (Sprint 2)](#luồng-2--người-lạ--cảnh-báo--leo-thang-sprint-2)
- [Luồng 3 — Té ngã (Sprint 3)](#luồng-3--té-ngã-sprint-3)
- [Luồng 4 — Cháy lửa ưu tiên P0 theo code hiện tại](#luồng-4--cháy-lửa-ưu-tiên-p0-theo-code-hiện-tại)
- [Luồng 5 — Wellness check (Sprint 3)](#luồng-5--wellness-check-sprint-3)
- [Luồng 6 — Xem ảnh/clip qua presigned URL](#luồng-6--xem-ảnhclip-qua-presigned-url)
- [Luồng 7 — Telegram gửi cảnh báo và nhận phản hồi](#luồng-7--telegram-gửi-cảnh-báo-và-nhận-phản-hồi)
- [Ngân sách độ trễ](#ngân-sách-độ-trễ)
- [Xử lý lỗi trên từng chặng](#xử-lý-lỗi-trên-từng-chặng)

---

## Luồng 1 — Phát hiện người (walking skeleton, Sprint 1)

Đây là đường ống phải thông trước tiên. Mọi module AI sau chỉ cắm thêm vào đúng đường ống này.

```mermaid
sequenceDiagram
    autonumber
    participant CAM as Webcam
    participant MTX as mediamtx
    participant FRG as Frigate + bridge.py
    participant MQ as Mosquitto
    participant ORC as Orchestrator (MqttConsumerService)
    participant PG as PostgreSQL
    participant OBJ as MinIO / S3
    participant WEB as Dashboard

    CAM->>MTX: ffmpeg đẩy luồng
    MTX->>FRG: RTSP
    FRG->>FRG: Phát hiện "person" (min_score 0.5, threshold 0.7)<br/>max_disappeared=75, stationary interval=50/threshold=50
    FRG->>MQ: publish frigate/camerai/frames (TrackStabilizer gắn canonicalTrackId)
    FRG->>MQ: publish frigate/events {type:"new|update|end"}
    MQ->>ORC: message JSON

    ORC->>ORC: Parse + kiểm tra schema + cập nhật FrigateDetectionTrackerService
    ORC->>ORC: Tính dedup_key ổn định frigate:camera:track

    alt Chưa có event của track
        ORC->>PG: INSERT events (status=DETECTED)
    else Event của track đã tồn tại
        ORC->>PG: UPDATE cùng event (confidence, zone, priority)
    end

    opt after.has_snapshot = true
        ORC->>FRG: GET /api/events/{id}/snapshot.jpg
        ORC->>OBJ: PUT events/.../{id}/snapshot.jpg
        ORC->>PG: UPSERT event_media (SNAPSHOT)
    end

    ORC-->>WEB: SSE event.created / event.updated
    ORC->>ORC: Chuyển tiếp track sang FaceRecognitionCoordinatorService (Luồng 2)
```

Consumer xử lý tuần tự các message của cùng kết nối MQTT. Một `after.id` của Frigate luôn ánh xạ
vào đúng một hàng `events`; các message `update` và `end` chỉ cập nhật hàng đó. Snapshot thường chưa
sẵn sàng ở message `new`, nên orchestrator thử lưu khi bất kỳ message nào báo
`after.has_snapshot = true`. Việc lưu media là idempotent: nếu snapshot/clip đã tồn tại thì không tải
và upload lại.

Ngoài topic `frigate/events`, bridge `infra/frigate/frame-metadata/bridge.py` chạy `TrackStabilizer`
(two-stage IoU + center-proximity theo từng camera) để gắn `canonicalTrackId` lên topic
`frigate/camerai/frames` (bật mặc định qua `FRIGATE_TRACK_STABILIZER_ENABLED=true`). Sau đó
`MqttConsumerService` chuyển tiếp cả `new`, `update` và `end` sang `FaceRecognitionCoordinatorService`
thay vì tự đẩy job nhận diện ngay khi `INSERT events`.

### Payload MQTT từ Frigate (rút gọn những trường nhóm thực sự dùng)

```json
{
  "type": "new",
  "before": { "...": "trạng thái trước đó, thường bỏ qua ở message type=new" },
  "after": {
    "id": "1726387200.123456-abc123",
    "camera": "cam_kitchen",
    "frame_time": 1726387200.456,
    "label": "person",
    "sub_label": null,
    "top_score": 0.87,
    "score": 0.84,
    "box": [412, 180, 640, 720],
    "area": 164_160,
    "current_zones": ["restricted_stove"],
    "entered_zones": ["restricted_stove"],
    "has_snapshot": true,
    "has_clip": false,
    "start_time": 1726387200.123,
    "end_time": null
  }
}
```

> **Chú ý:** `after.camera` là **slug** — khớp với cột `cameras.slug` trong DB.
> `after.id` chính là **track ID**, dùng làm `events.track_id`.
> `box` là **pixel** theo khung `detect`, phải chuẩn hóa chia cho `detect_width`/`detect_height`
> trước khi lưu vào `ai_results`.
> Payload **không** chứa đường dẫn snapshot: khi `after.has_snapshot = true`, lấy ảnh qua
> `GET http://frigate:5000/api/events/{after.id}/snapshot.jpg`.
> Khi track kết thúc, Frigate gửi thêm một message `"type": "end"` cùng `after.id`, có `after.end_time`.
>
> Cấu hình Frigate, cách chạy thử và bảng ánh xạ trường AC ↔ payload:
> [FRIGATE_MQTT_SETUP.md](../FRIGATE_MQTT_SETUP.md) (US-01, US-02).

### Bản ghi `events` sau khi orchestrator xử lý

```json
{
  "id": "0192f8a1-...",
  "camera_id": "<uuid của cam_kitchen>",
  "zone_id": "<uuid của restricted_stove>",
  "event_type": "RESTRICTED_ZONE",
  "status": "DETECTED",
  "priority": "P1",
  "source": "FRIGATE",
  "track_id": "1726387200.123456-abc123",
  "dedup_key": "frigate:cam_kitchen:1726387200.123456-abc123",
  "confidence": 0.84,
  "ai_results": [],
  "correlation_id": "c0ffee00-...",
  "detected_at": "2026-09-15T14:20:00.456+07:00"
}
```

### Quy tắc khử trùng lặp (FR-ING-07)

Frigate bắn nhiều message `new`, `update`, `end` cho cùng một track khi đối tượng di chuyển. Công
thức dùng khóa ổn định theo track:

```
dedup_key = "frigate:{camera_slug}:{track_id}"
```

Cột `dedup_key` có **unique index**, nên chống trùng lặp được đảm bảo ở tầng database —
kể cả khi message đi qua ranh giới 10 giây hoặc chạy hai instance orchestrator song song. Nếu khóa đã
tồn tại, orchestrator cập nhật chính event đó thay vì tạo thêm hàng mới. Quy tắc này đáp ứng yêu cầu
FR-ING-07 “cùng `track_id` trong 10 giây chỉ tạo một sự kiện” và còn chặt hơn: toàn bộ vòng đời của
một track chỉ có một event. Ngoài ra, `detect.max_disappeared: 75` (~15 giây ở 5 fps), `detect.stationary`
(`interval: 50, threshold: 50`) và `TrackStabilizer` giúp giữ ổn định vòng đời track ngay từ edge.

---

## Luồng 2 — Người lạ → cảnh báo → leo thang (Sprint 2)

Đây là luồng đầy đủ nhất, chạm vào gần như mọi thành phần.

> **Cập nhật kiến trúc Track-Once (`feat/face-track-once-optimization`):** Luồng nhận diện khuôn mặt M1
> trong Luồng 2 đã chuyển từ cơ chế gửi ảnh ngay lúc `type=new` / DB trigger `cloud_face_intent` sang
> kiến trúc 5 lớp **"Recognize Once, Track Continuously"** (migration
> [0024_face_track_once_pipeline.sql](../../db/migrations/0024_face_track_once_pipeline.sql)).
> Xem phân tích chi tiết, bảng cấu hình và cơ chế chống tailgating tại
> [FACE_TRACK_ONCE_OPTIMIZATION_REPORT.md](../reports/FACE_TRACK_ONCE_OPTIMIZATION_REPORT.md) và
> [services/aws-workers/README.md](../../services/aws-workers/README.md).
>
> Phần gửi nhận Telegram của sơ đồ Luồng 2 là phác thảo tích hợp với Escalation Engine.
> Sequence Telegram đã đối chiếu code hiện tại nằm ở Luồng 7; không dùng các bước ACK hoặc gửi trực tiếp cũ làm đặc tả Telegram.

```mermaid
sequenceDiagram
    autonumber
    participant FRG as Frigate + TrackStabilizer
    participant ORC as Orchestrator (Coordinator + State + Cache)
    participant AI as AI Service (/face/assess | /face/match)
    participant AWS as CloudQueue + S3/SQS + Face Lambda
    participant PG as PostgreSQL
    participant TG as Telegram (Luồng 7)
    participant P1 as 👤 Người giám sát
    participant P4 as 👤 Liên hệ khẩn

    FRG->>ORC: frigate/events (new/update/end) + frames (canonicalTrackId)
    ORC->>PG: INSERT/UPDATE events (DETECTED)

    alt Track đang KNOWN hoặc PENDING_RECOGNITION
        ORC->>ORC: Bỏ qua gọi AI/cloud (chỉ cập nhật lastBox / endedAt vào Session Cache)
    else Đủ nhịp lấy mẫu (>= 350ms) và được phép đánh giá
        ORC->>FRG: GET /api/events/{trackId}/snapshot.jpg?crop=1&quality=100
        ORC->>ORC: Tính appearanceSignature & kiểm tra Spatial-Appearance Re-ID<br/>(track KNOWN mới kết thúc <=20s, proximity>=0.35, appearance>=0.78)
        alt Hit Spatial-Appearance Re-ID
            ORC->>PG: AiResultsService.submit (KNOWN, provider=local-session-cache, 0 AWS call)
        else Miss Spatial Re-ID -> Local Quality Gate (Layer 2)
            ORC->>AI: POST /face/assess (YuNet + SFace cục bộ, độc lập FACE_PROVIDER)
            AI-->>ORC: {passed, qualityScore, rejectionReason, embeddingBase64, gateStatus}
            alt Không đạt gate (quay lưng, mờ, nhỏ, nhiều mặt)
                ORC->>ORC: Giữ track ở COLLECTING/state cũ, chờ frame tốt hơn
            else Đạt gate -> Kiểm tra Embedding Session Cache (Layer 4)
                ORC->>ORC: Match cosine SFace trong scope (ownerScopeId, cameraSlug, collectionVersion) >= 0.72
                alt Hit Embedding Cache
                    ORC->>PG: AiResultsService.submit (KNOWN, provider=local-session-cache, 0 AWS call)
                else Miss Cache -> Tích lũy Best-Shot (1200ms / 4 mẫu / early >= 0.82 / end)
                    alt FACE_JOB_TRANSPORT = sqs (Layer 5 Cloud)
                        ORC->>AWS: CloudQueueService.enqueueFaceJob(revision, bestShot) -> S3 -> SQS face.job
                        AWS->>AWS: Face Lambda fast path (REKOGNITION_SKIP_DETECT_FACES=true)<br/>0 call nếu collection rỗng; 1 call SearchFacesByImage
                        AWS-->>ORC: SQS face.result -> CloudQueueService.applyResult
                        ORC->>PG: AiResultsService.submit + cloud_result_receipts
                    else FACE_JOB_TRANSPORT = bullmq (Local)
                        ORC->>AI: FaceRecognitionWorker -> POST /face/match
                        AI-->>ORC: {personStatus, similarity, matchedKnownFaceId}
                        ORC->>PG: AiResultsService.submit
                    end
                    ORC->>ORC: onRecognitionResult: đóng băng KNOWN (hoặc giới hạn retry UNDETERMINED/UNKNOWN)<br/>và lưu Session Cache nếu KNOWN
                end
            end
        end
    end

    ORC->>PG: SELECT * FROM escalation_rules WHERE event_type='UNKNOWN_PERSON'
    Note over ORC: T_low=0.60 T_high=0.80 T_wait=120s (cấu hình DB)

    alt personStatus = KNOWN hoặc UNDETERMINED hoặc confidence < T_low
        ORC->>PG: status = LOGGED_ONLY (không báo M1)
    else UNKNOWN và confidence >= T_low
        ORC->>PG: status=NOTIFIED, escalation_deadline_at = now() + T_wait
        ORC->>TG: Gửi cảnh báo qua NotificationRetryWorker (Luồng 7)
        TG->>P1: Ảnh + nút [Tôi ổn] / [Cần giúp đỡ]
    end

    alt P1 bấm "Tôi ổn" trong T_wait
        P1->>TG: bấm nút
        TG->>ORC: POST /api/v1/webhooks/telegram
        ORC->>PG: status = RESOLVED, hủy deadline
    else P1 bấm "Cần giúp đỡ" hoặc hết hạn T_wait
        ORC->>PG: status = ESCALATED
        ORC->>P4: Gọi điện / thông báo khẩn cấp
    end
```

### Tóm tắt 5 lớp tối ưu M1 trong Luồng 2

1. **Lớp 1 — `TrackIdentityStateService` & `FaceRecognitionCoordinatorService`:** quản lý vòng đời từng track `(cameraSlug, trackId)` với các trạng thái `COLLECTING → PENDING_RECOGNITION → KNOWN | UNKNOWN | UNDETERMINED`. Track đã `KNOWN` bị đóng băng vĩnh viễn không gọi lại cloud; `UNDETERMINED` chỉ retry tối đa 2 lần (cooldown 4s, chất lượng cao hơn); `UNKNOWN` chỉ recheck tối đa 1 lần khi `qualityScore` tăng tối thiểu `+0.15`.
2. **Lớp 2 — Local Face Quality Gate (`POST /face/assess` + `Best-Shot`):** chạy YuNet + SFace cục bộ trong `ai-service` (độc lập với `FACE_PROVIDER`) để loại ngay ảnh quay lưng, mờ (`BLURRY`), mặt nhỏ (`FACE_TOO_SMALL`), góc nghiêng lớn (`EXTREME_POSE`), không mặt hoặc nhiều mặt trước khi đẩy lên cloud; đồng thời chọn best-shot trong cửa sổ `1200 ms` (tối đa `4` mẫu, bắn sớm nếu `qualityScore >= 0.82`).
3. **Lớp 3 — Frigate Tracker & `TrackStabilizer`:** `detect.max_disappeared: 75` (~15s), `stationary` (`interval: 50, threshold: 50`) và `TrackStabilizer` (two-stage IoU + center-proximity) giữ ổn định track và cấp `canonicalTrackId` qua đứt quãng ngắn.
4. **Lớp 4 — `FaceSessionCacheService` (chống tailgating):** cache ngắn hạn theo đúng bucket `(ownerScopeId, cameraSlug)` và `collectionVersion` (tự hủy khi `collectionVersion` đổi). Hỗ trợ match embedding SFace (`>= 0.72`) và Spatial-Appearance Re-ID cho track vừa đứt (`<= 20s`, chỉ khớp khi có track `KNOWN` đã kết thúc thỏa đồng thời `proximityScore >= 0.35` và `appearanceSimilarity >= 0.78`), tuyệt đối không dùng cooldown toàn camera mù quáng.
5. **Lớp 5 — Cloud Queue & Face Lambda Fast Path:** migration `0024` xóa trigger `cloud_face_intent` và thêm khóa `(event_id, revision)` cho `cloud_jobs`; `CloudQueueService.enqueueFaceJob` upload thẳng best-shot lên S3; Face Lambda (`REKOGNITION_SKIP_DETECT_FACES=true`) trả `UNKNOWN` với **0 Rekognition API call** khi `collection_face_count == 0`, hoặc chỉ **1 call** `SearchFacesByImage` (map `InvalidParameterException` sang `UNDETERMINED / NO_FACE_DETECTED` không retry SQS).

### Vì sao `escalation_deadline_at` phải nằm trong DB

`setTimeout()` sống trong RAM. Service restart lúc 2 giờ sáng → mọi cảnh báo đang chờ biến mất
mà không ai biết. Cách làm đúng:

1. Khi chuyển sang `NOTIFIED`: ghi `escalation_deadline_at = now() + t_wait_seconds`.
2. `TimerService` chạy mỗi 10 giây, quét:
   ```sql
   SELECT id FROM events
   WHERE status = 'NOTIFIED' AND escalation_deadline_at <= now();
   ```
   (có partial index `idx_events_dang_cho_escalate` nên truy vấn này rất nhẹ)
3. Khi khởi động: chạy đúng truy vấn trên một lần để dọn những sự kiện đã quá hạn khi service chết.

Đây là yêu cầu FR-ESC-07 và NFR-05 — **sẽ bị hỏi khi bảo vệ đồ án.**

---

## Luồng 3 — Té ngã (Sprint 3)

Khác hai luồng trên ở chỗ: quyết định dựa trên **chuỗi frame**, không phải một ảnh.

```mermaid
sequenceDiagram
    autonumber
    participant FRG as Frigate
    participant ORC as Orchestrator
    participant AI as AI Service (pose)
    participant PG as PostgreSQL

    loop Mỗi frame có person (5 fps)
        FRG->>ORC: frame + track_id
        ORC->>AI: POST /pose/fall {trackId, inRestArea}
        AI->>AI: MediaPipe Pose → 33 keypoint<br/>tính góc trục thân + trọng tâm

        alt Trục thân < 30° và trọng tâm hạ đột ngột
            AI-->>ORC: {state:"CANDIDATE", immobileSeconds:2.1}
            Note over ORC: Chưa tạo sự kiện. Chỉ theo dõi.
        else Bất động liên tục > 15 giây
            AI-->>ORC: {state:"CONFIRMED", confidence:0.78}
            ORC->>PG: INSERT events (FALL_DETECTED, P1)
            Note over ORC: → vào state machine như luồng 2
        else Người đứng dậy trong 15 giây
            AI-->>ORC: {state:"CANCELLED"}
            Note over ORC: Chỉ ghi log nội bộ.<br/>KHÔNG tạo cảnh báo (US-17)
        else Nằm trong vùng REST_AREA
            AI-->>ORC: {state:"MONITORING"}
            Note over ORC: Giường/sofa — không bao giờ báo (FR-DET-M2-05)
        end
    end
```

### Ba cơ chế chống báo động giả

| Cơ chế                            | Chống trường hợp                 | FR           |
| --------------------------------- | -------------------------------- | ------------ |
| Ngưỡng thời gian bất động 15 giây | Cúi xuống nhặt đồ, buộc dây giày | FR-DET-M2-03 |
| Hủy candidate khi đứng dậy        | Ngồi xổm rồi đứng lên            | FR-DET-M2-04 |
| Bỏ qua vùng `REST_AREA`           | Nằm ngủ trên giường/sofa         | FR-DET-M2-05 |

> **Bắt buộc:** `FALL_IMMOBILITY_SECONDS` đọc từ biến môi trường. Con số 15 giây sẽ phải
> chỉnh lại ở Sprint 4 dựa trên FAR đo được — hard-code là tự chuốc việc vào thân.

---

## Luồng 4 — Cháy lửa ưu tiên P0 theo code hiện tại

Đối chiếu ngày 12/11/2026 tại commit `d23cad6`. Checkpoint hai lớp giữ nguyên class map,
nhưng M3 hiện chỉ dùng `fire` để xác nhận cảnh báo. Nhánh full frame hoạt động độc lập với person.

```mermaid
sequenceDiagram
    autonumber
    participant F as Frigate frame bridge
    participant M as MQTT Mosquitto
    participant O as Orchestrator M3
    participant A as AI Service ONNX CPU
    participant DB as PostgreSQL
    participant S as MinIO hoặc S3
    participant T as Worker Telegram
    F->>M: Topic frigate/camerai/fire/frames header và JPEG đúng timestamp
    Note over F,O: Full frame không phụ thuộc person QoS 0 queue hữu hạn ưu tiên frame mới
    M->>O: Fire frame envelope
    O->>O: Kiểm tra độ tươi thứ tự camera và giới hạn
    O->>A: POST /fire/detect ảnh và metadata với X-Internal-Token
    A->>A: Letterbox 640 RGB FP32 NCHW rồi ONNX
    A->>A: NMS trong graph chỉ giữ class fire
    alt Chưa đủ 3 frame hợp lệ đạt ngưỡng
        A-->>O: INSUFFICIENT_FRAMES hoặc lý do chưa xác nhận
    else Đủ chuỗi trong 5 giây gap không quá 1 giây
        A-->>O: CONFIRMED episode và incidentConfidence bằng min score
        O->>O: Kiểm tra lại bằng chứng
        O->>DB: Transaction tạo event lửa P0 riêng và fire_incidents
        O->>S: Lưu snapshot của frame xác nhận
        O->>DB: event_media và AI result receipt cùng outbox
        O->>DB: Engine tạo NOTIFIED và notification PENDING theo rule
        T->>DB: Claim công việc gửi
        Note over T: Gửi ảnh hoặc text và xử lý callback theo Luồng 7
    end
    Note over O,DB: Người dùng xác nhận không xóa latch Chỉ chuỗi âm tính hợp lệ mới clear episode
```

Mặc định mỗi frame phải có fire score ít nhất 0,50; cần tối thiểu 3 frame trong 5 giây,
gap không quá 1 giây. Incident confidence là **min score** của các frame xác nhận.
Frame sai thứ tự, quá cũ, replay hoặc lỗi suy luận không được dùng để cộng đủ chuỗi.
Snapshot giữ đúng ảnh của frame xác nhận. Latch trong `fire_incidents` chỉ được clear
sau quan sát âm tính hợp lệ liên tục 10 giây, không phải khi người dùng bấm Tôi ổn.

P0 là ưu tiên nghiệp vụ. Truy vấn claim Telegram hiện `ORDER BY n.created_at, n.id`,
chưa ưu tiên mọi P0 vượt toàn bộ P1/P2. `skip_logged_only` không bỏ qua kiểm tra bằng chứng AI.
Rule escalation và deadline đọc từ cấu hình, không coi seed 30 giây là giá trị luôn cố định.

Nguồn: `FireFramesConsumer`, `FireProcessorService`, `FireDeliveryService`,
`FireTracker`, `FireDetector`, `NotificationsRepository` và migration `0014_fire_incidents.sql`.
Phần model, số liệu train và ERD xem [báo cáo của Nhân](../BAO_CAO_PHAN_CONG_NHAN.md).

---

## Luồng 5 — Wellness check (Sprint 3)

Module duy nhất **không dùng computer vision** — thuần logic scheduler.

```mermaid
sequenceDiagram
    autonumber
    participant CRON as WellnessScheduler
    participant PG as PostgreSQL
    participant TG as Telegram
    participant P2 as 👤 Người được giám sát
    participant P1 as 👤 Người giám sát

    Note over CRON: 09:00 theo lịch trong wellness_schedules

    CRON->>PG: Có sự kiện nào của người đã đăng ký<br/>trong 6 giờ qua không?

    alt Có hoạt động
        Note over CRON: Bình thường. Không làm gì.
    else Module 1 ghi nhận đã rời khỏi nhà
        Note over CRON: Bỏ qua — báo động vô nghĩa (FR-DET-M5-03)
    else Không có hoạt động nào
        CRON->>PG: INSERT events (WELLNESS_TIMEOUT, P2)
        CRON->>TG: "Bà Hoa ơi, bà vẫn ổn chứ?" [✅ Tôi ổn]

        alt P2 xác nhận trong 5 phút
            P2->>TG: bấm nút
            Note over CRON: → RESOLVED
        else Hết 5 phút
            Note over CRON: → ESCALATED
            CRON->>P1: "Không liên lạc được với bà Hoa từ 03:00"
        end
    end
```

Module này rẻ nhất trong backlog (3 SP) nhưng bắt được một loại rủi ro mà 4 module kia không thấy:
người nằm im trong phòng camera không phủ tới.

---

## Luồng 6 — Xem ảnh/clip qua presigned URL

```mermaid
sequenceDiagram
    autonumber
    participant WEB as Dashboard
    participant ORC as Orchestrator
    participant PG as PostgreSQL
    participant OBJ as MinIO / S3

    WEB->>ORC: GET /events/{id}/media<br/>Authorization: Bearer <token>
    ORC->>ORC: Kiểm tra quyền (FR-DAT-04)
    ORC->>PG: SELECT * FROM event_media WHERE event_id = ?
    ORC->>OBJ: generatePresignedUrl(key, expiresIn: 900)
    OBJ-->>ORC: https://.../snapshot.jpg?X-Amz-Signature=...
    ORC-->>WEB: {data:[{url, expiresAt}]}
    WEB->>OBJ: GET trực tiếp bằng presigned URL
    OBJ-->>WEB: image/jpeg
```

**Ba điều tuyệt đối không làm:**

1. ❌ Mở public bucket "cho tiện" — lộ ảnh riêng tư trong nhà người khác.
2. ❌ Cho ảnh chạy qua orchestrator (`res.pipe(stream)`) — tốn băng thông và RAM vô ích.
3. ❌ Presigned URL hạn dài (vài ngày) — link rò ra là ai cũng xem được.

Hạn 15 phút là đủ cho người dùng xem xong, ngắn đến mức link rò ra cũng vô hại.

---

## Luồng 7 — Telegram gửi cảnh báo và nhận phản hồi

Đây là luồng gửi nhận hiện tại thay cho đoạn Telegram minh họa trong Luồng 2 của bản Sprint 2.
Chỉ cập nhật phạm vi Telegram; thuật toán Face AI và escalation chi tiết thuộc tài liệu của phần tương ứng.

### Chiều gửi từ event đến người nhận

```mermaid
sequenceDiagram
    autonumber
    participant E as Escalation Engine
    participant DB as PostgreSQL
    participant W as NotificationRetryWorker
    participant S as MinIO hoặc S3
    participant T as Telegram Bot API
    participant U as Người giám sát
    E->>DB: Transaction event NOTIFIED và notification PENDING
    W->>DB: Claim lease bằng FOR UPDATE SKIP LOCKED
    DB-->>W: Job và người nhận đã liên kết
    W->>S: Tải snapshot đúng event
    alt Có ảnh phù hợp
        W->>W: Render bbox lửa nếu đủ metadata
        W->>T: sendPhoto JPEG caption và inline buttons
    else Không lấy được ảnh
        W->>T: sendMessage kèm Chưa lấy được ảnh
    end
    T-->>W: chat_id và message_id
    W->>DB: Mark SENT lưu định danh và loại PHOTO hoặc TEXT
    T->>U: Hiển thị tin cảnh báo
    Note over W,T: Timeout có thể là DELIVERY_UNCERTAIN và retry có thể tạo tin trùng
```

`NOTIFIED` ở event là quyết định nghiệp vụ. Notification chỉ chuyển sang `SENT` sau khi
Bot API phản hồi thành công. Người nhận phải đang hoạt động và đã liên kết Telegram;
chat ID đơn lẻ chưa đủ. Mặc định chiều gửi tối đa 4 attempts với backoff 2/4/8 giây,
HTTP 429 tôn trọng `retry_after`; lỗi 4xx khác 429 không retry. Không bảo đảm exactly once qua HTTP.

### Chiều callback và chỉnh sửa tin

```mermaid
sequenceDiagram
    autonumber
    actor U as Người giám sát
    participant T as Telegram
    participant API as Webhook API
    participant DB as PostgreSQL
    participant W as TelegramWorkWorker
    participant E as Escalation Engine
    U->>T: Bấm Tôi ổn hoặc Cần giúp đỡ
    T->>API: POST webhook với secret header
    API->>API: Parse update và kiểm tra secret
    API->>DB: INSERT inbox theo update_id chống trùng
    DB-->>API: Đã lưu bền vững
    API-->>T: HTTP 200
    W->>DB: Claim inbox sau ACK
    W->>E: confirmInitial với actor chat message và TTL
    E->>DB: Khóa event kiểm tra quyền và trạng thái
    alt IM_OK hợp lệ
        E->>DB: COMMIT confirmation RESOLVED và history
    else NEED_HELP hợp lệ
        E->>DB: COMMIT confirmation ESCALATED và intent tiếp theo
    else Replay hết hạn sai actor hoặc đã xử lý
        E-->>W: Kết quả đã xử lý hoặc từ chối phù hợp
    end
    W->>DB: Lưu outcome và reconcile telegram_message_edits
    W->>T: answerCallbackQuery
    W->>T: editMessageCaption hoặc editMessageText và gỡ nút
    Note over W,E: Wellness có nhánh xác nhận chuyên biệt không phải INITIAL thông thường
```

Webhook `/api/v1/webhooks/telegram` kiểm tra secret header, lưu inbox chống trùng trước HTTP 200.
Sau ACK, worker nền xác minh actor/chat/message/TTL và trạng thái event qua cổng xác nhận.
Callback và edit có công việc bền vững riêng, mặc định tối đa 8 attempts, không nhầm với
4 attempts của gửi cảnh báo. Sửa tin lỗi không làm rollback xác nhận đã commit.
Wellness có nhánh xác nhận riêng trong `WellnessService`.

Nguồn: các file `notifications/telegram`, `NotificationRetryWorker`, `NotificationsRepository`
và migrations `0007_telegram_delivery.sql`, `0011_telegram_confirmation_delivery.sql`.
Hình minh họa và giải thích xem [báo cáo của Nhân](../BAO_CAO_PHAN_CONG_NHAN.md).

---

## Ngân sách độ trễ

NFR-01 yêu cầu **< 10 giây** từ lúc sự kiện xảy ra đến khi người dùng nhận thông báo.
Phân bổ ngân sách cho từng chặng (kèm các mốc cấu hình của luồng M1 Track-Once):

| #   | Chặng                                                  | Ngân sách / Cấu hình giới hạn | Đo bằng / Ghi chú                                                                                                     |
| --- | ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Camera → Frigate phát hiện                             | 1.0 s                         | `frame_time` vs `start_time` (có `min_initialized` frame)                                                             |
| 2   | Frigate → MQTT → Orchestrator                          | 0.2 s                         | log timestamp hai đầu (`frigate/events` & `frigate/camerai/frames`)                                                   |
| 3   | Orchestrator ghi DB & SSE                              | 0.1 s                         | `events`, `event_media`, SSE `event.created`                                                                          |
| 4a  | M1 Local Quality Gate & Best-Shot Window (Lớp 2)       | 0–1.2 s (`window 1200 ms`)    | `POST /face/assess` (timeout `2000 ms`); early dispatch ngay nếu `qualityScore >= 0.82`                               |
| 4b  | M1 Session Cache / Re-ID (Lớp 4) hoặc AI/Cloud (Lớp 5) | ~0 s (cache hit) / ≤ 2.0 s    | Cache hit gọi thẳng `AiResultsService.submit`; cloud dùng 0/1 call Rekognition, local `/face/match` timeout `5000 ms` |
| 5   | Escalation engine quyết định                           | 0.1 s                         | `escalation_rules` & `outbox_messages`                                                                                |
| 6   | Gửi Telegram                                           | 1.5 s                         | `notifications.sent_at`                                                                                               |
|     | **Tổng**                                               | **~5–6.1 s**                  | còn ~3.9–5 s dự phòng trong ngưỡng NFR-01 `< 10 s`                                                                    |
|     | _NFR-02: đến khi hiện trên dashboard_                  | _< 5 s_                       | chặng 1–3 + SSE `event.created` (không chờ chặng 4a/4b)                                                               |

**Cách đo:** mọi log ghi kèm `correlation_id` (và log Lambda ghi `jobId`, `resultId`, `cacheHit`, `durationMs`). Lọc log theo `correlation_id` là dựng lại được toàn bộ dòng thời gian của một sự kiện.

---

## Xử lý lỗi trên từng chặng

| Chặng hỏng                                                                                    | Hành vi bắt buộc                                                                                                                                                                                                                    | FR / Cơ chế                 |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| RTSP mất kết nối                                                                              | Ghi log, tự thử lại sau 30 s (`retry_interval` trên Frigate), **không crash**                                                                                                                                                       | FR-ING-03                   |
| Message MQTT sai định dạng                                                                    | Ghi vào dead-letter log, consumer **vẫn sống**                                                                                                                                                                                      | US-03, US-08                |
| Face Quality Gate (`POST /face/assess`) lỗi / timeout `2000 ms` / thiếu model (`UNAVAILABLE`) | `FaceQualityGateClient` áp dụng `FACE_QUALITY_GATE_FAIL_OPEN=true` mặc định cho qua với `qualityScore=0` để không nghẽn nhận diện (đặt `false` nếu muốn fail-closed)                                                                | Layer 2 Quality Gate        |
| Local AI service (`/face/match`) timeout > 5 s                                                | `status = AI_FAILED`, sự kiện vẫn được lưu; `TrackIdentityStateService` chuyển `UNDETERMINED` để retry có giới hạn                                                                                                                  | US-10                       |
| Face Lambda / Rekognition lỗi (SQS mode)                                                      | `InvalidParameterException` (không thấy mặt) ánh xạ sang `UNDETERMINED / NO_FACE_DETECTED` (`error=null`, không retry SQS); lỗi kỹ thuật khác giữ message cho SQS retry → DLQ (`fellBackToLocal=false`, không biến thành `UNKNOWN`) | Layer 5 / `handler.py`      |
| `collectionVersion` thay đổi khi có cache                                                     | `FaceSessionCacheService` tự xóa bucket của `(ownerScopeId, cameraSlug)` khi lệch `collectionVersion`; `CloudQueueService` ghi receipt `STALE` và không áp dụng kết quả cũ                                                          | Layer 4 / `applyResult`     |
| Lỗi upload S3 / prepare `cloud_jobs`                                                          | `enqueueFaceJob` giữ job ở `PREPARING` (`available_at + 30s`), `dispatchOne()` thử lại tối đa 5 lượt rồi `FAILED`; ảnh event vẫn giữ lifecycle 7 ngày (`S3_EXPIRE_7D_TAG`)                                                          | US-29 / `CloudQueueService` |
| Upload MinIO/S3 cho snapshot sự kiện thất bại                                                 | Retry 3 lần (2 s / 4 s / 8 s), sự kiện vẫn tồn tại không có ảnh                                                                                                                                                                     | US-29                       |
| Telegram lỗi                                                                                  | Mặc định 4 attempts tổng cộng, retry 2/4/8 giây; khi lỗi ghi `FAILED`, **timer escalation vẫn chạy**                                                                                                                                | FR-NOT-03, FR-NOT-05        |
| Một camera bắn > 20 sự kiện/phút                                                              | Kích hoạt rate limit, gộp thành 1 cảnh báo tổng hợp                                                                                                                                                                                 | FR-ADM-05                   |
| Cần rollback khẩn cấp tối ưu Track-Once                                                       | Đặt `FACE_TRACK_OPTIMIZATION_ENABLED=false` (Orchestrator quay về `handleLegacyDispatch`) và `REKOGNITION_SKIP_DETECT_FACES=false` (Lambda quay về legacy flow)                                                                     | Rollback Layer 1–5          |
| PostgreSQL chết                                                                               | Không có kế hoạch B — dừng nhận sự kiện mới, ghi log lỗi rõ ràng                                                                                                                                                                    | —                           |

### Mẫu retry dùng chung

```
lần 1: thử ngay
lần 2: sau 2 giây
lần 3: sau 4 giây
lần 4: sau 8 giây
→ thất bại: ghi dead-letter + notification.status = 'FAILED'
```

Cài một lần trong `RetryService`, dùng lại ở mọi adapter. Đừng mỗi người viết một kiểu retry.

---

## Xem tiếp

- [Kiến trúc C4](C4_ARCHITECTURE.md)
- [ERD](../database/ERD.md) — cấu trúc của mọi bảng nhắc tới ở đây
- [Hợp đồng API](../api/API_GUIDE.md)
