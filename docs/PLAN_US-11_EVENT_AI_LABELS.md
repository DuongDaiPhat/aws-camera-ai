# Plan US-11 — Gắn nhãn AI, confidence và tổng hợp ưu tiên sự kiện

> Phần giao với US-10, US-12, US-13, US-15, shared outbox và migration tuân theo [kế hoạch tích hợp 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md).
> Trạng thái: kế hoạch thực thi độc lập, chưa triển khai.
> Mục tiêu: mỗi kết quả inference được lưu đúng nguồn, event có nhãn đại diện nhất quán và không mất các nguy cơ đồng thời.

## 1. Phạm vi và phụ thuộc

- Sở hữu cổng nhận AI result, validation, chống trùng, tổng hợp labels/priority, lưu event và phát SSE/handoff escalation.
- Không tự triển khai model M1/M2/M3 hoặc sender Telegram.
- Input M1 theo [US-10](PLAN_US-10_PERSON_CROP_FACE_MATCH.md); output chuyển cho [US-13](PLAN_US-13_ESCALATION_STATE_MACHINE.md).
- Có thể triển khai bằng fixtures trước khi model và engine sẵn sàng; nghiệm thu tích hợp phải dùng producer/consumer thật.
- Nguồn chuẩn: [OpenAPI](../api/openapi.yaml), [AI OpenAPI](../api/openapi-ai-service.yaml), [schema](../db/migrations/0001_init.sql), [rules](../db/migrations/0002_seed_escalation_rules.sql), [coding convention](conventions/CODING_CONVENTION.md), [Git workflow](conventions/GIT_WORKFLOW.md).
- Đọc lại working tree và AGENTS.md nếu có trước khi thực thi, giữ thay đổi của người khác.

## 2. Hiện trạng và lỗi tích hợp cần xử lý

- `events` đã có ai_label, confidence, ai_model_version, ai_processed_at, person_status, matched_known_face_id, ai_results JSONB và priority.
- OpenAPI đã khai báo `POST /internal/events/{eventId}/ai-result` trả 202, bảo vệ bằng X-Internal-Token; chưa có controller thực thi.
- `AiResultItem` bắt buộc confidence là number nên chưa biểu diễn UNDETERMINED không có điểm.
- `EventDetail` có aiLabel/aiModelVersion/aiResults nhưng chưa phơi bày aiProcessedAt.
- `EventsRepository.updateEvent()` hiện dùng GREATEST cho confidence MQTT; khi có AI sẽ trộn person detection score với score của nhãn AI nếu không sửa.
- MQTT consumer có thể ghi đè event_type/priority theo PERSON_DETECTED hoặc zone ở những update sau. Phải chuyển quyền quyết định các trường này sang aggregator.
- API read/SSE và UI hiện có cần map đúng field mới, không tạo dashboard khác.

## 3. Ý nghĩa các trường: chốt trước code

| Trường           | Quy tắc                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| person_status    | Kết quả M1 KNOWN/UNKNOWN/UNDETERMINED, độc lập nguy cơ M4/M3             |
| ai_results       | Tập kết quả chi tiết có nguồn, version, time, score và trạng thái hợp lệ |
| ai_label         | Nhãn của kết quả đại diện, không ghép chuỗi mơ hồ                        |
| confidence       | Score của đúng nhãn đại diện, không lấy max từ các nhãn khác nhau        |
| ai_model_version | Version của đúng kết quả đại diện                                        |
| ai_processed_at  | processedAt của kết quả đại diện; thời điểm nhận lưu riêng nếu cần       |
| priority         | Mức nghiêm trọng cao nhất của các nguy cơ hợp lệ: P0 > P1 > P2 > P3      |
| event_type       | Loại tương ứng nguy cơ đại diện; KNOWN không tự tạo event type mới       |

Với event chưa có inference hoặc UNDETERMINED, nullable field phản ánh đúng việc chưa có dữ liệu. Không tạo confidence/model version giả để thỏa câu “mọi sự kiện”. M4 rule-based dùng version rule/config, không giả thành version neural model.

### Score policy dùng chung với US-10

- Giữ detectionConfidence của Frigate riêng: metadata của observation hoặc cột mới nếu cần query.
- Lưu raw cosine/similarity M1 riêng với thresholdUsed và confidencePolicyVersion.
- Đề xuất ban đầu: KNOWN confidence=similarity, UNKNOWN confidence=1-similarity; không mô tả là xác suất đã hiệu chuẩn. UNDETERMINED confidence=null, eligibleForAlert=false.
- Không dùng similarity=0.2 làm confidence UNKNOWN=0.2, cũng không lấy Frigate score=0.9 thay thế confidence UNKNOWN.
- Backend tự xác định quyền tham gia cảnh báo theo module/label/quality; không tin `eligibleForAlert=true` từ payload tùy ý.
- Việc UNKNOWN được nhận vẫn phải qua T_low/T_high của US-13; không tự bypass threshold.

## 4. Contract-first

Giữ endpoint hiện có và mở rộng AiResultRequest/AiResultItem:

```text
requestId / resultId    định danh ổn định để chống trùng
observationId          định danh frame/observation đã xử lý
revision               số thứ tự theo producer/module/observation
module                 enum hiện tại, phải khớp mọi result item
modelVersion
processedAt            ISO date-time
results[]              label, confidence nullable, metadata có schema giới hạn
personStatus?
matchedKnownFaceId?
error?                 code, message đã làm sạch
```

- Không nhận event priority, owner ID hoặc event status do client quyết định.
- Kiểm tra confidence hữu hạn 0–1; unknown module/label combination, timestamp sai hoặc metadata quá lớn trả 400.
- Bounding box chuẩn hóa: x/y/width/height, x+width và y+height không vượt 1.
- Giới hạn số labels, độ sâu/kích thước metadata; cấm ảnh/vector/token trong metadata.
- error và successful result phải tuân thủ cấu trúc rõ; không mặc định error!=null luôn ghi đè event status.
- Public EventDetail thêm aiProcessedAt và chi tiết đủ đọc; matchedPersonName lấy từ server, không từ chuỗi input không kiểm chứng.
- Bổ sung lỗi 400/401/404/409. Kết quả lặp cùng ID/nội dung được tiếp nhận idempotently; cùng ID nhưng nội dung khác là 409.
- Endpoint chỉ trả 202 sau khi result đã được ghi bền vững; lưu inbox xong rồi xử lý async. Không ACK trước khi commit.
- Worker nội bộ US-10 gọi cùng result-application service để tránh hai đường cập nhật khác nhau.
- Regenerate contracts; enum mới nếu có phải đồng bộ SQL, packages/contracts/src/enums.ts và OpenAPI.

## 5. Database và chống mất kết quả

Tái sử dụng các cột events hiện có. Migration mới đề xuất:

1. Inbox `event_ai_result_receipts`: resultId unique, eventId, producer/module, observationId, revision, payload JSONB đã validate, receivedAt, processedAt, processing status/lease.
2. Kết quả chuẩn hóa hoặc receipt lưu đủ từng observation và error. `events.ai_results` là projection đầy đủ các kết quả được giữ cho event; nếu số observation tăng, giới hạn inference có cấu hình và giữ lịch sử tại receipt, không xóa lịch sử im lặng.
3. Outbox handoff/SSE theo `(eventId, aggregateVersion, messageType)` để không mất thông báo giữa commit và publish.
4. `aggregate_version` để consumer nhận biết revision mới; source confidence riêng nếu không để metadata.
5. Snapshot tên người nếu cần giữ tên sự kiện sau khi known_face bị xóa; không lưu embedding vào event. Tôn trọng ON DELETE SET NULL đang có.

Không xây hai outbox khác nhau nếu US-13 đã cung cấp shared infrastructure. Không sửa migration cũ; update ERD và chính sách retention của receipts cùng event.

Transaction áp dụng:

```text
claim receipt
  → lock event
  → kiểm tra duplicate/stale/scope/model
  → merge result theo identity, không thay cả JSONB bằng result mới
  → tính lại projection
  → UPDATE event + aggregate version
  → outbox event.updated + evaluate-escalation
  → đánh dấu receipt processed
  → COMMIT
```

Network call không nằm trong transaction. Hai worker M1/M4 đồng thời phải serialize trên cùng event để không mất JSONB update. Stale revision được lưu trạng thái ignored có lý do, không thay projection hiện tại.

## 6. Thuật toán tổng hợp

1. Lấy các result hợp lệ mới nhất của mỗi observation/module; giữ chi tiết result trước trong receipt.
2. Loại khỏi danh sách nguy cơ: KNOWN, UNDETERMINED, inference lỗi, M4 chưa đủ dwell/lịch hoặc result thuộc camera/owner sai.
3. Map label sang event type bằng mapping được kiểm thử, ví dụ UNKNOWN → UNKNOWN_PERSON, RESTRICTED_ZONE → RESTRICTED_ZONE.
4. Lấy priority theo escalation_rules, không hard-code thứ tự bằng so sánh chuỗi. Dùng rank P0=0, P1=1, P2=2, P3=3.
5. Đại diện của các nguy cơ: priority cao nhất; hòa thì giữ đại diện hiện tại nếu còn hợp lệ, nếu chưa có chọn theo thứ tự ổn định eventType/module/observationId. Không so confidence giữa các module như thể cùng thang xác suất.
6. Copy label/confidence/modelVersion/processedAt từ cùng result đại diện.
7. Nếu không có nguy cơ, lấy kết quả M1 hợp lệ để hiển thị; event_type PERSON_DETECTED, priority P3. UNDETERMINED giữ confidence=null.
8. Chuyển toàn bộ danh sách candidate sang engine, không chỉ gửi scalar confidence của đại diện. Engine đánh giá ngưỡng từng candidate để không bỏ nguy cơ P2 đủ ngưỡng khi P1 có score thấp.
9. Event đã NOTIFIED/ESCALATED không tự bị hạ hoặc đóng vì kết quả đến muộn. Giữ nguy cơ đã kích hoạt phản ứng trong projection được chốt; cập nhật chi tiết mới mà không triệt tiêu hành động đã phát sinh.
10. RESOLVED/CLOSED không bị mở lại bởi result cũ. Nguy cơ mới thuộc occurrence mới cần event riêng theo lifecycle đã chốt, không tự sửa dedup trong task này.

Ví dụ bắt buộc: M1 UNKNOWN confidence=0.85 và M4 RESTRICTED_ZONE confidence=0.70 → giữ cả hai labels; priority P1 do M4; confidence đại diện 0.70, không lấy 0.85 ghép với M4. Nếu M1 KNOWN và M4 hợp lệ, person_status vẫn KNOWN nhưng event vẫn là RESTRICTED_ZONE.

## 7. Lỗi và lifecycle

- Lỗi model/timeout: receipt lưu module, code, duration và requestId; không đưa vào tập nhãn thành công.
- Event chỉ có M1 đang DETECTED mà M1 thất bại → yêu cầu state service chuyển AI_FAILED, có history.
- Không có face → UNDETERMINED; đây không phải MODEL_NOT_LOADED và không tự tạo AI_FAILED.
- M1 lỗi trong khi M4 hợp lệ → M4 vẫn được engine đánh giá. Event đã có deadline không bị xóa deadline bởi result lỗi.
- Retry có version mới thành công khi event AI_FAILED: cho phép reevaluate qua state service; ghi history. Không tạo event mới cho cùng track.
- SSE chỉ phát sau commit; có outbox/retry để broker hoặc UI disconnect không làm mất trạng thái DB.
- Log có correlationId/eventId/resultId/module; không log toàn payload nếu có dữ liệu nhạy cảm.

## 8. File/module và trình tự thực hiện

1. `apps/orchestrator/src/ai-results/`: module, internal controller, DTO, receipt repository, application service, aggregator thuần và worker.
2. `apps/orchestrator/src/events/`: mở rộng record/DTO/serializer; loại bỏ cập nhật confidence/type/priority bằng GREATEST từ MQTT khi AI projection đã tồn tại.
3. `apps/orchestrator/src/ingestion/`: ghi observation/detection metadata và gọi aggregator cho M4 hợp lệ; không tự coi mọi current_zone là restricted.
4. `apps/orchestrator/src/auth/` hoặc `common/guards/`: internal-token guard; bỏ JWT cho route nội bộ chỉ khi guard chuyên biệt đã bảo vệ.
5. `apps/web/src/lib/events-client.ts`, `types/`, event components: map fields, hiển thị KNOWN/UNKNOWN/UNDETERMINED, tên, confidence đúng label, chi tiết nhiều module; dùng CSS tokens hiện có.
6. `db/migrations/`: migration receipts/version/outbox nếu chưa có.

Tách rule aggregator thành hàm thuần để test đầy đủ; Controller → Service → Repository. Không dùng any, không truy cập env trực tiếp ngoài ConfigService. Frontend dùng apiFetch và @cam/contracts.

## 9. Ma trận kiểm thử

| Ca                                              | Kết quả                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Một M1 KNOWN                                    | status người, tên, label/score/version/time đúng           |
| M1 UNKNOWN + M4                                 | Giữ cả hai, priority cao nhất, confidence thuộc đúng label |
| KNOWN + M4/FIRE                                 | Không mất nguy cơ độc lập                                  |
| P1 dưới T_low + P2 đủ T_low                     | Engine vẫn nhận P2 để thông báo                            |
| Result trùng hoặc cùng ID khác nội dung         | Một lần áp dụng / 409                                      |
| M1 và M4 ghi đồng thời                          | Không mất phần tử ai_results                               |
| Confidence -0.1, 1.1, NaN; timestamp/module sai | Reject trước DB                                            |
| No face và timeout                              | Hai outcome/lifecycle phân biệt                            |
| MQTT update sau khi có AI                       | Không ghi đè nhãn và confidence AI                         |
| Kết quả stale hoặc collection bị xóa            | Không ghi tên/ID sai hoặc downgrade                        |
| Callback đến sau RESOLVED/CLOSED                | Không mở lại, lưu lý do ignored                            |
| Crash sau commit trước SSE/handoff              | Outbox phát lại, consumer dedup                            |

Integration test dùng PostgreSQL thật cho lock/race/JSONB/unique constraint. E2E submit M1 + M4 → đọc EventDetail → SSE cập nhật UI → engine nhận đủ candidates. Test thứ tự M1/M4 đảo ngược phải cho projection tương đương.

## 10. Git và kiểm tra trước bàn giao

- Nhánh ví dụ `feat/US-11-event-ai-labels`; PR contract trước implementation theo Git workflow.
- Commit mẫu: `feat(orchestrator): tổng hợp nhãn AI theo mức ưu tiên`, `test(orchestrator): kiểm tra kết quả AI đồng thời`.
- Chạy `pnpm contracts:generate`, `pnpm api:lint`, `pnpm --filter @cam/orchestrator test`, `pnpm --filter @cam/web test`, `pnpm check:all`.
- Core business coverage tối thiểu 60%, ưu tiên test mất dữ liệu/concurrency hơn test boilerplate.
- PR đúng template, mô tả score policy và migration, không tự merge; API cần A/B review, một người khác approve, squash.

## 11. Definition of Done

- [ ] Cổng nội bộ có auth và validate, 202 chỉ sau durable accept.
- [ ] ai_label/confidence/model/time nhất quán cùng result.
- [ ] Giữ đủ nhãn M1/M4 và không làm mất kết quả khi đồng thời.
- [ ] P0/P1/P2/P3 và mapping event type có policy rõ, UNKNOWN score không nhầm similarity.
- [ ] Không có mặt/lỗi AI/terminal event được xử lý riêng.
- [ ] MQTT không ghi đè projection AI, SSE và handoff có dedup/recovery.
- [ ] Frontend hiển thị đúng nullable confidence và chi tiết labels.
- [ ] Contract, generated types, migration/ERD và tests đạt.
