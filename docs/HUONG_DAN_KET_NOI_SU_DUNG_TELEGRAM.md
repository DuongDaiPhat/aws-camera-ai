# Hướng dẫn kết nối và sử dụng Telegram trong CameraAI

Hướng dẫn cho môi trường local Windows/PowerShell, chạy lệnh tại thư mục gốc dự án.
Port mẫu là orchestrator `3001`, dashboard `3000`; điều chỉnh nếu `.env` dùng port khác.
Runbook kỹ thuật: [US14_TELEGRAM_DEV.md](US14_TELEGRAM_DEV.md).

## 1. Luồng hoạt động

Camera/Frigate tạo sự kiện → US-11 lưu kết quả AI → US-13 đánh giá rule → US-14 gửi
ảnh/cảnh báo Telegram → người nhận xác nhận trên Telegram hoặc dashboard.

Bot không phải tài khoản Telegram cá nhân. Bạn tạo bot bằng BotFather, sau đó liên kết
tài khoản CameraAI với private chat Telegram của mình. Hiện người nhận tự động là owner
của camera; liên kết tài khoản khác không làm người đó tự nhận cảnh báo mọi camera.

## 2. Tạo bot và cấu hình `.env`

1. Mở [BotFather chính thức](https://t.me/BotFather), kiểm tra đúng username và dấu xác minh.
2. Gửi `/newbot`, đặt tên và username kết thúc bằng `bot`.
3. Lưu token BotFather cấp vào `.env` local. **Không gửi token vào chat, ảnh chụp, PR hoặc Git.**
   Nếu đã lộ, dùng `/revoke` với BotFather để thay token, rồi cập nhật `.env`.
4. Tạo webhook secret riêng, không dùng bot token làm secret. Có thể tạo bằng:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Điền các giá trị thật vào đúng một dòng cho mỗi key (không giữ dấu `< >`):

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<token-mới-từ-BotFather>
TELEGRAM_WEBHOOK_SECRET=<secret-ngẫu-nhiên>
```

Secret dùng chữ, số, `_` hoặc `-`; hướng dẫn này chọn chuỗi hex 64 ký tự.
Telegram kiểm tra secret qua header webhook, theo [setWebhook](https://core.telegram.org/bots/api#setwebhook).
Không commit `.env`; chỉ `.env.example` chứa giá trị mẫu.

## 3. Chuẩn bị dịch vụ

```powershell
node --env-file=.env tools/scripts/migrate.mjs status
pnpm db:migrate
docker compose up -d --no-deps --force-recreate orchestrator
docker compose ps
curl.exe http://localhost:3001/api/v1/health
```

Các lệnh trên giả định PostgreSQL và các dịch vụ nền đã chạy. Nếu chưa, chạy
`docker compose up -d` trước. Khi chưa có image hoặc image cũ không mount source,
build các service liên quan trước. **Không dùng `pnpm db:reset` để sửa kết nối Telegram**:
lệnh này xóa dữ liệu. Nếu health chưa trả 200, kiểm tra `docker compose logs --tail=100 orchestrator`.

Đổi `.env` cần **recreate** container; `docker compose restart` không nạp env mới.

## 4. Mở HTTPS và đăng ký webhook

Telegram cần gọi vào backend để nhận `/start` và thao tác bấm nút. Localhost không
truy cập được từ Telegram. Dùng tunnel đã cài/cấu hình trên máy:

```powershell
ngrok http 3001
```

Giữ terminal này mở. Lấy URL HTTPS ngrok hiển thị, ví dụ `https://your-domain.ngrok-free.dev`.
Tunnel công khai backend, vì vậy phải giữ JWT/webhook guard, không tắt xác thực để test.

Trong terminal PowerShell thứ hai, đọc riêng hai secret từ `.env`, không in chúng:

```powershell
$telegramConfig = @{}
foreach ($line in Get-Content -LiteralPath .env) {
    if ($line -match '^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)\s*=(.*)$') {
        $telegramConfig[$Matches[1]] = $Matches[2].Trim().Trim([char]34).Trim([char]39)
    }
}
if (-not $telegramConfig.TELEGRAM_BOT_TOKEN -or -not $telegramConfig.TELEGRAM_WEBHOOK_SECRET) {
    throw 'Chưa điền bot token hoặc webhook secret trong .env.'
}
$telegramApi = 'https://api.telegram.org/bot' + $telegramConfig.TELEGRAM_BOT_TOKEN
$publicUrl = (Read-Host 'Nhập URL HTTPS của tunnel, không có đường dẫn').TrimEnd('/')
if ($publicUrl -notmatch '^https://[^/]+$') { throw 'Cần URL HTTPS, chỉ gồm tên miền.' }
$webhookUrl = "$publicUrl/api/v1/webhooks/telegram"

try {
    $botInfo = Invoke-RestMethod -Uri "$telegramApi/getMe" -TimeoutSec 15
    $before = Invoke-RestMethod -Uri "$telegramApi/getWebhookInfo" -TimeoutSec 15
    if (-not $botInfo.ok -or -not $before.ok) { throw 'Telegram API thất bại.' }
} catch {
    throw 'Không kiểm tra được bot/webhook. Kiểm tra token và mạng; không chia sẻ URL có token.'
}
$botUsername = $botInfo.result.username
Write-Host "Bot: @$botUsername"
Write-Host "Webhook hiện tại: $($before.result.url)"
if ($before.result.url -and $before.result.url -ne $webhookUrl) {
    $approval = Read-Host 'Webhook khác đang được dùng. Chỉ thay nếu đây là bot test của bạn; nhập DOI để tiếp tục'
    if ($approval -cne 'DOI') { throw 'Đã dừng, chưa thay webhook.' }
}

$webhookBody = @{
    url = $webhookUrl
    secret_token = $telegramConfig.TELEGRAM_WEBHOOK_SECRET
    allowed_updates = @('message', 'callback_query')
    drop_pending_updates = $false
} | ConvertTo-Json
try {
    $registered = Invoke-RestMethod -Method Post -Uri "$telegramApi/setWebhook" `
        -ContentType 'application/json' -Body $webhookBody -TimeoutSec 15
    if (-not $registered.ok) { throw 'Đăng ký thất bại.' }
    $webhookInfo = Invoke-RestMethod -Uri "$telegramApi/getWebhookInfo" -TimeoutSec 15
    [pscustomobject]@{
        Registered = $registered.ok
        Url = $webhookInfo.result.url
        PendingUpdates = $webhookInfo.result.pending_update_count
        HasDeliveryError = [bool]$webhookInfo.result.last_error_message
    }
} catch {
    throw 'Không đăng ký/kiểm tra được webhook. Kiểm tra backend, HTTPS, secret và mạng.'
}
```

Kỳ vọng `Registered=True`, URL đúng, không có lỗi giao nhận mới. Pending updates cần
giảm sau khi backend xử lý. Khi tunnel đổi URL, đăng ký lại webhook; không cần liên kết
user lại chỉ vì URL thay đổi. Không dùng `getUpdates` polling song song với webhook.
Tham khảo [getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo).

## 5. Liên kết người nhận cảnh báo

Đăng nhập **tài khoản CameraAI owner của camera**, role ADMIN hoặc CAREGIVER.
Đoạn dưới hỏi mật khẩu thay vì ghi mật khẩu vào command history; chạy trong terminal
ở bước 4 để dùng `$botUsername` đã xác minh. Nếu mở terminal mới, điền username bot của bạn:

```powershell
# Chỉ cần dòng này nếu chưa có $botUsername từ bước 4:
# $botUsername = 'username_bot_cua_ban'
$apiBase = 'http://localhost:3001/api/v1'
$cameraEmail = Read-Host 'Email tài khoản CameraAI nhận cảnh báo'
$cameraPassword = Read-Host 'Mật khẩu CameraAI' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cameraPassword)
try {
    $loginBody = @{
        email = $cameraEmail
        password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    } | ConvertTo-Json
    $auth = Invoke-RestMethod -Method Post -Uri "$apiBase/auth/login" `
        -ContentType 'application/json' -Body $loginBody -TimeoutSec 15
    $link = Invoke-RestMethod -Method Post -Uri "$apiBase/auth/telegram/link" `
        -Headers @{ Authorization = "Bearer $($auth.accessToken)" } -TimeoutSec 15
    Write-Host "Mở link này trong Telegram và nhấn Start: https://t.me/$($botUsername)?start=$($link.linkToken)"
    Write-Host "Hết hạn: $($link.expiresAt)"
} catch {
    throw 'Không tạo được liên kết. Kiểm tra đăng nhập, backend; nếu bị giới hạn tần suất hãy đợi rồi thử lại.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Variable loginBody, auth, cameraPassword, link -ErrorAction SilentlyContinue
}
```

Mã link có hiệu lực **10 phút**, một lần; không chia sẻ link cho người khác. Mở link
và nhấn **Start**, hoặc gửi `/start <linkToken>` vào private chat bot.
Kỳ vọng bot trả **“Đã liên kết Telegram với tài khoản CameraAI.”** Chỉ gửi `/start`
không kèm mã không thực hiện liên kết. Cơ chế link dựa trên
[Telegram deep linking](https://core.telegram.org/bots/features#deep-linking).

## 6. Chỉnh thời gian chờ trên UI

Vào **Cài đặt → Cấu hình cảnh báo & Quy tắc leo thang** bằng tài khoản ADMIN.
Trong từng thẻ sự kiện có panel **Thời gian chờ xác nhận**:

1. Ghi lại `Đã lưu` để khôi phục sau test.
2. Chọn nhanh **30 giây / 1 phút / 2 phút / 5 phút / 10 phút**, hoặc nhập số nguyên
   **1–3600 giây**. Các nút chỉ sửa bản nháp, không tự lưu.
3. Với rule có nhánh tin cậy cao, nhập riêng **Nhánh khẩn cấp**. Giá trị phải là số
   nguyên không âm và **nhỏ hơn T_wait**; bằng hoặc lớn hơn sẽ không cho lưu.
   Chọn nhanh/đổi T_wait không tự chia đôi hoặc sửa giá trị này. Ngưỡng T_low/T_high
   không bị đổi khi chỉ chọn thời gian. `0` giây nghĩa là không chờ phản hồi,
   worker sẽ xử lý timeout ở lần kiểm tra kế tiếp.
4. Bấm **Lưu thay đổi**, chờ báo thành công. Reload kiểm tra giá trị còn giữ.
   **Hủy** chỉ bỏ bản nháp về cấu hình đã lưu, không khôi phục giá trị trước lần lưu.
5. Tạo **sự kiện mới** bằng camera thật. Đổi T_wait không gia hạn event đang NOTIFIED
   hoặc đưa event ESCALATED quay lại chờ xác nhận.

Để có thời gian thao tác khi test vùng cấm, có thể nhập **T_wait=600 giây** và
**Nhánh khẩn cấp=120 giây**. Đây là hai giá trị độc lập; nhánh cao có 120 giây
tính từ phát hiện. Đây là lựa chọn test, không phải mức
khuyến nghị vận hành thực tế; khôi phục cấu hình trước test khi hoàn tất.
Người không có quyền ADMIN chỉ xem, không sửa/lưu.

**Đánh giá ngưỡng và deadline:**

- Dưới T_low: chỉ ghi nhận, không gửi cảnh báo.
- T_low ≤ confidence < T_high: dùng T_wait.
- Confidence ≥ T_high: dùng `highWaitSeconds` đã nhập và lưu, không tự chia đôi.
- Rule `skipLoggedOnly` (ví dụ FIRE) và WELLNESS dùng T_wait trực tiếp, không có
  ô nhập nhánh khẩn cấp riêng.
- `deadline = detected_at + thời gian hiệu lực`. Xử lý AI và gửi tin cũng nằm trong
  thời gian đó; không cộng thêm thời gian từ lúc Telegram nhận cảnh báo.

Ví dụ T_wait=600, nhánh cao=120: phát hiện 20:00:00 → deadline 20:02:00.
Nếu nhận tin 20:00:10 thì còn 110 giây. Dữ liệu rule được đọc ở lần đánh giá mới;
không cần restart backend để áp dụng cấu hình vừa lưu.

## 7. Nhận và xử lý cảnh báo

| Thao tác                            | Khi sự kiện còn NOTIFIED | Kết quả                        |
| ----------------------------------- | ------------------------ | ------------------------------ |
| Tôi ổn trên Telegram hoặc dashboard | Xác nhận an toàn         | RESOLVED, hủy deadline         |
| Cần giúp đỡ                         | Yêu cầu xử lý ngay       | ESCALATED, tạo intent khẩn cấp |
| Không thao tác đến deadline         | Tự động TIMEOUT          | ESCALATED, tạo intent khẩn cấp |

Sau xác nhận INITIAL thành công, tin Telegram được sửa thêm tên người xác nhận,
thời gian và lựa chọn; hai nút được gỡ. Dashboard nhận cập nhật sự kiện.
Thông báo nổi sau bấm: “Đã xác nhận bạn an toàn.” hoặc “Đã ghi nhận yêu cầu giúp đỡ.”

Sau timeout, nút cũ hiện vẫn có thể còn trên tin Telegram. Bấm sẽ báo
**“Sự kiện đã được xử lý hoặc không còn chờ xác nhận.”** Không thử cả hai lựa chọn trên
cùng event: chỉ quyết định INITIAL đầu tiên hợp lệ có hiệu lực. Test mỗi lựa chọn
bằng một sự kiện mới riêng.

Với event ESCALATED, vào **Sự kiện → Xem chi tiết**, nhập ghi chú kết quả sau khi đã
kiểm tra/xử lý và bấm **Đóng sự kiện khẩn cấp**. Không coi timeout là xác nhận an toàn.
Hiện CONNECT_CALL chỉ là yêu cầu chờ xử lý: **chưa gọi điện thật, chưa tự gửi thêm
Telegram khẩn cấp sau timeout**. Các tích hợp ngoài này được triển khai sau.

## 8. Kiểm chứng và lỗi thường gặp

```powershell
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT email, telegram_linked_at, (telegram_chat_id IS NOT NULL AND telegram_user_id IS NOT NULL) AS linked FROM users WHERE telegram_linked_at IS NOT NULL LIMIT 10;"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT event_type, t_wait_seconds, high_wait_seconds, version FROM escalation_rules ORDER BY priority LIMIT 10;"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT event_id, status, telegram_message_kind, attempt_count, error_code, sent_at FROM notifications WHERE channel='TELEGRAM' ORDER BY created_at DESC LIMIT 10;"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT status, outcome, processed_at FROM telegram_webhook_inbox ORDER BY created_at DESC LIMIT 10;"
```

| Hiện tượng                             | Kiểm tra                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bot không trả lời link hoặc bấm nút    | Tunnel còn chạy? Webhook URL đúng? Secret khớp env container? getWebhookInfo có lỗi mới?          |
| Có event nhưng không có tin            | Đúng owner đã liên kết? TELEGRAM_ENABLED=true? Event có đạt ngưỡng và còn đủ điều kiện gửi không? |
| Người quen/UNDETERMINED không có tin   | Có thể đúng policy; dùng sự kiện nguy cơ đủ ngưỡng, không dùng mọi person detection làm cảnh báo  |
| Có cảnh báo nhưng ảnh chưa có          | Sender có thể fallback text; kiểm tra snapshot/storage, không giả tạo AI callback                 |
| Bấm báo không còn chờ xác nhận         | Event đã timeout/được xử lý trước; kiểm tra history và dùng event mới                             |
| Lưu cấu hình báo xung đột              | Có người khác đã sửa phiên bản; tải lại rồi nhập/lưu lại                                          |
| Đổi thời gian nhưng tin cũ vẫn timeout | Tin cũ dùng deadline/snapshot cũ; phải tạo event mới                                              |

Khi chia sẻ evidence, che token, link token, JWT, Telegram ID và thông tin riêng tư.
Ảnh chụp nhận tin không chứng minh cả luồng xác nhận đã PASS: đối chiếu thêm
`confirmations`, `telegram_message_edits`, trạng thái event theo
[TEST_US-14_TELEGRAM_ALERTS.md](TEST_US-14_TELEGRAM_ALERTS.md).
