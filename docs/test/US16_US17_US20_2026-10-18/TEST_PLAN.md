# Kế hoạch kiểm thử US-16, US-17 và US-20

- Ngày: 18/10/2026, Asia/Bangkok. Một người/một AI thực hiện.
- Nhánh chuẩn: `origin/main` tại `0f5c948a27fc82e1e20cfd35bf56781a468750f2`.
- Đối tượng M2a: `feat/US-16-US-17-pose-fall` tại `549f9c0`.
- Đối tượng M5: `feat/US-20-wellness-check` tại `872a895`.
- Hai nhánh có merge-base đã xác minh là `0f5c948`. Working tree ban đầu ở `docs/testing`, có thay đổi ngoài phạm vi tại `docs/README.md`, `.postman/`, `docs/aws/`, `postman/`; giữ nguyên.
- Thực thi trong worktree riêng `codex/qa-us16-us17-us20`; kiểm tra từng nhánh rồi ghép candidate để kiểm thử xung đột/hồi quy. Candidate không phải merge vào main.

## 1. Nguồn yêu cầu và truy vết

Đọc `docs/test/HUONG_DAN_DOC_SHEET_TEST_CASE.md`, `docs/test/HUONG_DAN_DUNG_AI_TAO_TEST_CASE.md`, hai plan E2E trong `docs/sprint-3/`, các task plan/guide trên nhánh, backlog, hai OpenAPI, generated types, migrations 0013/0015 và code/test thật. Code và contract là bằng chứng triển khai; dấu hiệu lỗi trong code không được biến thành expected result.

Bảng thiết kế `TEST_CASES_DESIGN.md` gồm đúng ba phần theo hướng dẫn và đúng 16 cột; tất cả bắt đầu `Not Run`. Bảng thực thi riêng `TEST_CASES_EXECUTED.md` giữ cùng ID/schema và chỉ cập nhật theo assertion/log/thao tác đã thực hiện. Cấp kiểm thử ghi trong `Sub Category` và `Remarks`, không thêm cột hoặc giá trị Type ngoài enum.

## 2. Phạm vi và chiến lược

| Cấp              | US-16 / US-17                                                                        | US-20                                                                                     | Bằng chứng                                                                     |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Unit Test        | Geometry, history 10 frame, góc 30°, continuity, >15s, missing 5s, replay, REST_AREA | Timezone/weekday, window, ownership, confirmation idempotency/deadline                    | Jest/pytest hiện có và regression assertions bổ sung                           |
| Module Test      | FastAPI router/token/validation, envelope, consumer, coordinator, media, registry    | DTO/controller/guard, scheduler admission/evaluation/delivery/confirm                     | HTTP in-process và Nest testing module; dependency double được ghi rõ          |
| Integration Test | Postgres 16 thật: incident+event transaction/dedup, AI submit/retry; bridge fixtures | Migrations, repositories/scheduler trên DB thật, 300s logical clock, notification routing | DB disposable và logs; không dùng mock SQL để tuyên bố tích hợp DB đạt         |
| System Test      | Runtime wiring, health, MQTT-frame → AI → incident → escalation/media/SSE            | Runtime API → schedule → run → resident delivery → confirm/caregiver                      | Local runtime/HTTP, adapter test; chặn downstream khi prerequisite hỏng        |
| Acceptance Test  | AC16-1..3, AC17-1..3; video thật và chất lượng/latency khi có fixture hợp lệ         | Mục 1 của plan: 09:00/18:00, no activity, IM_OK trước 300s, timeout đúng/sau 300s, AWAY   | Traceability AC tới các test; live UI/Telegram chỉ Passed khi quan sát thực tế |

Hồi quy: auth, permissions, M1/M4, AI receipts/outbox, escalation/confirmation/deadline, notifications, media, web, bridge/tools, typecheck/lint/API generation. Phân biệt unit assertion, integration có double, DB thật và live end-to-end. Không gán Passed toàn luồng từ mock.

## 3. Trình tự thực thi

1. Chụp refs/diff/baseline, tìm AGENTS, đối chiếu plan/code và liệt kê chức năng chỉ có trong plan/code.
2. Chuẩn bị Node 22, pnpm 9.12.0 nếu có, Python 3.11.13 từ baseline cục bộ, model đã pin; Docker/Postgres 16 disposable riêng. Không nâng dependency, không reset DB thật, không gửi Telegram thật.
3. Xuất bảng thiết kế trước khi chạy. Chạy baseline/main và các suite hiện có trên từng nhánh, lưu đầy đủ kết quả/exit code.
4. Bổ sung test cho rủi ro chưa được suite hiện có kiểm tra, đặc biệt timezone, SQL/schema, first successful delivery, terminal event, REST_AREA lookup failure, malformed AI response và retry.
5. Thực hiện migration fresh/upgrade/replay và integration trên Postgres thật khi môi trường sẵn sàng. Chạy module HTTP và system smoke. Lỗi prerequisite làm case phụ thuộc `Blocked`, không `Passed` hoặc `N/A`.
6. Ghép hai nhánh vào candidate riêng, ghi conflict/resolution và chạy lại kiểm tra thích hợp trên candidate. Không sửa production code để làm xanh trong đợt kiểm thử này; ghi lỗi và cách tái hiện.
7. Xuất bảng thực thi, defect log, báo cáo phạm vi/giới hạn, số liệu lấy từ kết quả thật và quyết định merge.
8. Chỉ merge cả hai vào `main` khi gate mục 4 đạt; kiểm tra refs không thay đổi và CI/review hiện hữu. Nếu có lỗi hoặc gate bắt buộc bị chặn, giữ nguyên main và bàn giao lỗi.

## 4. Điều kiện ra quyết định

- Không còn test Failed và không còn lỗi chưa xử lý trong phạm vi hai tính năng.
- Tất cả AC bắt buộc và ca P0 đạt; không có Blocked đối với an toàn, quyền, thời gian, persistence/retry, giao nhận resident và hồi quy cốt lõi.
- Unit/module/integration/system/acceptance có bằng chứng đúng cấp; Python core coverage tối thiểu 60% theo cấu hình; quality checks bắt buộc đạt.
- Candidate hợp nhất không xung đột chưa xử lý và kiểm tra lại đạt; CI/review/protection thỏa điều kiện repository, không bỏ qua hoặc ép merge.
- Yêu cầu người dùng đã cho phép merge nếu không có lỗi; không xin xác nhận lại cho hành động đủ điều kiện. Nếu có lỗi thì không merge.

## 5. Quản lý kết quả và an toàn dữ liệu

Log có command, commit, thời điểm, exit code và output; không chứa `.env`, token hay dữ liệu cá nhân thật. Dùng UUID và ảnh/landmark tổng hợp cho assertion. Dataset/video có sẵn chỉ được dùng nếu provenance/expected labels thích hợp; smoke model trên ảnh trống không chứng minh precision/recall/FAR. Một case chưa thực thi được giữ `Blocked` hoặc `Not Run` với nguyên nhân rõ ràng. Thiếu UI/feed adapter được ghi `Chưa tìm thấy`/`Một phần`, không xóa case.
