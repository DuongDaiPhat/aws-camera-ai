# Caregiver — chủ hộ

Caregiver dùng bộ giao diện hiện có, trong phạm vi hộ gia đình của mình. Admin hệ thống vẫn giữ trang quản lý tài khoản riêng; thay đổi này không cấp quyền quản trị hệ thống cho Caregiver.

## Trang và chức năng

| Trang               | Chức năng                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tổng quan           | Camera trực tiếp, bố cục, thứ tự camera khu vực theo tài khoản, cảnh báo mới.                                                       |
| Camera              | Thêm/sửa/xóa, bật/tắt, nguồn RTSP/webcam/video, FPS/độ phân giải/nhận diện và đồng bộ Frigate. Nguồn phát nằm trong tab của camera. |
| Xem lại thời gian   | Chọn kênh/ngày, phát nhiều camera, tua, tốc độ, toàn màn hình và nhận diện lịch sử.                                                 |
| Thông báo           | Cảnh báo và bằng chứng trong hộ, lọc, xác nhận, yêu cầu trợ giúp và trạng thái xử lý.                                               |
| Người quen          | Đăng ký khuôn mặt, sửa thông tin, xóa và liên kết với Viewer hoạt động trong cùng hộ.                                               |
| Khu vực giám sát    | Vẽ vùng, loại vùng, tên và điều kiện giám sát theo camera.                                                                          |
| Kiểm tra an toàn    | Lịch kiểm tra người đã liên kết, phản hồi Tôi ổn/Cần giúp đỡ, quá hạn và lịch sử.                                                   |
| Thành viên gia đình | Tạo Viewer, cấp/thu hồi riêng quyền trực tiếp và lịch sử từng camera, vô hiệu hóa thành viên, quản lý tối đa ba liên hệ khẩn cấp.   |
| Cài đặt             | Hồ sơ, mật khẩu local, liên kết Telegram, tùy chọn cảnh báo, quy tắc chuyển cấp riêng hộ và thời gian lưu video.                    |

## API và phân quyền

- Module mới: `src/household`. Hợp đồng đầy đủ nằm trong `api/openapi.yaml`; client dùng kiểu được sinh từ hợp đồng.
- `GET /household`: thành viên, camera, liên hệ, cấu hình và dung lượng media cảnh báo của hộ.
- `POST /household/members`, `PUT /household/members/:id/cameras`, `DELETE /household/members/:id`: tạo Viewer, thay toàn bộ danh sách quyền, vô hiệu hóa tài khoản. Thành viên mới không có quyền camera tự động.
- `POST /household/cameras`: tạo camera đang tắt; các thao tác cấu hình dùng API camera hiện có.
- `POST/PUT/DELETE /household/contacts[/:id]`: liên hệ khẩn cấp thuộc hộ.
- `PUT /household/settings`: lưu cấu hình và gửi retention tới từng camera; `syncFailures` liệt kê camera chưa áp dụng thành công.
- `GET/PUT /household/escalation-rules[/:eventType]`: quy tắc của hộ, kiểm tra phiên bản trước khi ghi. Engine đọc override theo hộ của sự kiện; không sửa quy tắc toàn hệ thống.
- `GET /account`, `PATCH /account/profile`, `PUT /account/preferences`, `POST /account/password`: dữ liệu cá nhân của người đang đăng nhập.
- `PATCH /known-faces/:id`: sửa tên/quan hệ và liên kết Viewer cùng hộ; không trả embedding.
- Hàm SQL `can_access_camera(actor,camera,history)` kiểm tra tài khoản hoạt động, hộ và quyền trực tiếp/lịch sử. Áp dụng ở danh sách, tài nguyên, sự kiện và playback.
- Token đọc MediaMTX gắn với người dùng + camera; callback mở kết nối kiểm tra lại quyền hiện tại. Thu hồi áp dụng cho yêu cầu tiếp theo. Video đã tải hoặc kết nối đã thiết lập không thể được thu hồi ngược; presigned URL còn thời hạn riêng.

## Triển khai và dữ liệu local

Migration `0021_caregiver_households.sql` bổ sung cấu hình hộ, quyền camera, tùy chọn thông báo và quy tắc hộ; giữ quyền Viewer đã tồn tại khi nâng cấp. Chạy bằng quy trình `pnpm db:migrate` của dự án trên môi trường mới.

Trên máy phát triển đã áp dụng migration và gắn `caregiver@camerai.local` với hộ đang có bốn camera. Mật khẩu dev hiện có được giữ nguyên và đã thử đăng nhập; không cần chạy lại toàn bộ seed. `0005_caregiver_household.sql` mô tả liên kết demo cho lần seed mới; không thay mật khẩu và không ghi đè quyền camera đã cấu hình.

## Kiểm chứng ngày 18/11/2026

- Backend: 75 bộ kiểm thử, 546 ca đạt; frontend: 77 bộ, 355 ca đạt. Typecheck cả hai ứng dụng đạt. Lint các file thay đổi không có lỗi; còn cảnh báo độ dài/độ phức tạp của một số hàm. Bộ dò tĩnh Impeccable không báo lỗi trong UI mới.
- 42 bước API thật bằng hộ thử riêng: tạo/sửa/xóa camera, nguồn phát, tạo Viewer, quyền trực tiếp/lịch sử độc lập, chặn hộ khác, hồ sơ/mật khẩu/tùy chọn, liên hệ, quy tắc và xung đột phiên bản, liên kết người quen, lịch an toàn và thu hồi tài khoản. Đã dọn dữ liệu thử; giữ nguyên bốn camera thật.
- Đã đăng nhập Caregiver trong Chrome, quan sát đủ chín mục menu, các trang Tổng quan, Camera, Người quen, Khu vực giám sát, Kiểm tra an toàn, Gia đình và Cài đặt; mở bảng quyền và biểu mẫu liên kết Viewer. Người dùng dừng điều khiển bằng Escape trước khi kiểm thử hết Thông báo/Xem lại bằng trình duyệt. Hai trang này có kiểm thử tự động và API nhưng chưa được nghiệm thu thao tác đầy đủ bằng phiên Caregiver.
- Codex thực hiện và tích hợp. Antigravity `gemini-3.8-flash-high` chỉ rà soát phân quyền; nhận các góp ý về tách hộ, quyền tài nguyên và quy tắc, loại suy đoán không có trong code.

## Giới hạn vận hành hiện tại

- Hai nguồn VIDEO_FILE đang trỏ tới file không còn trên nơi lưu của máy; cần tải lại file tại Camera để thử phát trực tiếp. Không tự thay nguồn của người dùng.
- Không thử lửa/té ngã ngoài đời hoặc gửi tin Telegram/cuộc gọi thật trong đợt kiểm tra này. Gọi điện tự động còn phụ thuộc triển khai/xác minh nhà cung cấp điện thoại.
- Cognito: tạo người dùng trên User Pool trước, sau đó liên kết sub trong Gia đình; không tự gửi thư mời. Đổi mật khẩu Cognito qua nhà cung cấp.
- Dung lượng hiện hiển thị là ảnh/video cảnh báo trong event_media. Ngưỡng GB dùng theo dõi, chưa là hạn ngạch ổ đĩa video liên tục. Frigate quản lý video theo retention; cấu hình hộ cần được lưu/đồng bộ thành công để áp dụng lên camera cũ.
