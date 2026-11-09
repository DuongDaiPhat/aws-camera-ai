# Thiết lập đăng nhập Cognito cho CameraAI trên máy khác

Hướng dẫn dùng lại User Pool và app client của nhóm, chạy CameraAI trên máy phát triển mới hoặc liên kết ba tài khoản với PostgreSQL của bản cloud hiện có.

## 1. Chọn môi trường

- **Chỉ dùng bản cloud từ máy khác**. Mở [CameraAI trên cloud](https://argusai.dynv6.net/login) và đăng nhập. Máy người dùng chỉ cần trình duyệt. Nếu gặp thông báo tài khoản chưa được cấp quyền, người vận hành thực hiện mục 4 trên máy chủ.
- **Chạy bản local trên máy mới**. Thực hiện mục 2 và 3, rồi liên kết tài khoản trong PostgreSQL local theo mục 4.
- **Khôi phục đăng nhập cho bản cloud đang chạy**. Kiểm tra URL trong mục 2, rồi thực hiện mục 4 trên PostgreSQL mà orchestrator cloud đang dùng.

## 2. Kiểm tra app client Cognito

Trong AWS Console, chọn vùng **Asia Pacific (Singapore)** → **Amazon Cognito** → **User pools** → pool `ap-southeast-1_4WQxu8bnB` → **App clients**. Chọn public SPA client có ID `5p3hgqnkmjrdc5ktb99ur46hjr`.

Trong **Login pages → Managed login pages configuration → Edit**, thêm URL cho môi trường cần chạy. Giữ các URL đang dùng cho môi trường còn lại.

| Môi trường | Allowed callback URLs                     | Allowed sign-out URLs       |
| ---------- | ----------------------------------------- | --------------------------- |
| Local      | `http://localhost:3000/auth/callback`     | `http://localhost:3000`     |
| Cloud      | `https://argusai.dynv6.net/auth/callback` | `https://argusai.dynv6.net` |

App client sử dụng **Cognito user pool directory**, **Authorization code grant** và các scope `openid`, `email`, `profile`. CameraAI tự tạo callback từ địa chỉ đang mở trên trình duyệt, nên mở đúng hostname, giao thức và cổng đã đăng ký. [Cấu hình app client Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html) · [Đăng xuất qua Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)

## 3. Chạy local trên máy mới

Chuẩn bị Git, Docker có Compose, Node.js 22 trở lên và pnpm theo phiên bản trong `package.json`. Mở terminal ở thư mục gốc repo CameraAI đã có code xác thực Cognito và migration `0017_cognito_issuer.sql`.

1. Dùng lệnh PowerShell bên dưới để tạo `.env` từ `.env.example` nếu máy chưa có file cấu hình.

   ```powershell
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   ```

2. Sửa các dòng tương ứng trong `.env`. Thay `THAY_MAT_KHAU_POSTGRES` bằng cùng mật khẩu ở cả hai dòng PostgreSQL, mã hóa ký tự đặc biệt khi đặt mật khẩu vào URL. Điền mật khẩu MinIO và các token nội bộ theo cấu hình dev của nhóm. Chuyển các giá trị riêng qua nơi nhóm quản lý cấu hình.

   ```dotenv
   POSTGRES_PASSWORD=THAY_MAT_KHAU_POSTGRES
   DATABASE_URL=postgresql://camerai:THAY_MAT_KHAU_POSTGRES@postgres:5432/camerai
   AUTH_PROVIDER=cognito
   COGNITO_USER_POOL_ID=ap-southeast-1_4WQxu8bnB
   COGNITO_CLIENT_ID=5p3hgqnkmjrdc5ktb99ur46hjr
   COGNITO_DOMAIN=https://ap-southeast-14wqxu8bnb.auth.ap-southeast-1.amazoncognito.com
   WEB_ORIGIN=http://localhost:3000
   NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
   ```

3. Cài dependency, build contract rồi khởi động PostgreSQL và ứng dụng.

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @cam/contracts build
   docker compose up -d --build --wait postgres redis orchestrator web
   docker compose ps
   ```

   Với volume PostgreSQL mới, Compose chạy các file trong `db/migrations/` khi khởi tạo. Nếu đây là **DB local mới** và cần các hồ sơ demo trong bảng ở mục 4, chạy `pnpm seed` từ terminal trên máy. Với DB đã có dữ liệu, kiểm tra hồ sơ hiện có trước khi liên kết.

4. Mở [API cấu hình đăng nhập local](http://localhost:3001/api/v1/auth/config) và kiểm tra `provider` là `cognito`. Sau khi liên kết DB ở mục 4, mở [CameraAI local](http://localhost:3000/login).

Với bản **cloud đang chạy**, kiểm tra [API cấu hình đăng nhập cloud](https://argusai.dynv6.net/api/v1/auth/config) để xác nhận pool và client. Nếu đang dựng một bản cloud mới, đặt `WEB_ORIGIN=https://argusai.dynv6.net` cho orchestrator, build web với `NEXT_PUBLIC_API_BASE_URL=https://argusai.dynv6.net/api/v1` và dùng quy trình triển khai của nhóm. [Hướng dẫn triển khai Sprint 4](04_NGUOI_C_HA_TANG_VAN_HANH.md)

## 4. Liên kết ba tài khoản trong PostgreSQL

Trong đúng User Pool, vào **Users** và mở từng người dùng để lấy **User ID (Sub)**. Đối chiếu email đăng nhập đã được nhóm duyệt với từng hồ sơ CameraAI. Dùng các hồ sơ ứng dụng hiện có để giữ ID, vai trò và quyền camera.

| Hồ sơ CameraAI        | Vai trò cần khớp | Giá trị cần điền                                 |
| --------------------- | ---------------- | ------------------------------------------------ |
| `admin@camerai.local` | `ADMIN`          | `sub` của tài khoản admin đã được duyệt          |
| `caregiver@local`     | `CAREGIVER`      | `sub` của tài khoản người giám sát đã được duyệt |
| `viewer@local`        | `VIEWER`         | `sub` của tài khoản người xem đã được duyệt      |

Mở `psql` từ máy đang chạy PostgreSQL đích. Trên cloud, vào terminal của máy chủ triển khai và dùng `sudo docker` nếu tài khoản máy chủ yêu cầu. Dùng `docker ps` để kiểm tra tên container.

```bash
docker exec -it camerai-postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Dùng câu lệnh sau để kiểm tra hồ sơ và cấu trúc hiện tại trước khi cập nhật.

```sql
SELECT id, email, role, is_active, cognito_issuer, cognito_sub
FROM users
WHERE email IN ('admin@camerai.local', 'caregiver@local', 'viewer@local')
ORDER BY role;
```

Nếu thiếu cột `cognito_issuer`, áp dụng migration `0017_cognito_issuer.sql` theo quy trình migration của môi trường đó trước khi tiếp tục. Nếu hồ sơ hoặc vai trò cloud khác bảng trên, đối chiếu với người quản lý DB để xác định đúng hồ sơ và người được cấp quyền.

Thay ba giá trị `PASTE_..._SUB` bằng các `sub` đã đối chiếu, rồi dán cả khối sau vào `psql`. Giao dịch sẽ hủy nếu thiếu hồ sơ, vai trò khác, tài khoản bị vô hiệu hóa hoặc đã có liên kết khác. Các giá trị mẫu bị chặn trước khi cập nhật.

```sql
\set admin_sub 'PASTE_ADMIN_SUB'
\set caregiver_sub 'PASTE_CAREGIVER_SUB'
\set viewer_sub 'PASTE_VIEWER_SUB'

BEGIN;

CREATE TEMP TABLE cognito_setup_links (
  email citext PRIMARY KEY,
  expected_role text NOT NULL,
  cognito_sub text NOT NULL UNIQUE
    CHECK (cognito_sub <> '' AND left(cognito_sub, 6) <> 'PASTE_')
) ON COMMIT DROP;

INSERT INTO cognito_setup_links (email, expected_role, cognito_sub)
VALUES
  ('admin@camerai.local', 'ADMIN', :'admin_sub'),
  ('caregiver@local', 'CAREGIVER', :'caregiver_sub'),
  ('viewer@local', 'VIEWER', :'viewer_sub');

DO $link$
DECLARE
  pool_issuer CONSTANT text :=
    'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB';
  matched_count integer;
BEGIN
  UPDATE users AS u
  SET cognito_issuer = pool_issuer,
      cognito_sub = m.cognito_sub
  FROM cognito_setup_links AS m
  WHERE u.email = m.email
    AND u.role::text = m.expected_role
    AND u.is_active = true
    AND (u.cognito_issuer IS NULL OR u.cognito_issuer = pool_issuer)
    AND (u.cognito_sub IS NULL OR u.cognito_sub = m.cognito_sub);

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  IF matched_count <> 3 THEN
    RAISE EXCEPTION 'Chi khop %/3 ho so. Huy toan bo thay doi.', matched_count;
  END IF;
END
$link$;

COMMIT;

SELECT email, role, is_active, cognito_issuer, cognito_sub
FROM users
WHERE email IN ('admin@camerai.local', 'caregiver@local', 'viewer@local')
ORDER BY role;
```

Kết quả mong đợi là `COMMIT` và ba dòng có issuer cùng `sub` đã điền. Nếu lỗi và phiên `psql` vẫn mở, chạy `ROLLBACK;` rồi kiểm tra lại bằng câu `SELECT` ở trên.

## 5. Kiểm tra đăng nhập

1. Mở đúng địa chỉ CameraAI trong cửa sổ ẩn danh. Dùng email và mật khẩu của tài khoản Cognito. Nếu tài khoản còn mật khẩu tạm, làm theo yêu cầu đổi mật khẩu trên Cognito.
2. Thử lần lượt ba tài khoản. Trong Network của trình duyệt, yêu cầu `/api/v1/auth/me` cần trả `200` cùng vai trò tương ứng.
3. Đăng xuất và kiểm tra trình duyệt quay về đúng môi trường.

| Triệu chứng                 | Kiểm tra                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `redirect_mismatch`         | So sánh chính xác callback trong mục 2 với URL mà trình duyệt gửi Cognito.                |
| `403 USER_NOT_PROVISIONED`  | Kiểm tra `is_active` và cặp `cognito_issuer`/`cognito_sub` trong DB mà backend đang dùng. |
| Lỗi mạng hoặc API trả `502` | Mở `/api/v1/health` trên API tương ứng và kiểm tra proxy, container orchestrator.         |
| Đăng xuất báo lỗi Cognito   | Kiểm tra **Allowed sign-out URLs** của đúng app client.                                   |

Tài liệu cùng repo. [Đăng nhập và thông báo Sprint 4](02_NGUOI_A_DANG_NHAP_THONG_BAO.md) · [Cách chuẩn bị dữ liệu demo](../../db/seeds/README.md)
