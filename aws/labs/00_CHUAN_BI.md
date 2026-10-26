# Lab 00 — Nhận biết tài khoản, Region và quyền đang dùng

## Mục tiêu học

Bạn biết mình đang thao tác trên tài khoản nào, vì sao phải chọn Singapore và vì sao người dùng/CLI và Lambda cần quyền khác nhau. Cuối bài gọi được STS từ máy dev; chưa cần cài SAM hoặc deploy ứng dụng.

## Chuẩn bị

- Một tài khoản AWS nhóm được phép sử dụng; người quản lý có quyền cấp access và xem Billing.
- Máy Windows/PowerShell. Không dùng tài khoản root để làm lab.
- Tạo danh sách tài nguyên lab và một địa chỉ email nhóm nhận cảnh báo chi phí.

## Thực hành

1. Đăng nhập AWS Console. Ghi account alias/ID vào ghi chép nhóm, chọn **Asia Pacific (Singapore) — ap-southeast-1** ở Region selector. Không chụp credentials vào ảnh evidence.
2. Mở Billing để người quản lý kiểm tra plan, credits còn lại/ngày hết hạn và service có được phép dùng hay không. Tạo monthly budget alert theo mức nhóm chấp nhận, ví dụ 5 USD và 10 USD. Budget có độ trễ và không tự chặn mọi chi phí.
3. Cài **AWS CLI v2** theo [hướng dẫn Windows chính thức](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html). Mở PowerShell mới rồi chạy:

   ```powershell
   aws --version
   ```

4. Cấu hình profile `camerai-lab`. Chọn cách access mà người quản lý đã cấp, không tự tạo access key root:
   - Nếu nhóm đã có IAM Identity Center: lấy start URL/SSO Region/role từ người quản lý, chạy `aws configure sso --profile camerai-lab`, rồi `aws sso login --profile camerai-lab`.
   - Nếu nhóm được cấp IAM credentials riêng cho lab: chạy `aws configure --profile camerai-lab`; nhập keys trực tiếp vào prompt, Region `ap-southeast-1`, output `json`. Credentials tạm thời còn cần session token được cấu hình theo hướng dẫn của người cấp. Không ghi keys vào Markdown/Git hoặc truyền như literal trong command history.
   - Chưa có quyền/profile: đánh dấu `BLOCKED_ACCOUNT`, nhờ người quản lý cấp đúng access; không chữa bằng cách gắn AdministratorAccess cho mọi người.
5. Chạy lệnh đọc thông tin identity, không tạo resource:

   ```powershell
   aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
   ```

6. Đối chiếu `Account` và `Arn` với tài khoản/role được giao. Với mỗi lệnh CLI tiếp theo luôn ghi rõ profile và Region. Mỗi cửa sổ PowerShell có biến riêng; nếu mở cửa sổ mới phải đặt lại các biến không chứa secret được dùng trong bài.

## Cần nhìn thấy gì?

STS trả về identity đúng tài khoản/role. `aws --version` là v2. Bạn biết rõ budget và quyền dùng dịch vụ của nhóm; chưa có VM đang chạy vì bài này.

## Tự giải thích

- **Region:** nơi chọn triển khai dịch vụ; tài nguyên Singapore không tự xuất hiện khi mở Region khác.
- **IAM role:** tập quyền được một actor sử dụng; Lambda execution role khác profile dev tạo Lambda.
- **ARN:** tên định danh tài nguyên AWS, không phải credential.
- **AWS CLI:** gọi API từ terminal; Console cũng là cách thao tác AWS, không phải ứng dụng đang deploy.

## Lỗi thường gặp

| Hiện tượng                      | Kiểm tra trước                                                           |
| ------------------------------- | ------------------------------------------------------------------------ |
| Không tìm thấy `aws`            | Cài CLI v2, mở terminal mới, kiểm tra PATH                               |
| `Unable to locate credentials`  | Profile đúng chưa; đã login/cấp credentials chưa                         |
| `ExpiredToken`                  | Đăng nhập/cấp lại session theo phương thức đã dùng                       |
| `AccessDenied` khi tạo resource | Xin đúng quyền của bài; STS thành công không có nghĩa được tạo S3/Lambda |
| Console không thấy resource     | Account và Region có trùng với CLI không                                 |

## Qua bài và dọn dẹp

- [ ] STS đúng identity; không có secret trong repo/evidence.
- [ ] Một người khác nghe bạn giải thích Region, profile và execution role.
- [ ] Ghi mức budget/credits và người quản lý quyền.

Không xóa account, IAM role dùng chung hoặc budget sau bài. CLI/profile có thể giữ để học tiếp. **Bài tiếp: [01 — S3](01_S3.md)** hoặc [02 — Lambda/SQS](02_LAMBDA_SQS.md).
