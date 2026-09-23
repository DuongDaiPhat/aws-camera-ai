# Kế hoạch thực thi 1 tuần cho 5 thành viên

> Phạm vi: [Plan Giao diện Camera](Plan%20Giao%20diện%20Camera.md), [US-09](US_09_FACE_REGISTER.md), [US-10](PLAN_US-10_PERSON_CROP_FACE_MATCH.md), [US-11](PLAN_US-11_EVENT_AI_LABELS.md), [US-12](PLAN_US_12_ZONE_CONFIGURATION.md), [US-13](PLAN_US-13_ESCALATION_STATE_MACHINE.md), [US-14](PLAN_US-14_TELEGRAM_ALERTS.md) và [US-15](PLAN_US-15_ESCALATION_RULE_SETTINGS.md).
>
> Thời gian cố định: **5 ngày làm việc, từ thứ Hai đến thứ Sáu**. Không chuyển phần việc sang tuần sau. Phạm vi trong các plan là phạm vi nghiệm thu; các cải tiến ngoài acceptance criteria đưa vào backlog sau tuần này.

## 1. Mục tiêu cuối tuần

Đến 17:00 thứ Sáu, hệ thống phải chạy được luồng thật sau:

1. Quản trị viên thêm và bật camera webcam/video từ trang Camera, không chạy lệnh thủ công.
2. Quản trị viên vẽ zone trên preview, đặt lịch và thời gian dwell; Frigate nhận cấu hình mới.
3. Quản trị viên đăng ký người quen bằng 1–5 ảnh; hệ thống chỉ giữ embedding.
4. Person crop được nhận diện thành `KNOWN`, `UNKNOWN` hoặc `UNDETERMINED`.
5. Event lưu đầy đủ `ai_label`, `confidence`, `ai_model_version`, `ai_processed_at` và `ai_results`.
6. Rule `T_low`, `T_high`, `T_wait` chỉnh được trên dashboard và có hiệu lực với event mới trong tối đa 60 giây.
7. Escalation engine quyết định `LOGGED_ONLY`, `NOTIFIED`, `RESOLVED`, `ESCALATED`, `CLOSED` và khôi phục deadline sau restart.
8. Telegram gửi ảnh cùng hai nút xác nhận, xử lý idempotent và retry đúng 2/4/8 giây.

## 2. Thành viên và quyền sở hữu cố định

Tên A–E theo danh sách vai trò hiện có trong dự án. Một hạng mục chỉ có một người chịu trách nhiệm cuối cùng.

| Thành viên                          | Vai trò trong tuần               | Sở hữu chính                                                                             | Người review chính                                      |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **A — Team Lead/Frontend**          | Chủ trì UI và PO                 | Toàn bộ giao diện Camera, Known Faces, Zones, Settings; navigation; API hooks; UI E2E    | B review logic tích hợp, C/D review màn hình chuyên môn |
| **B — Backend Lead/Scrum Master**   | Chủ trì contract và domain event | OpenAPI, migration registry, US-11, US-13 core, backend US-15, role/audit                | A review API; E review state/recovery                   |
| **C — Infra/DevOps/Frigate**        | Chủ trì camera và zone runtime   | Backend Camera, source runner, MediaMTX, Frigate config, backend US-12, preview/snapshot | A review API/UI handoff; B review persistence           |
| **D — AI Engineer Face**            | Chủ trì face pipeline            | AI và backend US-09, toàn bộ US-10, collection/model/quality/privacy                     | B review event handoff; A review upload flow            |
| **E — Integration/Notification/QA** | Chủ trì notification và tích hợp | US-14, deadline worker của US-13, shared outbox/job, observability, E2E toàn hệ thống    | B review domain; C review runtime                       |

### Quy tắc ownership

- **A** là người duy nhất tích hợp trực tiếp `Sidebar.tsx`, `DashboardView.tsx` và layout dùng chung. C, D, B cung cấp component hoặc contract, không tự sửa shell trong PR tính năng.
- **B** là editor cuối của `api/openapi.yaml`, migration, event projection và escalation transition. Các thành viên gửi contract proposal trước 11:00 thứ Hai.
- **C** là người duy nhất apply cấu hình Frigate. Camera và Zone chỉ gửi desired state vào cùng `FrigateConfigModule`.
- **D** là người duy nhất thay đổi thuật toán detector/embedder, collection version và score mapping của face.
- **E** là người duy nhất gửi/chỉnh sửa Telegram message. Telegram callback gọi service của B, không tự cập nhật event.
- Tác giả không tự merge. Mọi PR cần ít nhất một approve và CI xanh; thay đổi OpenAPI cần cả A và B duyệt theo quy trình dự án.

## 3. Giao việc cụ thể theo plan và US

### A — Team Lead/Frontend

| Plan/US               | Phần A phải làm                                                                                                                                                | Đầu ra bắt buộc                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Plan Giao diện Camera | Route/NavItem Camera; list active/inactive; toggle camera; form webcam/video và cấu hình Frigate; preview; Debug View với `person boundary` và `zone boundary` | Camera có thể cấu hình và bật/tắt hoàn toàn từ dashboard; trạng thái lỗi/loading/empty rõ ràng |
| US-09                 | Trang Người quen; upload 1–5 ảnh; nhập tên; chọn đúng mặt khi có nhiều mặt; lỗi không có mặt; confirm hard-delete                                              | Hoàn tất mọi acceptance criteria UI của US-09, không giữ preview ảnh sau khi kết thúc request  |
| US-12                 | Trang Khu vực; chọn camera; polygon editor trên preview; tên, loại, lịch 06:00–22:00, dwell; CRUD zone                                                         | Tọa độ chuẩn hóa 0–1; render lại polygon chính xác khi resize; cảnh báo unsaved changes        |
| US-11                 | Hiển thị label, confidence, priority và chi tiết nhiều `ai_results` trên event view hiện có                                                                    | Không tự tính priority ở frontend; render theo response canonical                              |
| US-13/14              | Trạng thái escalation và kết quả xác nhận trên event view; xử lý 409 event đã được người khác xác nhận                                                         | UI phản ánh state mới mà không cần tải lại toàn trang                                          |
| US-15                 | Settings UI theo event type; form `T_low`, `T_high`, `T_wait`; default values; validation `T_low <= T_high`; conflict/version error                            | Lưu thành công, hiển thị version/update time; lỗi validation không gọi lưu                     |

**A không làm:** policy escalation, Frigate composer, face inference hoặc Telegram sender.

### B — Backend Lead/Scrum Master

| Plan/US        | Phần B phải làm                                                                                                                                  | Đầu ra bắt buộc                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Tất cả plan    | Chốt OpenAPI; generated types; shared `RolesGuard`, actor context, `AuditService`; cấp số migration                                              | Producer/consumer dùng cùng contract; không có type API viết tay trùng lặp |
| US-11          | Nhận kết quả AI idempotent; merge `ai_results`; cập nhật `ai_label`, `confidence`, `ai_model_version`, `ai_processed_at`; tính priority cao nhất | Concurrent/duplicate result không làm mất nhãn hoặc giảm priority          |
| US-13          | Pure policy evaluator; transition service; state/history; confirmation transaction; rule snapshot; cancel deadline khi resolve                   | Chỉ service này được đổi escalation state; transition sai trả conflict     |
| US-15          | CRUD escalation rules; defaults; validation; optimistic version; cache/invalidation tối đa 60 giây; audit                                        | Rule mới áp dụng cho event mới trong ≤60 giây, không restart               |
| US-09/10/12/14 | Review và tích hợp persistence/event handoff; không viết lại logic do C/D/E sở hữu                                                               | Foreign key, idempotency key và error model đồng nhất                      |

**B không làm:** UI feature, face model, Frigate apply hoặc Telegram HTTP adapter.

### C — Infra/DevOps/Frigate

| Plan/US               | Phần C phải làm                                                                                                                             | Đầu ra bắt buộc                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Plan Giao diện Camera | Cameras API/repository; webcam/video source settings; source lifecycle; MediaMTX; active/inactive runtime; snapshot/preview; debug metadata | Dev bật webcam/video qua API/UI; process restart an toàn; credential không xuất hiện trong log     |
| US-12                 | Zone schema/repository/API; validation polygon; schedule; dwell ≥2 giây; normalize/denormalize; zone event detector                         | Chỉ tạo `RESTRICTED_ZONE` khi đúng zone, đúng lịch và đủ dwell                                     |
| Camera + US-12        | Một `FrigateConfigModule`: compose toàn bộ camera+zone, validate, version, atomic apply, retry và sync status                               | Camera update không xóa zone; zone update không làm mất camera config; rollback khi config invalid |
| US-10/14              | Cung cấp MediaService/crop/snapshot interface cho D và E                                                                                    | Crop đúng track và snapshot Telegram truy xuất được qua interface ổn định                          |
| Toàn hệ thống         | Docker/runtime fixtures và môi trường Frigate/MediaMTX cho E2E thứ Năm–Sáu                                                                  | Một lệnh khởi động môi trường, container cần thiết healthy                                         |

**C không làm:** event priority, face matching hoặc confirmation state.

### D — AI Engineer Face

| Plan/US       | Phần D phải làm                                                                                                                               | Đầu ra bắt buộc                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| US-09         | Face detect/embed; zero-face error; multi-face candidates; selected-face embedding; known-face collection sync/version; hard delete embedding | Chỉ lưu vector và metadata; ảnh gốc/temp bị xóa cả khi thành công lẫn lỗi |
| US-09 backend | Endpoint orchestration cho create/select/delete known face, phối hợp contract của B                                                           | 1–5 ảnh hợp lệ; delete ghi audit qua shared service                       |
| US-10         | Nhận person crop; quality gate; cosine matching toàn collection; `T_known=0.6`; best match/similarity; timeout budget 5 giây                  | Trả `KNOWN`, `UNKNOWN`, `UNDETERMINED` hoặc `AI_FAILED` đúng acceptance   |
| US-10 → US-11 | Chuẩn hóa `AiResult` envelope, model/collection version, error code; publish result idempotent                                                | B có thể aggregate mà không suy diễn lại score hoặc model version         |
| US-09/10 test | Dataset ảnh tổng hợp/có giấy phép; model fixtures; privacy, stale collection, timeout và threshold tests                                      | Không dùng ảnh thật của thành viên trong repo hoặc test artifact          |

**D không làm:** cập nhật trực tiếp bảng event state, notification hoặc Frigate config.

### E — Integration/Notification/QA

| Plan/US           | Phần E phải làm                                                                                                                           | Đầu ra bắt buộc                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shared foundation | DB-backed job/outbox với lease, unique key, retry và recovery                                                                             | Restart không mất job; duplicate delivery không tạo tác dụng phụ lần hai                |
| US-13             | Deadline scheduler/worker; restore `NOTIFIED` theo `detected_at`; timeout chuyển `ESCALATED`; cancel job khi resolve                      | Restart giữa thời gian chờ vẫn escalation đúng thời điểm                                |
| US-14             | Telegram message + snapshot + metadata; inline buttons; webhook verification; callback; edit message; retry 2/4/8 giây; terminal `FAILED` | Hai người bấm cùng lúc chỉ người đầu thắng; lỗi Telegram không dừng escalation clock    |
| US-14 → US-13     | Callback gọi confirmation command của B, ánh xạ “Tôi ổn” và “Cần giúp đỡ”                                                                 | Telegram adapter không ghi thẳng event/status tables                                    |
| Toàn hệ thống     | Correlation log; integration test; E2E matrix; test report và evidence cuối tuần                                                          | Có bằng chứng chạy thật cho happy path, restart, timeout, retry, concurrency và privacy |

**E không làm:** định nghĩa transition domain, sửa face model hoặc compose Frigate config.

## 4. Thứ tự thực hiện trong 5 ngày

Mỗi ngày có checkpoint 09:00, tích hợp 14:30 và merge cutoff 17:00. WIP tối đa một PR code chính và một PR test/fix cho mỗi người.

### Thứ Hai — Khóa contract và dựng nền dùng chung

**Mục tiêu ngày:** tất cả module có contract ổn định và có thể phát triển song song bằng fake adapter.

| Người | Việc phải hoàn thành trước 17:00                                                                         | PR/Artifact                                      |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A     | Navigation typed cho Camera/Zones/Known Faces/Settings; page shell; API client generated chạy được       | PR `feat/web-admin-shell`                        |
| B     | Chốt OpenAPI cho 8 plan; migration skeleton; RolesGuard, audit actor; interfaces event/rule/confirmation | PR `feat/contracts-week-scope` và PR nền backend |
| C     | Cameras/source/runtime contract; Frigate composer spike; môi trường webcam/video/MediaMTX                | PR `feat/camera-runtime-foundation`              |
| D     | Face request/response, model fixture, collection interface, `AiResult` envelope proposal                 | PR `feat/ai-face-foundation`                     |
| E     | Outbox/job schema và worker skeleton; fake Telegram; E2E matrix                                          | PR `feat/orchestrator-durable-jobs`              |

**Thứ tự merge:** B contract → A shell → B role/audit → E jobs → C/D foundations. Nếu contract chưa merge lúc 12:00, cả nhóm pair để giải quyết; không phát triển contract riêng trên từng nhánh.

### Thứ Ba — Hoàn thành data plane Camera, Zone và Face

**Mục tiêu ngày:** CRUD và runtime của Camera, Zone, Known Face chạy được độc lập.

| Người | Việc phải hoàn thành trước 17:00                                                                             | Acceptance trong ngày                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A     | Camera list/toggle/source form/preview/debug; Known Faces upload/select/delete UI; Zone editor bản đầy đủ    | Ba NavItem chạy với API thật hoặc adapter đã khóa                         |
| B     | Migration cuối cho known faces/zones/events/rules/jobs; rule CRUD/default/validation; event receipt skeleton | Fresh DB và upgrade DB cùng chạy                                          |
| C     | Camera API/source runner + shared Frigate apply; Zone CRUD/geometry/schedule/config sync                     | Bật video từ dashboard; polygon lưu 0–1 và xuất hiện trong Frigate config |
| D     | US-09 hoàn chỉnh: detect/embed/multi-face/collection/hard-delete/privacy                                     | API đăng ký/xóa người quen đạt test integration                           |
| E     | Outbox worker hoàn chỉnh; Telegram sender/message builder/retry bằng fake API                                | Retry timing và terminal failure test xanh                                |

**Thứ tự tích hợp:** migration B → backend C/D/E → UI A. Cuối ngày demo Camera, Zone và Known Face riêng lẻ.

### Thứ Tư — Hoàn thành processing và escalation core

**Mục tiêu ngày:** event đi từ person/zone result đến quyết định escalation và tạo notification intent.

| Người | Việc phải hoàn thành trước 17:00                                                                 | Acceptance trong ngày                                              |
| ----- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| A     | Settings US-15; event labels/results/priority/state UI; nối toàn bộ API thật                     | Validation client/server thống nhất; event hiển thị nhiều nhãn     |
| B     | US-11 aggregator/projection; US-13 evaluator/transitions/confirmation; US-15 cache/version/audit | Duplicate/concurrent result an toàn; rule mới có hiệu lực ≤60 giây |
| C     | US-12 dwell/schedule/event output; snapshot/crop service ổn định; Camera debug boundaries        | Đi ngang <2 giây không phát event; ngoài lịch không phát event     |
| D     | US-10 crop consumer/quality/cosine match/timeout; publish kết quả sang US-11                     | Đủ bốn kết quả KNOWN/UNKNOWN/UNDETERMINED/AI_FAILED                |
| E     | US-13 deadline/recovery worker; US-14 webhook/callback/edit message                              | Fake E2E: NOTIFIED → xác nhận hoặc timeout → ESCALATED             |

**Thứ tự tích hợp:** D/C producers → B US-11 → B US-13 → E deadline/Telegram → A event/settings UI.

### Thứ Năm — End-to-end thật và xử lý lỗi

**Mục tiêu ngày:** hoàn thành toàn bộ acceptance criteria trên môi trường tích hợp, không còn mock trong đường nghiệm thu.

| Người | Trách nhiệm chính                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------- |
| A     | Chạy UI E2E: Camera, Known Faces, Zone, Settings; sửa responsive/accessibility/loading/error/409               |
| B     | Chạy DB/API/state concurrency tests; sửa race ở US-11/13/15; kiểm tra audit và authorization P1/P3             |
| C     | Chạy webcam/video → MediaMTX → Frigate; restart/config rollback; camera+zone concurrency; hỗ trợ snapshot/crop |
| D     | Chạy ảnh/crop thật; threshold/quality/dark/small/back-facing; stale collection/delete race; timeout 5 giây     |
| E     | Điều phối E2E Camera → M1/M4 → Event → Escalation → Telegram; test retry, hai callback đồng thời và restart    |

**Merge cutoff:** không merge feature mới sau 15:00. Từ 15:00 chỉ nhận fix cho acceptance, dữ liệu, test và tài liệu vận hành.

### Thứ Sáu — Regression, UAT và phát hành increment

**Mục tiêu ngày:** main xanh, bằng chứng nghiệm thu đầy đủ và không còn lỗi P0/P1.

| Khung giờ   | Hoạt động                                                                 | Người chịu trách nhiệm                               |
| ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| 08:30–10:30 | Full regression, fresh DB, upgrade DB, `pnpm check:all`, container health | E điều phối; B/C sửa backend/runtime; A/D sửa web/AI |
| 10:30–12:00 | UAT theo 8 acceptance flows và privacy check                              | A làm PO; E ghi evidence; B/C/D hỗ trợ               |
| 13:00–15:00 | Sửa lỗi UAT; chạy lại test bị ảnh hưởng                                   | Owner module tương ứng                               |
| 15:00–16:00 | Final E2E và restart scenario; chốt OpenAPI/ERD/runbook                   | E chạy; B chốt API/DB; C chốt runbook                |
| 16:00–17:00 | Demo, review DoD, squash merge PR cuối, tag increment                     | A accept; B điều phối                                |

Nếu còn lỗi P0/P1 lúc 15:00, dừng mọi cải tiến giao diện và tập trung sửa lỗi. Lỗi P2 không ảnh hưởng acceptance phải được ghi issue có owner và ngày xử lý; không dùng lỗi P2 để che phần acceptance chưa hoàn thành.

## 5. Dependency và Definition of Ready

### DoR chung cho mọi task

Task chỉ được chuyển từ `Backlog` sang `In Progress` khi có đủ:

- Link đúng plan và acceptance criterion mà task thực hiện.
- Một owner, một reviewer và danh sách file/module dự kiến thay đổi.
- API/schema/event contract đã merge hoặc fixture đã tuân đúng contract đang chờ merge.
- Dependency đầu vào đã sẵn sàng; nếu dùng fake adapter phải có interface và ngày thay bằng adapter thật.
- Test cases gồm happy path, validation/error và ít nhất một case idempotency/restart/concurrency nếu task có side effect.
- Không còn quyết định sản phẩm mở. A quyết định phạm vi; B quyết định kiến trúc khi nhóm không thống nhất trong 30 phút.
- Task đủ nhỏ để mở PR trong cùng ngày hoặc chậm nhất sáng hôm sau.

### DoR riêng theo plan

| Plan/US | Ready khi                                                                           | Owner xác nhận |
| ------- | ----------------------------------------------------------------------------------- | -------------- |
| Camera  | Source/runtime schema và Frigate apply interface đã khóa                            | C              |
| US-09   | Face candidate/embedding/collection contract và privacy rule đã khóa                | D              |
| US-10   | US-09 collection read interface, crop interface và `AiResult` envelope có fixture   | D              |
| US-11   | Producer envelope, priority order và concurrency key đã khóa                        | B              |
| US-12   | Cameras API, preview dimensions và Frigate desired-state interface có sẵn           | C              |
| US-13   | Event candidate, rule snapshot, notification intent và transition table đã khóa     | B              |
| US-14   | Notification intent, confirmation command và Telegram test bot/fake server sẵn sàng | E              |
| US-15   | Rule schema/defaults, derived high wait và role P3 đã khóa                          | B              |

Thiếu DoR không có nghĩa là ngồi chờ: owner phải pair với người giữ dependency để hoàn thành điều kiện Ready trước checkpoint kế tiếp.

## 6. Definition of Done

### DoD chung

Mọi task và PR chỉ được đánh dấu `Done` khi:

- Acceptance criterion liên quan chạy qua API/UI thật; mock chỉ dùng ở unit test.
- OpenAPI, generated client/types, implementation và response thực tế khớp nhau.
- Migration chạy được trên DB mới và DB đang có dữ liệu; migration đã merge không bị sửa lại.
- Authorization đúng P1/P3, owner scope đúng và hành động quản trị có audit khi plan yêu cầu.
- Side effect có idempotency; retry/restart/concurrency được test khi liên quan.
- Không log token, credential, RTSP URL nhạy cảm, ảnh đăng ký hoặc embedding.
- UI có loading, empty, validation, server error và permission state; thao tác chính dùng được trên desktop và mobile.
- Unit/integration/E2E cần thiết xanh; `pnpm check:all` xanh; container bắt buộc healthy.
- PR theo template, đã rebase, có approve từ người khác, mọi comment được xử lý và squash merge.
- Có evidence trong PR: test output ngắn, ảnh/video UI khi liên quan và mapping tới acceptance criteria.

### DoD riêng theo plan/US

| Plan/US | Điều kiện Done bắt buộc                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera  | Xem active/inactive; bật/tắt webcam và video từ UI; restart giữ desired state; preview/debug person+zone boundaries hoạt động; không cần lệnh thủ công               |
| US-09   | Upload 1–5 ảnh; zero-face lỗi rõ; multi-face chọn được; danh sách cập nhật; hard-delete embedding và có audit; ảnh gốc/temp bị xóa                                   |
| US-10   | Crop đúng person; cosine best match; `KNOWN ≥0.6`; dưới ngưỡng thành `UNKNOWN`; ảnh kém thành `UNDETERMINED` không alert; timeout 5 giây thành `AI_FAILED`           |
| US-11   | Mọi AI result cập nhật metadata; nhiều kết quả được giữ trong JSONB; priority cao nhất thắng; duplicate/out-of-order không làm hỏng projection                       |
| US-12   | CRUD polygon trực quan; tọa độ 0–1; Frigate cập nhật; dwell <2 giây bị bỏ; lịch hoạt động được áp dụng; UI luôn hiển thị zone                                        |
| US-13   | Đủ transition; low confidence chỉ log; medium/high notify theo rule; hai confirmation idempotent; timeout escalation; restart khôi phục deadline theo `detected_at`  |
| US-14   | Tin nhắn có metadata, snapshot và hai nút; callback cập nhật qua US-13 và edit message; click lần hai không ghi đè; retry 2/4/8 và lưu `FAILED` nhưng clock tiếp tục |
| US-15   | Defaults đúng bảng; `T_low > T_high` không lưu; optimistic conflict rõ; rule mới dùng cho event mới trong ≤60 giây không restart; audit có before/after              |

### DoD của toàn bộ tuần

Tuần chỉ được công bố hoàn thành khi đồng thời thỏa mãn:

1. Tám dòng DoD riêng ở trên đều có evidence.
2. E2E chính chạy thành công ít nhất một lần trên main: Camera → Frigate → M1 hoặc M4 → US-11 → US-13 → Telegram → confirmation.
3. Các scenario bắt buộc đều xanh: AI timeout, Telegram fail 3 lần, callback đồng thời, restart khi `NOTIFIED`, xóa known face và cập nhật rule đa instance.
4. Không còn lỗi P0/P1; main deploy được và CI xanh.
5. OpenAPI, ERD, README/runbook và biến môi trường mẫu đã cập nhật.

## 7. Thứ tự PR và merge bắt buộc

1. **B:** contract OpenAPI và generated baseline.
2. **A:** shared navigation/page shell.
3. **B + E:** roles/audit, migration nền và durable jobs/outbox.
4. **C:** Camera API/source/runtime/Frigate composer.
5. **D:** US-09 face registration/collection.
6. **C:** US-12 zone CRUD/config/dwell/schedule.
7. **D:** US-10 crop/matching/result publisher.
8. **B:** US-11 aggregator/event projection.
9. **B:** US-15 rules và US-13 state core.
10. **E:** US-13 deadline recovery và US-14 Telegram.
11. **A:** các UI feature nối API thật, chia PR theo Camera, Face/Zone và Settings/Event.
12. **E:** E2E/regression fixes; từng owner sửa lỗi module của mình.

PR không cần chờ toàn bộ PR trước hoàn thành mới bắt đầu code; phải chờ contract liên quan merge trước khi merge consumer. Nhánh sống tối đa ba ngày, rebase hằng ngày, không gom cả tuần vào một PR.

## 8. Bảng bàn giao giữa các thành viên

| Người giao | Người nhận | Nội dung bàn giao                                            | Hạn chót                       |
| ---------- | ---------- | ------------------------------------------------------------ | ------------------------------ |
| B          | A/C/D/E    | OpenAPI, generated types, error model, role/audit interfaces | Thứ Hai 12:00                  |
| C          | A          | Camera/Zone endpoints, preview dimensions, debug metadata    | Thứ Ba 14:00                   |
| D          | A          | Known-face endpoints và multi-face candidate payload         | Thứ Ba 14:00                   |
| C          | D/E        | Crop/snapshot MediaService interface                         | Thứ Tư 10:00                   |
| C/D        | B          | M4/M1 `AiResult` producers và idempotency key                | Thứ Tư 12:00                   |
| B          | E          | Notification intent, deadline và confirmation command        | Thứ Tư 12:00                   |
| B          | A          | Rules/event/escalation endpoints cuối                        | Thứ Tư 14:00                   |
| A/B/C/D    | E          | Bản tích hợp đủ để chạy E2E thật                             | Thứ Năm 09:00                  |
| E          | Cả nhóm    | Báo cáo lỗi/evidence theo acceptance                         | Thứ Năm 14:30 và thứ Sáu 12:00 |

Trễ mốc bàn giao quá hai giờ phải báo ngay trong kênh nhóm, ghi rõ phần bị chặn và pair trực tiếp. B chịu trách nhiệm điều phối lại người trong cùng ngày; không đẩy âm thầm sang thứ Sáu.

## 9. Nhịp Agile trong tuần

- **09:00–09:15:** Daily Scrum: đã xong, sẽ làm, blocker; cập nhật board và xác nhận DoR.
- **11:30:** Contract/dependency check 10 phút giữa các cặp giao nhận.
- **14:30–15:00:** Integration window; merge contract/foundation, chạy smoke test trên main.
- **16:30–17:00:** Review/merge cutoff và cập nhật evidence/DoD.
- **Thứ Hai 09:00:** Sprint Planning tối đa 60 phút; task đã được giao sẵn theo tài liệu này.
- **Thứ Năm 15:00:** Scope freeze; chỉ sửa acceptance và lỗi.
- **Thứ Sáu 16:00:** Sprint Review/demo; ngay sau đó retrospective 30 phút.

Board chỉ dùng các trạng thái `Backlog → Ready → In Progress → In Review → Testing → Done`. WIP tối đa hai item/người; item thứ hai chỉ nên là review/fix/test để không phân tán.

## 10. Xử lý xung đột và rủi ro trong tuần ngắn

| Rủi ro                                    | Cách xử lý ngay                                                                      | Người quyết định    |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------- |
| OpenAPI/migration gây chặn nhiều người    | Pair với B tại checkpoint gần nhất; merge contract PR nhỏ trước consumer             | B, A cùng duyệt API |
| Sidebar/Dashboard conflict                | Chỉ A sửa shell; feature owner gửi component/API contract                            | A                   |
| Camera và Zone ghi đè Frigate config      | Tất cả đi qua composer/version/atomic apply của C                                    | C                   |
| B quá tải US-11/13/15                     | E sở hữu worker/deadline/Telegram; B chỉ giữ domain state và rules                   | B điều phối         |
| AI hoặc Telegram môi trường thật chưa sẵn | Fake được phép đến hết thứ Tư; thứ Năm phải dùng adapter thật cho nghiệm thu         | D hoặc E            |
| E2E lỗi sát hạn                           | Dừng cải tiến, lập war-room theo owner module; E giữ một test case tái hiện duy nhất | E điều phối         |
| Acceptance vượt khả năng 5 ngày           | A chỉ được cắt phần ngoài acceptance; không bỏ tiêu chí Given/When/Then đã nêu       | A                   |

Kế hoạch một tuần giả định môi trường phát triển, database, Frigate/MediaMTX, Telegram test bot và model face cơ bản đã có thể chạy. Nếu một dependency bên ngoài chưa tồn tại lúc Planning, owner phải tạo fake có cùng contract trong thứ Hai và hoàn tất adapter thật trước integration freeze thứ Năm.
