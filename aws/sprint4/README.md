# Sprint 4 — Chọn đúng phần của mình rồi làm từ đầu đến cuối

Nhóm dùng **một tài khoản AWS do C quản lý, ba IAM User A/B/C với access key riêng**. Mỗi người cấu hình CLI bằng `aws configure --profile camerai-lab`; không dùng SSO/Organizations. C cấp quyền cho người dùng, role cho EC2/Lambda và tạo/quản lý toàn bộ tài nguyên AWS dùng chung. A/B gửi yêu cầu, viết mã rồi kiểm tra tính năng; không tạo thêm bộ dịch vụ riêng. Cách làm cụ thể đã có ngay trong từng file dưới đây.

Mục tiêu: hoàn thành CameraAI để demo đồ án trên một bản dev dùng chung. Bộ này chỉ hướng dẫn thực hiện tính năng; các bài học dịch vụ đã có trong bộ lab khác và không lặp lại ở đây. Mỗi người chỉ cần **một tài liệu**:

| Người | Mở tài liệu này                                                                | Kết quả cần làm xong                                                          |
| ----- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| A     | [Đăng nhập và gửi thông báo](02_NGUOI_A_DANG_NHAP_THONG_BAO.md)                | Đăng nhập đúng quyền, gửi thông báo từ sự kiện và thấy kết quả trong ứng dụng |
| B     | [Ảnh, nhận diện, hẹn giờ và dữ liệu thông báo](03_NGUOI_B_DU_LIEU_WORKFLOW.md) | Ảnh/kết quả về app, xác nhận hoặc hết hạn xử lý đúng, có API cho A gửi tin    |
| C     | [Máy chủ, triển khai và bản demo](04_NGUOI_C_HA_TANG_VAN_HANH.md)              | HTTPS, tài nguyên AWS, nối edge, giám sát và cách khôi phục bản demo          |

Ba người bắt đầu cùng lúc. Trong mỗi file đã có phần chuẩn bị, đầu vào nhận từ C, cấu hình, phần phải lập trình, cách thử và mẫu bàn giao. Đọc tới dòng **Đợi A/B/C hoàn thiện…** thì làm phần độc lập tiếp theo trong cùng file. Đọc tới **Đưa kết quả … cho A/B/C** thì bàn giao ngay, đừng đợi xong cả tài liệu.

Chỉ ghi đã hoàn thành khi tính năng chạy qua ứng dụng trên bản dùng chung, người khác làm lại được và có kết quả kiểm tra. Tạo tài nguyên trên Console, chạy bằng dữ liệu mẫu hoặc chạy thử không gửi tin thật phải ghi đúng phạm vi đó. Những API/worker ghi cần tạo vẫn là phần thành viên phải viết.

Các hướng dẫn trước ngày viết lại nằm trong `luu_tru_2026_11_05/`, chỉ để đối chiếu lịch sử, **không cần đọc để làm bài**. File `00_HOP_DONG_G0.md` và thư mục `contracts/` giữ quy ước kỹ thuật/dữ liệu máy đọc; phần cần dùng đã đưa vào từng tài liệu A/B/C. Không dùng các hướng dẫn cũ như một danh sách việc bổ sung.

Bản viết lại ngày 05/11/2026. Tên nút tiếng Anh được giữ để tìm đúng trên AWS; mã biến/API được giữ để không làm sai cấu hình. Việc viết lại tài liệu không chứng minh tài khoản hoặc tính năng đã được chạy thành công.
