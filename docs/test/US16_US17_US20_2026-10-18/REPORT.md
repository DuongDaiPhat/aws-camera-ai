# Báo cáo kiểm thử US-16 / US-17 / US-20

**Kết luận: KHÔNG MERGE hai nhánh vào main.** Đã lập và thực thi kế hoạch kiểm thử; phát hiện lỗi chức năng, an toàn, phân quyền và tích hợp DB. Điều kiện người dùng đặt ra “merge nếu không có lỗi” không đạt.

Ngày thực hiện: **18/10/2026**, Asia/Bangkok. Một AI thực hiện, không chia subagent. Báo cáo phản ánh kết quả đã chạy và các phần bị chặn; không tuyên bố System/Acceptance toàn hệ thống hoàn tất.

## 1. Đối tượng, baseline và sản phẩm bàn giao

| Đối tượng                                                                                     | Revision đã kiểm thử                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `main` / `origin/main`                                                                        | `0f5c948a27fc82e1e20cfd35bf56781a468750f2` |
| `feat/US-16-US-17-pose-fall`, PR [#28](https://github.com/DuongDaiPhat/aws-camera-ai/pull/28) | `549f9c092a3b274aaa8629c9323365b0c0a2d1e6` |
| `feat/US-20-wellness-check`, PR [#27](https://github.com/DuongDaiPhat/aws-camera-ai/pull/27)  | `872a895cd88ac8303bfe448831873aea562dfba5` |
| Candidate cục bộ `codex/qa-us16-us17-us20`                                                    | `c8f14a31822bc697cc28a69e56893313fe88831c` |

Hai feature có merge-base đã xác minh là main `0f5c948`. Ghép candidate phát sinh conflict ở hai vị trí import/register trong `apps/orchestrator/src/app.module.ts`; đã giữ cả `FallDetectionModule` và `WellnessModule`, ghi merge commit **chỉ trên candidate cục bộ**. Không sửa business logic hoặc test sản phẩm để làm xanh. Các regression test mới còn riêng trong worktree và được sao lưu trong bộ báo cáo này.

Thư mục ban đầu vẫn ở nhánh `docs/testing`. Giữ nguyên các thay đổi của người dùng tại `docs/README.md`, `.postman/`, `docs/aws/`, `postman/`; chỉ thêm thư mục báo cáo này. Không push/merge main và không thay feature heads trên GitHub.

- [Kế hoạch đã thực hiện](TEST_PLAN.md).
- [Bảng thiết kế 48 case, tất cả Not Run ban đầu](TEST_CASES_DESIGN.md).
- [Bảng thực thi 48 case, đúng 16 cột](TEST_CASES_EXECUTED.md).
- [25 nhóm lỗi và 3 khoảng trống nghiệm thu](DEFECTS.md).
- [Manifest lệnh, revisions, số liệu và checksum test](evidence/manifest.json).
- [Test/script tái hiện và hướng dẫn](REPRODUCE.md).

## 2. Kết quả theo năm cấp kiểm thử

| Cấp kiểm thử        | Passed | Failed | Blocked |   Tổng |
| ------------------- | -----: | -----: | ------: | -----: |
| Unit Test           |      6 |     11 |       0 |     17 |
| Module Test         |      2 |      9 |       0 |     11 |
| Integration Test    |      4 |      5 |       1 |     10 |
| System Test         |      1 |      0 |       4 |      5 |
| Acceptance Test     |      0 |      1 |       4 |      5 |
| **Tổng case sheet** | **13** | **26** |   **9** | **48** |

Một case sheet có thể gồm ma trận biên được triển khai bằng nhiều assertion. Vì vậy **48 case sheet** khác với **61 assertion bổ sung**. 61 assertion mới có **22 Passed, 39 Failed**; không cộng lại các lần rerun để tăng số lượng. Các attempt lỗi sandbox/fixture được loại khỏi số liệu sản phẩm.

| Bộ kiểm thử bổ sung được dùng kết luận                                            | Passed | Failed | Bằng chứng                                                                |
| --------------------------------------------------------------------------------- | -----: | -----: | ------------------------------------------------------------------------- |
| Python: góc, grace, continuity, replay, prone startup, timer 15s, identity/latch  |      9 |      6 | [fall-python-regression.txt](evidence/fall-python-regression.txt)         |
| Backend fall: envelope, freshness, response identity, REST lookup, retry          |      0 |      8 | [fall-jest-regression-valid.txt](evidence/fall-jest-regression-valid.txt) |
| Wellness: timezone/DST, activation/flag, delivery, state, scope/idempotency/as-of |      3 |     15 | [wellness-jest-regression.txt](evidence/wellness-jest-regression.txt)     |
| Production repositories/scheduler/confirmation trên PostgreSQL 16                 |      4 |      5 | [candidate-db-complete.txt](evidence/candidate-db-complete.txt)           |
| Local HTTP với production Wellness/Auth/Database, JWT và DTO thật                 |      6 |      5 | [candidate-http-qualified.txt](evidence/candidate-http-qualified.txt)     |

HTTP runtime đã mở server thật trên loopback với production modules, real JWT guard/service/repositories và DB thật. Timer scheduler được điều khiển bằng override để tách test HTTP; đây là bằng chứng subsystem/API, **không phải** full system Telegram/MQTT/UI. Test service với repository/storage double được ghi rõ trong bảng, không dùng để xác nhận tích hợp DB/storage/live delivery.

## 3. Hồi quy, chất lượng source và môi trường

| Kiểm tra                         | Kết quả cuối được chấp nhận                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Main baseline backend            | 325 Passed, 44 suites                                                                                                       |
| Main baseline AI / bridge        | 31 Passed, coverage 94.34%; bridge 6 Passed                                                                                 |
| Riêng nhánh pose/fall backend    | 355 Passed, 49 suites                                                                                                       |
| Riêng nhánh wellness backend     | 345 Passed, 47 suites                                                                                                       |
| Candidate backend, suite có sẵn  | 375 Passed, 52 suites                                                                                                       |
| Candidate web / tools            | 191 Passed, 31 files / 109 Passed                                                                                           |
| AI suite có sẵn trên pose/fall   | 49 Passed; coverage 86.17%, vượt ngưỡng 60%; không skip model smoke do đã cấu hình model local                              |
| Bridge trên pose/fall            | **7 Passed, 1 Failed**; stale-person assertion hồi quy so với main                                                          |
| PostgreSQL migration gate        | Fresh + seeded upgrade + replay + constraints/immutability đều đạt; 17 migrations apply vào DB runtime riêng                |
| Model/runtime thật               | Python 3.11.13, pinned M1/M2a model checksum/import/load/inference smoke đạt; AI process live HTTP health/token/no-pose đạt |
| Typecheck / ESLint / Python Ruff | Đạt; ESLint có 63 warnings, không error trong lần chạy, gồm cảnh báo của source/test cũ và QA helpers                       |
| OpenAPI / contracts              | Hai spec lint đạt, 5 warnings; generate thành công và `git diff --exit-code` generated types sạch                           |
| Formatting / diff                | Prettier cuối đạt; Ruff format đạt; diff check đạt                                                                          |

Node thực chạy **22.20.0**, pnpm QA **9.12.0**, dependency JS cài `--frozen-lockfile` vào worktree/store riêng. Python dùng môi trường `artifacts/ai-gate-windows` có sẵn, **3.11.13**, `pip check` đạt; smoke kiểm tra versions thư viện/model cốt lõi. Không tuyên bố đã cài lại sạch toàn bộ Python lock trong đợt này.

Docker được khởi động để dùng PostgreSQL **16** disposable; không reset, migrate hoặc xóa database/volume thật. Migration gate tự thu hồi container của nó. DB runtime QA dùng riêng `qa_runtime`/cổng 55432 và được thu hồi sau kiểm thử. AI server của script smoke tự dừng. Dữ liệu kiểm thử là UUID, email example.invalid, landmark/JPEG tổng hợp; không gửi Telegram thật.

GitHub CI được đọc cho đúng feature heads: **9 checks success ở mỗi PR**, gồm “CI xanh”. Bằng chứng CI: [PR28 run](https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/39022634533), [PR27 run](https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/38933224776). CI hiện tại không bao phủ các assertion mới/DB runtime đã thất bại, nên CI xanh chưa đủ căn cứ merge.

## 4. Lỗi chặn và đối chiếu Acceptance

25 nhóm lỗi mở gồm **17 P0, 8 P1**; trong đó 24 nhóm có assertion thất bại, một nhóm xác định bằng source audit về nguồn frame. Ba khoảng trống nghiệm thu được tách riêng khỏi số bug. Chi tiết, source và bước tái hiện nằm trong [DEFECTS.md](DEFECTS.md).

Các lỗi ảnh hưởng trực tiếp quyết định merge:

1. **Pose/fall có thể xác nhận ngã từ dữ liệu thiếu**: 16s không có frame vẫn cộng thành bất động; missing không reset interval; frame trùng lấp history; nằm sẵn startup vẫn tạo candidate; default angle 45° không giữ AC `<30°`.
2. **Fail-closed và delivery chưa an toàn**: lookup REST lỗi vẫn alert; response sai track/thiếu episode vẫn persist; submit lần đầu lỗi bị bỏ retry khi episode đã tồn tại. Bridge dùng latest.jpg với timestamp metadata khác nguồn, chưa chứng minh capture đồng nhất.
3. **Wellness core runtime không hoạt động đúng trên DB thật**: no-activity evaluation lỗi SQL và run còn PROCESSING; IM_OK/NEED_HELP đều rollback vì kiểu tham số UPDATE event không nhất quán.
4. **Wellness sai giờ/quyền/bằng chứng**: local 09:00/18:00 đổi sai UTC; VIEWER không household link vẫn hợp lệ; observation thiếu provenance/direction vẫn cập nhật AWAY; presence tương lai suppress check quá khứ.
5. **Deadline/state/contract sai**: bắt đầu 300s khi notification PENDING; event terminal vẫn có thể bị resolve qua service; M5_ENABLED không dừng admission; API response/status/validation lệch frozen spec.

| Nguồn nghiệm thu                                                  | Đánh giá có bằng chứng                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AC16-1: 33 landmarks và geometry                                  | Geometry/model smoke đạt trong phạm vi fixture; video thật, multi-person association và timestamped frame pipeline còn Blocked   |
| AC16-2: `<30°` + hạ thấp so 10 frame                              | **Failed**: angle=30 vẫn candidate; prone startup và replay cũng vi phạm giả thiết                                               |
| AC16-3: thiếu pose tối đa 5s                                      | **Failed** đúng grace/continuity; không coi test hiện có qua là đóng AC                                                          |
| AC17-1: bất động liên tục `>15s`, một P1 incident/alert           | Strict 15s unit và incident DB đạt; **không đạt toàn AC** vì gap/time/retry và live alert chưa chứng minh                        |
| AC17-2: đứng dậy trước 15s                                        | Unit tracker/coordinator đạt; live video acceptance còn Blocked                                                                  |
| AC17-3: REST_AREA suppress                                        | Polygon/enabled-zone unit đạt; **Failed** khi lookup lỗi; live REST scenario còn Blocked                                         |
| US-20 Mục 1: 09:00/18:00, no activity, IM_OK/timeout              | **Failed** do timezone, runtime alert/confirmation SQL. Unit boundary 299.999/300/300.001s đạt với double, không thay thế DB/E2E |
| US-20 Mục 1: skip-away đúng người; unknown/offline không suy AWAY | **Blocked/không nghiệm thu**: thiếu source adapter thật; observation validation/as-of đã có lỗi tái hiện                         |

## 5. Phần chưa thể kết luận

Chưa thực thi đầy đủ camera/video → Frigate/MQTT → pose → DB → media/SSE → Telegram/callback. Dataset cục bộ có file video nhưng chưa có bộ ground-truth với track/timestamp/checksum và split nghiệm thu theo plan; không lấy clip bất kỳ để báo precision/recall/FAR/p95. Không yêu cầu người dùng/người nhà thực hiện động tác ngã.

Chưa chứng minh MinIO/S3 thực tế, resident first delivery/callback với tài khoản Telegram test đã đồng ý, UI caregiver/resident wellness và nguồn M1 motion/direction. Lỗi SQL chặn pipeline wellness trước delivery; source/UI còn thiếu. Chín case phụ thuộc được ghi **Blocked**, không đổi thành Passed hoặc N/A.

Do đã có nhiều lỗi P0 đủ chặn merge, không tiếp tục các thử nghiệm crash/load/race toàn pipeline hoặc staging tốn công trước khi prerequisite được sửa. Những biến thể chưa chạy không được coi là đã bao phủ bằng một case unit/DB đã qua. Tác động tới mọi interleaving/concurrency chưa được chứng minh chỉ bằng một lần test concurrent thành công.

## 6. Quyết định và điều kiện kiểm thử lại

**Giữ nguyên cả `main` và hai nhánh tính năng trên remote. Không merge PR #28 hoặc #27.** Đây là kết quả của gate “không có lỗi”, không phải chờ xác nhận lại từ người dùng.

Sau khi sửa các lỗi trong DEFECTS, kiểm thử lại đúng feature heads mới, ghép candidate mới, chạy regression/quality/DB/HTTP; hoàn thiện source, delivery, UI, video/storage/SSE/Telegram acceptance và đóng các case Failed/Blocked bắt buộc. Chỉ khi đó mới đánh giá merge cả hai theo CI/review/protection của repository.
