# Hướng dẫn Cài đặt & Kiểm thử US-09 (Đăng ký khuôn mặt người quen)

Tài liệu này dành cho các thành viên trong team Review Pull Request của **US-09**. Do kiến trúc luồng dữ liệu thay đổi và có thêm AI model, các bạn cần làm theo các bước dưới đây để hệ thống chạy trơn tru trên máy local.

## 1. Mục đích của US-09
- Cho phép người dùng (Role: ADMIN) đăng tải từ 1-5 tấm ảnh chân dung lên hệ thống để đăng ký khuôn mặt người quen.
- Tự động rút trích ra các đặc trưng sinh trắc học (vector embedding) thông qua mô hình YuNet / SFace.
- Cập nhật cơ sở dữ liệu và đồng bộ vào bộ nhớ của AI Service.

---

## 2. Các bước cấu hình (Configuration)

Trước khi chạy, hãy đảm bảo bạn đang ở nhánh `feat/US-09-face-register` và đã pull code mới nhất.

### Cập nhật file `.env`
Mở file `.env` ở thư mục gốc, nếu thiếu các biến môi trường cho AI Service thì hãy bổ sung:
```env
# AI Service Settings
FACE_PROVIDER=LOCAL
FACE_MATCH_THRESHOLD=0.9
FACE_MODEL_VERSION=yunet-2023mar-sface-2021dec
FACE_MAX_IMAGE_BYTES=5242880
FACE_MAX_PIXELS=12000000
FACE_MAX_CONCURRENT=2
```

---

## 3. Các bước khởi chạy (How to Run)

Do US-09 có sinh mã giao tiếp tự động (Contracts) và thêm bảng Database mới (Migration 0005), bạn bắt buộc phải làm theo thứ tự sau:

**Bước 1: Khởi động toàn bộ container bằng Docker Compose**
```bash
docker compose up -d
```
*(Nếu Docker tải thiếu image `postgres:16-alpine`, hãy kiểm tra lại kết nối mạng hoặc thử chạy lại lệnh này).*

**Bước 2: Chạy lại Migration DB (Tự động chạy, nhưng nếu bạn dùng DB cũ thì nên clean)**
Nếu bạn gặp lỗi schema, tốt nhất hãy xóa volume cũ và dựng lại:
```bash
docker compose down -v
docker compose up -d
```

**Bước 3: Biên dịch lại Contracts (Cực kỳ quan trọng)**
Do chúng ta có thêm Interface OpenAPI mới, container Orchestrator cần được biên dịch lại gói `@cam/contracts` để hiểu code mới:
```bash
docker exec camerai-orchestrator pnpm --filter @cam/contracts build
docker compose restart camerai-orchestrator
```

**Bước 4: Cài đặt thư viện trên Frontend & Chạy Test (Tuỳ chọn)**
Trên máy local của bạn:
```bash
pnpm install
pnpm check:all
```
*Lưu ý: Nếu bạn gặp lỗi Python Formatting khi chạy `pnpm check:all`, hãy chạy `pnpm format:ai`.*

---

## 4. Hướng dẫn Kiểm thử (How to Test)

1. Mở giao diện Dashboard tại: `http://localhost:3000`
2. Đăng nhập bằng tài khoản ADMIN.
3. Ở Sidebar bên trái, bấm vào mục **Người quen** -> Chọn **Thêm mới**.
4. **Test kịch bản 1 (Upload ảnh chuẩn):**
   - Điền Tên và Quan hệ.
   - Bấm chọn 1 tấm ảnh chân dung rõ mặt.
   - Bấm Đăng ký -> Giao diện sẽ báo thành công và biến mất form.
5. **Test kịch bản 2 (Cộng dồn ảnh):**
   - Chọn tiếp Thêm mới.
   - Bấm "Chọn ảnh" và tải lên 1 tấm ảnh.
   - Bấm "Chọn ảnh" lần nữa và tải lên tấm ảnh thứ 2.
   - Giao diện phải hiển thị đủ 2 tấm ảnh vừa chọn (Không được ghi đè).
6. **Test kịch bản 3 (Ảnh độ phân giải siêu cao):**
   - Lấy 1 tấm ảnh chụp Selfie bằng điện thoại đời mới (12MP - 24MP).
   - Tải lên hệ thống. AI Service sẽ tự động thu nhỏ ảnh (Downscale max 640px) và vẫn bóc tách được khuôn mặt thay vì báo lỗi như trước.
   - (Giao diện hiển thị khung cắt màu xanh dương bọc lấy khuôn mặt chuẩn xác).

Chúc các bạn Review vui vẻ! Nếu có bug hãy comment trực tiếp vào Pull Request.
