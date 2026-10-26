# Lab 05 — Đăng nhập Cognito và hiểu token API

## Mục tiêu và điều kiện

Qua lab 00, frontend/API local chạy được. A/B học song song luồng face; không cần model. Học phân biệt **identity** (ai đăng nhập) và **authorization** (người đó được xem camera nào).

## A. Thử User Pool trước

1. Console Cognito, Region Singapore → tạo User Pool lab `camerai-lab-users`. Chọn login email/password theo nhu cầu nhóm; ghi feature tier đang chọn và chi phí, không bật tính năng nâng cao chưa dùng.
2. Tạo app client cho browser/public, **không client secret**. Bật authorization code grant, scope `openid`, `email`, `profile`; đăng ký callback local như `http://localhost:3000/auth/callback` và logout URL `http://localhost:3000`. Những route này **cần được tạo ở phần B**, chưa có chỉ vì bạn đăng ký URL.
3. Cấu hình domain/managed login theo khả năng của pool. Tạo một test user qua Console; hoàn thành email verification/temporary-password challenge theo flow đã cấu hình. Không dùng số điện thoại thật làm MFA cho bài cơ bản.
4. Ghi User Pool ID, app client ID, issuer URL, domain và callback URI trong cấu hình lab **không chứa token/password**. User Pool ID khác client ID.
5. Dùng chức năng mở trang login của app client nếu UI cung cấp để kiểm tra trang hiển thị. Nếu callback route chưa có, login có thể về 404: đây chưa phải lỗi credentials, và chưa tính login tích hợp pass.

## B. Nối vào dashboard và NestJS

1. A tạo login/callback/logout bằng thư viện OIDC được nhóm chọn và khóa version qua PR; flow **Authorization Code + PKCE S256**. Client tạo state/nonce/verifier, kiểm tra callback state, đổi code lấy token. Không ghép thủ công access token vào URL.
2. B thêm verifier Cognito vào guard/adapter auth hiện có. Có thể dùng `aws-jwt-verify` theo [hướng dẫn AWS](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html); dependency phải được review trước khi thêm, không coi package đã có.
3. Guard kiểm tra signature/JWKS, issuer, expiry, token_use access, client ID và scope mong đợi; audience nếu app dùng resource binding. Cache JWKS; không gọi Cognito cho mỗi API request.
4. Map `(issuer, sub)` vào application user. Giữ IDs/ownership camera/incident hiện có. Demo có thể onboarding test user mới qua quy trình kiểm soát; không tự ghép admin theo email và không hứa chuyển password hash cũ sang Cognito.
5. Frontend gửi **access token** vào Authorization của API, không dùng ID token thay thế. Chọn cách lưu token/refresh/logout và bảo vệ XSS/CSRF theo mô hình browser đã chọn. Không đổi sang BFF nửa chừng mà không cập nhật sequence/contract.
6. A/B tạo hai test users với quyền khác nhau và thực hiện bảng test sau.

## Kết quả cần thấy

| Thao tác                        | Kết quả kỳ vọng                                      |
| ------------------------------- | ---------------------------------------------------- |
| Login và gọi API của chính user | 200, đúng dữ liệu                                    |
| Không gửi token                 | 401                                                  |
| Token sai issuer/client/hết hạn | 401                                                  |
| User không có role cần thiết    | 403                                                  |
| User A đọc camera của user B    | Từ chối theo policy, không lộ media                  |
| Refresh thành công              | API tiếp tục chạy với access token mới               |
| Logout/reset password           | Đúng flow đã chọn; không ghi password/token vào logs |

API xác minh JWT cục bộ không tự biết mọi revocation ngay lập tức. Ghi rõ session/expiry policy, không kết luận logout đã làm mọi access token cũ mất hiệu lực tức thì nếu chưa có cơ chế đó.

## Lỗi thường gặp

- `redirect_mismatch`: callback URI phải khớp chính xác scheme/host/port/path đã đăng ký.
- API vẫn đòi JWT_SECRET nội bộ: auth module chưa wire Cognito; chỉ đổi `.env` chưa đủ.
- Login được nhưng 403: kiểm tra mapping/role/ownership, không bỏ guard để demo chạy.
- `invalid_grant`: code dùng rồi/hết hạn hoặc PKCE verifier không đúng; bắt đầu phiên login mới.
- Console pool không thấy user: kiểm tra account/Region/pool, không nhầm Identity Pool với User Pool.

## Qua bài và dọn dẹp

- [ ] A giải thích code khác token; B giải thích access token khác ID token.
- [ ] Có test 200/401/403/cross-owner và bằng chứng không chứa token.
- [ ] Chưa tích hợp xong callback/guard thì ghi NEEDS_FIX, không chỉ chụp trang login rồi Done.

Nếu tiếp tục integration, giữ pool dev có kiểm soát. Nếu dọn pool lab, kiểm tra không gắn user thật/dữ liệu cần giữ; xóa user/client/domain/pool lab theo Console và ghi inventory. Không xóa pool chung. **Bài tiếp: [08 — EC2](08_EC2_EDGE.md)** sau khi backend đã hoàn tất các lab cần thiết.

Nguồn: [Cognito authorization và PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).
