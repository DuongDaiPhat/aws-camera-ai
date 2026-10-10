# API change register — Sprint 3

> Source of truth: [`api/openapi.yaml`](../../api/openapi.yaml), [`api/openapi-ai-service.yaml`](../../api/openapi-ai-service.yaml). Repo dùng **openapi.yaml**, không tạo thêm openapi.yml. Mỗi story có một owner E2E/một AI Agent; phần shared có một người tích hợp tuần tự.

## Trạng thái chốt ngày 10/10/2026

Contract và DDL của **US-16, US-17, US-18, US-20 đã merge** qua [PR #24](https://github.com/DuongDaiPhat/aws-camera-ai/pull/24), merge commit `97765fc710aefd0d76c0572f7e74c86fa10efdca`. Hai spec và migrations 0013–0015 tại commit này là baseline dùng chung; không cần tạo lại PR contract giống hệt.

Đã kiểm chứng lại: OpenAPI lint hợp lệ (5 warnings đã ghi ở snapshot), regeneration từ cả hai spec, build/types của workspace, PostgreSQL 16 fresh install, upgrade từ schema đến 0012 có seed, re-run migration runner và invariants M2a/M3/M5. Không apply DB thật. Generated files được chuẩn hóa bằng formatter sau generate; không sửa types bằng tay. CI kiểm tra generated output không lệch source.

Các ghi chú `LOCAL_PREPARED`/`merge SHA pending` bên dưới là **snapshot lịch sử ngày 09/10**, đã được thay thế bởi trạng thái merge ở mục này. Hướng dẫn hiện hành: [shared gate handoff](SHARED_GATE_HANDOFF.md). Merge không xác nhận runtime detector/scheduler đã được implement hoặc story E2E đã đạt.

## 1. Reservation operation/schema

| Story                   | File/phần được reserve                                                                | Operation/schema                                                                                                                    | Trạng thái                                        |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| US-16/17 M2a            | AI `/pose/fall` và `Fall*`                                                            | `evaluateFall`, FallResponse/FallInferenceError                                                                                     | Local contract prepared; review/merge SHA pending |
| US-16/17 M2a            | Orchestrator callback M2a example/docs                                                | `FallResultMetadata`; generic union không đổi                                                                                       | Local contract prepared; review/merge SHA pending |
| US-18 M3                | AI `/fire/detect` và `Fire*`                                                          | `detectFire`, FireResponse/FireDetection/FireInferenceError                                                                         | Local contract prepared; review/merge SHA pending |
| US-18 M3                | Orchestrator callback M3 example/docs                                                 | `FireResultMetadata`; generic union không đổi                                                                                       | Local contract prepared; review/merge SHA pending |
| US-20 M5                | `/wellness-schedules*`, `/wellness-checks*`, `/internal/wellness-observations`        | `list/create/update/deleteWellnessSchedule`, `listWellnessChecks`, `confirmWellnessCheck`, `submitWellnessObservation`, `Wellness*` | Local contract prepared; review/merge SHA pending |
| Shared tích hợp tuần tự | AI overview, EventSummary M5 context optional, callback overview, generated contracts | Không đổi security/enums/common bbox/error/required event fields                                                                    | Đi cùng contract PR có A+B review                 |

`FallResultMetadata`/`FireResultMetadata` là schema tài liệu cho producer mới; generic `OtherAiResultItem.metadata` giữ shape hiện hữu. Lint có thể báo unused cho hai schema này; không sửa union chồng lấn để xóa warning. M5 scheduler không gọi inference hoặc generic AI callback.

## 2. Reservation migration

| File append-only                                                                       | Owner/phạm vi | Invariants chính                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [0013_fall_incidents.sql](../../db/migrations/0013_fall_incidents.sql)                 | US-16/17      | Confirmed episode unique, immutable pending result, lease/retry                                                             |
| [0014_fire_incidents.sql](../../db/migrations/0014_fire_incidents.sql)                 | US-18         | One active detector episode/camera; event resolution/restart không clear                                                    |
| [0015_wellness_check_runtime.sql](../../db/migrations/0015_wellness_check_runtime.sql) | US-20         | Scope/cursor/soft delete, observations/presence, occurrence unique, one active check/resident/hộ, immutable response window |

Người thêm DB migration khác lấy số tiếp theo sau rebase. Nếu số bị dùng trước merge, phối hợp đổi tên **file chưa apply/chưa merge** và cập nhật references; không sửa migration đã apply. Số 0007/0010 lịch sử đã trùng filename prefix, giữ nguyên.

## 3. Quy trình đóng contract

1. Base Git commit của phiên chuẩn bị: `865dc6e`. Local spec hash được ghi ở mục 4 sau kiểm tra; hash chưa thay thế merge commit/PR.
2. Một integrator merge contract PR trước feature; bắt buộc review A+B theo API_GUIDE/GIT_WORKFLOW. Điền PR URL, full merge SHA và owner người thực hiện vào reservation khi có thật; hiện chưa tạo PR.
3. Contributor API mới checkout/rebase commit đó, đăng ký namespace khác. Thay operation/schema shared phải coordinated contract PR trước code. Không copy spec từ branch cũ hoặc merge ours/theirs toàn file.
4. Generate cả hai types từ specs cuối, typecheck/build, chạy lint và kiểm tra examples/compatibility. Generated files không sửa tay; generate lần hai phải ổn định.
5. Có thay đổi đã frozen thì cập nhật register/hash bằng PR contract mới, xác định tương thích và chạy regression. Không tuyên bố “không thể conflict” chỉ nhờ đặt tên schema.

## 4. Local snapshot

Hashes SHA-256 của hai spec và pnpm lock được ghi sau lần kiểm tra cuối của phiên chuẩn bị. Trạng thái này là **LOCAL_PREPARED**, chưa MERGED_FROZEN; không có library/model/DB production được thay đổi tự động.

| Local file                                         | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `api/openapi.yaml`                                 | `60ecc1b5aedcca655d728642e443c2636cedabc32dc8ca0d2aa31f863f6240bb` |
| `api/openapi-ai-service.yaml`                      | `5c7673f228afef7326da088971ee354d2f9be040f78325f1f18f9c75efac9d33` |
| `pnpm-lock.yaml`                                   | `99cf285b961721d2e83ac3cc6029008e7518b12386d310ec54e01a3832554d6a` |
| `packages/contracts/src/generated/orchestrator.ts` | `0f12515d48c2fb47cdc3b5bbee658313a8a9368c8a570367cd47c76d0f2a45bf` |
| `packages/contracts/src/generated/ai-service.ts`   | `9111d68716383e08fc227f226228648a4f40e523fe9e49088f58ffc525fca5be` |
| `db/migrations/0013_fall_incidents.sql`            | `3965fe35533103720a98fb9a0234a8d79e0e524b746bb8b2faada15b631e7cb5` |
| `db/migrations/0014_fire_incidents.sql`            | `4503f9135f2637d86eff6e098f5eab133a933255e3900c045fd83f441ee953a0` |
| `db/migrations/0015_wellness_check_runtime.sql`    | `04b824356399ac1400c2e1b0ca19f003db30d0449f405d760d94ef1623dd7ee5` |

Local base full SHA: `865dc6e867d1df6b0b620def71ed47dc5ac0b55b`. Node thực chạy: `v22.20.0` (win32/x64).

Verification của snapshot:

- Hai spec lint hợp lệ; 5 warnings gồm health thiếu 4xx (hai spec), FaceSelectionDetails unused và hai metadata schema tài liệu Fall/Fire unused. Không thay generic union để che warnings.
- 26 ca JSON Schema/example đã qua, gồm M3 responses/callback metadata, departure conditional, PATCH validation và resident confirmation shape. Unrelated API paths/schemas, security/enums và generic callback wire shape đối chiếu HEAD không đổi.
- Regenerated hai types; contracts typecheck/build đạt. 26 unit tests hiện hữu thuộc escalation-policy, escalation-engine và events.controller đạt.
- Typecheck đầy đủ còn lỗi baseline ở repo: fresh compiler so với types HEAD có cùng bộ diagnostics (orchestrator 61, web 9), không thêm lỗi từ contracts mới. Không sửa mã hiện hữu ngoài scope để làm báo cáo xanh.
- DDL đã kiểm tra tĩnh (transaction, references, uniqueness/lease/snapshot và historical migration diff); ERD có 29 bảng. Docker PostgreSQL không khả dụng trong phiên này, chưa chạy fresh/upgrade/constraint/concurrency trên PostgreSQL 16, chưa apply DB thật.
- Generated output phải ổn định sau generate lần hai; format/diff/local links được kiểm tra trước bàn giao. Runtime/model/E2E của stories vẫn theo các gate trong plan.
