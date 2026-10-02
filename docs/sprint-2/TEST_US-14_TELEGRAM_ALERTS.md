# Test US-14 — Telegram alerts và xác nhận

## Mục tiêu

Kiểm tra US-11 → US-13 → Telegram → confirmation → dashboard, cùng replay,
quyền truy cập, retry và phục hồi. Setup: [Runbook US-14](US14_TELEGRAM_DEV.md).

## Automated tests

```powershell
pnpm --filter @cam/orchestrator typecheck
pnpm --filter @cam/orchestrator exec jest --runInBand
pnpm --filter @cam/orchestrator test:integration -- --runInBand telegram-db.integration.spec.ts
pnpm --filter @cam/orchestrator test:integration -- --runInBand ai-results-db.integration.spec.ts
pnpm api:lint
```

PostgreSQL integration chạy trong testcontainer riêng, áp dụng toàn bộ migrations;
không sử dụng/reset database đang phục vụ camera. HTTP Telegram được thay bằng adapter test
để kiểm tra lỗi có kiểm soát và không gửi tin cho liên hệ thật.

| Nhóm          | Kỳ vọng                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| Webhook       | Secret sai bị chặn; DB ghi lỗi không ACK; ACK sau durable inbox                        |
| Identity      | Sai actor/chat/message/action/TTL hoặc ngoài scope camera không sửa event              |
| Confirmation  | IM_OK → RESOLVED; NEED_HELP → ESCALATED, một intent khẩn cấp                           |
| Replay        | Commit xong rồi crash trước inbox ACK: không tạo thêm confirmation/history             |
| Race          | Hai actor hoặc callback/deadline: một transition có hiệu lực                           |
| Cross-channel | Dashboard xác nhận trước: callback không ghi đè; edit dùng kết quả canonical           |
| Recovery      | Lease hết hạn được nhận lại, attempt không reset                                       |
| Edit          | Edit lỗi chỉ retry edit, không gửi lại alert; bỏ nút; replay “not modified” thành công |
| Delivery      | 4 attempts theo 2/4/8; FAILED không đổi deadline; engine vẫn escalation                |
| Linking       | Chỉ lưu hash token, xử lý link từ inbox sau ACK/restart                                |

## Kết quả kiểm chứng ngày 29/09/2026

Môi trường: Windows, Docker Desktop, nhánh `feat/US-14-telegram-alerts`,
SHA nền `4f28d9c` cùng thay đổi chưa commit trong working tree.

| Kiểm tra               | Kết quả thực tế                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:all`       | PASS, exit code 0; Prettier, lint, typecheck, tests, OpenAPI và AI checks đã chạy hết                                       |
| Orchestrator unit      | 43 suites / 304 tests PASS                                                                                                  |
| Web unit               | 26 files / 109 tests PASS                                                                                                   |
| Tools unit             | 109 tests PASS                                                                                                              |
| AI unit                | 31 tests PASS, coverage 94.34%                                                                                              |
| PostgreSQL integration | 41 tests PASS: Telegram 18 + US-11 23; DB thật trong container riêng, HTTP Telegram bằng adapter test                       |
| Migration local        | `0007_telegram_delivery.sql` và `0011_telegram_confirmation_delivery.sql` đã áp dụng bằng `pnpm db:migrate`; không reset DB |
| Docker smoke           | Orchestrator đã recreate và healthy; health HTTP 200; Swagger có hai route Telegram                                         |
| Route bảo vệ           | Link thiếu JWT trả 401; webhook thiếu secret trả 401                                                                        |
| Telegram thật          | Chưa chạy: bot token/webhook secret còn trống, chưa có webhook HTTPS được chỉ định                                          |

Lint/OpenAPI vẫn có warnings nhưng không có errors. Kết quả automated/smoke không
chứng minh gửi ảnh hoặc xác nhận trên Telegram thật. Sau khi commit cần ghi SHA mới;
nếu thay đổi logic thì chạy lại các kiểm tra liên quan.

## E2E thực tế — chưa nghiệm thu trong lần triển khai này

Không đánh dấu PASS chỉ dựa trên unit/integration. Dùng bot/chat test được chỉ định,
lưu commit SHA, môi trường, eventId, expected/actual và evidence đã che thông tin riêng tư.

| Ca     | Thao tác                                      | Kết quả cần ghi nhận                                      | Evidence  |
| ------ | --------------------------------------------- | --------------------------------------------------------- | --------- |
| E14-01 | Camera tạo UNKNOWN                            | Tin thật đúng ảnh/camera/zone/time, hai nút               | Chưa chạy |
| E14-02 | Camera tạo RESTRICTED_ZONE                    | Tin thật đi từ M4/US-11 qua rule US-13                    | Chưa chạy |
| E14-03 | Bấm Tôi ổn                                    | DB RESOLVED; dashboard cập nhật; tin có tên/giờ và bỏ nút | Chưa chạy |
| E14-04 | Event mới, bấm Cần giúp đỡ                    | ESCALATED; một intent khẩn cấp, không giả báo đã gọi      | Chưa chạy |
| E14-05 | Dashboard và Telegram cùng xác nhận           | Chỉ quyết định đầu hợp lệ thắng                           | Chưa chạy |
| E14-06 | Hai actor hợp lệ, hai notification cùng event | Một authoritative; cả tin được cập nhật                   | Chưa chạy |
| E14-07 | Chặn kết nối Telegram / restart               | Retry giữ ngân sách; deadline độc lập                     | Chưa chạy |
| E14-08 | Thiếu snapshot                                | Text fallback rõ lý do, hai nút vẫn hoạt động             | Chưa chạy |

Giới hạn hiện tại: người nhận tự động là owner camera; chưa có giao diện gán nhiều caregiver.
E14-06 cần hai notification hợp lệ được chuẩn bị trong môi trường test. Tin cũ thiếu metadata
chỉ bỏ nút. Telegram timeout có thể gửi trùng tin vật lý; callback chỉ chấp nhận message ID đã lưu.
