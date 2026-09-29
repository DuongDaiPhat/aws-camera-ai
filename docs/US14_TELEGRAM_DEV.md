# US-14 · Chạy cảnh báo và xác nhận Telegram

Hướng dẫn từng bước cho người dùng/dev local, gồm kết nối bot và chỉnh thời gian chờ:
[Kết nối và sử dụng Telegram](HUONG_DAN_KET_NOI_SU_DUNG_TELEGRAM.md).

Sender đọc notification intent của US-13. Webhook xác thực secret, ghi inbox rồi ACK 200;
worker xử lý link/callback, gọi `confirmInitial()` và phát `event.updated` sau commit.
Worker edit reconcile từ confirmation INITIAL đã commit, nên xác nhận trên dashboard cũng
cập nhật các tin Telegram đã gửi. Telegram không tự UPDATE trạng thái event.

## Chuẩn bị môi trường test

1. Kiểm tra lịch sử migration bằng `node --env-file=.env tools/scripts/migrate.mjs status`.
   Chạy `pnpm db:migrate` để áp dụng migration còn thiếu, gồm
   `0011_telegram_confirmation_delivery.sql`. Không dùng `db:reset` trên DB cần giữ dữ liệu.
   Nếu báo cột đã tồn tại, kiểm tra `schema_migrations` trước khi chạy tiếp.
2. Dùng bot/chat riêng cho test. Điền `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
   trong `.env` local. Đặt `TELEGRAM_ENABLED=true` khi đã sẵn sàng gửi tin thật.
3. Đăng ký webhook **HTTPS công khai** tới `/api/v1/webhooks/telegram` bằng `setWebhook`,
   truyền `secret_token` trùng `TELEGRAM_WEBHOOK_SECRET`. Telegram không truy cập được localhost.
   Chỉ đăng ký trên bot test được chỉ định. Không ghi token/chat cá nhân vào log, PR hoặc evidence.
4. Recreate orchestrator để nạp env mới. Nếu dùng image không mount source,
   build image mới trước khi chạy. Chờ endpoint health hoạt động.
5. Đăng nhập bằng tài khoản nhận cảnh báo (owner của camera, role CAREGIVER hoặc ADMIN).
   Dùng access token gọi `POST /api/v1/auth/telegram/link`; gửi `/start <linkToken>` trong
   private chat với bot. Token một lần hết hạn sau 10 phút. Chờ bot trả “Đã liên kết”.
   Không tự gán `telegram_linked_at` để giả xác minh user production.

API gửi ảnh, sửa tin và webhook: [Telegram Bot API](https://core.telegram.org/bots/api).
Ảnh được upload bằng bytes từ storage; Telegram không phải truy cập URL MinIO nội bộ.

### Phần môi trường local đã chuẩn bị

Ngày 29/09/2026 đã áp dụng hai migration Telegram và recreate orchestrator.
Health trả 200, Swagger có `/api/v1/auth/telegram/link` và `/api/v1/webhooks/telegram`;
gọi thiếu JWT/secret đều trả 401. `pnpm check:all` đã PASS.
Chi tiết tại [test guide](TEST_US-14_TELEGRAM_ALERTS.md#kết-quả-kiểm-chứng-ngày-29092026).

Còn cần thông tin môi trường để chạy bot thật:

1. Tạo/chọn bot test bằng [BotFather](https://t.me/BotFather), điền token và
   webhook secret vào `.env` local. Secret dùng các ký tự chữ/số/`_`/`-`;
   đặt `TELEGRAM_ENABLED=true`. Không gửi secret vào PR/chat.
2. Tạo URL HTTPS công khai trỏ tới port 3001. Máy local đã có ngrok; nếu đã cấu hình
   tài khoản ngrok, chạy `ngrok http 3001` ở terminal riêng và giữ terminal đó mở.
   Ghi lại forwarding URL; webhook đầy đủ là `<URL_HTTPS>/api/v1/webhooks/telegram`.
3. Chỉ định bot/chat test và đăng ký webhook cho bot đó bằng `setWebhook`, có
   `secret_token` và `allowed_updates=["message","callback_query"]`. Giữ pending
   updates để không làm mất callbacks đang chờ. Kiểm tra URL và lỗi giao nhận bằng
   [`getWebhookInfo`](https://core.telegram.org/bots/api#getwebhookinfo).
4. Chạy `docker compose up -d --no-deps --force-recreate orchestrator` sau khi đổi
   `.env`, rồi liên kết tài khoản theo bước 5 phía trên. Một dòng env thay đổi không
   tự cập nhật environment của container đang chạy.
5. Bắt đầu E14-01 bằng camera thật. Gửi lời xác nhận đã nhận tin/bấm nút cùng eventId
   để đối chiếu notification, inbox, confirmation và trạng thái canonical trong DB.

Không đánh dấu story Done khi mới cấu hình bot hoặc health đã xanh.

## Cấu hình

Các giá trị mẫu nằm trong `.env.example`:

| Biến                          | Mặc định | Ý nghĩa                                                       |
| ----------------------------- | -------- | ------------------------------------------------------------- |
| TELEGRAM_RETRY_DELAYS_SECONDS | 2,4,8    | Ban đầu + 3 retry = 4 attempts gửi alert                      |
| TELEGRAM_CALLBACK_TTL_SECONDS | 86400    | Thời hạn nút từ sent_at; engine vẫn kiểm tra trạng thái event |
| TELEGRAM_WORK_POLL_MS         | 1000     | Chu kỳ worker inbox/edit                                      |
| TELEGRAM_WORK_LEASE_SECONDS   | 30       | Thời gian claim một job                                       |
| TELEGRAM_WORK_MAX_ATTEMPTS    | 8        | Ngân sách inbox/edit, độc lập ngân sách gửi alert             |
| TELEGRAM_WORK_BATCH_SIZE      | 20       | Số inbox/edit tối đa mỗi lượt                                 |

`TELEGRAM_TIMEOUT_MS`, `TELEGRAM_POLL_MS`, `TELEGRAM_LEASE_SECONDS`,
`TELEGRAM_BATCH_SIZE`, `TELEGRAM_MEDIA_WAIT_MS` tiếp tục điều khiển sender.
Lỗi 429 tôn trọng `retry_after`; lỗi vĩnh viễn dừng sớm. Thiếu ảnh sau ngân sách chờ
sẽ gửi text có hai nút và “Chưa lấy được ảnh”.

## Kiểm tra luồng thật

1. Tạo event UNKNOWN hoặc RESTRICTED_ZONE bằng camera/Frigate thật.
2. Kiểm tra US-13 chuyển NOTIFIED và tạo notification TELEGRAM đúng người nhận.
   Hiện engine mặc định gửi cho owner camera; chưa có màn hình cấu hình nhóm nhiều caregiver.
3. Nhận tin đúng ảnh/camera/zone/thời gian cùng hai nút.
4. Bấm “Tôi ổn”: event về RESOLVED, dashboard cập nhật; tin được sửa kèm tên/thời gian và bỏ nút.
5. Tạo event mới rồi bấm “Cần giúp đỡ”: event ESCALATED, tạo intent khẩn cấp.
   Intent CONNECT_CALL chưa đồng nghĩa đã gọi điện thành công; adapter khẩn cấp ngoài US-14.
6. Thử dashboard xác nhận trước, callback lặp và actor không đúng người nhận.
   Chỉ một quyết định INITIAL có hiệu lực; bấm sau không ghi đè quyết định đầu.
7. Thử Telegram lỗi và restart ở môi trường test; xác nhận deadline vẫn chạy.

## Truy vấn kiểm chứng

```sql
SELECT id, event_id, status, attempt_count, max_attempts, next_retry_at,
       provider_chat_id, provider_message_id, telegram_message_kind, error_code
FROM notifications WHERE channel = 'TELEGRAM' ORDER BY created_at DESC LIMIT 20;

SELECT update_id, status, attempt_count, outcome, last_error, processed_at
FROM telegram_webhook_inbox ORDER BY created_at DESC LIMIT 20;

SELECT event_id, notification_id, channel, response, is_authoritative,
       source_message_id, source_update_id, responded_at
FROM confirmations ORDER BY responded_at DESC LIMIT 20;

SELECT notification_id, status, attempt_count, available_at, last_error
FROM telegram_message_edits ORDER BY created_at DESC LIMIT 20;
```

`FAILED` có `next_retry_at` là alert đang đợi retry; NULL là đã dừng.
Inbox/edit `FAILED` là hết ngân sách hoặc lỗi vĩnh viễn: cần kiểm tra nguyên nhân,
không reset confirmation. Notification `CONFIRMED` được đặt khi edit đã được ACK.
Tin cũ trước migration thiếu loại nội dung chỉ được bỏ nút; tin mới lưu caption/text để edit.

## Phạm vi và giới hạn

- Actor phải có Telegram user ID đã liên kết, đúng recipient, role và owner/admin,
  đúng chat/message, TTL và trạng thái canonical. UUID callback chỉ là định danh,
  không phải credential. Chia sẻ nút vào chat khác không cấp quyền.
- Hai notification tới hai actor có quyền cùng event được serialize qua lock US-13;
  schema chưa có quan hệ caregiver–camera để tự suy ra người nhận ngoài owner/admin.
- HTTP timeout sau khi Telegram nhận tin vẫn có thể gây hai tin vật lý khi retry;
  không cam kết exactly-once send. Callback phải khớp message ID đã lưu; tin không có
  message ID được xác nhận trong DB không được phép tác động event.
- E2E bot/chat thật cần ghi riêng theo [test guide](TEST_US-14_TELEGRAM_ALERTS.md).
  Adapter giả lập trong automated tests không thay thế nghiệm thu Telegram thật.
