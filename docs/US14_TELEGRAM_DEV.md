# US-14 · Trạng thái triển khai và cách chạy phần gửi cảnh báo

Phần hiện có trên nhánh `feat/US-14-telegram-alerts` là sender/retry worker. Luồng callback xác nhận cần confirmation service của US-13 và chưa được nối; không dùng nhánh này để demo xác nhận Telegram hoàn chỉnh.

## Hợp đồng với US-13

Trong cùng transaction chuyển event sang `NOTIFIED` và lưu deadline, US-13 cần ghi một row `notifications` cho từng người nhận, `channel='TELEGRAM'`, `status='PENDING'`, `max_attempts=4`, `recipient_user_id` hợp lệ và `event_id` tương ứng. Worker US-14 đọc row đó, không tự thay đổi `events.status` hoặc deadline. US-13 cần đảm bảo uniqueness theo transition/recipient/channel/level khi ghi intent; schema `notifications` hiện chưa có `transition_id` nên phải thống nhất migration đó trước khi E2E.

Sender lấy tên camera/zone, `detected_at`, timezone và snapshot từ event cùng media đã lưu. Nếu ảnh chưa có hoặc storage lỗi sau một lần đợi ngắn, worker gửi text ghi “Chưa lấy được ảnh”. Ảnh được đọc thành bytes từ MinIO/S3 rồi upload multipart; không chuyển URL nội bộ cho Telegram. Hai nút chứa mã notification để chuẩn bị cho callback sau khi US-13 cung cấp confirmation service.

## Cấu hình và kiểm tra

1. Chạy migration bằng `pnpm db:migrate` trước khi bật worker. Không dùng `db:reset` trên DB có dữ liệu cần giữ.
2. Điền `TELEGRAM_BOT_TOKEN` trong `.env` cục bộ, dùng bot/chat thử nghiệm. Đặt `TELEGRAM_ENABLED=true` khi đã sẵn sàng gửi tin thật. Mặc định là `false`.
3. Người nhận phải có `telegram_chat_id`, `telegram_user_id`, `telegram_linked_at` đã được xác minh trên server và `is_active=true`. Đăng nhập vào Dashboard, dùng access token để gọi `POST /api/v1/auth/telegram/link`, rồi gửi `/start <linkToken>` trong private chat với bot; mã hết hạn sau 10 phút. Bot phải được đăng ký webhook HTTPS trỏ tới `/api/v1/webhooks/telegram` với `TELEGRAM_WEBHOOK_SECRET` qua `setWebhook`. Không tự gán `telegram_linked_at` cho user production.
4. Chạy `pnpm --filter @cam/orchestrator test`, `pnpm --filter @cam/orchestrator typecheck`, rồi khởi động orchestrator.
5. Khi US-13 đã tạo notification intent, xem kết quả bằng SQL:

```sql
SELECT id, event_id, channel, status, attempt_count, max_attempts,
       next_retry_at, provider_chat_id, provider_message_id, error_code
FROM notifications
WHERE channel = 'TELEGRAM'
ORDER BY created_at DESC
LIMIT 20;
```

`SENT` có cả chat ID và message ID; `FAILED` kèm `next_retry_at` là đang chờ thử lại; `FAILED` với `next_retry_at=NULL` là thất bại cuối cùng. Lịch 4 attempts là gửi ngay, sau đó chờ 2/4/8 giây tính từ lúc mỗi attempt kết thúc. Telegram 429 dùng `retry_after` nếu lâu hơn. Event đã rời `NOTIFIED` sẽ được `SKIPPED` trước khi gửi.

## Việc còn lại để đạt DoD US-14

- Callback từ inbox vào confirmation service US-13, xác minh quyền người bấm theo event, trả lời callback và sửa tin sau khi transaction commit. Hiện webhook trả 503 cho callback để Telegram thử lại, đồng thời giữ update ở inbox. Không bật bot phục vụ người dùng thật cho tới khi bước này hoàn tất.
- Edit retry riêng, contract OpenAPI, kiểm thử PostgreSQL race/restart, và smoke test bot/chat thật. Không kết luận US-14 hoàn thành chỉ từ unit test sender.
