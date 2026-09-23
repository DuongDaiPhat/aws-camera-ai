# Kế hoạch 1 tuần — 5 người thực hiện theo Vertical Slice

> Mỗi người sở hữu một hoặc nhiều tính năng **từ đầu đến cuối**: contract, dữ liệu, backend/AI, giao diện khi có, tích hợp và kiểm thử. Không giao riêng frontend, backend hoặc QA cho một người khác.
>
> Mục tiêu: hoàn thành tám plan trong **5 ngày làm việc**, nghiệm thu lúc 17:00 thứ Sáu. Đây là lịch mục tiêu, không phải bằng chứng tính năng đã hoàn thành. Không đánh dấu Done khi còn acceptance chưa đạt.

## 1. Phạm vi, nguồn chuẩn và cách đọc

| Mã    | Plan cần thực thi                                                                | Owner E2E |
| ----- | -------------------------------------------------------------------------------- | --------- |
| CAM   | [Plan Giao diện Camera.md](<Plan Giao diện Camera.md>)                           | A         |
| US-09 | [US_09_FACE_REGISTER.md](US_09_FACE_REGISTER.md)                                 | D         |
| US-10 | [PLAN_US-10_PERSON_CROP_FACE_MATCH.md](PLAN_US-10_PERSON_CROP_FACE_MATCH.md)     | D         |
| US-11 | [PLAN_US-11_EVENT_AI_LABELS.md](PLAN_US-11_EVENT_AI_LABELS.md)                   | E         |
| US-12 | [PLAN_US_12_ZONE_CONFIGURATION.md](PLAN_US_12_ZONE_CONFIGURATION.md)             | C         |
| US-13 | [PLAN_US-13_ESCALATION_STATE_MACHINE.md](PLAN_US-13_ESCALATION_STATE_MACHINE.md) | B         |
| US-14 | [PLAN_US-14_TELEGRAM_ALERTS.md](PLAN_US-14_TELEGRAM_ALERTS.md)                   | E         |
| US-15 | [PLAN_US-15_ESCALATION_RULE_SETTINGS.md](PLAN_US-15_ESCALATION_RULE_SETTINGS.md) | B         |

A–E là ký hiệu thành viên hiện có của dự án; trong tuần này tất cả nhận trách nhiệm full-stack theo slice. Reviewer hỗ trợ kiểm tra, không nhận phần backend/UI còn thiếu của owner.

Thứ tự nguồn chuẩn:

1. Acceptance criteria của user story và yêu cầu được người dùng xác nhận.
2. OpenAPI và schema/code hiện tại đã kiểm tra, gồm [OpenAPI chính](../api/openapi.yaml), [OpenAPI AI](../api/openapi-ai-service.yaml).
3. Các quy tắc tích hợp và phạm vi triển khai tối thiểu trong tài liệu này.
4. Chi tiết tám plan, sau khi đối chiếu code thực tế.

Tài liệu này thay thế phân công theo tầng và các đề xuất hạ tầng dùng chung bắt buộc trong bản cũ. Các hành vi nghiệp vụ của từng plan vẫn phải thực hiện. Nếu plan đề xuất kiến trúc lớn hơn mức cần thiết, chọn phương án đơn giản tại mục 5 và ghi rõ trong PR. Nếu có mâu thuẫn nghiệp vụ thật sự, ghi decision có người xác nhận; không tự đổi yêu cầu để hoàn thành lịch.

Tuân thủ [CODING_CONVENTION.md](conventions/CODING_CONVENTION.md) và [GIT_WORKFLOW.md](conventions/GIT_WORKFLOW.md). “Hiện trạng” hoặc đường dẫn module trong plan là thông tin cần kiểm tra lại, không phải bằng chứng module còn thiếu.

## 2. Phân công cố định và đầu ra E2E

| Người | Slice sở hữu trọn vẹn                               | Phần phải tự làm                                                                                                       | Reviewer          |
| ----- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A** | **CAM — Quản lý camera và nguồn phát**              | Camera UI/API/DB, browser webcam, video runner, preview/debug, apply cấu hình Frigate, tests/runbook                   | C                 |
| **B** | **US-15 + US-13 — Cấu hình và xử lý phản ứng**      | Settings UI/API/DB, rule policy, event state, timer/recovery, dashboard confirmation/close, notification intent, tests | E                 |
| **C** | **US-12 — Quản lý và giám sát vùng**                | Zones UI/editor/API/DB, tích hợp config camera, schedule/dwell, M4 result, tests                                       | A                 |
| **D** | **US-09 + US-10 — Đăng ký và nhận diện người quen** | Known Faces UI/API/DB, face detector/embedder, matching/crop job, collection/delete/privacy, tests                     | E                 |
| **E** | **US-11 + US-14 — Kết quả AI và cảnh báo Telegram** | Result ingestion/aggregation/DB, event labels UI, Telegram sender/webhook/identity/retry, tests                        | B; D review score |

Mỗi owner tự sửa OpenAPI và migration của slice, tự nối NavItem và UI, tự viết bằng chứng E2E. A/B review API theo workflow, không trở thành người viết toàn bộ API cho nhóm. Không chuyển toàn bộ kiểm thử cho E.

### A — CAM: người dùng bật camera và quan sát được

**Thứ tự task:**

1. **A1:** Kiểm tra camera contract, MediaMTX/Frigate đang ghim; xác minh preview và config apply. Chốt interface camera/preview/config để C dùng, không xây lại dashboard.
2. **A2:** Hoàn thiện list/detail/settings/toggle API và persistence; tích hợp trang Camera vào Sidebar; active/inactive phải phân biệt với online/offline.
3. **A3:** Browser webcam → publish → MediaMTX → Frigate; upload video → runner có quản lý → MediaMTX → Frigate; RTSP theo plan. UI có lỗi quyền webcam, upload, khởi động/dừng source.
4. **A4:** Debug View với hai toggle person/zone độc lập; test lưu settings, bật/tắt, restart video runner và cập nhật camera không mất zone.

**DoR:** Có môi trường chạy camera, source fixture, đường apply config đã xác minh và danh sách settings hỗ trợ ở phiên bản đang dùng.

**DoD:** Người dùng cấu hình/bật/tắt nguồn qua dashboard không cần lệnh thủ công; preview và debug hoạt động; video source phục hồi đúng; cấu hình lỗi không phá cấu hình đang chạy. Webcam trình duyệt dừng khi đóng tab/mất quyền là giới hạn phải hiển thị, không hứa tự khôi phục camera sau khi tab đóng.

**Phạm vi:** Thực hiện cấu hình Frigate đã nêu trong plan Camera, kiểm tra schema thực tế. Không tự suy diễn “đầy đủ Frigate” thành xây trình biên tập mọi khóa YAML hay local webcam agent chạy nền.

### B — US-15 + US-13: cấu hình tới quyết định và xác nhận

**Thứ tự task:**

1. **B1 / US-15:** Rule repository/API/validation và Settings UI; dùng defaults hiện có; update có actor/audit/version theo plan; đọc rule DB cho lần đánh giá mới.
2. **B2 / US-13:** Policy thuần và transition transaction; lưu history, rule snapshot, deadline và notification intent cùng commit. Cung cấp evaluate/confirm/close interface cho E.
3. **B3 / US-13:** Worker quét deadline DB, khôi phục sau restart, xử lý timer đua với confirmation; B sở hữu toàn bộ timer, không bàn giao cho E.
4. **B4 / US-13:** Dashboard “Tôi ổn”/“Cần giúp đỡ”, kết quả xác nhận thật và đóng sự kiện khẩn cấp đúng phase; nối E Telegram; kiểm thử Settings → event mới → phản ứng → xác nhận/restart.

**DoR:** Có rule defaults/schema, bảng transition, đầu vào candidate từ E và interface notification/confirmation thống nhất.

**DoD:** Chỉnh rule có hiệu lực với event mới ≤60 giây; validation sai không lưu; event đang chờ giữ deadline; đủ transition và recovery; dashboard gọi backend thật. Deadline quá hạn sau restart được xử lý ngay, không cấp lại T_wait.

**Phạm vi:** B sở hữu state, confirmations và deadline xuyên mọi kênh. Không tự triển khai Amazon Connect/SNS trong US-13. Phải có emergency dispatch interface và trạng thái lỗi/chưa cấu hình rõ. Không coi mock là đã gọi liên hệ khẩn cấp; nếu nghiệm thu đòi cuộc gọi thật mà provider chưa có, ghi blocker, không tuyên bố đã hoàn thành ca đó.

### C — US-12: vẽ vùng tới phát hiện vi phạm

**Thứ tự task:**

1. **C1:** ZonesView tại NavItem “Khu vực”, camera selector, preview có tên/polygon của zone hiện có; API/DB CRUD với quyền ADMIN và validation.
2. **C2:** Polygon editor, tọa độ 0–1, tên tiếng Việt, loại/bật tắt/dwell/lịch; chỉnh sửa và xóa trực quan; dùng đường apply config của A.
3. **C3:** Kiểm chứng dwell trên Frigate đang ghim; schedule theo múi giờ camera; chỉ xuất M4 result đủ điều kiện sang E, không tự UPDATE event priority/state.
4. **C4:** E2E vẽ “Bếp” → lưu → Frigate nhận → person đủ dwell → event đúng zone; kiểm thử đi lướt, lịch, resize preview và camera update đồng thời.

**DoR:** A cung cấp camera/preview/config interface; có fixture MQTT đúng phiên bản và rule timezone/zone type.

**DoD:** Trang Khu vực luôn hiển thị zone; CRUD và chuẩn hóa đúng; mặc định dwell 2 giây; dưới 2 giây không có M4 alarm; lịch [06:00,22:00) đúng; zone tắt hoặc không RESTRICTED không cảnh báo.

**Phạm vi:** “Cấm trẻ em” kích hoạt bởi person theo story, không tự xây nhận diện tuổi. Không đếm thêm 2 giây nếu Frigate đã xác nhận dwell. Không tạo thêm Camera API/runner riêng.

### D — US-09 + US-10: đăng ký tới nhận diện thật

**Thứ tự task:**

1. **D1 / US-09:** Known Faces UI, upload 1–5 ảnh/tên; API detect/embed; chọn mặt khi nhiều mặt, lỗi zero-face; lưu embedding và hiển thị danh sách.
2. **D2 / US-09:** Hard-delete và audit; collection sync/invalidation; dọn ảnh trong RAM/temp, giải phóng preview; cùng preprocessing/model cho đăng ký và matching.
3. **D3 / US-10:** Crop đúng track/frame từ media hiện có; job M1 tối thiểu có dedup/recovery; cosine matching đúng owner/model, quality gate và timeout 5 giây.
4. **D4 / US-10:** Gửi result vào interface E; test đăng ký → person crop → event KNOWN/tên; người khác → UNKNOWN; quay lưng → UNDETERMINED; AI timeout → lỗi lưu/log.

**DoR:** AI model local chạy được, ảnh test được phép sử dụng, contract embed/match/collection/result và media adapter được kiểm tra.

**DoD:** Mọi nhánh upload/multi-face/delete đạt; ảnh gốc không lưu dài hạn; xóa embedding cả DB và collection/cache liên quan; stale result không gắn lại người đã xóa. Matching dùng T_known mặc định 0.6 trước rounding; crop kém không báo động M1; timeout 5 giây lưu lỗi.

**Phạm vi:** D sở hữu UI Người quen lẫn backend và AI; dùng một local model/provider hoạt động cho tuần này. Không triển khai thêm Rekognition hoặc huấn luyện model mới nếu chưa là dependency bắt buộc. Không tạo UI riêng cho US-10; kết quả người dùng xem ở EventDetail của E.

### E — US-11 + US-14: kết quả tới cảnh báo có thể xác nhận

**Thứ tự task:**

1. **E1 / US-11:** Chốt AiResult/candidate contract với C/D/B; nhận result có auth/validation/dedup; merge JSONB atomic, chọn label/score/version/time cùng nguồn.
2. **E2 / US-11:** EventDetail/read API và UI nhãn/confidence/chi tiết nhiều kết quả; bỏ đường MQTT ghi đè AI projection; handoff đủ candidate sang B có recovery.
3. **E3 / US-14:** Đọc notification intent của B; gửi snapshot/metadata/hai nút; lưu attempt/retry bằng notifications hiện có; mapping Telegram actor có xác minh.
4. **E4 / US-14:** Webhook → confirmation service B → cập nhật message; xử lý duplicate/unauthorized/edit lỗi; E2E result → event view → Telegram thật → xác nhận trên dashboard.

**DoR:** Envelope C/D, state/confirmation/intent B đã chốt; storage snapshot và bot test sẵn. Mapping dev xác minh được phép; không dùng username hoặc chat ID suy đoán làm quyền.

**DoD:** Giữ đủ M1/M4, score không bị trộn; priority cao nhất; callback đồng thời chỉ quyết định đầu hợp lệ thắng; snapshot đúng event; retry ban đầu + 3 lần; FAILED không dừng deadline. Không hứa exactly-once khi Telegram timeout sau khi đã nhận request.

**Phạm vi:** E sở hữu frontend nhãn AI và toàn bộ Telegram, không sở hữu QA toàn đội; không trực tiếp đổi events.status hoặc xây một state machine khác.

## 3. Các quyết định nghiệp vụ phải giữ nhất quán

| Điểm dễ suy diễn sai                   | Quy tắc và owner chịu trách nhiệm                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KNOWN/UNKNOWN và lỗi kỹ thuật          | D trả person_status KNOWN/UNKNOWN/UNDETERMINED. AI_FAILED là trạng thái xử lý sự kiện, không phải person_status thứ tư; E ghi result lỗi, B quyết định transition                                                                                 |
| Similarity và confidence               | T_known=0.6 là ngưỡng giống người quen, khác T_low/T_high. Theo đề xuất US-10/11: KNOWN confidence=similarity; UNKNOWN=1-similarity; UNDETERMINED=null. D/E phải ghi policy/version và kiểm thử, không gọi điểm này là xác suất đã hiệu chuẩn     |
| UNKNOWN không mặc nhiên gửi alert      | D chuyển UNKNOWN sang E/B; B vẫn áp dụng ngưỡng. Ví dụ similarity=0.59 → UNKNOWN confidence=0.41 → có thể LOGGED_ONLY. PO phải biết kết quả này trước code; không tự bypass T_low để làm demo                                                     |
| KNOWN hoặc M1 không rõ/lỗi + M4 hợp lệ | Không triệt tiêu M4. Event đã NOTIFIED/ESCALATED không bị lỗi M1 reset về AI_FAILED                                                                                                                                                               |
| Nhiều kết quả                          | E giữ chi tiết; priority P0 cao hơn P1/P2/P3; score đại diện thuộc đúng label. B đánh giá từng candidate, không chỉ candidate đại diện                                                                                                            |
| Zone                                   | C dùng lịch timezone camera [from,to), hỗ trợ qua nửa đêm; dwell mặc định 2 giây. Zone alarm bị chặn không có nghĩa xóa event person hoặc chặn UNKNOWN độc lập                                                                                    |
| Ngưỡng                                 | B: confidence < T_low chỉ log; tại T_low notify; tại T_high dùng high branch. T_low=T_high hợp lệ; score cần thiết bị null không tự chuyển thành 0                                                                                                |
| High wait                              | Giữ quyết định thiết kế trong US-13/15: max(1, ceil(T_wait/2)); FIRE/WELLNESS theo ngoại lệ đã có. Đây là lựa chọn của plan, không phải câu chữ nguyên gốc user story; B phải kiểm tra contract và ghi rõ quyết định, không thêm tHighWaitSeconds |
| Rule thay đổi                          | Dùng DB cho event mới; lưu rule/deadline của event đang chờ. Sửa Settings không reset timer; bằng chứng nguy cơ mới xử lý theo US-13                                                                                                              |
| Deadline                               | B tính từ detected_at + effectiveWait và lưu ngay; restart không tính lại từ now                                                                                                                                                                  |
| Xác nhận                               | NOTIFIED + IM_OK → RESOLVED; NEED_HELP hoặc hết hạn → ESCALATED; CLOSED cần emergency acknowledgement riêng. Telegram chỉ gọi service B                                                                                                           |
| Telegram retry                         | Ban đầu + 3 retry sau 2/4/8 giây = 4 attempts; lỗi transient hết attempts → FAILED, timer vẫn chạy. Không có deadline mới vì gửi chậm                                                                                                             |

Default US-15 bắt buộc:

| event_type          | Priority | T_low | T_high | T_wait (giây) |
| ------------------- | -------- | ----- | ------ | ------------- |
| FIRE_SMOKE_DETECTED | P0       | 0.50  | 0.70   | 30            |
| FALL_DETECTED       | P1       | 0.55  | 0.75   | 60            |
| RESTRICTED_ZONE     | P1       | 0.60  | 0.80   | 60            |
| UNKNOWN_PERSON      | P2       | 0.60  | 0.80   | 120           |
| WELLNESS_TIMEOUT    | P2       | null  | null   | 300           |

FIRE có skipLoggedOnly theo seed/plan; WELLNESS không có score. PERSON_DETECTED vẫn là rule hệ thống không cảnh báo. Có settings cho FIRE/FALL/WELLNESS không có nghĩa phải xây thêm detector/scheduler của các US khác trong tuần này.

## 4. Ranh giới tích hợp và tránh sửa trùng

Vertical slice là quyền sở hữu đầu ra nghiệp vụ, không có nghĩa mỗi người được tạo bản sao của mọi dependency.

| Đường giao nhau       | Producer/owner | Consumer                | Implementation/mock phải bàn giao trước 12:00 ngày 1                                                                     |
| --------------------- | -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Camera/preview/config | A              | C; D dùng media hiện có | Camera ID/scope, kích thước ảnh, trạng thái nguồn, cách apply toàn config không mất zones                                |
| Face result           | D              | E                       | Event/result/observation ID, module, label/score, model/time, error và scope đã xác thực                                 |
| Zone result           | C              | E                       | Event/zone ID, tên snapshot, bằng chứng dwell/schedule, config version, confidence theo policy đã chốt; không tự bịa 1.0 |
| Candidate set         | E              | B                       | Đủ kết quả hợp lệ và version; lỗi/UNDETERMINED tách rõ                                                                   |
| Rule và state         | B              | E                       | evaluate/confirm semantics, ACKNOWLEDGED để close, canonical response, rule snapshot, deadline                           |
| Notification intent   | B              | E                       | Event/recipient/channel/transition ID và unique key; persist cùng state transaction                                      |

### 4.1. Nguồn chuẩn của sáu contract

Contract có nguồn chuẩn bằng spec/type; Markdown chỉ giữ nghiệp vụ, ownership và lịch thực thi.

| Contract                | Nguồn chuẩn                                                                                                                                                                   | Owner |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Camera/preview/config   | [OpenAPI](../api/openapi.yaml): Camera, CameraPreview, CameraSourceSettings; [internal ports](../apps/orchestrator/src/contracts/vertical-slice.ports.ts): CameraConfigPortV1 | A     |
| Face result             | [AI OpenAPI](../api/openapi-ai-service.yaml): embed/match/collection; [Orchestrator OpenAPI](../api/openapi.yaml): FaceResultSubmission                                       | D/E   |
| Zone result             | [OpenAPI](../api/openapi.yaml): ZoneResultSubmission                                                                                                                          | C/E   |
| Candidate set           | [Internal ports](../apps/orchestrator/src/contracts/vertical-slice.ports.ts): EvaluateEventCommandV1                                                                          | E/B   |
| Rule/state/confirmation | [OpenAPI](../api/openapi.yaml): rules/confirm; [internal ports](../apps/orchestrator/src/contracts/vertical-slice.ports.ts): EscalationPortV1                                 | B     |
| Notification intent     | [Internal ports](../apps/orchestrator/src/contracts/vertical-slice.ports.ts): NotificationIntentV1                                                                            | B/E   |

HTTP types được sinh trong packages/contracts. Internal ports tham chiếu generated types cho enum/DTO dùng chung; không tạo HTTP endpoint cho lời gọi cùng process. Mock lấy type từ code/spec, không chép interface từ tài liệu.

### 4.2. Nghiệp vụ phối hợp

- Camera/Zone apply từ desired state trong DB và giữ toàn bộ cấu hình. Lưu DB thành công chưa có nghĩa Frigate đã áp dụng; UI phải thể hiện lỗi đồng bộ.
- Crop phải đúng track/frame. M1 không rõ khác lỗi kỹ thuật; xóa người quen phải chặn kết quả stale gắn lại người đã xóa.
- M4 chỉ submit khi đúng loại vùng, lịch, enabled và đủ dwell. Confidence lấy từ person observation tương ứng; thiếu score phải ghi diagnostic.
- E chuyển mọi candidate hợp lệ cho B. B đọc rule và lưu state/history/deadline/notification cùng transaction; network chạy ngoài transaction.
- Xác nhận đầu tiên thắng ở phase NOTIFIED; ACKNOWLEDGED đóng ESCALATED là phase riêng. Actor được xác minh và thời gian xác nhận do server cấp.
- Telegram lỗi hoặc edit thất bại không reset deadline, rollback confirmation hoặc gửi lại alert để thay cho edit.
- US-15 dùng PATCH thresholds có version; giữ PUT hiện có để không phá contract full-resource. Priority/channels/flags không bị Settings ghi đè.
- Mock cần có success, no-face, timeout, stale/replay/conflict, thiếu ảnh và callback đồng thời. Định dạng lấy từ spec/ports.
- Đây là baseline contract; endpoint/service/migration vẫn cần owner triển khai. Không coi việc sinh types là tính năng đã chạy.

- Hợp đồng là interface/DTO/payload đã xác minh, không bắt buộc mở HTTP API nội bộ mới nếu gọi service trong cùng process đủ.
- Owner tự sửa phần OpenAPI của mình trong PR nhỏ; A/B review, merge lần lượt để không ghi đè generated files.
- Migration: owner tự viết, B điều phối số thứ tự. Không sửa migration đã merge hoặc tạo lại bảng đang có.
- Sidebar/Dashboard: A tạo điểm render tối thiểu trong A1; B/C/D tự nối màn hình của mình bằng diff nhỏ, E sửa event components. Merge lần lượt, không tái cấu trúc navigation hoặc làm registry framework.
- Role/audit: kiểm tra helper hiện có; B bổ sung helper tối thiểu trong B1 nếu thiếu. Từng owner tự tích hợp quyền/audit vào slice, không chờ một sprint “platform”.
- MQTT/media: A quản lý camera runtime; C sửa phân loại zone; D bổ sung crop/M1; E sửa projection. Nêu file/function giao nhau trong PR và merge tuần tự, không thay cả module.
- Caller không sửa DB nội bộ của slice khác. Khi dependency sai, owner dependency sửa cùng ngày; người gọi cung cấp test tái hiện.

## 5. Thiết kế tối thiểu đủ nghiệp vụ

| Hạng mục               | Phương án tuần này                                                                                                   | Chỉ mở rộng khi có bằng chứng                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Rule refresh           | B đọc PostgreSQL mỗi lần đánh giá event mới; tận dụng bảng/defaults hiện có                                          | Cache phân tán, pub/sub invalidation khi profiling chứng minh cần                              |
| Deadline               | B lưu deadline DB và worker quét; transition có lock/conditional update                                              | Scheduler service riêng khi mô hình triển khai thực sự cần                                     |
| Telegram retry         | E dùng notifications, attempt_count, next_retry_at và claim an toàn                                                  | Queue/broker mới nếu hạ tầng sẵn có không đáp ứng                                              |
| AI jobs/results        | D/E tái sử dụng durable work hiện có; nếu thiếu thêm bảng/receipt nhỏ đúng nhu cầu dedup, ACK sau commit và recovery | Không bắt buộc generic job framework, plugin worker, DLQ dashboard                             |
| Handoff event → engine | E/B dùng transaction và pending work/receipt tối thiểu có replay                                                     | Không gọi fire-and-forget rồi đánh dấu Done; không xây event bus toàn hệ thống                 |
| Config Frigate         | A/C dùng một đường compose/validate/apply, xử lý ghi đồng thời và lỗi                                                | Không thêm config control plane/microservice riêng                                             |
| Face                   | D dùng chung một detector/embedder và collection theo scope/model                                                    | Không thêm provider mới, vector DB, tìm kiếm ANN hoặc training pipeline cho danh sách gia đình |
| UI                     | Mỗi owner dùng component, CSS Modules và tokens hiện tại                                                             | Không đổi design system, tạo page builder hoặc làm lại dashboard                               |
| Audit/version          | Giữ audit, optimistic update và guard cần cho hành vi đã chọn                                                        | Không xây event sourcing hoặc hệ thống permission mới                                          |
| Defaults               | Tái sử dụng seed, kiểm tra row bắt buộc khi startup                                                                  | Không xây default catalog/self-healing framework chỉ để xử lý DB bị sửa thủ công               |

Đơn giản hóa không được bỏ hard-delete, bảo vệ ảnh, xác thực callback, dedup, persist deadline, recovery hoặc giới hạn timeout. Test nhiều worker chỉ khi thực thi có nhiều worker/instance; vẫn phải bảo đảm hai request đồng thời không làm sai dữ liệu.

## 6. Lịch thực thi một tuần

Giả định đầu vào: nền đăng nhập/event/media/DB đã hoạt động; có máy chạy Frigate, model và bot test. Kiểm tra ngay sáng ngày 1. Thiếu dependency thật phải ghi blocker/owner/mốc xử lý; fixture giúp code song song nhưng không thay bằng chứng nghiệm thu.

| Ngày            | A — Camera                                       | B — Rules/State                                              | C — Zone                                   | D — Face                                   | E — Labels/Telegram                                  | Gate cuối ngày                                                |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| **1 / Thứ Hai** | A1, camera list API → UI tối thiểu, config spike | B1 rule API → Settings tối thiểu; state implementation       | C1 camera fixture → zone editor → CRUD DB  | D1 một ảnh → embedding → danh sách UI      | E1 result fixture → DB → EventDetail UI; bot smoke   | Mock/implementation khớp sáu contract; demo một lát dọc mỏng  |
| **2 / Thứ Ba**  | A2–A3 source form → webcam/video thật → preview  | Hoàn tất B1; B2 candidate → state/history/intent; confirm UI | C2 editor → config Frigate thật → schedule | D1–D2 đủ 1–5/multi-face/delete; bắt đầu D3 | E2 aggregator đủ nhiều nhãn; E3 gửi ảnh/hai nút thật | CAM/Zone/Face CRUD nối thật; rule và result persistence merge |
| **3 / Thứ Tư**  | A4 debug/restart; sửa tích hợp zone              | B3–B4 deadline/recovery/confirmation/close                   | C3–C4 M4 đủ dwell/lịch → E/B               | D3–D4 match/quality/timeout → E/B          | E3–E4 webhook/identity/retry → B; cập nhật UI        | Đủ luồng Camera → M1/M4 → event → engine → Telegram           |
| **4 / Thứ Năm** | Test CAM + phối hợp C config race                | Test US-13/15 restart/race/60 giây                           | Test US-12 lịch/dwell/geometry             | Test US-09/10 privacy/threshold/timeout    | Test US-11/14 multi-result/callback/retry            | 15:00 chốt feature; sau đó sửa lỗi acceptance                 |
| **5 / Thứ Sáu** | Regression/demo CAM                              | Regression/demo rule + state                                 | Regression/demo zone                       | Regression/demo đăng ký + matching         | Regression/demo labels + Telegram                    | 15:00 chạy lại E2E; 17:00 nghiệm thu trên main                |

Để cân bằng tải, B/D/E làm US đầu tiên tới mức chạy được rồi nối US thứ hai, không mở hai implementation rời rạc. A/C ưu tiên xác minh Frigate ngay ngày 1 vì đó là dependency rủi ro. Mỗi người có khoảng ngày 4–5 để sửa lỗi, không dành cả tuần chỉ code rồi chuyển QA cho người khác.

### Thứ tự tích hợp, không biến thành hàng đợi tuần tự

1. Sáu contract tại mục 4 là baseline đã chốt. Sáng ngày 1, owner map chúng vào file/schema hiện có và chỉ nêu OpenAPI/migration delta cần triển khai; không thiết kế lại semantics trên từng nhánh.
2. Merge các OpenAPI delta nhỏ và render hook; A/B review API theo workflow. Mỗi slice bắt đầu ngay bằng fixture đúng contract canonical.
3. Các slice CRUD **A Camera, B Rules, C Zone, D Register, E Result** chạy song song.
4. C nối camera/config A; D Match nối Register của chính D; E nối producers C/D; B nối aggregator E.
5. E Telegram nối intent/confirmation B. Không cần đợi toàn bộ Camera UI hoàn tất mới làm Telegram.
6. Ngày 3 tích hợp hai đường thật: UNKNOWN_PERSON và RESTRICTED_ZONE; ngày 4 thử lỗi; ngày 5 nghiệm thu.

PR tách theo hành vi có thể kiểm tra, ví dụ “US-09 đăng ký một mặt E2E”, sau đó “US-09 chọn mặt và hard-delete”. Contract PR là ngoại lệ kỹ thuật nhỏ; không chia công việc thành PR frontend của A chờ PR backend của B.

## 7. DoR, DoD và bằng chứng chống suy diễn

### DoR chung cho từng task A1–E4

- Đọc plan liên quan, AGENTS.md nếu có, working tree, code và OpenAPI thực tế.
- Ghi vào issue/PR: acceptance nào được thực hiện, owner/reviewer, file thật sẽ sửa, dependency và fixture.
- Phân biệt rõ **đã có trong code**, **đề xuất triển khai**, **chưa xác minh**; không tạo file/table chỉ vì plan có tên ví dụ.
- Contract liên quan đã chốt: enum, nullability, đơn vị giây, identity, scope, error và idempotency. Mọi giá trị chưa rõ phải có decision trước khi code phụ thuộc.
- Có ca kiểm thử thành công và lỗi nghiệp vụ tương ứng; có môi trường/fixture chạy được.
- Đủ nhỏ để review trong ngày hoặc sáng hôm sau.

### DoD chung cho mỗi vertical slice

- Owner tự demo đầu vào người dùng/Frigate đến kết quả quan sát được bằng API/UI/Telegram thật; không bàn giao “backend xong, UI người khác làm”.
- Đủ acceptance của plan, kể cả lỗi, quyền truy cập và giới hạn đã nêu; không dùng mock để tuyên bố tích hợp external đã xong.
- API, generated types, DB và UI thống nhất; migration mới chỉ khi cần, chạy được fresh/upgrade DB.
- Test đúng rủi ro: state/race/restart với DB thật; model/Frigate/Telegram có smoke test thật; fixture dùng cho lỗi và unit/integration có kiểm soát.
- Không mất dữ liệu vì retry/concurrency; không log ảnh/embedding/token; không giữ ảnh đăng ký dài hạn.
- UI dùng cấu trúc/style hiện tại và thể hiện loading/error/empty; không thông báo thành công trước backend.
- Chạy checks theo convention/workflow, gồm pnpm check:all khi tích hợp; ghi rõ check nào chưa chạy và vì sao. Chỉ có evidence xanh mới tính Done.
- PR được người khác review/merge, không tự merge; branch ngắn ≤3 ngày; commit theo workflow.
- Evidence gồm commit SHA, môi trường, input, expected/actual, test output hoặc ảnh/video đã làm sạch; đánh dấu từng Given/When/Then.

### Ma trận nghiệm thu bắt buộc cuối tuần

| Plan  | Owner demo | Bằng chứng cần có                                                                                                                 |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CAM   | A          | Active/inactive; RTSP/webcam/video theo plan; bật/tắt; preview; hai debug toggle; camera update giữ zone                          |
| US-09 | D          | 1–5 ảnh; zero-face không record; multi-face chọn đúng; hard-delete cả collection và audit; không giữ ảnh                          |
| US-10 | D          | Similarity 0.5999/0.6; đúng owner/model; quality kém → UNDETERMINED; timeout 5 giây → lỗi lưu/log; collection rỗng khác chưa sync |
| US-11 | E          | M1 và M4 đồng thời không mất nhãn; priority/score cùng nguồn; MQTT không ghi đè; replay/stale không mở lại terminal event         |
| US-12 | C          | Vẽ “Bếp” 0–1 và Frigate nhận; dwell dưới/đủ 2 giây; 06:00/22:00; zone tắt; resize không lệch                                      |
| US-13 | B          | Low/mid/high; IM_OK; NEED_HELP; timeout; restart giữ deadline; emergency ACK → CLOSED đúng điều kiện, không giả gọi khẩn cấp      |
| US-14 | E          | Tin thật có ảnh/metadata/nút; hai actor click; retry 2/4/8 (4 attempts); FAILED vẫn escalation; callback sai quyền bị chặn        |
| US-15 | B          | Bảng defaults đúng; T_low>T_high không lưu; sửa từ Settings → event mới dùng rule ≤60 giây; event đang chờ không reset            |

UAT tổng hợp do A điều phối với vai trò PO, nhưng mỗi owner chạy và sửa slice của mình. Cả UNKNOWN và M4 phải đi qua engine, Telegram và confirmation. Không chấp nhận chỉ chạy một nhánh rồi kết luận mọi US đã đạt.

## 8. Nhịp Agile và xử lý trễ

- Ngày 1, 09:00–10:00: Planning, kiểm tra dependency và map sáu contract vào code; tới 12:00 phải có mock/port compile được. Chỉ mở decision mới khi code thực tế chứng minh contract không khả thi.
- Ngày 2–5, 09:00–09:15: Daily, mỗi người báo slice đã chạy được, blocker và mục tiêu trong ngày.
- Hằng ngày 14:30: review/merge và smoke trên main; 16:30: demo tiến độ theo acceptance.
- Board: Backlog → Ready → In Progress → Review → Testing → Done. Mỗi người tối đa một task implementation đang làm và một task review/fix.
- Blocker quá hai giờ: báo B điều phối pair với owner dependency. Pair không đổi owner E2E hoặc biến thành phân công theo tầng.
- Thứ Năm 15:00: ngừng mở rộng tính năng; tập trung lỗi acceptance. Thứ Sáu 15:00: regression cuối; 16:00 review/demo; 17:00 chốt kết quả và retrospective.
- Nếu quá tải, bỏ refactor/hạ tầng/provider ngoài scope trước. Không bỏ timeout, retry, lịch, privacy hoặc recovery để “kịp tuần”.
- Nếu acceptance còn lỗi hoặc external adapter bắt buộc chưa có, ghi rõ US chưa Done và blocker. Deadline một tuần là mục tiêu triển khai; không được dùng nó để báo cáo hoàn thành sai thực tế.
