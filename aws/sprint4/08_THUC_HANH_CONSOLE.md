# Thao tác Console đã kiểm tra trên trình duyệt

Kiểm tra ngày **04/11/2026**, Console English, Singapore. Đọc phần tương ứng trước khi làm A1, B1–B3 hoặc C3. Đây là các biểu mẫu đã mở thực tế; chưa bấm tạo tài nguyên hoặc lưu cấu hình. Giá trị dưới đây là lựa chọn cho bài lab, không phải mọi giá trị mặc định của AWS.

## A — Tạo Cognito và sửa callback đúng chỗ

1. Trong Search trên thanh AWS, nhập `Cognito`, mở kết quả thuộc Services.
2. Kiểm tra Region **Asia Pacific (Singapore)**. Chọn **User pools**, rồi **Create user pool**.
3. Trang tiếp theo có tiêu đề **Set up resources for your application**. Trong **Define your application**, chọn **Single-page application (SPA)**.
4. Ô **Name your application**: nhập `camerai-s4-dev-web`. Đây là tên ứng dụng/app client, không phải tên user pool.
5. Trong **Configure options**, điền theo bảng. Các lựa chọn sign-in/required attributes cần quyết định trước khi tạo vì không sửa tùy ý sau đó.

| Trường trên màn hình                         | Chọn/nhập cho lab                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| Options for sign-in identifiers              | Email                                                                         |
| Self-registration → Enable self-registration | Bỏ chọn; quản trị viên tạo user lab                                           |
| Required attributes for sign-up              | Chọn email nếu chưa có                                                        |
| Add a return URL - optional → Return URL     | Xóa toàn bộ `https://` đang có rồi nhập `http://localhost:3000/auth/callback` |

6. Cuộn xuống cuối. Nút xác nhận hiện tại là **Create user directory**. Khi bạn sẵn sàng tạo pool, bấm nút này một lần và đợi trang kết quả.
7. Mở pool → **Overview**, ghi **User pool ID**. Nếu muốn đổi tên hiển thị pool, dùng **Rename** tại đây; không tìm ô tên pool trong wizard ứng dụng.
8. Menu trái → **Applications → App clients**. Trong bảng **App clients and analytics**, bấm tên client vừa tạo.
9. Trang mặc định mở tab **Quick setup guide**. Trong **App client information**, kiểm tra **Client secret** là `-` cho public browser client. Không đưa secret vào frontend.
10. Bấm tab **Login pages**. Trong khung **Managed login pages configuration**, bấm **Edit** ở chính khung này. Nút Edit phía trên trong App client information không phải nơi sửa callback.
11. Trang **Edit managed login pages configuration**: kiểm tra từng dòng dưới đây. Nếu đã có URL local đúng, giữ lại; dùng **Add another URL** để thêm URL cloud sau khi C có HTTPS.

| Trường                      | Giá trị                                                  |
| --------------------------- | -------------------------------------------------------- |
| Allowed callback URLs → URL | `http://localhost:3000/auth/callback`                    |
| Default redirect URL        | Có thể để chưa chọn cho bài này                          |
| Allowed sign-out URLs → URL | `http://localhost:3000`                                  |
| Identity providers          | Cognito user pool                                        |
| OAuth 2.0 grant types       | Authorization code grant; bỏ Implicit nếu có             |
| OpenID Connect scopes       | Email, OpenID, Profile; tương ứng `email openid profile` |
| Custom scopes               | Để trống cho bài cơ bản                                  |

12. Bấm **Save changes** khi đã đối chiếu đúng client. Quay lại Login pages, đọc lại Allowed callback URLs và Allowed sign-out URLs để chắc chắn đã lưu.
13. Trong menu **Branding → Domain**, kiểm tra domain đang có trước khi tạo thêm. Sao chép origin HTTPS cho cấu hình ứng dụng; không thêm đường dẫn authorize vào biến domain.
14. Tiếp tục A2/A3 trong [tài liệu người A](02_NGUOI_A_DANG_NHAP_THONG_BAO.md). Mật khẩu local và Cognito độc lập; không dùng email ảo cho bài reset password.

## B — Tạo S3 private

1. Search `S3` → **Buckets** → tab **General purpose buckets** → **Create bucket**. Danh sách bucket có thể hiển thị All AWS Regions; kiểm tra region của từng bucket.
2. Trong **General configuration**, kiểm tra Singapore và điền bảng sau.

| Trường                                       | Giá trị lab                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Bucket type                                  | General purpose                                                                    |
| Bucket namespace                             | Global namespace, để khớp mẫu lab đang dùng                                        |
| Bucket name                                  | `camerai-s4-lab-b-media-<suffix-duy-nhat>`; thay cả placeholder bằng chữ/số thường |
| Object Ownership                             | ACLs disabled (recommended)                                                        |
| Block Public Access settings for this bucket | Giữ Block all public access bật                                                    |
| Bucket Versioning                            | Disable cho bài ảnh lab ngắn hạn; quyết định riêng cho dữ liệu cần khôi phục       |
| Tags - optional                              | Add new tag: Project=CameraAI, Environment=lab, Owner=B, Sprint=4                  |
| Default encryption → Encryption type         | Server-side encryption with Amazon S3 managed keys (SSE-S3)                        |

3. Console còn có **Account Regional namespace (recommended)**. Bài này chủ động chọn Global; không khẳng định mọi loại namespace đều yêu cầu tên duy nhất toàn cầu. Nếu dùng Global và tên bị trùng, đổi suffix rồi thử lại.
4. Cuộn cuối, kiểm tra lại tên và public access rồi **Create bucket**. Kết quả cần có bucket trong danh sách, region Singapore. Các bước upload/lifecycle tiếp tục tại B1; chưa được thao tác thực tế trong phiên kiểm tra này.

## B — SQS: tạo DLQ trước, queue chính sau

1. Search `SQS` → **Queues → Create queue**.
2. Tạo DLQ trước: **Type = Standard**, Name `camerai-s4-lab-b-face-dlq`. Retention 4 Days, encryption Enabled → **Amazon SQS key (SSE-SQS)**. Access policy Basic, giữ Only the queue owner ở hai lựa chọn gửi/nhận.
3. Với chính DLQ này, giữ **Dead-letter queue - Optional = Disabled**. Cuộn cuối và **Create queue**. Mở Details, lưu ARN.
4. Quay Queues → Create queue; Type Standard, Name `camerai-s4-lab-b-face-jobs`.

| Configuration             | Giá trị queue chính                                      |
| ------------------------- | -------------------------------------------------------- |
| Visibility timeout        | 60, đơn vị Seconds                                       |
| Message retention period  | 1, đơn vị Days                                           |
| Delivery delay            | 0 Seconds                                                |
| Maximum message size      | Có thể giữ mặc định; màn hình kiểm tra hiển thị 1024 KiB |
| Receive message wait time | 20 Seconds                                               |

5. Giữ encryption SSE-SQS và access policy private như DLQ.
6. Cuộn qua **Redrive allow policy - Optional**. Đây là quyền cho queue nguồn sử dụng queue này làm DLQ; không phải nơi chọn đích nhận message lỗi.
7. Tìm khung riêng **Dead-letter queue - Optional**, chọn **Enabled**. Trong **Choose queue**, chọn ARN của `face-dlq`.
8. **Maximum receives**: thay giá trị mặc định đang là `10` thành `5`. Kiểm tra lại rồi **Create queue**.
9. Mở Details queue chính; lưu URL và ARN riêng. URL dùng SDK, ARN dùng IAM/trigger.
10. Lặp lại cho echo và results theo B2. Không nối echo Lambda vào face-jobs. Trong danh sách Queues có nút **Send and receive messages** trực tiếp; không bắt buộc tìm trong Actions.

## B — Lambda: tên và vị trí mới

1. Search `Lambda`. Trang danh sách trong tài khoản hiện tại là **Event Functions**; bấm **Create Event Function**.
2. Chọn **Author from scratch**. Function name: `camerai-s4-lab-b-echo`.
3. **Runtime** mặc định quan sát được là Node.js 24.x. Chủ động mở danh sách và chọn Python tương thích code Lab 02; không để Node.js rồi dán Python. Việc có Python 3.12 trong danh sách chưa được kiểm tra trong phiên này; nếu không có, nhóm chọn runtime được hỗ trợ và kiểm thử lại code.
4. Trong **Custom settings**, giữ **Durable execution** và **EC2 capacity provider** tắt cho bài SQS thông thường.
5. Mở **Additional settings**. Trong **General**, để **ARM64 architecture** tắt nếu dùng x86_64.
6. Nếu C đã chuẩn bị execution role, bật **Custom execution role** rồi chọn role theo các trường xuất hiện. Nếu giữ tắt, Console tạo role mới với quyền Logs cơ bản; role này chưa tự có quyền SQS/S3/Rekognition của bài lab.
7. Giữ Function URL/VPC tắt cho echo queue lab. Cuộn cuối, **Create Event Function** khi đã kiểm tra runtime/role.
8. Sau tạo, tiếp tục B3 để dán handler, Deploy, đặt timeout và gắn trigger. Các màn hình sau tạo/trigger chưa được kiểm tra trực tiếp trong phiên này; dùng hướng dẫn AWS được liên kết tại B3 nếu nhãn khác.

## C — EC2: đọc từng khung trước khi Launch

1. Search `EC2`. Trang giới thiệu tài khoản hiện tại có **Launch instance**; hoặc mở **Instances → Launch instances**. Cả hai dẫn tới **Launch an instance**.
2. **Name and tags → Name**: `camerai-s4-dev-app`; **Add additional tags** để thêm Environment/Owner/Sprint.
3. **Application and OS Images (Amazon Machine Image) → Quick Start → Ubuntu**. Chọn Ubuntu Server 24.04 LTS theo baseline C3, xác nhận Canonical và **Architecture = 64-bit (x86)**. Không giữ Amazon Linux mặc định rồi dùng lệnh cài Ubuntu.
4. **Instance type**: chọn cấu hình nhóm duyệt, kiểm tra RAM/giá trên dropdown. `t3.micro` mặc định không phải cam kết đủ RAM cho toàn bộ Compose.
5. **Key pair (login)**: chọn key đã quản lý hoặc phương án không key chỉ khi đã chuẩn bị SSM theo C2/C4.
6. **Network settings → Edit**: chọn VPC/subnet đã ghi ở C1, Auto-assign public IP theo phương án public dev.
7. **Firewall (security groups)**: ưu tiên **Select existing security group**, chọn nhóm C1 đã review. Wizard kiểm tra đang mặc định **Allow SSH traffic from → Anywhere 0.0.0.0/0** khi tạo nhóm mới; phải sửa thành IP quản trị /32 hoặc bỏ SSH nếu dùng SSM. HTTPS/HTTP chỉ bật theo phương án proxy đã chốt.
8. **Configure storage**: nhập dung lượng nhóm duyệt, ví dụ 30 GiB gp3. Bấm **Advanced** trong chính khung storage để kiểm tra encryption; bản mặc định quan sát ghi **Not encrypted**, không giả định đã mã hóa. Đặt encrypted và ghi lựa chọn Delete on termination.
9. **File systems**: giữ **None** cho bài Compose này; không cần chọn S3 Files/EFS/FSx.
10. Mở **Advanced details** ở cuối biểu mẫu. Trong **IAM instance profile**, chọn profile C2. Nếu vừa tạo role, bấm nút refresh bên cạnh dropdown.
11. Trong cùng khung, tìm **Metadata accessible = Enabled**, **Metadata version = V2 only (token required)**, **Metadata response hop limit = 2** cho SDK trong Docker bridge. Đây là các nhãn thực tế đã đọc; vẫn phải thử lấy credentials từ container sau triển khai.
12. Trong **Summary** bên phải, kiểm tra **Number of instances = 1**, AMI, instance type, firewall và storage. Nút **Launch instance** tạo máy thật; chỉ bấm sau khi các lựa chọn và chi phí đã được nhóm chốt.
13. Sau tạo, theo C3/C4 kiểm tra Running/status checks và Session Manager. Phiên kiểm tra tài liệu chưa launch máy hoặc thử kết nối SSM.

## Phạm vi còn cần xác minh

SNS subscriptions/publish, SMS, Connect, Step Functions editor, CloudWatch alarm wizard, IAM role wizard và các thao tác sau tạo chưa được kiểm tra trực tiếp. Hướng dẫn tương ứng trong A/B/C dựa trên nguồn AWS tại [bảng nguồn](07_CONSOLE_VA_NGUON.md); không được hiểu là đã chạy thành công trên tài khoản của bạn. Không có tài nguyên AWS nào được tạo hoặc cấu hình được lưu trong phiên khảo sát này.
