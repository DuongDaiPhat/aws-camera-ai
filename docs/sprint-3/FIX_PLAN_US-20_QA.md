# Kế hoạch sửa US-20 sau kiểm thử ngày 18/10/2026

## Phạm vi và baseline

Thực hiện trên `fix/US-20-wellness-check`, bắt đầu từ `feat/US-20-wellness-check` commit `872a895`. Giữ nguyên working tree người dùng ở `docs/testing`. Một AI thực hiện, không chia subagent theo plan E2E. Không sửa các lỗi M2a hoặc merge main trong đợt sửa riêng US-20 này.

Nguồn: `PLAN_US-20_WELLNESS_CHECK_E2E.md`, OpenAPI/generated contracts, migrations và bảng QA `docs/test/US16_US17_US20_2026-10-18` ở checkout gốc. US-20 có 24 case: 16 Failed, 4 Blocked, 4 Passed. Giữ lịch sử QA cũ; kết quả retest ghi riêng, đúng schema 16 cột.

## Thứ tự triển khai

| Bước                    | Lỗi/case truy vết                            | Thay đổi và tiêu chí kiểm chứng                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Runtime và thời gian | M5-01/02/03/10/11; TC001-004,012,013,018,021 | Sửa SQL typed parameters; occurrence/cursor/timezone/DST bằng PostgreSQL16; admission flag, lease/retry và snapshot. Thực thi no-activity→event/intents và confirmation trên DB thật                                                                                              |
| 2. Quyền và bằng chứng  | M5-04/05/06/07; TC008-010,016,017,022        | Active face household link, owner camera scope, merged PATCH validation; xác minh identity event/track/session, direction và age/skew; canonical hash; ledger/presence transaction/as-of; confirmation state/idempotency/lock order                                               |
| 3. Gửi và xác nhận      | M5-08/09, GAP02; TC014-018,020,021           | Chỉ ghi firstSent sau provider dispatch thành công; resident explicit/camera-less; deadline firstSent+snapshot300, 60s delivery failure; caregiver/emergency routing; Telegram callback riêng M5 với recipient/chat/message/TTL; outbox/SSE và loại M5 khỏi generic deadline path |
| 4. Kết nối M1/Frigate   | GAP01; TC019,022                             | Association đúng owner/camera/session/track từ M1 KNOWN; motion chỉ từ metadata nguồn, TTL; direction từ boundary inside/outside có config; không suy AWAY do mất track. Fixture đi qua production adapter/wiring, kiểm thử người khác, face-only, restart, out-of-order          |
| 5. API và UI            | M5-12/13, GAP03; TC006,007,023               | CamelCase generated contract, observation202, days/timezone/PATCH validation; caregiver CRUD/history và resident pending requests/IM_OK/NEED_HELP; loading/empty/error, scope và refresh/SSE theo UI hiện có                                                                      |
| 6. Retest và báo cáo    | Toàn bộ TC001-024                            | Unit/module + real Postgres16 + local HTTP provider/callback + UI/browser; regression auth/notifications/M1/MQTT/web; typecheck/lint/format/API/contracts. Lưu logs/commands/revision và bảng retest; không gán Passed nếu chỉ thay bằng mock hoặc chưa chạy                      |

## Nguyên tắc triển khai

- Không đổi expected result để hợp thức hóa bug. Có thể sửa fixture/mocks lỗi thời để phản ánh điều kiện an toàn thực tế; ghi rõ thay đổi và giữ assertions nghiệp vụ.
- Không thêm runtime dependency; giữ pnpm/Python locks và spec freeze. Nếu phải thay schema, thêm migration mới, không sửa migration lịch sử. Thay contract phải cập nhật spec trước và regenerate.
- PostgreSQL disposable riêng; không dùng `.env` chứa secrets hoặc reset volume thật. Telegram dùng server/provider test cục bộ, không gửi người thật. Phân biệt kiểm chứng adapter HTTP thật với staging Telegram thật.
- Không dùng broadcast caregiver/ghi DB như bằng chứng resident đã nhận. Không lấy face match đơn lẻ làm motion; không giữ nhận diện qua đổi session/TTL. Không ghi image/embedding/token trong observations.
- Feature flag mặc định off, nhưng delivery/deadline đã persist phải tiếp tục khi tắt admission.

## Điều kiện hoàn thành

Các lỗi M5-01..13 được sửa và có regression; TC019/020/022/023 có đường production thực thi và bằng chứng thích hợp, không chỉ đổi nhãn Blocked. Các suite cũ và quality gates đạt. Bảng retest truy vết đúng từng case và ghi giới hạn external staging nếu chưa có bằng chứng. Đợt này không đủ căn cứ merge cả hai feature vì lỗi pose/fall ngoài phạm vi vẫn còn.

## Kết quả thực thi

Đã hoàn thành6 bước trên trong ngày18/10/2026, tiếp tục sau khi phiên bị gián đoạn vì usage limit. [Báo cáo retest](../test/US20_FIX_2026-10-18/REPORT.md) ghi24/24 case US20 đạt trong phạm vi cục bộ; unit/module365, Web196; snapshot ghép thử395 unit/module và87 integration, gồm25 ca US20. Production build, migration fresh/upgrade/replay và các quality gates đã kiểm chứng. Nhánh sửa có commit production `ba13844`; snapshot ghép thử riêng `e36eee7`, không thay main. Camera/Telegram staging và các lỗi pose/fall cũ không được tuyên bố đã nghiệm thu/sửa trong đợt này.
