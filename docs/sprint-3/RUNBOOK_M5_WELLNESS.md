# Vận hành US-20 wellness

Mặc định `M5_ENABLED=false`. Flag chỉ tắt admission mới; yêu cầu đã tạo vẫn được gửi, xác nhận và xử lý deadline. Không chuyển trách nhiệm M5 sang generic escalation worker. Không cần model AI mới hoặc runtime dependency mới.

## Chuẩn bị

Áp dụng migration bằng runner thông thường sau backup/review, không reset database. Migration mới [0016](../../db/migrations/0016_wellness_source_evidence.sql) thêm bảng association và provenance; không đổi lịch, enum hoặc seed rule. Schema hiện có 18 file migration do các prefix lịch sử trùng nhau.

Resident là tài khoản hiện hữu, thường mang role VIEWER. Cần active `known_faces` liên kết resident với đúng owner hộ; resident còn active và có Telegram user/chat ID đã xác minh cùng `telegram_linked_at`. Caregiver quản lý lịch của hộ mình, resident xem lịch/check của mình và chỉ resident của check được xác nhận. Camera chỉ chọn camera đang bật thuộc thiết bị của owner. Danh sách camera rỗng được chốt thành các camera đang bật trong hộ tại lúc materialize.

Lịch legacy chưa xác định owner có trạng thái `INVALID_CONFIG` và không được admission. Người vận hành phải đối chiếu active face links và xác nhận đúng owner trước khi sửa owner của lịch trong DB bằng giao dịch có kiểm soát. Không đoán khi một resident có nhiều owner. Sau khi sửa link, dùng PATCH của người có quyền để revalidate cấu hình. Không thay occurrence/snapshot đã có.

## Nguồn hoạt động

M1 KNOWN đã commit tạo `wellness.identity` trong outbox cùng giao dịch. Consumer gắn owner/resident/face/event vào camera + source session + track, mặc định hạn 30 giây. Metadata bridge và face job cùng dùng `camera:start_time` (6 chữ số thập phân) để tránh dùng identity cũ sau restart. Chỉ `motionless_count=0` và `stationary=false` được bridge công nhận là chuyển động. Metadata thiếu hoặc face-only không được tính là hoạt động.

Cấu hình ranh giới bằng `WELLNESS_BOUNDARIES_JSON`, ví dụ:

```json
[
  {
    "cameraSlug": "front_door",
    "boundaryId": "door",
    "axis": "x",
    "position": 0.5,
    "inside": "less",
    "policyVersion": "v1"
  }
]
```

Vị trí chuẩn hóa 0..1; `inside` chỉ rõ phía trong hộ. Mặc định cần hai mẫu liên tiếp qua phía mới, ngoài biên nhiễu 0.01. Chuyển vào là ARRIVAL; chuyển ra là DEPARTURE. Không cấu hình boundary thì chỉ có MOTION. Mất track, mất camera, frame cũ và mất tín hiệu không tạo AWAY. Thay boundary phải đổi `policyVersion` và restart để bỏ trạng thái hướng cũ.

Quan sát nội bộ phải khớp provenance đã persist, đúng identity/camera/session/track/kind/thời gian. Caller không thể tự gắn tên người bằng JSON. Ledger và projection ghi cùng transaction; đọc presence as-of `scheduledFor`, hết hạn hoặc cùng timestamp mâu thuẫn là UNKNOWN. Đồng bộ giờ các thành phần; mặc định skew 5 giây, tuổi observation tối đa 86400 giây.

Các giới hạn có thể chỉnh trong `.env.example`: TTL identity/presence, mẫu xác nhận hướng, margin, queue/frame/state tối đa. Queue mặc định 2 frame, state 2048; frame cũ có thể bị loại và có cảnh báo. Provenance/association quá tuổi observation được dọn theo batch 10000 mỗi phút khi có frame. Observation ledger và run phục vụ audit giữ nguyên; retention của event phải xử lý run sau audit/export, không xóa run pending hoặc event NOTIFIED/ESCALATED và không làm mất evidence đang được presence tham chiếu.

## Lịch, gửi và xác nhận

Ngày ISO 1..7, timezone kiểm tra bằng PostgreSQL `pg_timezone_names`; occurrence dùng `AT TIME ZONE`. Gap/fold DST theo PostgreSQL16. Một schedule/localDate chỉ có một run. Không tạo lượt trước activation; admission cursor commit cùng insert. Lookback mặc định 6 giờ, cửa sổ đóng cả hai đầu. Catch-up tối đa 300 giây; quá hạn đánh dấu MISSED, có log runId. Reconcile tối đa 24 giờ, lease 30 giây và reclaim khi hết hạn. Lỗi evaluate rollback rồi trở lại PENDING có backoff và `last_error`.

Không hoạt động và không AWAY hợp lệ tạo một event P2/WELLNESS_TIMEOUT/SCHEDULER, camera/confidence null và một resident intent. Một resident/hộ chỉ có một event active. Intent PENDING không chứng minh đã gửi. Chỉ dispatch Telegram thành công mới ghi first SENT và deadline = first SENT + grace snapshot, mặc định 300 giây. Sửa lịch/retry/late SENT không gia hạn hạn phản hồi. Gửi thất bại tới deadline 60 giây chuyển DELIVERY_FAILED tới caregiver và danh sách emergency contact đã xác minh của đúng owner.

Resident IM_OK trước hạn chuyển RESOLVED. NEED_HELP trước hạn chuyển ESCALATED và thông báo caregiver ngay. Tại hoặc sau deadline, transaction commit TIMEOUT rồi trả HTTP409. Command replay cùng response/note/actor trả lại kết quả cũ; đổi payload trả409. Terminal events không nhận authoritative confirmation mới. Callback Telegram kiểm tra recipient, actor, chat, message, SENT, TTL và assigned resident, giữ nguyên guard của sự kiện khác. Không dùng endpoint xác nhận generic để xác nhận thay resident.

Mở mục **Kiểm tra sức khỏe** trên sidebar. Caregiver CRUD/bật/tắt và xem lịch sử; resident thấy các yêu cầu đã gửi của mình, có nút Tôi ổn/Cần giúp đỡ. Lịch sử refresh theo SSE và polling5 giây. API dùng đồng hồ DB làm quyết định cuối cùng. SSE/list/detail/stats US20 chỉ hiển thị cho owner/resident/admin.

## Chẩn đoán và rollback

- Không có run: kiểm tra flag, owner/link/channel, ngày/timezone/activation/cursor. Lịch vừa bật không bù lịch đã qua.
- Run PENDING/PROCESSING lâu: xem `available_at`, `attempt_count`, `last_error`, lease; không sửa snapshot hoặc dùng SQL giả SENT. Kiểm tra migration và lỗi SQL trước khi thử lại.
- Không có hoạt động: kiểm tra bridge có explicit motion, start_time/session khớp face job, identity còn TTL, owner đúng, boundary đúng; camera offline phải giữ UNKNOWN.
- Chưa gửi: kiểm tra Telegram đã liên kết, notification attempts/error_code/provider IDs. Không đưa token vào logs. `TELEGRAM_API_BASE_URL` chỉ dành endpoint chính thức hoặc loopback trong kiểm thử, không chuyển token tới host tùy ý.
- Trễ: phân biệt MISSED, DELIVERY_FAILED và TIMEOUT bằng run/history/outbox. Quá 24 giờ reconciliation cần audit vận hành, không tạo bù hàng loạt.

Rollback: tắt admission trước, giữ worker M5 để drain các yêu cầu đã commit. Schema additive giữ để audit, không drop/reset bảng. Chỉ khôi phục toàn bộ image cũ khi không còn cảnh báo pending hoặc image đó đã được kiểm chứng xử lý M5 camera-less. Đợt QA này không bật feature trên môi trường thật và không gửi Telegram người thật.
