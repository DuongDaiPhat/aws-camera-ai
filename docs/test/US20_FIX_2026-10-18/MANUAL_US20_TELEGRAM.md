# Kiểm thử manual US20, gồm Telegram thật

Áp dụng bản sửa trên `fix/US-20-wellness-check`. Đợt tự động trước dùng Telegram provider local; chưa chứng minh bot thật hoạt động. Tài liệu này là quy trình thực hiện và ghi kết quả, không phải biên bản PASS sẵn.

## 1. Chuẩn bị đúng mã nguồn và dữ liệu

Chạy dịch vụ từ checkout nhánh sửa; không chạy từ checkout `docs/testing` hoặc bản feature cũ. Nếu dùng worktree khác, chuẩn bị `.env` riêng vì Git không mang theo file này. Port mặc định web3000/backend3001; điều chỉnh theo môi trường. Không chạy hai compose project cùng tranh port/container.

```powershell
git branch --show-current
docker compose up -d postgres redis mosquitto minio
pnpm db:migrate
docker compose up -d --build orchestrator web
curl.exe http://localhost:3001/api/v1/health
```

Chạy migration theo cấu hình DB của checkout, kiểm tra đích DB trước khi chạy; không dùng db:reset. Với các ca camera thật, cần chạy thêm Frigate, AI và metadata bridge theo cấu hình hiện hữu của dự án.

Cần hai tài khoản thử nghiệm active: caregiver (CAREGIVER hoặc ADMIN, owner camera) và resident (thường VIEWER), mỗi tài khoản liên kết một private chat Telegram khác nhau. Dùng hai cửa sổ trình duyệt/profiles để giữ hai phiên đăng nhập.

Resident phải có bản ghi `known_faces` active thuộc caregiver với `linked_user_id` đúng resident; camera được chọn phải bật và thuộc owner. **Giới hạn hiện tại:** API tạo known-face chỉ cho `linkedUserId` bằng chính tài khoản đăng ký; chưa có luồng UI/API tạo liên kết caregiver → resident khác tài khoản. Nếu danh sách người được giám sát trống, không thể hoàn tất bước này chỉ bằng UI. Nhờ người quản trị chuẩn bị liên kết trong DB test, hoặc ghi BLOCKED phần chuẩn bị dữ liệu; không nhận ID mẫu trong tài liệu cũ là dữ liệu có thật.

Ví dụ truy vấn kiểm tra (psql vào đúng DB test; không cần xuất Telegram ID):

```sql
SELECT k.id AS face_id, k.owner_user_id, k.linked_user_id,
       k.is_active, u.email, u.is_active AS resident_active,
       (u.telegram_linked_at IS NOT NULL
        AND u.telegram_user_id IS NOT NULL
        AND u.telegram_chat_id IS NOT NULL) AS telegram_ready
FROM known_faces k LEFT JOIN users u ON u.id = k.linked_user_id
WHERE k.is_active;
```

Nếu quản trị viên cần provision **DB test**, tạo trước face của đúng resident dưới owner bằng luồng đăng ký khuôn mặt, xác minh ba UUID thật rồi thực hiện transaction dưới đây. Thay các placeholder; không dùng trên production và không đổi link đã gắn người khác. Ghi lại giá trị cũ để hoàn nguyên sau test.

```sql
BEGIN;
UPDATE known_faces k SET linked_user_id = 'RESIDENT_UUID'::uuid
WHERE k.id = 'FACE_UUID'::uuid AND k.owner_user_id = 'OWNER_UUID'::uuid
  AND k.is_active AND k.linked_user_id IS NULL
  AND EXISTS (SELECT 1 FROM users u
              WHERE u.id = 'RESIDENT_UUID'::uuid AND u.is_active)
RETURNING id, owner_user_id, linked_user_id;
-- Chỉ COMMIT sau khi thấy đúng một hàng và xác minh đúng người/hộ.
-- Nếu sai hoặc không có hàng, dùng ROLLBACK để kiểm tra lại dữ liệu.
```

## 2. Kết nối Telegram thật

Làm theo các bước2–5 của [hướng dẫn kết nối Telegram](../../HUONG_DAN_KET_NOI_SU_DUNG_TELEGRAM.md): tạo bot test, điền token/secret, mở tunnel HTTPS tới backend3001, đăng ký webhook `/api/v1/webhooks/telegram` với `message` và `callback_query`.

Trong `.env` của checkout chạy backend:

```dotenv
M5_ENABLED=true
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<token bot test>
TELEGRAM_WEBHOOK_SECRET=<secret riêng>
```

Để mặc định Telegram API chính thức; bỏ override provider local `TELEGRAM_API_BASE_URL` nếu đã dùng harness. Sau khi sửa env, recreate backend:

```powershell
docker compose up -d --no-deps --force-recreate orchestrator
```

**Liên kết hai lần:** đăng nhập caregiver để gọi `POST /api/v1/auth/telegram/link`, mở deep link bằng Telegram caregiver và nhấn Start; sau đó đăng nhập resident để gọi cùng endpoint, mở bằng Telegram resident và nhấn Start. Script đăng nhập/link ở bước5 tài liệu Telegram dùng được cho từng tài khoản; với US20 phải liên kết cả resident, không chỉ owner. Link dùng một lần, hạn10 phút. Bot cần trả thông báo liên kết thành công cho từng người.

Kiểm tra webhook URL đúng tunnel đang chạy và không có lỗi giao nhận mới. Không dùng polling getUpdates cùng webhook. Không chia sẻ token, JWT, link token hoặc Telegram ID trong evidence.

## 3. Tạo lịch để kích hoạt bằng scheduler thật

Caregiver vào **Kiểm tra sức khỏe**, chọn resident vừa chuẩn bị. Tạo lịch tên `Manual US20`, đặt giờ **sau hiện tại2–3 phút**, timezone `Asia/Ho_Chi_Minh`, đủ bảy ngày, lookback6 giờ, grace300 giây, bật lịch. Chọn camera của hộ hoặc để rỗng để dùng các camera đang bật.

Nếu cần Swagger/API, dùng POST `/api/v1/wellness-schedules` với JWT caregiver:

```json
{
  "residentUserId": "UUID_THAT_CUA_RESIDENT",
  "name": "Manual US20",
  "checkAt": "HH:mm_GIO_SAP_TOI",
  "daysOfWeek": [1, 2, 3, 4, 5, 6, 7],
  "lookbackHours": 6,
  "graceSeconds": 300,
  "cameraIds": [],
  "timezone": "Asia/Ho_Chi_Minh",
  "isEnabled": true
}
```

Thay các chuỗi placeholder trước khi gửi. Lưu `scheduleId`; xem lượt bằng GET `/api/v1/wellness-checks` và lưu `checkId`, `eventId`. Không chèn SQL giả run/SENT, không dùng giờ đã qua để ép chạy: lịch mới không tạo bù trước activation.

Để test nhánh cảnh báo, dùng resident thử nghiệm không có bằng chứng hoạt động hợp lệ hoặc AWAY còn hiệu lực trong cửa sổ. Không xóa ledger để ép kết quả. Face-only không đủ chứng minh hoạt động; camera mất tín hiệu cũng không chứng minh AWAY.

## 4. Các ca bắt buộc — mỗi lựa chọn dùng lượt mới

| Ca                 | Thao tác                                                                  | Kết quả cần kiểm chứng                                                                                                 |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CRUD               | Tạo, sửa giờ tương lai, tắt/bật lịch, reload; xóa lịch sau khi có history | Dữ liệu giữ đúng sau reload; lịch tắt không tạo lượt mới; xóa mềm giữ history                                          |
| Không hoạt động    | Đợi đúng giờ với dữ liệu ở bước3                                          | Một lượt, một event WELLNESS_TIMEOUT/P2/SCHEDULER; resident nhận tin, notification SENT, có deadline                   |
| Telegram IM_OK     | Resident bấm **Tôi ổn** trước hạn                                         | Event RESOLVED; confirmation đúng resident/Telegram; không leo thang khi qua deadline cũ                               |
| Telegram NEED_HELP | Tạo lịch/lượt mới rồi resident bấm **Cần giúp đỡ**                        | Event ESCALATED ngay; có notification caregiver và tin đến đúng chat caregiver                                         |
| Telegram TIMEOUT   | Tạo lượt mới, không bấm gì                                                | Hết300 giây từ lần SENT đầu, cộng độ trễ worker, event ESCALATED; lý do TIMEOUT; caregiver nhận cảnh báo               |
| Nút cũ/lặp         | Bấm lại nút đã xử lý hoặc nút sau hạn                                     | Không đổi quyết định cũ, không phát sinh xác nhận/leo thang trùng                                                      |
| Web IM_OK/HELP     | Lượt mới, resident bấm trên mục Kiểm tra sức khỏe                         | Kết quả tương ứng như Telegram; history tự cập nhật; bấm nút Telegram cũ không đảo kết quả                             |
| Phân quyền         | Caregiver thử confirm check resident bằng API; user hộ khác đọc/sửa       | Bị từ chối; không thay trạng thái, không lộ dữ liệu hộ khác                                                            |
| Lịch trùng         | Cùng owner/resident, cùng giờ tạo lần nữa                                 | HTTP409, không sinh lịch thứ hai                                                                                       |
| Gửi thất bại       | Dùng bot test, resident chặn bot rồi tạo lượt mới                         | Không giả SENT/deadline phản hồi; sau giới hạn giao nhận60 giây, DELIVERY_FAILED và chuyển caregiver; bỏ chặn sau test |

Một resident/hộ chỉ có một event active; hoàn tất/đóng event trước khi chạy ca tiếp theo. Dùng lịch mới có giờ tương lai khác nhau: sửa cùng lịch không tạo thêm occurrence thứ hai trong cùng ngày. Grace60 giây có thể dùng riêng để smoke test, nhưng acceptance mặc định cần chạy300 giây. Không chỉnh generic escalation rule để thay deadline US20; lịch/run snapshot quyết định grace.

Với event ESCALATED, caregiver kiểm tra thực tế rồi đóng bằng luồng đóng sự kiện và ghi chú. Tin Telegram không chứng minh có cuộc gọi điện thật; không coi TIMEOUT là người đó an toàn.

## 5. Camera/AI và không báo động sai

- **VERIFIED_ACTIVE:** trước giờ lịch, đúng resident được M1 nhận diện KNOWN, đồng thời metadata có chuyển động thật trên cùng camera/session/track còn TTL. Đến giờ phải VERIFIED_ACTIVE, không tạo cảnh báo. Chỉ nhận diện mặt hoặc gửi JSON observation tự tạo không chứng minh ca này PASS.
- **SKIPPED_AWAY:** cấu hình boundary cửa theo [runbook](../../sprint-3/RUNBOOK_M5_WELLNESS.md), restart bridge cần thiết; cho đúng resident đi từ phía trong ra ngoài, kiểm chứng DEPARTURE có provenance trước giờ lịch. Đến giờ phải SKIPPED_AWAY. Cho resident quay vào để có ARRIVAL cho ca sau.
- **UNKNOWN:** camera offline/thiếu metadata/track không xác định không được chuyển thành AWAY hoặc VERIFIED_ACTIVE; thiếu hoạt động hợp lệ vẫn phải đi nhánh yêu cầu xác nhận.

Nếu thiếu camera/boundary/AI hoạt động thật, ghi BLOCKED các ca nguồn vật lý, giữ riêng kết quả Telegram/UI; không suy ra PASS từ fixture tự động.

## 6. Ghi kết quả và chẩn đoán

Mỗi ca lưu: case ID, branch/commit hiện tại, scheduleId/checkId/eventId, giờ địa phương và UTC, người thao tác, request_sent_at/deadline, trạng thái trước/sau, screenshot tin resident + caregiver và history web. Ghi Actual Result, PASS/FAIL/BLOCKED, lý do và evidence theo hai hướng dẫn test case của dự án; giữ nguyên Expected Result. Đợt manual bot thật là bằng chứng mới, không ghi đè evidence local trước đó.

- Không có resident để chọn: kiểm tra active known-face link ở bước1; đây là hạn chế provision hiện có.
- Không có run: kiểm tra M5 flag, activation/giờ tương lai/ngày/timezone, owner/camera và resident đã xác minh Telegram.
- Có event nhưng không có tin: xem `notifications` (status, attempt_count, error_code, sent_at), link của người nhận và TELEGRAM_ENABLED; PENDING không phải SENT.
- Nhận tin nhưng bấm không tác dụng: kiểm tra tunnel/webhook/secret; đúng Telegram resident, đúng tin/lượt và còn hạn. Forward tin hoặc caregiver bấm thay không phải luồng hợp lệ.
- Không có caregiver alert: kiểm tra link owner, notification recipient và lỗi provider; không chỉ nhìn trạng thái ESCALATED để kết luận giao nhận thành công.

Sau test, tắt/xóa mềm lịch test, đóng các event test đã xử lý, khôi phục cấu hình và dữ liệu provision có kiểm soát. Tắt M5 chỉ ngừng lượt mới; các yêu cầu đã tạo vẫn tiếp tục được xử lý. Ngừng tunnel khi không cần dùng.
