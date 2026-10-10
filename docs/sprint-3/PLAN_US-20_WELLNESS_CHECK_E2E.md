# PLAN US-20 — Wellness check định kỳ, cảnh báo quá hạn (M5)

> Một người chịu trách nhiệm E2E với **một AI Agent duy nhất**, không chia backend/frontend/scheduler cho các agent khác. M5 là logic lịch, bằng chứng hoạt động và xác nhận; không chạy computer vision, không train model, không gọi endpoint inference.
>
> Hợp đồng chuẩn: [OpenAPI orchestrator](../../api/openapi.yaml), [OpenAPI AI service](../../api/openapi-ai-service.yaml). Migration M5: [0015_wellness_check_runtime.sql](../../db/migrations/0015_wellness_check_runtime.sql). Đọc cùng [CODING_CONVENTION.md](../conventions/CODING_CONVENTION.md), [GIT_WORKFLOW.md](../conventions/GIT_WORKFLOW.md), [API_GUIDE.md](../api/API_GUIDE.md), [ERD](../database/ERD.md), [API_CHANGE_REGISTER.md](API_CHANGE_REGISTER.md) và [DEPENDENCY_BASELINE.md](DEPENDENCY_BASELINE.md).

## 1. User story và kết quả bắt buộc

**Là** người giám sát P1, **tôi muốn** hệ thống kiểm tra người nhà vẫn ổn theo lịch, **để** phát hiện cả trường hợp camera không thấy bất thường nhưng thực tế có vấn đề.

| Điều kiện                                                                         | Hành động                             | Kết quả nghiệm thu                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Có hai lịch 09:00 và 18:00, timezone của hộ                                       | Đến giờ, scheduler xét X giờ trước đó | Chỉ xét hoạt động đã xác minh của đúng người đăng ký, trong phạm vi camera của lịch                         |
| Không có hoạt động hợp lệ trong cửa sổ                                            | Đánh giá lịch                         | Tạo một `WELLNESS_TIMEOUT`, source `SCHEDULER`, priority **P2**, yêu cầu chính người được giám sát xác nhận |
| Yêu cầu đã gửi thành công; người đó bấm “Tôi ổn” trước deadline 5 phút            | Nhận phản hồi hợp lệ                  | Chuyển event `RESOLVED`, ghi confirmation và history, hủy công việc leo thang còn chờ                       |
| Đúng deadline hoặc muộn hơn, chưa có phản hồi                                     | Worker quét deadline                  | Chuyển `ESCALATED`, gửi caregiver của đúng hộ; retry không tạo nhiều lần leo thang                          |
| M1 có bằng chứng rõ ràng người đó đã rời nhà, chưa quay lại và bằng chứng còn hạn | Scheduler chạy                        | `SKIPPED_AWAY`, không tạo event hoặc yêu cầu xác nhận                                                       |
| Có chuyển động của người khác, mặt không nhận diện, camera offline hoặc model lỗi | Scheduler chạy                        | Không tính đó là hoạt động của người cần kiểm tra; không suy diễn thành đã rời nhà                          |

Giá trị mặc định: X = 6 giờ, thời gian phản hồi = **300 giây**. API lịch đã có `lookbackHours` 1–24 và `graceSeconds` 60–3600; giữ tương thích và cho cấu hình rõ ràng. Toàn bộ AC “5 phút” phải chạy với 300 giây. Đổi cấu hình chỉ ảnh hưởng occurrence tương lai.

M5 bổ sung một loại bảo vệ không phụ thuộc nhãn nguy hiểm từ M1/M2/M3/M4. Camera thiếu dữ liệu có thể khiến phát sinh yêu cầu wellness; đó không phải bằng chứng người ấy đã gặp tai nạn. UI dùng “Chưa ghi nhận hoạt động, vui lòng xác nhận” và không tự kết luận tai nạn.

## 2. Hiện trạng và các khoảng trống phải xử lý

| Thành phần hiện có                                         | Điều có thể tái sử dụng                                                   | Việc còn thiếu                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `wellness_schedules` từ migration 0001                     | Giờ, ngày ISO, timezone, lookback, grace, camera IDs                      | Owner hộ rõ ràng, soft delete, version và occurrence bền vững                                 |
| Enum `WELLNESS_TIMEOUT`, source `SCHEDULER`, rule seed P2  | Event/history/notification/SSE/confirm/deadline dùng chung                | Adapter chính sách M5: nhắm resident trước, caregiver khi quá hạn                             |
| `known_faces.linked_user_id`, owner và camera/device owner | Liên kết người đăng ký với tài khoản/hộ                                   | Phải kiểm tra link còn active; không dùng tên khuôn mặt làm khóa resident                     |
| M1 face worker và metadata Frigate                         | Danh tính gắn với track/camera/source session và bằng chứng motion sẵn có | Chưa có feed rời nhà rõ ràng; phải bổ sung adapter bằng chứng, không giả định M1 đã làm xong  |
| `EscalationDeadlineWorkerService`                          | Timer lifecycle, batch, transaction, row locks và recovery                | Hiện tự gửi CONNECT_CALL theo camera owner; event không có camera cần owner/resident explicit |
| `/events/{eventId}/confirm`                                | Idempotency, history, version, phase INITIAL/EMERGENCY                    | Hiện chỉ ADMIN/CAREGIVER; tạo endpoint M5 riêng cho đúng resident                             |
| Telegram worker/callback                                   | Gửi intent, retry, callback ràng buộc recipient/message                   | Hiện kiểm tra role ADMIN/CAREGIVER và camera owner; nhánh M5 phải ràng buộc resident/check    |

**P2 là persona, không phải role tên RESIDENT.** Enum hiện có là `ADMIN`, `CAREGIVER`, `VIEWER`. Tài khoản người được giám sát thường là VIEWER, được xác định bằng `residentUserId`; không thêm enum RESIDENT hoặc nâng quyền VIEWER toàn hệ thống. Quyền xác nhận M5 chỉ mở cho `auth.sub == run.resident_user_id` và hộ/notification khớp.

## 3. Phạm vi E2E của một owner

Owner triển khai theo thứ tự: contract/dependency → migration → adapter M1 metadata → observation/presence → CRUD lịch → scheduler/run repository → event/notification/deadline/confirmation → dashboard và Telegram → kiểm thử thật → runbook. Không dừng ở cron log hoặc mock service.

Bao gồm hai màn hình/lối dùng: caregiver tạo/quản lý lịch và xem lịch sử; resident thấy yêu cầu “Tôi ổn”/“Cần giúp đỡ” của mình. Caregiver nhận cảnh báo khi resident không phản hồi. Mọi dữ liệu có phạm vi hộ và người; không chọn caregiver đầu tiên trong bảng users.

Không thêm YOLO/Pose, không tính motion từ ảnh trong M5, không để browser quyết định timeout, không tạo scheduler trong FastAPI. Không yêu cầu event M5 có snapshot/camera. Không thay chính sách deadline hoặc quyền xác nhận M1/M2/M3/M4.

## 4. Gate dependency trước triển khai

M5 **không thêm package runtime**. Dùng Node 22, pnpm 9.12.0, NestJS 10.4.22, `pg` 8.23.0, TypeScript/test/frontend từ `pnpm-lock.yaml`; cài bằng `pnpm install --frozen-lockfile`. Xem exact versions và cách cập nhật ở [DEPENDENCY_BASELINE.md](DEPENDENCY_BASELINE.md).

- Timer dùng `OnModuleInit`/`OnModuleDestroy` + `setInterval` đã có ở deadline worker, quét ngay startup, không chạy hai vòng cùng process. Timer chỉ đánh thức worker; Postgres mới là nguồn bền vững.
- Tính occurrence bằng PostgreSQL 16 `AT TIME ZONE`; hiển thị bằng `Intl.DateTimeFormat` có sẵn. Không cài `@nestjs/schedule`, `cron`, `node-cron`, `moment`, `luxon`, `date-fns-tz` hoặc package AI cho M5.
- Dùng `pg` transaction/row locks/lease như repo. Không thêm một phiên bản BullMQ/Redis client khác; M5 không cần queue mới để giữ lịch.
- Ghi Node patch, Postgres image digest/tzdata, lockfile SHA-256 thực dùng và kết quả clean install vào baseline lúc build. `postgres:16-alpine` hiện là major tag; digest phải được xác minh khi dựng môi trường, không bịa digest trong plan.
- Python runtime/lock/model của M2a/M3 do một người tích hợp theo baseline chung; M5 không sửa `pyproject.toml`, requirements hoặc training environment.

Gate đạt khi install frozen lock, contracts generate/typecheck, startup health và baseline test cũ đều đạt. Nếu môi trường tool hỏng, ghi blocker và sửa tool path; không giải quyết bằng tự nâng dependency.

## 5. Chốt cả hai OpenAPI trước code

### 5.1. Quyền sửa và chống conflict

| File                          | Phần M5 sở hữu                                                                                                     | Phần cần giữ                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `api/openapi.yaml`            | `/wellness-schedules*`, `/wellness-checks*`, `/internal/wellness-observations`, schema prefix `Wellness`           | Face/Fall/Fire contracts, generic AI result union và enums/security chung                  |
| `api/openapi.yaml` — shared   | Ba context field optional `wellnessResidentUserId`, `wellnessResidentName`, `wellnessCheckId` trong `EventSummary` | Required fields và behavior của event khác                                                 |
| `api/openapi-ai-service.yaml` | Một câu overview: M5 chạy ở orchestrator, không dùng inference                                                     | Không thêm endpoint M5; `/face/*`, `/pose/fall`, `/fire/detect` và response shapes đã chốt |
| Generated contracts           | Regenerate từ cả hai spec cuối cùng                                                                                | Không sửa tay generated files                                                              |

Đăng ký thay đổi tại [API_CHANGE_REGISTER.md](API_CHANGE_REGISTER.md). Một người tích hợp phần shared, PR contract có A+B review và merge trước implementation. Namespace giúp giảm conflict nhưng không khóa kỹ thuật YAML; contributor khác lấy commit spec đã merge, tránh sửa cùng operation/schema. Khi conflict, resolve từng operation với owner, regenerate types; không lấy toàn bộ ours/theirs. Global `info.version`, JWT/internal token, shared enums và generic callbacks giữ nguyên nếu không có PR contract riêng.

### 5.2. Lịch wellness

- GET `/wellness-schedules`: `data[]` lịch chưa soft-delete. Caregiver/admin chỉ quản lý hộ được phép; resident chỉ đọc lịch của mình. Filter `residentUserId` không mở rộng quyền.
- POST giữ `residentUserId`, `checkAt` bắt buộc. 09:00 và 18:00 là **hai record**. `checkAt` HH:mm; `daysOfWeek` ISO 1–7, không rỗng/không trùng; `timezone` IANA, mặc định Asia/Ho_Chi_Minh. Camera IDs phải thuộc hộ, đang hợp lệ; `[]` là mọi camera enabled của hộ. Không đủ household/resident/channel hoặc cấu hình invalid trả 400/403, trùng resident/checkAt trả 409.
- PATCH dùng `UpdateWellnessScheduleRequest`, không bắt gửi lại các field required của POST. Ít nhất một field, validate object sau merge; tăng version. Không sửa snapshot occurrence hoặc deadline đã gửi.
- DELETE soft-delete và disable admission; không xóa run/history hay dừng deadline của alert tồn tại. Migration mới thay unique cũ bằng partial unique `(resident_user_id, check_at) WHERE deleted_at IS NULL`: lịch active trùng vẫn 409; có thể tạo lịch mới cùng giờ sau khi xóa lịch cũ, giữ lịch sử và deadline của record cũ. Không sửa file migration lịch sử.
- Response giữ required cũ; thêm optional owner/version/configurationStatus. Record legacy không tìm được owner duy nhất có `INVALID_CONFIG`; hiện trong UI để sửa, scheduler không giả định hộ bất kỳ.

### 5.3. Lịch sử và xác nhận

- GET `/wellness-checks`: phân trang `page/pageSize`, filter resident/schedule, trả `data[]` và `total`. `status` là quyết định scheduler; `eventStatus` là lifecycle hiện tại của event. Run ALERT_CREATED không đổi thành RESOLVED; event đổi trạng thái và UI đọc cả hai.
- POST `/wellness-checks/{checkId}/confirm`: chỉ tài khoản resident của check; body `commandId` UUID bắt buộc, `response=IM_OK|NEED_HELP`, note ≤500. Không có ACKNOWLEDGED ở endpoint này.
- IM_OK trước deadline → RESOLVED; NEED_HELP trước deadline → ESCALATED tức thì. Actor/time lấy từ JWT/server, không nhận timestamp hoặc resident ID do client khai.
- Cùng commandId/payload trả lại confirmation 200 gốc, kể cả sau khi event chuyển trạng thái. CommandId đổi payload hoặc confirmation khác → 409. Check không thuộc user → 403/404 theo policy thống nhất, không rò metadata.
- Chưa gửi yêu cầu → `409 REQUEST_NOT_SENT`. Đúng hoặc sau deadline → transaction leo thang nếu còn NOTIFIED rồi `409 DEADLINE_EXPIRED` cùng canonical state. Không cho IM_OK muộn ghi RESOLVED trước khi deadline worker kịp chạy.
- Dashboard resident không được dùng endpoint caregiver chung để lách guard. Telegram callback M5 route tới cùng service với actor đã đối chiếu recipient, check, notification/message/chat/user và TTL; không bỏ kiểm tra hiện có với sự kiện khác.

### 5.4. Bằng chứng hoạt động/hộ

POST `/internal/wellness-observations` dùng `X-Internal-Token`, không nhận JWT tự khai hoạt động. Request có observationId, owner/resident/knownFace/identityEvent/camera, sourceSessionId, trackId, kind, observedAt. `kind=MOTION|ARRIVAL|DEPARTURE`; hai nhãn direction phải có `directionalEvidence` với boundaryId, direction ENTER/EXIT và policyVersion theo schema.

Xác minh `identityEventId` và active face result `KNOWN` của đúng linked resident, đúng owner/camera/track/session; motion phải là chuyển động thật trong metadata nguồn đã xác minh, không phải job replay hoặc face match đơn lẻ. ID sai/khác hộ trả 400/403/404. Observation ID dùng một lần: canonical payload hash giống → 202 DUPLICATE; khác → 409, không ghi đè.

Lưu `observedAt` và `receivedAt` riêng; bounded clock skew/staleness. Out-of-order không ghi đè presence mới, duplicate không cộng hoạt động. Bằng chứng tới muộn có thể phục vụ check sau, không tự resolve event đã phát sinh. Không log image/embedding/secret.

## 6. Nguồn M1 và phép xét hoạt động

### 6.1. Không nhầm person/face detection với hoạt động

Tạo `ResidentObservationPort` và adapter từ pipeline M1/Frigate metadata hiện có. M1 vẫn chịu trách nhiệm nhận diện; M5 không đọc pixel và không gọi Face/Pose để tìm lại người.

1. Khi M1 trả KNOWN, lập association `(owner,camera,sourceSession,trackId) -> resident/knownFace/identityEvent` có TTL, mặc định 30 giây, có version và bounded cache. Không dùng trackId trần vì camera/restart tái sử dụng ID.
2. Chỉ phát MOTION khi nguồn hiện có báo chuyển động cho association còn hạn; timestamp là capture/observation time. Không phát mỗi tick/frame/job refresh nếu người không chuyển động. Nếu nguồn chỉ có face match mà không có motion metadata, gate nguồn chưa đạt; không giả lập mọi KNOWN thành activity.
3. Track mới/session mới hoặc association hết hạn cần bằng chứng M1 mới; người không nhận diện được không kéo dài thời hạn của resident.
4. Dùng observationId ổn định theo nguồn; giữ payload trong cơ chế retry có sẵn của integration, không đổi observedAt/result identity khi gửi lại.

Phép xét cho run là tồn tại observation `MOTION` hoặc `ARRIVAL` của đúng owner/resident/camera trong **cửa sổ đóng `[scheduledFor - X giờ, scheduledFor]`**, đã được nhận không muộn hơn thời điểm evaluate. Tại đúng biên vẫn tính hợp lệ. Check lúc 09:00 không được dùng motion 09:01 vì worker trễ. Khi cameraIds rỗng, resolve tập camera enabled thuộc owner vào snapshot; camera người khác không được tính.

### 6.2. Rời nhà và quay về

Repo hiện chưa có feed departure hoàn chỉnh. Owner phải bổ sung adapter direction từ bằng chứng có sẵn của M1/Frigate, cùng một story E2E, trước nghiệm thu skip-away:

- Cấu hình boundary logic có phía inside/outside, policyVersion, camera/zone IDs trong cấu hình hộ đã kiểm chứng. Chỉ directional transition có thứ tự `inside -> outside` của identified track là EXIT; ngược lại ENTER. Không suy EXIT từ mất track, face biến mất hoặc kết thúc clip.
- Nếu camera/metadata không quan sát được direction, giữ UNKNOWN; không thêm model vision cho M5 hoặc dùng absence timeout để tạo departure giả. Tài liệu ghi camera nào chưa hỗ trợ skip-away.
- ARRIVAL hoặc MOTION đã xác minh trong camera của hộ → HOME. Explicit DEPARTURE → AWAY. Presence projection cập nhật theo observedAt mới hơn trong transaction; một observation cũ không đổi HOME thành AWAY.
- Presence có TTL mặc định 24 giờ, snapshot policyVersion. Hết hạn/missing/config lỗi → UNKNOWN, **không skip**. Thời điểm đang xét là scheduledFor; chứng cứ departure sau giờ check không được bỏ check đã đến hạn.
- Query ledger as-of scheduledFor khi evaluate run, không lấy mù projection hiện tại: projection có thể chứa ARRIVAL/DEPARTURE xảy ra sau scheduledFor. Latest valid evidence đúng thời điểm quyết định trạng thái snapshot.
- Xung đột evidence cùng timestamp phải được phát hiện, không chọn AWAY theo thứ tự nhận tùy ý; hạ về UNKNOWN trong phép đánh giá và ghi operational metric.

Gate nguồn đạt khi integration fixtures đi qua adapter thật: known+motion, unknown motion, face-only, depart, arrive, restart track reuse, out-of-order và cross-household. Fixture là metadata có provenance/bối cảnh; E2E không cần quay video hay chạy model để kiểm tra scheduler. Nghiệm thu end-to-end integration với M1 hiện hữu vẫn phải chứng minh được association/direction chứ không chỉ gọi API bằng JSON tự khai.

## 7. Scheduler bền vững, timezone và lịch trễ

### 7.1. Occurrence

- Một occurrence mỗi `(schedule_id, local_date)` theo timezone của lịch; 09:00/18:00 có schedule IDs riêng. DB unique ngăn worker/replica chạy trùng, kể cả khi chỉnh giờ của cùng schedule giữa ngày.
- Dùng thời gian database; không phụ thuộc timezone máy hoặc đồng hồ browser. `scheduledFor` và API date-time là UTC có offset; lưu `localDate`, version và config/camera snapshot để audit.
- Tính `scheduledFor = (local_date + check_at) AT TIME ZONE timezone`, kiểm tra timezone qua `pg_timezone_names`. Dùng ISO weekday của localDate, không weekday UTC.
- Chốt DST theo PostgreSQL 16: thời điểm không tồn tại khi spring-forward dùng offset trước transition; ambiguous fall-back dùng offset sau transition. Có thể dẫn tới 02:30 được chạy ở 03:30 địa phương; unique ngày ngăn chạy hai lần. Không tự áp thuật toán timezone khác trong frontend. [Tài liệu PostgreSQL về thời điểm DST](https://www.postgresql.org/docs/16/datetime-invalid-input.html).
- Schedule mới chỉ xét occurrence từ thời điểm tạo/enable; không phát cảnh báo lịch trước khi người dùng cấu hình. Lưu `activation_started_at` khi create/re-enable và `last_materialized_at` như admission cursor; advance cursor cùng transaction tạo run, tách khỏi last_checked_at. Startup reconcile tối đa 24 giờ gần nhất tính từ max(cursor, activation), không replay toàn bộ lịch sử; khoảng downtime cũ hơn được ghi operational missed-range có số occurrence ước tính, không tạo hàng loạt alert.

### 7.2. Chốt cấu hình worker

| Config                                 | Mặc định | Quy tắc                                                                                                               |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `M5_ENABLED`                           | false    | Admission mới tắt tới khi AC/regression đạt; delivery/deadline event đã lưu vẫn chạy                                  |
| `WELLNESS_POLL_INTERVAL_MS`            | 5000     | Validate >0; quét ngay startup; hủy timer khi shutdown                                                                |
| `WELLNESS_BATCH_SIZE`                  | 50       | Có giới hạn, batch transaction ngắn                                                                                   |
| `WELLNESS_RUN_LEASE_SECONDS`           | 30       | Reclaim lease hết hạn, không giữ transaction khi gọi network                                                          |
| `WELLNESS_RECONCILE_LOOKBACK_SECONDS`  | 86400    | Giới hạn materialize khi startup/downtime; ghi missed-range cho khoảng cũ hơn                                         |
| `WELLNESS_CATCHUP_SECONDS`             | 300      | Run trễ ≤300 giây được evaluate cửa sổ gốc; trễ hơn ghi MISSED và operational alert, không phát hàng loạt wellness cũ |
| `WELLNESS_DELIVERY_TIMEOUT_SECONDS`    | 60       | Không gửi được yêu cầu trong thời hạn này thì escalate caregiver với lý do DELIVERY_FAILED                            |
| `WELLNESS_PRESENCE_TTL_SECONDS`        | 86400    | AWAY không được skip vô hạn                                                                                           |
| `WELLNESS_IDENTITY_LINK_TTL_SECONDS`   | 30       | Không tái sử dụng nhận diện track quá hạn                                                                             |
| `WELLNESS_OBSERVATION_MAX_AGE_SECONDS` | 86400    | Hỗ trợ lookback 24h; observation stale bị loại và ghi metric                                                          |
| `WELLNESS_CLOCK_SKEW_SECONDS`          | 5        | Không ghi evidence từ tương lai vượt giới hạn; không dùng evidence sau scheduledFor                                   |

ConfigService đọc/validate startup và thêm `.env.example` khi implementation. Grace/lookback lấy từ schedule snapshot; không thêm env khác có thể âm thầm override lịch.

Worker không chỉ kiểm tra `HH:mm == now`. Materialize occurrence đến hạn bằng INSERT ON CONFLICT trong transaction; claim PENDING bằng lease và `FOR UPDATE SKIP LOCKED`. [Quy tắc row locking PostgreSQL](https://www.postgresql.org/docs/16/sql-select.html) phù hợp hàng công việc, không thay transaction nhất quán để tính hoạt động.

Mỗi claim tạo lease_token UUID; completion/retry chỉ UPDATE khi token/status còn khớp. Lease quá hạn quay về PENDING, clear token/lease rồi claim lại; worker cũ không ghi đè claim mới. Giữ occurrence/snapshot. Hai replica có thể quét đồng thời nhưng một quyết định chỉ commit một lần. Catch-up vượt giới hạn phải hiện MISSED/degraded cho caregiver, không báo rằng mọi check đã chạy tốt. Run nguồn/cấu hình lỗi retry có backoff và metric; không chuyển SKIPPED_ACTIVITY để che lỗi.

## 8. State machine, transaction và notification

### 8.1. Quyết định theo thứ tự

1. Recheck schedule chưa soft-delete, enabled, cùng version hợp lệ và link owner/resident. Lịch disable/delete trước khi evaluate → SKIPPED_DISABLED; version thay đổi → SKIPPED_SUPERSEDED, không mutate snapshot. Version thay đổi không chạy lại occurrence cũ trong ngày.
2. Quá catch-up → MISSED.
3. Evidence explicit AWAY còn hạn tại scheduledFor → SKIPPED_AWAY, không event.
4. Có activity hợp lệ trong cửa sổ → SKIPPED_ACTIVITY, không event.
5. Có wellness event DETECTED/NOTIFIED/ESCALATED chưa xử lý của owner/resident → SKIPPED_SUPERSEDED, log liên kết check đang chờ; không tạo yêu cầu lặp ở lịch kế tiếp.
6. Còn lại → ALERT_CREATED: tạo event WELLNESS_TIMEOUT/P2, không dùng confidence ML; camera_id/zone_id/track_id null, wellness_owner/resident explicit. Dedup key `m5-wellness:{scheduleId}:{localDate}`.

Trong transaction khóa schedule và hàng resident/household theo thứ tự thống nhất, evaluate evidence snapshot, tạo event/histories/notification intents/outbox SSE và run decision cùng commit. DB partial unique active wellness owner/resident là lớp bảo vệ cuối. Conflict unique phải reload canonical check, không chuyển thành 500 hoặc duplicate event.

### 8.2. Resident trước, caregiver sau

Nhánh M5 dùng `WellnessEscalationPolicy`/service adapter riêng, tái sử dụng repository/history/notification/outbox primitives. Tạo chuyển DETECTED -> NOTIFIED cùng lịch sử; snapshot priority P2, grace, resident/owner/channel và delivery deadline. **Không** đi qua generic AI callback/threshold policy để tạo deadline từ detectedAt hoặc giả confidence=1.

- INITIAL intents có `recipient_user_id=resident_user_id` explicit; không dựa fallback camera owner vì M5 có camera null. Chỉ bật schedule sau khi có channel resident khả dụng (Telegram đã link hoặc dashboard delivery hỗ trợ authenticated resident).
- `notifiedAt` ban đầu là lúc request intent được tạo; `requestSentAt` riêng là lần dispatch thành công đầu tiên được lưu. Không giả định Telegram SENT nghĩa là resident đã đọc.
- Trước first dispatch, event `escalation_deadline_at` null; run `delivery_deadline_at=evaluatedAt+60s` để tránh treo vô hạn. Delivery success hook transaction khóa **event trước, run sau**, đặt requestSentAt từ server, deadline=requestSentAt+grace, đồng bộ event deadline. Retry không đổi cả hai.
- Dashboard dispatch chỉ được tính thành công khi đã gửi tới phiên authenticated resident qua kênh có thể chứng minh; không coi broadcast caregiver, ghi DB hoặc tạo intent là resident đã được yêu cầu. Nếu hạ tầng dashboard hiện chưa có recipient delivery, dùng Telegram resident ở release đầu và ghi rõ hạn chế.
- Delivery hết 60 giây hoặc không có channel: chuyển NOTIFIED -> ESCALATED một lần với DELIVERY_FAILED, gửi caregiver explicit. Không “đợi 5 phút” cho request chưa hề gửi được. Hook thành công tới sau escalation chỉ ghi delivery, không hồi sinh deadline/event.
- Sau deadline phản hồi: deadline worker nhánh M5 khóa event, run theo thứ tự trên; kiểm tra trạng thái/version; tạo intents cho owner caregiver và các emergency contacts theo policy hiện có, không gửi lại request resident hoặc recipient null. Các event khác giữ nguyên code path cũ.
- Không đổi priority P2 thành P0/P1 vì timeout. NEED_HELP leo thang ngay cùng priority P2. Emergency close tiếp tục cơ chế caregiver/ADMIN hiện có.
- Confirmation service, delivery hook và timeout worker dùng cùng DB transaction time sau khi có lock; không lấy timestamp client. Boundary: `now < deadline` mới nhận IM_OK, `now >= deadline` timeout thắng. Identical replay kiểm tra trước state/deadline để trả response đã lưu.
- M5 Telegram callback phải đối chiếu assigned resident và notification context camera-less. Không chỉ xóa role check của adapter chung; thêm nhánh feature-specific và test giữ quyền cũ.
- SSE `event.updated`, notification jobs và UI re-fetch dùng event version/idempotency; không gửi stale notification cho event đã RESOLVED/CLOSED. Crash sau commit còn outbox; crash trước commit không có nửa event hoặc nửa request.

## 9. Migration và dữ liệu

Đã chuẩn bị migration append-only [0015](../../db/migrations/0015_wellness_check_runtime.sql), không sửa seed enum/rule hay migration lịch sử:

| Thay đổi                                                                                         | Mục đích/invariant                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `wellness_schedules.owner_user_id/version/activation_started_at/last_materialized_at/deleted_at` | Backfill owner chỉ khi active face links cho resident có đúng một owner; ambiguous để null, sửa rõ ràng trước admission       |
| `events.wellness_owner_user_id/wellness_resident_user_id`                                        | Authorize và route event không có camera; optional cho event cũ                                                               |
| Partial unique active M5 owner/resident                                                          | Một check chưa xử lý mỗi resident/hộ; không ảnh hưởng event types khác                                                        |
| `resident_wellness_observations`                                                                 | Observation UUID/hash/evidence/observedAt/receivedAt, các FK scope và indexes theo người/thời gian                            |
| `resident_wellness_presence`                                                                     | Projection HOME/AWAY có expiry, observation gốc; expired/missing là UNKNOWN khi đọc                                           |
| `wellness_check_runs`                                                                            | Unique schedule/localDate, snapshot immutable, cửa sổ, quyết định, lease/retry, event và delivery/confirmation timestamps     |
| Triggers/invariants                                                                              | Snapshot/decision đã commit không viết lại; request đã gửi không restart grace window; status/lease/deadline và ranges hợp lệ |

Không dùng projection thay ledger as-of. Application validate owner/camera/face/user role và payload conditional; FK chỉ chứng minh ID tồn tại, không chứng minh cùng hộ. Camera_ids dạng array hiện hữu phải validate mỗi UUID và snapshot scope; không giả rằng có FK array.

Schedule DELETE là soft delete vì run FK RESTRICT. Event retention phải xóa run hết hạn sau audit/export policy rồi xóa event; không xóa run đang pending hoặc event đang NOTIFIED/ESCALATED. Observation referenced bởi presence có FK NO ACTION deferred để account cascade vẫn hoàn tất, nhưng không được để mất evidence ở commit: compact projection/retention có thứ tự, không xóa bằng CASCADE làm mất evidence hiện hành. Account deletion và dữ liệu nhạy cảm theo policy hiện có; các snapshot không chứa embedding/image/token.

Đồng thời có [0013 M2a](../../db/migrations/0013_fall_incidents.sql), [0014 M3](../../db/migrations/0014_fire_incidents.sql). Số 0013–0015 đã được reserve trong register; rebase kiểm tra collision trước merge. Repo đã có số 0007/0010 trùng theo filename, không sửa lịch sử để “dọn”.

Gate DB bắt buộc trên **PostgreSQL 16 disposable**: apply chuỗi cũ rồi 0013/14/15, cả fresh và upgrade có dữ liệu; xác minh old rows/constraints/seed còn đúng; run up lần hai không chạy lại file đã applied. Migration runner và Docker init phải dùng một lịch sử filename nhất quán; DB tạo từ Docker init chưa có schema_migrations không được chạy mù toàn bộ chuỗi qua runner — baseline lịch sử cũ sau đối chiếu schema trên DB test, không reset DB thật. Không chạy `db:reset`, không xóa volume đang dùng. Migration này là DDL chuẩn bị, không tự apply vào DB production.

## 10. Trình tự triển khai và phạm vi file

| Bước | Sản phẩm một owner giao                                                         | Điều kiện chuyển bước                                             |
| ---- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0    | Đọc conventions, giữ diff ngoài phạm vi, baseline test/API/DB                   | Ghi hiện trạng và nguồn M1 thật                                   |
| 1    | Register/baseline và PR contract cả hai spec + generated types + migrations/ERD | Review A+B, lint/typecheck/DB gate đạt, merge contract trước code |
| 2    | Observation port/adapter, DTO, repository, presence projection                  | Source identity/motion/direction và cross-scope/replay tests đạt  |
| 3    | CRUD schedule + authorization + timezone/config validation                      | FE/BE cùng types; create/patch/delete đúng semantics              |
| 4    | Occurrence materializer + leased evaluator + atomic event/intents               | Restart, concurrency, downtime, dedup và rollback tests đạt       |
| 5    | M5 resident delivery/deadline/confirmation + caregiver routing                  | 300 giây, boundary/race/retry, camera null và Telegram guards đạt |
| 6    | Caregiver/resident UI và SSE/history                                            | “Tôi ổn” hoạt động bằng tài khoản resident, không nhầm actor/hộ   |
| 7    | E2E + regression + runbook/metrics                                              | AC đầy đủ, feature flag chỉ bật sau nghiệm thu                    |

Backend module dự kiến `apps/orchestrator/src/wellness/`: controller, DTO, service, repository; observation/source ports và adapters; scheduler lifecycle/materializer/evaluator; policy/confirmation/delivery services. Wiring tại AppModule và config; scoped modifications tại event authorization, notification/Telegram và deadline worker. Frontend tái sử dụng event cards/filter/types, thêm quản lý lịch và danh sách yêu cầu riêng cho resident. Đường dẫn frontend cụ thể chọn theo routing hiện hữu sau audit, không tạo app mới.

Tuân thủ conventions: controller không chứa SQL/domain; repository dùng explicit columns và parameterized SQL; public TS typed, không any/console.log; transaction không giữ network call; ConfigService thay magic constants; input/date/time/array validate rõ ràng; không sửa tay generated contracts; comment/log English, UI Vietnamese. Core logic coverage tối thiểu 60% theo repo, test behavior thay vì getters.

Git theo [GIT_WORKFLOW.md](../conventions/GIT_WORKFLOW.md): nhánh `feat/US-20-wellness-check`, lifespan ≤3 ngày, rebase main hằng ngày; nếu nhiều PR thì contract/DB rồi backend/runtime rồi UI/E2E nhưng cùng owner/AI. English Conventional Commits với scope, không push main/skip hook/tự merge. Contract có A+B review, PR tính năng có reviewer hợp lệ; không coi “một owner” là miễn review. Lock conflict regenerate theo baseline, không sửa tay.

## 11. Kiểm thử chức năng và hồi quy

| Nhóm          | Ca bắt buộc                                                                                       | Kỳ vọng                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Lịch          | 09:00/18:00, ISO weekday, timezone không theo host, create sau giờ, DST gap/fold                  | Đúng occurrence; một lần/schedule/ngày; không replay quá khứ trước enable |
| Cửa sổ        | Biên start/end; X=1/6/24; motion sau giờ nhưng trước evaluate                                     | Chỉ evidence trong cửa sổ gốc; cả biên được tính                          |
| Identity      | Hai người/camera, UNKNOWN, face-only, expired link, track/session reuse                           | Không dùng hoạt động người khác hoặc association cũ                       |
| Presence      | Explicit exit, arrive rồi delayed exit, expired away, outage, conflicting timestamps              | Chỉ AWAY tin cậy/còn hạn/as-of mới skip; còn lại UNKNOWN/HOME             |
| Alert         | Không activity, không camera, confidence null, hai schedules cùng resident                        | P2/request resident đúng một active check; không event camera giả         |
| Delivery      | First SENT, retry, crash, dispatch thất bại 60s, late SENT sau escalation                         | Deadline = firstSent+300; không kéo dài; caregiver nhận failure           |
| Confirmation  | IM_OK 299.999s, đúng 300s, 300.001s, NEED_HELP, identical/changed command                         | Trước hạn RESOLVED; bằng/sau hạn ESCALATED; replay ổn định                |
| Race          | Confirm/timeout/SENT/disable chạy đồng thời, hai replicas                                         | Một authoritative transition/notification; lock order không deadlock      |
| Recovery      | Crash trước/sau commit, expired lease, startup <300s/>300s late                                   | Không mất run; catch-up đúng cửa sổ hoặc MISSED rõ ràng                   |
| Auth          | VIEWER resident own/other, caregiver cross-household, wrong face/camera/token                     | Chặn sai actor/scope; old roles giữ nguyên                                |
| Update/delete | Edit X/timezone/grace/version, soft-delete có pending request                                     | Snapshot/deadline cũ không đổi, không chạy lại ngày đó                    |
| Retention     | Remove old ledger/projection/run/event theo thứ tự                                                | Không mất active evidence/check; FK bảo vệ audit                          |
| E2E           | M1 metadata adapter -> DB -> scheduler -> Telegram/dashboard resident -> confirm/caregiver -> SSE | Dùng Postgres thật và clock controlled; không chỉ service mock            |

E2E clock có thể dùng test config/injected clock và scheduler tick; một test chốt **300 giây thật theo thời gian logic**, không phải đổi production default thành vài giây rồi tuyên bố đạt. Network Telegram dùng adapter test/local fake để không nhắn người thật ngoài test; staging với tài khoản test đã đồng ý chứng minh callback thực tế.

Hồi quy bắt buộc: auth/JWT/refresh và VIEWER permissions; camera CRUD/live/zone; M1 face collection/matching/M4 person events; M2a missing pose/rest area/confirmed fall; M3 temporal P0/active latch; AI result receipts/dedup/outbox; Telegram retry/first-confirmation/security; configurable high_wait và deadline của events cũ; emergency close, media/SSE/event filter. So sánh source branch baseline, không sửa test cũ để che lỗi. M5 tắt không tạo run/event mới nhưng không vô hiệu notification/deadline đã persist.

## 12. Verification, vận hành và Definition of Done

Lệnh chuẩn tại repo, dùng toolchain đã lock:

```powershell
pnpm install --frozen-lockfile
pnpm api:lint
pnpm contracts:generate
pnpm --filter @cam/contracts typecheck
pnpm --filter @cam/contracts build
pnpm --filter @cam/orchestrator typecheck
pnpm --filter @cam/orchestrator test --runInBand
pnpm --filter @cam/orchestrator test:integration
pnpm --filter @cam/web typecheck
pnpm --filter @cam/web test
pnpm test:tools
pnpm check:all
git diff --check
```

Chạy migration up/status **chỉ với DATABASE_URL của DB disposable đã xác minh**, không sao chép URL/secrets vào log. Thêm test migration PostgreSQL vào suite integration hiện có khi triển khai runtime. Generate lần hai phải không có diff. Spec lint pass không chứng minh backend đã implements API; migration parse không thay thế PostgreSQL upgrade test.

Metrics/logs English, có correlationId/runId/scheduleId/resident pseudonymous IDs: scheduler lag/missed/lease retry, observations accepted/replayed/rejected, stale presence/unknown, checks skipped/alert created, delivery latency/failure, pending response, confirmation/escalation count và timeout lateness. Không log dữ liệu khuôn mặt/secret/chat token. Health/ops hiển thị scheduler degraded hoặc MISSED, không thêm fake wellness “OK” khi worker chưa chạy.

Rollback: `M5_ENABLED=false` dừng admission, giữ delivery/confirmation/deadline của alert tồn tại; khôi phục image/commit cũ đã kiểm chứng. Schema additive giữ để audit, không drop/reset tables. Nếu code cũ không xử lý M5 camera-less, phải giữ worker M5 tương thích để drain pending trước khi rollback hoàn toàn; không trả trách nhiệm cho generic worker thiếu recipient context.

Deliverables implementation: `TEST_US-20_WELLNESS.md`, `RUNBOOK_M5_WELLNESS.md`, cấu hình recipient/boundary/clock/retention, logs DB upgrade/concurrency/E2E và baseline regression, commit contracts/baseline đã frozen. Runbook giải thích sửa link owner legacy, timezone/DST, missed checks, resident Telegram/dashboard readiness và cách tắt admission mà vẫn xử lý cảnh báo cũ.

- [ ] Một owner/một AI thực hiện E2E; conventions/Git/reviewer đúng.
- [ ] Baseline dependency và hai OpenAPI merge trước code; generated types không lệch.
- [ ] 0013–0015 fresh/upgrade/re-run và dữ liệu cũ kiểm chứng trên PostgreSQL 16.
- [ ] Motion đúng registered resident; departure có nguồn explicit; không suy AWAY từ mất tín hiệu.
- [ ] 09:00/18:00, X giờ, grace 300 giây, IM_OK/timeout/NEED_HELP đúng.
- [ ] Resident VIEWER chỉ xác nhận check của mình; caregiver đúng hộ; camera null hoạt động.
- [ ] Duplicate/restart/race/late delivery không tạo nhiều alert hoặc reset deadline.
- [ ] UI/Telegram/SSE E2E và hồi quy tính năng cũ đạt; docs/ops/rollback hoàn chỉnh.

## 13. Prompt giao cho AI Agent thực thi

> Triển khai US-20 theo plan này bằng một AI Agent duy nhất. Đọc AGENTS nếu có và conventions, giữ diff ngoài phạm vi; bắt đầu bằng baseline và gate contract/dependency/DB. Không thêm model hoặc thư viện scheduler/timezone mới. M5 đọc bằng chứng identity/motion/direction từ M1 metadata qua adapter, không đọc ảnh hoặc suy rời nhà từ camera silence. Hoàn thiện CRUD lịch/owner scope, ledger/presence, occurrence/lease/recovery, atomic P2 event và resident request, deadline từ first successful dispatch, resident confirmation, caregiver escalation, UI/SSE/Telegram và E2E. Dùng VIEWER hiện hữu cho persona resident với quyền đúng check, không mở guard chung. Không claim departure AC khi source adapter chưa chứng minh direction. Không tự apply migration lên dữ liệu thật, reset DB, push main hoặc tự merge. Giữ feature flag off tới khi review/AC/hồi quy đạt và chỉ đánh dấu hoàn tất khi có bằng chứng kiểm thử.

## 14. Trạng thái bàn giao contract/DDL

Plan này đi kèm cập nhật hai OpenAPI, regenerated contracts, migration M2a/M3/M5 và ERD. Đây là **chuẩn bị triển khai**, chưa có runtime scheduler/AI detector mới, chưa có model đã train và chưa apply DDL lên database của người dùng. Hash/file reservation trong register ghi local snapshot; PR/merge SHA, model checksum và kết quả DB/E2E phải được bổ sung bằng bằng chứng thực tế, không suy ra từ việc có plan/spec.
