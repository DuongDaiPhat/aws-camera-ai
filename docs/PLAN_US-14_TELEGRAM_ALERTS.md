# Plan US-14 — Cảnh báo Telegram kèm ảnh và hai nút xác nhận

> Phần giao với US-13, shared notifications/outbox, media và identity tuân theo [kế hoạch tích hợp 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md).
> Trạng thái: kế hoạch thực thi, chưa triển khai hay gửi tin nhắn thật.
> Mục tiêu: gửi cảnh báo rõ ràng, nhận xác nhận đúng người, retry bền vững và không trì hoãn escalation.

## 1. Phạm vi và phụ thuộc

- Xử lý notification kênh TELEGRAM khi event chuyển NOTIFIED; gửi snapshot, hai inline buttons, callback, sửa tin nhắn và retry.
- [US-13](PLAN_US-13_ESCALATION_STATE_MACHINE.md) sở hữu state machine, deadline và confirmation transaction. Telegram chỉ gọi interface của engine, không tự UPDATE events.status.
- [US-11](PLAN_US-11_EVENT_AI_LABELS.md) cung cấp event projection; media hiện có cung cấp snapshot.
- Không triển khai SNS/Connect trong story này. Engine vẫn phải enqueue kênh khẩn cấp qua interface; khi thiếu adapter thật phải báo chưa cấu hình, không giả báo đã gọi.
- Nguồn chuẩn: [OpenAPI](../api/openapi.yaml), [schema](../db/migrations/0001_init.sql), [quy ước code](conventions/CODING_CONVENTION.md), [Git workflow](conventions/GIT_WORKFLOW.md).
- Đọc AGENTS.md nếu có, git status và module mới nhất trước khi code; không tạo notifications/outbox trùng với task khác.

## 2. Hiện trạng

- Đã có notifications, confirmations, event_status_history và audit_logs.
- notifications có attempt_count/max_attempts/next_retry_at/provider_message_id, nhưng mặc định max_attempts=3 và constraint attempt_count<=max_attempts.
- confirmations có unique partial index cho một is_authoritative=true trên mỗi event; các lần bấm sau có thể lưu is_authoritative=false.
- OpenAPI có `/webhooks/telegram` và `/events/{eventId}/confirm`; backend chưa triển khai.
- Env đã có TELEGRAM_BOT_TOKEN và TELEGRAM_WEBHOOK_SECRET.
- Chưa có Telegram sender, worker, retry scheduler hoặc mapping người bấm được xác minh.

## 3. Hợp đồng với engine

### Notification intent từ US-13

```text
notificationId, eventId, eventVersion, transitionId
recipientUserId / emergencyContactId
channel=TELEGRAM, escalationLevel
priority, createdAt, deliveryPolicy
```

Intent được lưu cùng transaction chuyển NOTIFIED và deadline. Unique key theo transition/recipient/channel/level ngăn tạo hai notification vì outbox replay. Retry là nhiều attempt trên cùng notification.

### Confirmation command vào US-13

```text
eventId, response=IM_OK|NEED_HELP
actorUserId, channel=TELEGRAM
notificationId, sourceMessageId, sourceUpdateId
```

- Actor lấy từ liên kết Telegram đã xác minh và authorization của server.
- `accepted` trả canonical Confirmation; `alreadyConfirmed` trả thông tin xác nhận trước; `forbidden`/`invalidState` không sửa event.
- Dashboard và Telegram phải gọi cùng service/transaction để quy tắc “lần đầu tiên” có hiệu lực xuyên kênh.
- Lỗi Telegram không được đổi NOTIFIED/ESCALATED về trạng thái khác, không reset/cancel deadline.

## 4. Nội dung và gửi ảnh

Mẫu nội dung tiếng Việt:

```text
Cảnh báo: Người không quen
Camera: Cửa chính
Khu vực: Lối vào
Thời gian: 14:32:10 23/09/2026 (Asia/Ho_Chi_Minh)

[Tôi ổn] [Cần giúp đỡ]
```

- Tên loại sự kiện dùng mapping thống nhất với dashboard.
- Tên camera/zone từ event snapshot hoặc dữ liệu đã đọc; zone null hiển thị “Không xác định”, không chèn undefined.
- Thời gian là detected_at chuyển theo timezone camera, không lấy timezone server.
- Dùng snapshot sự kiện, không dùng ảnh đăng ký người quen và không dùng crop face nhỏ.
- Đọc bytes từ storage nội bộ rồi upload multipart tới Telegram; tránh gửi URL MinIO nội bộ mà Telegram không truy cập được.
- Giới hạn caption/ảnh theo API, escape nội dung tên do người dùng đặt; không render Markdown/HTML tùy ý từ DB.
- Lưu chat_id và message_id cùng notification sau khi send thành công; message_id chỉ duy nhất trong từng chat.

Nếu snapshot chưa sẵn sàng, retry tải ảnh trong thời gian ngắn có cấu hình. Hết ngân sách ảnh thì gửi text với hai nút và dòng “Chưa lấy được ảnh”; ghi rõ degraded delivery. Không chờ ảnh vô hạn làm chậm hỗ trợ. Happy path vẫn phải chứng minh tin có ảnh đúng event.

## 5. Telegram adapter và webhook

Các API nền cần dùng: sendPhoto/sendMessage, answerCallbackQuery, editMessageCaption cho tin ảnh, editMessageText cho tin text, editMessageReplyMarkup để vô hiệu hóa nút. callback_data tối đa 64 bytes; webhook dùng secret header và trả lời callback để tắt trạng thái chờ trên Telegram. Chi tiết kiểm chứng khi triển khai tại [Telegram Bot API](https://core.telegram.org/bots/api).

### Callback data

- Dùng opaque token ngắn cùng mã action, ví dụ `cf:<token>:ok` hoặc `cf:<token>:help`.
- Token ánh xạ server-side tới event/notification/recipient và có thời hạn phù hợp lifecycle; lưu hash nếu token đóng vai trò bí mật.
- Không nhét JWT, tên, event payload hoặc secret vào callback_data.
- Không tin callback_data đơn lẻ: kiểm tra notification, chat, message, actor, action và trạng thái event.

### Xác minh người bấm

- Kiểm tra X-Telegram-Bot-Api-Secret-Token bằng constant-time comparison.
- Secret header chứng minh request từ webhook được cấu hình, không chứng minh người bấm có quyền với event.
- So callback_query.from.id với Telegram user ID đã liên kết account. Không dùng display name/username làm khóa danh tính.
- Nếu repo mới chỉ có telegram_chat_id, thêm telegram_user_id và luồng liên kết bằng one-time token qua dashboard đã đăng nhập → bot start/link → xác nhận server. Không suy đoán chat ID luôn là user ID.
- Có thể dùng mapping đã xác minh từ setup cho dev. Một liên kết chưa xác minh không được nhận quyền confirm trong production.
- Chỉ caregiver/admin có quyền với camera/owner liên quan được confirm. Group chat không tự cấp quyền cho mọi thành viên.

### Xử lý webhook bền vững

1. Validate secret, loại update, giới hạn body và trường bắt buộc.
2. Ghi inbox theo Telegram update_id/callback_query.id unique trước khi ACK 200.
3. Worker xử lý callback nhanh, kiểm tra actor và gọi confirmation service US-13.
4. Gọi answerCallbackQuery với kết quả phù hợp; không chờ network edit message mới quyết định event.
5. Xác nhận thắng: enqueue edit caption/text thành “Đã xác nhận bởi <tên> lúc <giờ>”, bỏ nút; tên lấy từ account server và giờ từ confirmation đã commit.
6. Đã xử lý: trả “Sự kiện đã được xử lý”, không ghi đè event hoặc confirmation đầu tiên.
7. Retry webhook cùng update ID không tạo thêm confirmation/audit. Người khác bấm mới tạo bản ghi không authoritative theo contract.
8. Edit tin thất bại chỉ retry edit, không rollback confirmation và không gửi lại cảnh báo mới.
9. Nếu cùng event có nhiều tin gửi tới nhiều caregiver, enqueue cập nhật các tin đã gửi; nút cũ chưa sửa vẫn bị server từ chối tác động lặp.

DB/inbox không ghi được → không trả ACK thành công để tránh mất callback. Update không liên quan sau xác thực có thể bỏ qua với 200. Không log nguyên body gồm thông tin cá nhân.

## 6. Retry và phục hồi

### Chốt nghĩa số lần thử

“Retry 3 lần, backoff 2s/4s/8s” = lần gửi ban đầu + 3 lần gửi lại = tối đa 4 attempts.

| Attempt | Khoảng chờ trước attempt |
| ------- | ------------------------ |
| 1       | Gửi ngay                 |
| 2       | 2 giây sau lỗi attempt 1 |
| 3       | 4 giây sau lỗi attempt 2 |
| 4       | 8 giây sau lỗi attempt 3 |

- Giữ attempt_count là tổng số attempt đã thực hiện; Telegram tạo row max_attempts=4. Không sửa default của kênh khác một cách ngầm định.
- Trong fixture giả lập lỗi tức thời, mốc là 0/2/6/14 giây. Với request chậm, backoff tính từ lúc attempt trước kết thúc.
- Lỗi transient/network/5xx áp dụng backoff. Telegram 429 tôn trọng retry_after lớn hơn backoff; không retry sớm hơn chỉ để giữ lịch 2/4/8.
- Lỗi vĩnh viễn như token không hợp lệ hoặc bot bị chặn có thể FAILED ngay với reason rõ; không gọi lặp chắc chắn thất bại.
- Sau attempt cuối thất bại: status=FAILED, failed_at có giá trị, next_retry_at=null.
- Attempt lỗi còn được thử lại: status=FAILED, next_retry_at!=null; đúng partial index hiện có. Dashboard phân biệt “Đang chờ thử lại” và “Đã thất bại”.
- Worker claim bằng lease/lock, tăng attempt atomically. Không giữ DB lock trong HTTP call, không sleep cả process giữa attempts.
- Restart khôi phục hàng đợi từ next_retry_at/lease hết hạn; không đặt attempt_count về 0.
- Trước gửi/retry, đọc trạng thái canonical: event RESOLVED/CLOSED thì dừng alert cũ và đánh dấu SKIPPED; khi ESCALATED, không để retry caregiver cũ chặn kênh khẩn cấp.
- Deadline engine chạy độc lập ngay từ transaction NOTIFIED, kể cả Telegram chưa gửi thành công.

### Giới hạn chống gửi trùng

DB dedup bảo đảm một notification intent, không bảo đảm exactly-once từ phía Telegram khi request timeout sau khi Telegram đã nhận ảnh. Ghi attempt có outcome không chắc chắn, retry có giới hạn; nếu xuất hiện hai tin, cả hai callback vẫn trỏ về một event và chỉ một quyết định có hiệu lực. Không tuyên bố đã giải quyết hoàn toàn send duplication bằng unique index.

## 7. Database và contract

- Tái sử dụng notifications; thêm provider_chat_id hoặc metadata có schema, delivery key unique, lease token/until và attempt trace nếu cần.
- Tạo inbox update unique và mapping callback token. Dùng cùng outbox/lease infrastructure với US-13 khi đã có.
- Xác minh telegram_user_id bằng migration mới; giữ chat ID như chuỗi hoặc kiểu đủ lớn để tránh mất độ chính xác.
- confirmations và phase đóng khẩn cấp do US-13 sở hữu; không tạo unique constraint thứ hai xung đột.
- Cập nhật `/webhooks/telegram` trong OpenAPI: mô tả header auth, idempotency, status codes. Route bypass JWT phải có guard webhook riêng.
- `/events/{eventId}/confirm` vẫn giữ 409 ALREADY_CONFIRMED; webhook chuyển kết quả đó thành thông báo và ACK 200, không bắt Telegram retry mãi.
- Endpoint liên kết Telegram nếu phải bổ sung cần contract-first, role/TTL/rate-limit rõ; không tự mở route nhận arbitrary userId.
- Cập nhật Notification response nếu cần delivery stage; generated types và ERD cùng PR.

## 8. Cấu trúc và công việc triển khai

```text
apps/orchestrator/src/notifications/
  notifications.module.ts
  notifications.repository.ts
  notification-dispatcher.service.ts
  notification-retry-worker.service.ts
  notification-channel.interface.ts
  telegram/
    telegram.adapter.ts
    telegram-message-builder.ts
    telegram-webhook.controller.ts
    telegram-webhook.guard.ts
    telegram-callback.service.ts
    dto/
```

- Adapter HTTP qua interface, mock được; log dùng Logger/correlationId.
- Tái sử dụng storage interface để lấy snapshot, event service để đọc thông tin canonical.
- UI không cần trang mới: event detail thể hiện SENT/FAILED/CONFIRMED, số attempt và người xác nhận nếu đã có component tương ứng.
- Env hiện có cho token/secret; thêm timeout, retry delays, retry count, media wait, public webhook base URL và worker polling/lease qua ConfigService. Secret không có default giả.
- Runbook setup bot/webhook HTTPS, test chat, mapping user và kiểm tra delivery; không tự gửi tin thật hoặc đăng ký webhook trong quá trình chỉ viết code khi chưa có môi trường test được chỉ định.

## 9. Kiểm thử

| Trường hợp                                     | Kết quả                                                     |
| ---------------------------------------------- | ----------------------------------------------------------- |
| NOTIFIED + Telegram enabled + snapshot         | Đúng loại/camera/zone/time/ảnh và hai nút                   |
| Zone null/tên chứa ký tự markup                | Nội dung hợp lệ, không injection                            |
| MinIO URL nội bộ                               | Adapter gửi bytes, Telegram không phải truy cập mạng nội bộ |
| IM_OK / NEED_HELP lần đầu                      | Engine RESOLVED / ESCALATED, message được sửa               |
| Hai caregiver bấm đồng thời                    | Một authoritative confirmation, người sau nhận đã xử lý     |
| Callback và timer chạy đồng thời               | Đúng policy US-13, không hai transition xung đột            |
| Webhook thiếu/sai secret hoặc actor trái quyền | Không thay event                                            |
| Replay update/callback                         | Không thêm side effect; ACK phù hợp                         |
| 4 attempts đều lỗi transient                   | Chờ 2/4/8, FAILED terminal; engine vẫn hết hạn đúng lúc     |
| Restart giữa attempt/backoff                   | Tiếp tục từ DB, không reset budget                          |
| Edit caption lỗi sau confirm                   | Event giữ kết quả, chỉ retry edit                           |
| Event đã xử lý trước retry send                | SKIPPED, không gửi cảnh báo cũ                              |
| Telegram timeout không chắc đã gửi             | Outcome được ghi, không duplicate quyết định                |

Unit dùng fake clock/HTTP adapter; integration dùng PostgreSQL để chứng minh inbox/dedup/race. E2E dùng bot/chat test được chỉ định, chụp tin thật kèm ảnh và log 2 nút, test ngắt Telegram nhưng deadline vẫn chạy. Không gọi liên hệ thật trong automated tests.

## 10. Trình tự, Git và Definition of Done

1. Chốt interface confirmation/outbox với US-13; chỉ dùng adapter giả cho phần chưa có, không ghi hoàn thành E2E.
2. Contract/migration → message builder/sender → retry worker → webhook/auth/linking → confirmation/edit worker → E2E.
3. Nhánh ví dụ `feat/US-14-telegram-alerts`; commit tiếng Việt theo scope: `feat(orchestrator): gửi cảnh báo Telegram kèm xác nhận`.
4. Chạy `pnpm api:lint`, `pnpm contracts:generate`, `pnpm --filter @cam/orchestrator test`, `pnpm check:all` và Docker smoke test.
5. PR theo template, không log secret/chat cá nhân trong evidence; A/B review khi sửa API, ít nhất một người khác approve, không tự merge và squash theo workflow.

- [ ] Happy path gửi ảnh và đủ nội dung/hai nút.
- [ ] Actor được xác minh, callback có secret và authorization theo event.
- [ ] Một lần xác nhận có hiệu lực xuyên Telegram/dashboard; tin sửa theo dữ liệu đã commit.
- [ ] Retry ban đầu + 3 lần, backoff 2/4/8, recovery sau restart.
- [ ] Lỗi gửi/edit không reset hoặc dừng deadline escalation.
- [ ] Snapshot unavailable, duplicate webhook, concurrent callbacks và ambiguous send được kiểm thử.
- [ ] Contract, migration/ERD, env, runbook và tests hoàn tất.
