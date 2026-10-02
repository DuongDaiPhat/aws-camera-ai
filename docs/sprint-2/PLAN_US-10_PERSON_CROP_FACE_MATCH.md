# Plan US-10 — Crop person và so khớp người quen (M1)

> Phần giao với US-09, US-11, shared jobs, contract và migration tuân theo [kế hoạch tích hợp 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md).
> Trạng thái: kế hoạch thực thi, chưa phải tính năng đã triển khai.
> Mục tiêu: phân loại KNOWN / UNKNOWN / UNDETERMINED từ ảnh person của Frigate; lỗi AI không làm mất sự kiện.

## 1. Phạm vi và nguồn chuẩn

- Thực hiện crop đúng đối tượng, inference M1, cosine matching, timeout 5 giây, đồng bộ collection và ghi nhận kết quả.
- US-09 cung cấp embedding người quen; không xây lại giao diện đăng ký trong task này.
- US-11 sở hữu việc tổng hợp kết quả vào event; US-13 sở hữu chuyển trạng thái/escalation. M1 không gửi Telegram trực tiếp.
- Tham chiếu [OpenAPI AI](../api/openapi-ai-service.yaml), [OpenAPI Orchestrator](../api/openapi.yaml), [schema](../db/migrations/0001_init.sql), [quy ước code](conventions/CODING_CONVENTION.md), [Git workflow](conventions/GIT_WORKFLOW.md).
- Các đường dẫn code trong tài liệu tính từ repository root. Khi bắt đầu, đọc lại AGENTS.md nếu có, git status và code mới nhất; tái sử dụng module đã được task khác triển khai.

## 2. Hiện trạng đã kiểm tra

| Thành phần   | Hiện trạng                                                                           | Việc cần làm                                              |
| ------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| MQTT         | Đã lưu event theo dedup `frigate:{camera_slug}:{track_id}`, tải media theo lifecycle | Tạo job M1 bền vững khi có ảnh, không chặn hàng đợi MQTT  |
| MediaService | Tải `/api/events/{trackId}/snapshot.jpg`, chưa có crop M1                            | Thêm adapter lấy ảnh sạch/crop khớp track                 |
| AI service   | Mới có health router và Settings; `FACE_MATCH_THRESHOLD=0.60`                        | Implement `/face/match`, collection và matcher            |
| known_faces  | BYTEA embedding, dimension, model version, owner và provider đã có                   | Đọc đúng owner, model và trạng thái active                |
| events       | Có person_status, matched_known_face_id, ai_processed_at, ai_results                 | US-11 cập nhật atomic, giữ dữ liệu của module khác        |
| API          | `/face/match`, `/face/collection/sync` đã định nghĩa                                 | Bổ sung scope, version và định danh request nếu còn thiếu |

## 3. Quy tắc phân loại

1. Chỉ xử lý track `label=person` thuộc camera hợp lệ và đang bật.
2. Xác định owner từ camera → device → owner_user_id ở backend. “Toàn bộ known_faces” nghĩa là toàn bộ người quen active thuộc phạm vi này, không trộn các hộ.
3. Query embedding phải cùng provider/modelVersion/dimension với ảnh đang xử lý. Không so hai vector khác model dù cùng số chiều.
4. Cùng model tiền xử lý ảnh đăng ký và ảnh matching: orientation, color space, face alignment và normalization.
5. Độ tương đồng cosine: `rawCosine = dot(q, v) / (norm(q) * norm(v))`; khoảng cách cosine là `1 - rawCosine`. Chọn khoảng cách nhỏ nhất/tương đồng lớn nhất.
6. Vector zero norm, NaN/Infinity hoặc dimension không hợp lệ là lỗi dữ liệu/model, không suy luận thành UNKNOWN.
7. Để tương thích API similarity 0–1, đề xuất `similarity = clamp(rawCosine, 0, 1)`; ghi rõ công thức trong contract và metadata policy version. Không tự đổi sang `(rawCosine+1)/2` vì sẽ thay ý nghĩa ngưỡng 0.6.
8. `similarity >= T_known` → KNOWN; `< T_known` → UNKNOWN. So sánh trước khi làm tròn để tránh lỗi tại 0.5999/0.6000.
9. KNOWN lưu ID và tên người từ dữ liệu server. UNKNOWN không gắn best candidate thành người được nhận diện; trả best candidate riêng ở internal API để debug nếu cần.
10. Không có face/face quá nhỏ, tối, mờ, quay lưng hoặc nhiều face không thể gán chắc chắn cho track → UNDETERMINED, không cảnh báo M1.
11. Collection rỗng nhưng đã đồng bộ đúng owner: có face hợp lệ → UNKNOWN, best match null. Collection chưa nạp/lỗi/stale chưa phục hồi không được coi là collection rỗng; trả lỗi hệ thống.
12. UNDETERMINED/KNOWN chỉ loại cảnh báo M1, không triệt tiêu RESTRICTED_ZONE/FALL/FIRE hợp lệ từ module khác.

### Phân biệt similarity và confidence

- Similarity cao nghĩa là giống người quen. Không dùng similarity thấp làm confidence của UNKNOWN rồi so trực tiếp với T_low.
- Chính sách ban đầu đề xuất, phải ghi rõ trong hai contract: KNOWN có `labelConfidence=similarity`; UNKNOWN có `labelConfidence=1-similarity`. Đây là điểm quy ước, không phải xác suất đã hiệu chuẩn.
- Ví dụ similarity 0.55 → UNKNOWN, confidence 0.45; chuyển cho engine để đánh giá, engine có thể LOGGED_ONLY. Story yêu cầu chuyển cho engine, không đồng nghĩa mọi UNKNOWN đều phải gửi cảnh báo.
- Collection rỗng: ghi reason `EMPTY_COLLECTION`, dùng similarity quy ước 0, confidence 1 chỉ khi face đạt quality gate; đánh giá false alarms riêng cho ca này.
- UNDETERMINED không có similarity/confidence nhận diện; dùng null sau khi mở rộng schema, không gán 0 để giả thành inference hợp lệ.
- Trước nghiệm thu model, đo precision/recall và FAR trên tập có quyền sử dụng tại T_known=0.6 và ngưỡng escalation hiện tại. Nếu chính sách điểm cần đổi, version hóa và cập nhật US-11, không đổi ngầm.

## 4. Contract và model

### Internal AI API

Giữ `POST /face/match` multipart `image`, `eventId`, `threshold?`; thêm các trường được backend cấp:

- `requestId`, `ownerScopeId`, `collectionVersion`.
- Request không nhận scope từ browser. Xác thực `X-Internal-Token` bắt buộc.
- Response giữ các trường hiện có: personStatus, similarity, matchedKnownFaceId, matchedPersonName, modelVersion, processedAt, thresholdUsed, provider, boundingBox, error.
- Bổ sung requestId, collectionVersion, labelConfidence, confidencePolicyVersion, qualityReason và bestCandidate nội bộ nếu cần.
- Các nhánh không có điểm dùng null; ghi required/nullability rõ ràng.
- Inference có thể trả HTTP 200 kèm error theo quy ước AI. Orchestrator phải đọc error, không coi mọi 200 là thành công.
- Không có face là kết quả nghiệp vụ UNDETERMINED; model unavailable, decode input hỏng và timeout là lỗi kỹ thuật. Nếu NO_FACE_DETECTED vẫn nằm trong error enum cũ, adapter phải map riêng, không gộp mọi error thành AI_FAILED.

Mở rộng `/face/collection/sync` với ownerScopeId, version, modelVersion và embeddingDim. AI thay collection bằng snapshot mới atomically; không để request nhìn thấy collection đang nạp dở.

Giữ `/internal/events/{eventId}/ai-result` là cổng nhập US-11. Response đồng bộ của `/face/match` được chuyển vào cùng application service; không vừa callback vừa POST lại cùng kết quả mà thiếu idempotency key.

Chạy `pnpm api:lint` và `pnpm contracts:generate`; commit generated types. Không viết tay kiểu API frontend.

## 5. Crop và lifecycle xử lý

### Bước A — Tạo job

- Sau khi event được lưu, tạo job theo `(eventId, module=M1_FACE, observationVersion)` với unique constraint.
- `new` thường chưa có snapshot: chờ `update` có ảnh; có retry giới hạn và thời hạn lấy ảnh. Không kết luận UNDETERMINED chỉ vì snapshot chưa sẵn sàng.
- Kết thúc track mà không lấy được ảnh sau retry → lỗi kỹ thuật có reason, event vẫn tồn tại.
- Worker có concurrency/batch size cấu hình, lease và recovery sau crash. Không await toàn bộ inference trong processingQueue toàn cục của MQTT.
- Một observation chỉ được xử lý/áp dụng một lần; chọn một ảnh tốt cho mỗi track trước, tránh gọi AI trên mỗi frame. Retry chất lượng nếu bổ sung phải có giới hạn và version mới.

### Bước B — Lấy crop đúng track

- Spike trên Frigate 0.18.0 đang ghim: kiểm chứng endpoint crop snapshot cho event, tắt timestamp/bounding box trên ảnh gửi AI.
- Ưu tiên crop do Frigate sinh từ chính snapshot event. Không lấy `latest.jpg` rồi dùng box của message cũ.
- Nếu crop tại Orchestrator, bắt buộc có ảnh và bbox cùng frame; chuyển hệ tọa độ theo kích thước ảnh thực tế, clamp biên, reject box rỗng, thêm padding có cấu hình.
- Person crop là đầu vào; AI tiếp tục detect và align face bên trong. Không dùng toàn bộ body embedding làm face embedding.
- Tách crop transient khỏi snapshot dùng cho Telegram. Không thay snapshot sự kiện bằng ảnh crop nhỏ.
- Crop/face embedding suy luận chỉ ở RAM; không thêm bản ảnh vào S3/MinIO hoặc log. Snapshot sự kiện hiện có vẫn theo retention media của hệ thống.

### Bước C — Inference và timeout

- Dùng AI_SERVICE_TIMEOUT_MS hiện có, mặc định 5000; áp dụng cho toàn request đọc response body, hủy HTTP khi hết hạn.
- Download crop có timeout riêng và tổng tuổi job hữu hạn; ghi riêng downloadLatencyMs và aiLatencyMs.
- Không retry AI vô hạn trong ngân sách 5 giây. Retry sau đó là job/attempt mới, không kéo dài lặng lẽ request đã timeout.
- Timeout tạo result lỗi `TIMEOUT`, giữ event và ghi AI_FAILED qua cơ chế US-11/US-13 khi event chưa có trạng thái phản ứng cao hơn.
- Kết quả đến sau timeout/attempt mới phải bị loại bằng requestId/version, không ghi đè kết quả mới hoặc event đã resolved.
- Nếu một nguy cơ M4/M3 đã NOTIFIED/ESCALATED, lưu M1 failure vào chi tiết; không reset lifecycle chung thành AI_FAILED và không hủy deadline đang chạy.

## 6. Cấu trúc triển khai

| Vị trí                                                  | Trách nhiệm                                    |
| ------------------------------------------------------- | ---------------------------------------------- |
| `services/ai-service/app/routers/face.py`               | Match/sync API và auth nội bộ                  |
| `services/ai-service/app/models/face.py`                | Request/response Pydantic đúng contract        |
| `services/ai-service/app/services/face_matcher.py`      | Cosine, best match, threshold                  |
| `services/ai-service/app/services/face_collection.py`   | Collection theo owner/model/version            |
| `services/ai-service/app/services/face_embedder.py`     | Tái sử dụng embedder US-09                     |
| `apps/orchestrator/src/face-recognition/`               | Module, worker, inference client qua interface |
| `apps/orchestrator/src/media/`                          | Adapter crop sạch, không ghi ảnh tạm dài hạn   |
| `apps/orchestrator/src/ingestion/`                      | Enqueue theo lifecycle, giữ MQTT dedup         |
| `apps/orchestrator/test/`, `services/ai-service/tests/` | Unit/integration, fixture hợp lệ               |

Migration mới cho job/lease nếu chưa có hạ tầng dùng chung. Không sửa 0001_init.sql; cập nhật ERD. Cùng job/outbox chỉ tạo một lần trong repo.

## 7. Collection, bảo mật và log

- Khởi động AI ở trạng thái chưa sẵn sàng matching cho tới khi collection cần dùng đã nạp.
- Thêm/xóa người quen phải tăng version và sync; check result matchedKnownFaceId vẫn tồn tại, active, đúng owner trước khi áp dụng.
- Sau hard-delete US-09, request cũ dùng collection cũ không được tiếp tục gắn người đã xóa. Reject/retry kết quả stale; log không giữ embedding.
- Internal token bắt buộc, đọc qua ConfigService/Settings, thiếu secret phải fail startup của capability cần dùng.
- Log JSON: correlationId, eventId, trackId, requestId, module, modelVersion, collectionVersion, durationMs, outcome, errorCode.
- Local ghi stdout; AWS chuyển log qua driver/agent CloudWatch được cấu hình. CLOUDWATCH_LOG_GROUP chỉ là tên cấu hình, không đủ chứng minh log đã được gửi; bổ sung hướng dẫn kiểm tra ingest.
- Không log ảnh/base64, vector, RTSP URL có mật khẩu hoặc internal token.

## 8. Kiểm thử và nghiệm thu

| Ca kiểm thử                                       | Kết quả bắt buộc                           |
| ------------------------------------------------- | ------------------------------------------ |
| Vectors cùng/khác hướng, norm không bằng 1        | Đúng cosine và best match                  |
| Similarity 0.5999 / 0.6 / 0.6001                  | UNKNOWN / KNOWN / KNOWN trước rounding     |
| known_faces owner khác/model khác                 | Không được tham gia so khớp                |
| Không mặt, tối, mờ, quá nhỏ, nhiều mặt mơ hồ      | UNDETERMINED, không có M1 alarm            |
| Collection rỗng so với chưa sync                  | Hai outcome khác nhau, không suy luận sai  |
| Snapshot delayed và bbox khác frame               | Chờ ảnh đúng, không crop nhầm người        |
| AI phản hồi sau >5000 ms, HTTP error, schema sai  | Event còn tồn tại; lỗi được lưu/log        |
| Replay MQTT hoặc worker restart                   | Không nhân job/result/event                |
| KNOWN hoặc UNDETERMINED đồng thời RESTRICTED_ZONE | M4 vẫn được đánh giá                       |
| Xóa người quen giữa inference                     | Không gắn lại ID đã xóa                    |
| Timeout M1 khi event đã NOTIFIED vì M4            | Deadline/trạng thái hiện tại được bảo toàn |

Các bước E2E: đăng ký người quen qua US-09 → phát video/webcam người đã đăng ký → kiểm tra KNOWN và tên → người chưa đăng ký → UNKNOWN và handoff engine → quay lưng → UNDETERMINED → ngắt AI → AI_FAILED/log có correlationId. Dùng dữ liệu được phép, ghi model/hash/threshold và precision/recall; không commit ảnh riêng tư.

## 9. Thứ tự giao việc và Git

1. Chốt shared envelope/score policy với [US-11](PLAN_US-11_EVENT_AI_LABELS.md) và input interface của [US-13](PLAN_US-13_ESCALATION_STATE_MACHINE.md).
2. Contract PR trước; triển khai crop/matcher và collection bằng adapter test.
3. Thêm durable jobs, timeout, integration với event-result service.
4. Kiểm thử dữ liệu model thật, collection mutation và E2E; chỉ hoàn tất end-to-end khi US-09/11/13 đã sẵn sàng.
5. Nhánh theo Git workflow, ví dụ `feat/US-10-person-face-match`; commit nhỏ tiếng Việt, scope `ai`, `orchestrator`, `api`, `db` phù hợp.
6. Chạy `pnpm test:ai`, `pnpm --filter @cam/orchestrator test`, `pnpm api:lint`, `pnpm check:all`; report bước bị chặn môi trường, không đánh dấu pass giả.
7. PR theo `.github/pull_request_template.md`, đính log đã làm sạch và chỉ số AI. API cần A/B review, ít nhất một người khác approve, không tự merge; squash theo workflow.

## 10. Definition of Done

- [ ] Crop đúng track/frame, không chặn MQTT và không tạo inference lặp.
- [ ] So khớp toàn bộ collection hợp lệ theo owner/model bằng cosine.
- [ ] Threshold mặc định 0.6; KNOWN có tên, UNKNOWN được chuyển cho engine.
- [ ] UNDETERMINED không phát M1 alarm và không triệt tiêu nguy cơ khác.
- [ ] Timeout 5 giây có abort, event còn tồn tại, AI_FAILED áp dụng đúng lifecycle.
- [ ] Collection sync/delete/version và stale result được kiểm thử.
- [ ] Không lưu ảnh crop hoặc embedding suy luận vào log/storage dài hạn.
- [ ] Contract, migration nếu có, ERD, log/CloudWatch runbook và tests đã cập nhật.
