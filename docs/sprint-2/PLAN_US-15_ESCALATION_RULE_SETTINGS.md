# Plan US-15 — Cấu hình ngưỡng confidence và thời gian chờ theo loại sự kiện

> Trạng thái: kế hoạch thực thi, chưa phải tính năng đã triển khai.
> Mục tiêu: ADMIN chỉnh T_low, T_high và T_wait trên trang Cài đặt; rule mới áp dụng cho sự kiện mới trong tối đa 60 giây, không restart service.

## 1. Phạm vi và phụ thuộc

- Xây API đọc/cập nhật escalation_rules, validation ba lớp, audit, giao diện Cài đặt và cơ chế refresh runtime.
- [US-11](PLAN_US-11_EVENT_AI_LABELS.md) cung cấp nhãn/confidence đúng module; [US-13](PLAN_US-13_ESCALATION_STATE_MACHINE.md) là consumer duy nhất quyết định trạng thái và deadline.
- US-15 không trực tiếp gửi Telegram, cập nhật event status hoặc sửa deadline của event đang chờ.
- Bảng `escalation_rules` và dữ liệu mặc định đã có trong [0001_init.sql](../db/migrations/0001_init.sql) và [0002_seed_escalation_rules.sql](../db/migrations/0002_seed_escalation_rules.sql); không tạo bảng/seed thứ hai và không sửa migration đã chạy.
- Contract hiện có: `GET /escalation-rules`, `PATCH /escalation-rules/{eventType}`, EscalationRule và UpdateEscalationThresholdsRequest trong [api/openapi.yaml](../api/openapi.yaml).
- Tuân thủ [CODING_CONVENTION.md](conventions/CODING_CONVENTION.md) và [GIT_WORKFLOW.md](conventions/GIT_WORKFLOW.md). Trước khi làm, đọc AGENTS.md nếu có và kiểm tra working tree để giữ thay đổi ngoài phạm vi.

## 2. Bảng mặc định chuẩn

| event_type          | Priority | T_low | T_high |   T_wait |
| ------------------- | -------- | ----: | -----: | -------: |
| FIRE_SMOKE_DETECTED | P0       |  0.50 |   0.70 |  30 giây |
| FALL_DETECTED       | P1       |  0.55 |   0.75 |  60 giây |
| RESTRICTED_ZONE     | P1       |  0.60 |   0.80 |  60 giây |
| UNKNOWN_PERSON      | P2       |  0.60 |   0.80 | 120 giây |
| WELLNESS_TIMEOUT    | P2       |     — |      — | 300 giây |

`PERSON_DETECTED` vẫn là rule hệ thống P3, không có thresholds, channels rỗng và không xuất hiện như một loại cảnh báo có thể chỉnh trong form chính.

Migration 0002 là nguồn mặc định khi cài mới. “Hệ thống chưa được cấu hình” nghĩa là chưa có thay đổi bởi ADMIN sau khi migrations hoàn tất; engine phải đọc các row mặc định này ngay ở sự kiện đầu tiên. Không hard-code một bảng mặc định khác trong controller/service vì sẽ tạo hai nguồn sự thật.

Nếu một row bắt buộc bị thiếu sau migrations, health check báo DEGRADED và startup initializer idempotent có thể khôi phục đúng row từ một default catalog dùng chung với migration tooling. Engine không âm thầm dùng giá trị tùy ý. Việc khôi phục phải ghi audit/system log. Cần tránh copy-paste catalog trong nhiều module; nếu thêm initializer, chuyển default catalog thành một artifact duy nhất mà migration tooling và test cùng kiểm chứng.

## 3. Ý nghĩa T_low, T_high và T_wait

Policy phải thống nhất với US-13:

| Confidence của candidate hợp lệ | Phản ứng                                                  |
| ------------------------------- | --------------------------------------------------------- |
| `< T_low`                       | LOGGED_ONLY                                               |
| `T_low <= confidence < T_high`  | NOTIFIED, deadline `detected_at + T_wait`                 |
| `>= T_high`                     | NOTIFIED, deadline `detected_at + max(1, ceil(T_wait/2))` |

- Công thức chờ ngắn là computed policy, không phải field thứ tư ADMIN phải cấu hình. API response có thể trả `effectiveHighWaitSeconds` read-only và UI phải giải thích giá trị này.
- FIRE có `skipLoggedOnly=true`: phát hiện cháy hợp lệ vào NOTIFIED bất kể confidence nhưng vẫn dùng T_wait của rule. Không biến lỗi model thành phát hiện hợp lệ.
- WELLNESS_TIMEOUT không có confidence nên T_low/T_high luôn null và input threshold bị khóa; scheduler result hợp lệ dùng T_wait.
- T_wait là thời gian từ `detected_at`, theo quyết định trong US-13. Khi ADMIN đổi rule, chỉ lần đánh giá mới dùng version mới; event đang NOTIFIED giữ rule snapshot/deadline cũ.
- Priority, channels, skipLoggedOnly và maxEscalationLevel có sẵn trong schema nhưng không thuộc acceptance criteria UI của US-15. Trang này hiển thị priority read-only; không tự mở form sửa channels nếu chưa có story tương ứng.

## 4. Validation

### Quy tắc chung

- T_low/T_high là số hữu hạn trong [0,1], cho phép tối đa 3 chữ số thập phân vì DB là NUMERIC(4,3).
- Với FIRE/FALL/RESTRICTED_ZONE/UNKNOWN_PERSON: cả hai threshold bắt buộc, `T_low <= T_high`.
- Cho phép `T_low == T_high`; nhánh “giữa hai ngưỡng” rỗng và confidence tại giá trị đó vào high-confidence branch. UI nên cảnh báo nhưng không từ chối vì DB/OpenAPI hiện cho phép.
- WELLNESS_TIMEOUT: cả hai phải null; không chấp nhận chỉ một field null.
- T_wait là integer giây. Với năm rule có cảnh báo: 1–3600. `PERSON_DETECTED` nội bộ có thể giữ 0 nhưng không sửa qua form này.
- eventType path phải thuộc tập rule được quản lý; unknown/unsupported trả 404 hoặc 400 theo contract đã chốt.
- Backend bỏ qua field lạ bằng whitelist+forbidNonWhitelisted hiện có; không nhận owner/user ID từ request.
- Dùng DB constraint hiện có làm lớp cuối; migration mới chỉ bổ sung constraint cặp-null và timeout nếu schema còn thiếu, không sửa 0001.

### Thông báo lỗi

| Code                     | Trường hợp                               | Message UI                                         |
| ------------------------ | ---------------------------------------- | -------------------------------------------------- |
| INVALID_THRESHOLD        | T_low > T_high hoặc ngoài 0–1            | “Ngưỡng thấp phải nhỏ hơn hoặc bằng ngưỡng cao.”   |
| THRESHOLD_REQUIRED       | Rule có confidence nhưng thiếu threshold | “Vui lòng nhập đủ hai ngưỡng.”                     |
| THRESHOLD_NOT_APPLICABLE | Gửi threshold cho WELLNESS               | “Loại sự kiện này không sử dụng confidence.”       |
| INVALID_WAIT_SECONDS     | Không phải integer hoặc ngoài giới hạn   | “Thời gian chờ phải từ 1 đến 3600 giây.”           |
| RULE_VERSION_CONFLICT    | Người khác đã sửa rule                   | “Cấu hình đã thay đổi. Hãy tải lại trước khi lưu.” |
| RULE_NOT_FOUND           | Rule không tồn tại                       | “Không tìm thấy cấu hình cho loại sự kiện.”        |

Validation frontend giúp phản hồi nhanh; backend và DB mới là nguồn quyết định. Request sai không thay đổi row, version, cache hoặc audit success.

## 5. Contract-first

Giữ các endpoint hiện có:

```text
GET /escalation-rules
PATCH /escalation-rules/{eventType}
```

### GET

- Yêu cầu đăng nhập; ADMIN dùng để chỉnh, các role khác chỉ được đọc nếu chính sách dashboard cho phép.
- Trả danh sách sắp xếp ổn định theo priority rồi eventType.
- Mỗi item gồm: eventType, displayName tiếng Việt, priority, tLow, tHigh, tWaitSeconds, effectiveHighWaitSeconds, skipLoggedOnly, isEnabled, version, updatedAt, updatedByName nullable.
- Không trả raw database metadata hoặc kênh bí mật.
- Không cache HTTP quá 60 giây; sau PATCH thành công client revalidate ngay.

### PATCH thresholds

- Chỉ ADMIN; backend dùng actor từ JWT và ghi updated_by_user_id.
- Settings dùng PATCH cùng đường dẫn theo UpdateEscalationThresholdsRequest trong OpenAPI. Giữ PUT hiện có cho full-resource compatibility; không thu hẹp request PUT và không gửi channels/flags từ form thresholds.
- Response trả canonical rule và version mới. `400` validation, `401`, `403`, `404`, `409` version conflict.
- Chạy `pnpm api:lint`, `pnpm contracts:generate`; frontend import @cam/contracts, không viết tay API type.

## 6. Database, version và audit

Migration mới nếu chưa có:

- `version INTEGER NOT NULL DEFAULT 1`, constraint version>0.
- Constraint `(t_low IS NULL) = (t_high IS NULL)`.
- Constraint `t_wait_seconds BETWEEN 0 AND 3600`; service chặn 0 cho các rule cảnh báo.
- Không tạo thêm cột high wait; giá trị được tính từ T_wait.

Update atomic:

```text
BEGIN
  UPDATE escalation_rules
  SET t_low=?, t_high=?, t_wait_seconds=?, updated_by_user_id=?, version=version+1
  WHERE event_type=? AND version=?
  RETURNING ...
  nếu 0 rows: phân biệt NOT_FOUND và VERSION_CONFLICT
  INSERT audit_logs action=ESCALATION_RULE_UPDATED
COMMIT
```

Audit metadata chỉ gồm before/after của các field cấu hình, eventType, version và correlationId; không chứa token. Audit failure không được bị nuốt. Repository dùng SQL tham số hóa và map snake_case/camelCase.

## 7. Hiệu lực trong 60 giây không restart

Phương án ưu tiên: US-13 đọc rule từ PostgreSQL ở mỗi lần đánh giá event. Số event types nhỏ, truy vấn theo unique event_type rẻ và thay đổi có hiệu lực ngay sau commit, đáp ứng 60 giây mà không có invalidation phân tán.

Nếu profiling chứng minh cần cache:

- Cache TTL tối đa 30 giây, key theo eventType/version.
- PATCH evict cache local sau commit; instance khác tự refresh trong TTL.
- Cache miss đọc DB; không dùng stale value vô hạn khi refresh lỗi. Giữ last-known-good tối đa theo policy và log/metric; health DEGRADED nếu vượt 60 giây.
- Không dùng setTimeout duy nhất để reload. Poll/cache phải phục hồi sau restart và dùng DB làm nguồn chuẩn.
- Integration test chạy ít nhất hai Orchestrator instances hoặc hai cache instances để chứng minh node không nhận PATCH vẫn thấy rule mới <=60 giây.

Rule snapshot phải được US-13 lưu lúc đánh giá, gồm version, thresholds, wait và computed effective wait. Thay đổi sau đó không kéo dài/rút deadline event đang NOTIFIED.

## 8. Backend

```text
apps/orchestrator/src/escalation-rules/
  escalation-rules.module.ts
  escalation-rules.controller.ts
  escalation-rules.service.ts
  escalation-rules.repository.ts
  escalation-rule-policy.ts
  escalation-rule-defaults.ts        # chỉ khi dùng catalog chung
  dto/
```

- Có thể đặt repository/policy trong module escalation của US-13; không tạo hai repository cùng quản lý bảng.
- Controller nhận path/DTO, gọi service và trả response; không chứa if nghiệp vụ.
- Service xác thực rule-specific validation, optimistic concurrency và audit.
- RolesGuard dùng chung với Camera/Zone/US-09; không tạo guard ADMIN riêng cho từng module.
- `effectiveHighWaitSeconds()` là hàm policy thuần dùng chung giữa API response và engine; test biên T_wait=1,2,3,30,60,120.
- ErrorResponse và global exception filter theo chuẩn hiện có; log correlationId và actor/eventType, không log Authorization header.

## 9. Giao diện Cài đặt

Sidebar đã có `activeNav === 'settings'`. `DashboardView` phải render `SettingsView` qua shared navigation shell được thống nhất trong [kế hoạch tích hợp](PLAN_AGILE_5_MEMBER_EXECUTION.md), tránh từng story tự sửa điều hướng theo cách khác.

```text
apps/web/src/components/settings/
  SettingsView.tsx
  EscalationRulesSection.tsx
  EscalationRuleCard.tsx
  EscalationRuleForm.tsx
  settings-view.module.css
apps/web/src/hooks/useEscalationRules.ts
apps/web/src/lib/escalation-rules-client.ts
```

### Bố cục và hành vi

- Tiêu đề “Cấu hình cảnh báo”; giải thích T_low, T_high, T_wait bằng tiếng Việt, không chỉ ký hiệu.
- Mỗi event type là một card/hàng: tên, priority badge read-only, inputs thresholds, T_wait giây, high-confidence wait computed read-only, updated time/user.
- WELLNESS hiển thị “Không áp dụng” cho thresholds và khóa inputs.
- Input number step=0.01, vẫn validate tối đa 3 decimals; T_wait có suffix “giây”.
- Lưu từng rule độc lập để không block toàn trang và giảm conflict. Nút Save chỉ bật khi dirty/valid; Cancel khôi phục canonical response.
- Hiển thị loading, empty, 401/403, retryable error. Khi PATCH thành công cập nhật version và thông báo `role=status`; không reload trang.
- 400 map vào đúng field; 409 giữ draft, hiển thị so sánh server/latest và nút tải lại. Không silently overwrite.
- Non-ADMIN xem read-only hoặc bị điều hướng theo policy; backend vẫn chặn write.
- Responsive từ 360px, CSS Modules và design tokens hiện có; không chỉ dùng màu cho priority/error.

## 10. Kiểm thử

| Trường hợp                               | Kết quả                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Fresh DB chạy migrations                 | Năm default rules đúng chính xác bảng yêu cầu trước event đầu tiên |
| T_low=0, T_high=1; T_low=T_high          | Lưu hợp lệ, policy biên đúng                                       |
| T_low>T_high, ngoài range, NaN, field lạ | 400, DB/version/audit không đổi                                    |
| WELLNESS có threshold hoặc chỉ một null  | Reject; canonical vẫn null/null                                    |
| T_wait 1/3600/0/3601/decimal             | Chỉ giới hạn hợp lệ được lưu                                       |
| User không phải ADMIN                    | GET theo policy, PATCH 403                                         |
| Hai ADMIN sửa cùng version               | Một thành công, một 409; không lost update                         |
| PATCH thành công                         | Audit before/after, actor và version đúng                          |
| Node A cập nhật, node B đánh giá event   | Rule mới được dùng trong <=60 giây, không restart                  |
| Event đã NOTIFIED rồi rule đổi           | Deadline/rule snapshot cũ giữ nguyên                               |
| Event mới sau đổi rule                   | Dùng version mới và computed wait đúng                             |
| Rule DB/cache lỗi                        | Không dùng giá trị giả; log/health rõ ràng                         |
| Frontend 400/409/network error           | Không báo lưu thành công, draft có thể sửa/khôi phục               |

Unit test policy/DTO/service bằng fake clock; integration PostgreSQL kiểm tra NUMERIC, constraint, optimistic update và audit; frontend Vitest cho loading/edit/validation/conflict. E2E: login ADMIN → sửa UNKNOWN_PERSON → tạo event mới → xác minh decision mới trong tối đa 60 giây → khôi phục default qua UI, không sửa DB thủ công.

## 11. Trình tự thực hiện

1. Chốt contract chung với US-13 và loại bỏ đề xuất lưu `tHighWaitSeconds`; high wait là computed.
2. Contract PR và generated types.
3. Migration version/constraints nếu cần; cập nhật ERD.
4. Repository/service/audit/role guard integration.
5. Rule policy dùng chung và nối US-13.
6. SettingsView và API client.
7. Multi-instance <=60s, concurrency và E2E với event mới.
8. Cập nhật DATA_FLOW/API_GUIDE nếu mô tả cũ khác policy.

## 12. Git và Definition of Done

- Nhánh ví dụ `feat/US-15-escalation-rule-settings`; contract PR nên merge trước consumer. Commit nhỏ theo scope, ví dụ `feat(orchestrator): cập nhật ngưỡng cảnh báo theo phiên bản` và `feat(web): thêm cấu hình ngưỡng theo loại sự kiện`.
- Chạy `pnpm api:lint`, `pnpm contracts:generate`, `pnpm --filter @cam/orchestrator test`, `pnpm --filter @cam/web test`, `pnpm check:all`, Docker smoke test.
- PR theo template, API cần A và B review, ít nhất một người khác approve; không tự merge, squash theo workflow.

- [ ] Trang Cài đặt đọc và lưu riêng từng rule bằng API thật.
- [ ] Default table đúng trên fresh DB và event đầu tiên dùng được.
- [ ] T_low>T_high bị chặn ở UI/service/DB, không lưu một phần.
- [ ] Rule mới có hiệu lực với event mới <=60 giây, không restart.
- [ ] Event đang chờ giữ snapshot/deadline cũ.
- [ ] WELLNESS null thresholds, priority read-only và high wait computed nhất quán US-13.
- [ ] ADMIN-only update, optimistic concurrency và audit đầy đủ.
- [ ] Contract/generated types, migration/ERD, docs và tests đạt.
