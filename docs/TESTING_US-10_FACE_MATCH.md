# Hướng dẫn Kiểm thử US-10: Tích hợp Nhận diện Khuôn mặt (Face Match)

Tài liệu này hướng dẫn các bước kiểm thử (test) từ đầu đến cuối luồng dữ liệu của tính năng nhận diện khuôn mặt (US-10), đảm bảo Orchestrator và AI Service phối hợp chính xác.

## 1. Chuẩn bị môi trường

- **Chạy toàn bộ dịch vụ**: Đảm bảo toàn bộ các container (postgres, redis, orchestrator, ai-service, frigate) đều đang ở trạng thái hoạt động.
- **Xóa dữ liệu cũ (tùy chọn)**: Nếu cần test trên môi trường sạch, hãy chạy lệnh `pnpm db:reset` để khôi phục cấu hình và dữ liệu mẫu về mặc định ban đầu.

> **Lưu ý quan trọng**:
> Hãy chắc chắn rằng bạn đang ở nhánh `feat/US-10-person-face-match` mới nhất và file `.env` đã được cấu hình ngưỡng nhận diện hợp lý (`FACE_MATCH_THRESHOLD=0.6`).

---

## 2. Các kịch bản kiểm thử (Test Cases)

### Kịch bản 1: Thêm người quen và đồng bộ (Face Register & Sync)

1. Mở giao diện quản trị (Dashboard), điều hướng vào mục **Người quen**.
2. Thêm một người quen mới (ví dụ: tên "Long") và tải lên một bức ảnh chụp rõ khuôn mặt.
3. Bấm nút **Lưu**.
4. **Kết quả mong đợi**:
   - Giao diện hiện lên nhãn "Đang chờ đồng bộ".
   - Chờ tối đa khoảng 10 giây (do chu kỳ đồng bộ là mỗi 10s), nhãn này sẽ biến mất và trạng thái tự động chuyển thành "Sẵn sàng nhận diện".
   - *(Dành cho Dev)* Bạn có thể check log bằng lệnh `docker logs camerai-ai` để thấy API đồng bộ trả về `POST /face/collection/sync HTTP/1.1" 200 OK`.

### Kịch bản 2: Frigate phát hiện người quen (Known Person Detected)

1. Bật camera (hoặc sử dụng file video mẫu giả lập webcam) có kết nối luồng với hệ thống Frigate.
2. Đứng vào trong khung hình sao cho camera nhìn thấy rõ mặt bạn (người đã được đăng ký ở Kịch bản 1).
3. Đợi vài giây để Frigate tạo sự kiện và phát thông báo qua MQTT.
4. Mở Dashboard trang **Sự kiện**, tìm và bấm vào sự kiện người lạ/chuyển động mới nhất vừa được hệ thống tạo ra.
5. **Kết quả mong đợi**:
   - Trường **Nhận diện người**: Hiển thị chính xác là "Người quen".
   - Trường **Người quen khớp**: Hiển thị đúng tên (ví dụ "Long") mà bạn đã lưu.
   - **Độ tin cậy AI**: Hiển thị % độ giống nhau (similarity) lớn hơn 60%.

### Kịch bản 3: Phân tích người lạ (Unknown Person Detected)

1. Nhờ một người **chưa từng được khai báo** vào danh sách "Người quen" bước ngang qua camera.
2. Chờ sự kiện mới được phân tích và tạo ra trên Dashboard.
3. Bấm vào xem chi tiết của sự kiện đó.
4. **Kết quả mong đợi**:
   - Trường **Nhận diện người**: Hiển thị là "Người lạ".
   - Trường **Người quen khớp**: Hiển thị là "Không".
   - *(Mở rộng)* Sự kiện "Người lạ" này sẽ kích hoạt quy trình tự động cảnh báo theo rule `UNKNOWN_PERSON` trong cài đặt mức độ ưu tiên của hệ thống (sau một khoảng thời gian chờ nhất định nếu không ai phản hồi).

### Kịch bản 4: Kiểm tra ngưỡng từ chối (Threshold Rejection)

1. Vẫn là người quen, nhưng dùng ảnh chất lượng kém, hoặc người quen đó đang đeo khẩu trang, cúi gập mặt che khuất các điểm đặc trưng.
2. Để Frigate bắt sự kiện.
3. **Kết quả mong đợi**:
   - Hệ thống AI sẽ tính toán độ tương đồng (similarity score).
   - Nếu độ giống nhau đo được **thấp hơn 0.6** (60%), hệ thống sẽ hoạt động đúng như thiết kế: tự động xếp người đó vào nhóm "Người lạ".

---

## 3. Khắc phục sự cố thường gặp (Troubleshooting)

- **Trạng thái "Chờ đồng bộ" bị treo (mãi không xong)**:
  - Có thể do ảnh tải lên không có chứa khuôn mặt, nên AI từ chối ghi nhận. Hoặc là Redis/Orchestrator bị mất kết nối. Hãy khởi động lại container `camerai-orchestrator` hoặc `camerai-ai`.
- **Luôn bị nhận diện thành "Người lạ" dù đã khai báo**:
  - Cần kiểm tra lại file cấu hình `.env` xem tham số `FACE_MATCH_THRESHOLD` có vô tình bị đặt quá khắt khe (ví dụ: `0.9` tương đương 90%) hay không.
  - Sau khi điều chỉnh `.env`, bắt buộc phải tái tạo lại container AI bằng lệnh: `docker compose up -d ai-service`.
