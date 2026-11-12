# CameraAI — thiết kế theo ảnh tham chiếu

Chỉ thao tác trên `feat/3d-camera-showcase`.

Màu nền #080e1c, bề mặt #111a2c, chữ #edf2ff, xanh #7785ff, tím #a77bfa, cyan #65d3f2. Font Manrope lưu cục bộ, giữ giấy phép OFL. Icon Lucide thống nhất nét và kích thước.

Cấu trúc tham khảo ảnh 1: menu ngang trên cùng, khung chọn duy nhất trượt theo vị trí hover/focus/selection, phần Tổng quan dùng bento bất đối xứng. Màu tối xanh–tím theo ảnh 2. Ba thẻ thống kê dùng dữ liệu API thật; phân loại sự kiện dựa trên danh sách đã tải, không tạo biểu đồ tăng trưởng giả.

Camera xuất hiện ngay Tổng quan theo yêu cầu đã xác nhận. Mô hình bullet có vỏ tách lớp, ngàm gắn tường, cụm hồng ngoại, nhiều thấu kính, cảm biến, bo mạch và biểu tượng xử lý AI. Nhấn camera hoặc nút để tách/lắp, kéo để xoay. Tính năng AI kết nối tới sự kiện, người quen và khu vực của dự án. Biểu tượng chip AI diễn giải dịch vụ phân tích hình ảnh của hệ thống, không khẳng định phần cứng camera thực tế có chip này.

Animation: Motion spring cho khung chọn menu và tính năng; trang chuyển nội dung 240ms; card hover 250ms. Chuyển động mô hình theo thời gian thực với giảm chấn, có độ trễ giữa các cụm và tôn trọng reduced motion. Không tự xoay liên tục. WebGL2 có fallback; chức năng điều hướng vẫn dùng được khi thiếu 3D.

## Kiểm tra

- `pnpm --filter @cam/web typecheck`
- `pnpm --filter @cam/web lint` (các cảnh báo độ dài hàm cũ được giữ nguyên)
- `pnpm --filter @cam/web test`: 222 kiểm thử đã qua.
- `node tools/scripts/ui-browser-review.mjs http://127.0.0.1:3002`: Chrome dùng profile riêng và thay API bằng fixture trong test. Cần Playwright ở `artifacts/m3/browser-qa` như script browser review hiện có của dự án; có thể cài bằng `pnpm --dir artifacts/m3/browser-qa add playwright` nếu thư mục chưa được chuẩn bị. Không thay dữ liệu trong ứng dụng hoặc cơ sở dữ liệu.
- 17 kiểm tra bố cục và thao tác trên desktop/mobile: camera đóng/tách, nhấp trực tiếp, zoom/reset, menu hover không đổi trang, điều hướng từ AI, giảm chuyển động, thiếu WebGL và cảnh báo cháy. Ảnh và JSON nằm ở `artifacts/ui-refresh-v2/`.

Nguồn: [Lucide React](https://lucide.dev/guide/react/), [Motion layout animations](https://motion.dev/docs/react-layout-animations), font Manrope từ Google Fonts (giấy phép OFL lưu kèm asset).

Kết quả cuối: build production Docker/Linux thành công; container web đã được build lại và chạy tại localhost:3000. Smoke test đăng nhập với backend thật, mở camera 3D và vào trang Camera trực tiếp đã qua, không có lỗi JavaScript hoặc API trong lượt kiểm tra. Prettier và git diff --check đã qua. Các component mới không có cảnh báo lint; các cảnh báo độ dài hàm cũ vẫn còn.
