# Chuyển đổi JWT local và Cognito

Backend chọn **một** provider bằng `AUTH_PROVIDER` lúc khởi động. Mặc định là
`jwt`. Không fallback sang provider khác khi xác minh token thất bại. Cognito
cũng phát JWT; `jwt` ở đây là tên chế độ JWT nội bộ HS256 của ứng dụng.

## Nguyên nhân lỗi LOGIN_MAX_ATTEMPTS

AuthModule cũ luôn khởi tạo cấu hình local, dù đã đặt `AUTH_PROVIDER=cognito`.
Lỗi xảy ra khi container chạy NestJS, không phải trong bước biên dịch image.
AuthModule mới đọc biến môi trường của provider được chọn; Cognito không cần
JWT_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL, LOGIN_MAX_ATTEMPTS hoặc LOGIN_LOCK_MINUTES.

## Chạy JWT local

Trong `.env` tại thư mục gốc:

```dotenv
AUTH_PROVIDER=jwt
JWT_SECRET=<chuoi-ngau-nhien-it-nhat-32-ky-tu>
JWT_ACCESS_TTL=3600
JWT_REFRESH_TTL=604800
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
```

Không cần biến Cognito trong chế độ này. Giữ secret local trong nơi lưu secret
của môi trường triển khai để dùng khi rollback. Không commit `.env`.

## Chạy Cognito

```dotenv
AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=ap-southeast-1_EXAMPLE
COGNITO_CLIENT_ID=<public-app-client-id>
COGNITO_DOMAIN=https://<prefix>.auth.ap-southeast-1.amazoncognito.com
```

Không cần biến JWT local. Không cần AWS access key cho việc xác minh JWT bằng
JWKS công khai. App client không có client secret, dùng authorization code +
PKCE, scope `openid email profile`. Bật token revocation; refresh token rotation
có thể bật với grace period phù hợp cho lab. Callback URL phải là
`<browser-origin>/auth/callback`; sign-out URL là `<browser-origin>`.
Ví dụ local: `http://localhost:3000/auth/callback` và `http://localhost:3000`.

### Database và onboarding

Chạy migration cộng thêm trước khi chuyển traffic sang Cognito:

```powershell
pnpm db:migrate
```

Hoặc khi dùng container đang chạy:

```powershell
docker compose exec -w /workspace orchestrator node tools/scripts/migrate.mjs up
```

Migration `0017_cognito_issuer.sql` không xóa hay đổi users.id, role hoặc ownership.
Nếu chạy migration trong container cũ chưa có file mới, build/recreate image
trước hoặc dùng máy dev có source mới. Migration command cần DATABASE_URL hiện có.

Quản trị viên chọn đúng application user và liên kết Cognito user bằng `sub`
lấy trong Cognito Console. Không tự liên kết theo email:

```sql
SELECT id, email, role, cognito_sub, cognito_issuer FROM users;

UPDATE users
SET cognito_sub = '<cognito-sub>',
    cognito_issuer = 'https://cognito-idp.ap-southeast-1.amazonaws.com/<pool-id>'
WHERE id = '<application-user-id>' AND cognito_sub IS NULL;
```

Kiểm tra đúng một dòng được cập nhật. Nếu trước đó đã đặt cognito_sub, kiểm tra
liên kết đó rồi bổ sung issuer với điều kiện id và sub khớp; không ghi đè ngầm.
Không đổi password_hash hoặc cấp ADMIN tự động. Role vẫn lấy từ users.

Token Cognito được xác minh chữ ký, expiry, issuer, client_id, token_use=access,
scope openid trước khi truy vấn mapping `(issuer, sub)`. Request nhận application
user ID để các kiểm tra ownership hiện tại tiếp tục hoạt động. Token hợp lệ nhưng
user chưa map hoặc bị vô hiệu hóa nhận 403. Token sai nhận 401.

## Triển khai và rollback

Sau lần cập nhật mã này, build cả hai image một lần:

```powershell
docker compose up -d --build orchestrator web
```

Sau đó chỉ đổi AUTH_PROVIDER và cấu hình tương ứng trong `.env`, rồi recreate
backend để Docker nạp lại biến môi trường:

```powershell
docker compose up -d --no-deps --force-recreate orchestrator
```

`docker compose restart` không nạp lại environment mới. Không xóa volume.
Frontend gọi `GET /api/v1/auth/config` với no-store để nhận chế độ đang chạy,
không dùng NEXT_PUBLIC_AUTH_PROVIDER. Tải lại trang và đăng nhập lại sau mỗi lần
chuyển provider; token của provider cũ bị từ chối. Giữ các biến local và Cognito
trong cấu hình secret riêng của môi trường; không phải comment qua lại.

Để rollback về local: đặt AUTH_PROVIDER=jwt, bảo đảm các biến local còn đầy đủ,
recreate backend rồi đăng nhập local. Không rollback migration cộng thêm này.
User chỉ có tài khoản Cognito và password_hash=NULL không tự có mật khẩu local;
chuẩn bị tài khoản local dự phòng trước khi chuyển production.

Chế độ này cần restart/redeploy backend; chưa phải chuyển traffic không downtime.
Continuous Delivery cần thêm bước phê duyệt/promote/deploy theo hạ tầng của nhóm.
CI bổ sung build web/backend và image production; test auth khởi tạo hai chế độ
không cần secret AWS. Trước promote Cognito vẫn cần smoke test trên pool dev thật.

## Kiểm tra sau triển khai

```powershell
curl.exe -i http://localhost:3001/api/v1/auth/config
curl.exe -i http://localhost:3001/api/v1/auth/me
docker compose ps orchestrator
docker compose logs --tail 50 orchestrator
```

Config trả 200 và đúng provider; không có token hoặc secret. /auth/me không token
trả 401. Trong Cognito mode, POST /auth/login và /auth/refresh local trả 409.
Thử login, refresh, logout, role 403, cross-owner và SSE ở cả hai chế độ.
Logout Cognito phải đi qua browser tới /logout; POST /auth/logout của API chỉ
dọn cookie local, không thay thế thu hồi token và phiên đăng nhập tại Cognito.
JWT xác minh cục bộ không tự biết mọi revocation ngay lập tức.

Frontend dùng sessionStorage cho phiên OIDC trong lab; nó không chống được XSS.
Không ghi token vào log hoặc ảnh evidence. API_BASE_URL hiện vẫn là biến
NEXT_PUBLIC_API_BASE_URL của Next.js: nếu thay URL API giữa các môi trường phải
build bundle với URL phù hợp hoặc dùng một gateway có URL ổn định. Khả năng đổi
provider lúc chạy không đồng nghĩa mọi cấu hình frontend đã là runtime config.

## Nguồn

- [AWS JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [NestJS factory providers](https://docs.nestjs.com/fundamentals/custom-providers)
- [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)
