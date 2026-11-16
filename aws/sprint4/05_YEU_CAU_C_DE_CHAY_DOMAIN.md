# Những việc đã nhờ C cấu hình để CameraAI chạy trên domain

Cập nhật: 10/11/2026 · Domain hiện dùng: `https://argusai.dynv6.net`

> Tài liệu này là bản ghi yêu cầu bàn giao cho C, không khẳng định các bước đã hoàn tất. Những điểm chưa có bằng chứng runtime được ghi là cần C xác nhận. Không đưa mật khẩu, Cognito client secret, access key, bot token hay giá trị secret trong `.env` vào đây.

## 1. Hệ thống cần chạy như thế nào

```text
Trình duyệt
  └─ HTTPS: argusai.dynv6.net
       ├─ Web frontend
       └─ /api/v1 → Orchestrator trên EC2
                      ├─ PostgreSQL trên EC2 / mạng Docker riêng
                      └─ Tailscale → máy Edge Windows
                                      ├─ Frigate
                                      ├─ MediaMTX
                                      └─ Mosquitto (MQTT)
```

DB của domain phải là DB mà Orchestrator trên EC2 thực sự sử dụng. Chạy migration trên PostgreSQL local của máy phát triển không cập nhật DB cloud. Không mở PostgreSQL, Redis, MQTT, Frigate hoặc MediaMTX ra toàn Internet để sửa lỗi kết nối.

## 2. Các việc đã nhờ C làm

### A. Giữ nguyên bộ Cognito hiện tại và cho phép HTTPS domain

Không tạo thêm User Pool. Dùng bộ Cognito đang được nhóm sử dụng:

| Cấu hình                                 | Giá trị                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Region                                   | `ap-southeast-1`                                                            |
| User Pool ID                             | `ap-southeast-1_4WQxu8bnB`                                                  |
| Issuer                                   | `https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB` |
| SPA app client ID được cung cấp sau cùng | `5p3hgqnkmjrdc5ktb99ur46hjr`                                                |
| Cognito domain                           | `https://ap-southeast-14wqxu8bnb.auth.ap-southeast-1.amazoncognito.com`     |

Trong đúng SPA app client, C cần kiểm tra/lưu:

- Identity provider: Cognito user pool.
- OAuth flow: Authorization code grant; frontend dùng PKCE.
- Scopes: `openid`, `email`, `profile`.
- Giữ callback/sign-out local nếu nhóm còn dùng local; bổ sung callback và sign-out HTTPS domain:

| Loại URL | Giá trị cần có                            |
| -------- | ----------------------------------------- |
| Callback | `https://argusai.dynv6.net/auth/callback` |
| Sign-out | `https://argusai.dynv6.net`               |

Client ID cũ `73vpf912fer5s4j4afpkee5iu6` từng báo `redirect_mismatch`. C xác nhận client ID đang gắn với domain và callback trên là `5p3hgqnkmjrdc5ktb99ur46hjr`; không dùng lẫn hai client.

### B. Triển khai đúng code frontend và backend lên EC2

C cần đưa lên cùng một bản tương thích gồm login Cognito, callback `/auth/callback`, refresh/logout và API `/api/v1/auth/config`. Phần quản lý user/role trong code cũng cần có nếu muốn dùng màn Quản lý tài khoản.

Trên cấu hình cloud:

```dotenv
AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=ap-southeast-1_4WQxu8bnB
COGNITO_CLIENT_ID=5p3hgqnkmjrdc5ktb99ur46hjr
COGNITO_DOMAIN=https://ap-southeast-14wqxu8bnb.auth.ap-southeast-1.amazoncognito.com
WEB_ORIGIN=https://argusai.dynv6.net
NEXT_PUBLIC_API_BASE_URL=https://argusai.dynv6.net/api/v1
```

Các giá trị trên là cấu hình công khai/runtime, không bao gồm secrets. `NEXT_PUBLIC_API_BASE_URL` phải được truyền vào lúc build web nếu đang đóng gói vào frontend; chỉ sửa `.env` sau khi build có thể chưa thay URL trong bundle.

Proxy HTTPS cần chuyển `/api/*` tới Orchestrator và các đường còn lại tới web, giữ nguyên prefix `/api`. Cần bảo đảm CORS cho đúng origin domain, không dùng `localhost` trong cấu hình bản cloud, và chỉ public cổng 80/443 theo thiết kế.

Khi triển khai, C ghi lại commit SHA/tag và image digest thực tế của web/backend. Chưa có bằng chứng từ phía mình rằng domain hiện tại đang chạy đúng commit có đầy đủ Cognito và API quản lý user.

### C. Chạy/kiểm tra migration trên đúng DB cloud và liên kết ba hồ sơ

Trước tiên C xác nhận hostname/database mà Orchestrator trên EC2 đang dùng và xem lịch sử migration. Backup DB theo quy trình của nhóm trước khi cập nhật. Không chạy `db:reset`.

- `0017_cognito_issuer.sql`: thêm `cognito_issuer` và ràng buộc duy nhất cho cặp issuer/sub.
- `0018_cognito_email.sql`: thêm email đăng nhập Cognito để giao diện tài khoản hiển thị email.

Migration `0017` từng được chạy trên môi trường local. C cần xác minh cả `0017` và `0018` đã áp dụng trên DB cloud; chỉ chạy migration còn thiếu bằng runner của repo, một lần cho đúng DB đích.

Trước khi chạy SQL, nhờ C thực hiện hai bước kiểm tra dưới đây trong shell Linux/SSH trên EC2. Lệnh đầu in đúng host, port và tên DB mà backend đang dùng; không in URL đầy đủ hay thông tin đăng nhập. Lệnh thứ hai tìm tên container của Compose service `postgres`.

```bash
sudo docker exec camerai-orchestrator node -e '
for (const p of [".env", "../../.env"])
  if (require("node:fs").existsSync(p)) process.loadEnvFile(p);
const e = process.env;
const d = e.DATABASE_URL ? new URL(e.DATABASE_URL) : null;
console.log({
  host: d?.hostname || e.POSTGRES_HOST || "localhost",
  port: d?.port || (d ? "5432" : e.POSTGRES_PORT || "5432"),
  database: d ? d.pathname.slice(1) : e.POSTGRES_DB || "camerai"
});
'

sudo docker ps --filter label=com.docker.compose.service=postgres \
  --format '{{.Names}}'
```

Nếu container backend không tên `camerai-orchestrator`, thay tên đó bằng tên thực tế. Nếu lệnh tìm PostgreSQL không in ra tên container, hoặc host/port/database backend in ra không khớp với DB dự kiến, dừng và xác nhận cấu hình Compose trước khi cập nhật. Sau khi xác nhận đúng DB cloud và backup, nhờ C chạy khối dưới đây. Khối này **chỉ liên kết ba hồ sơ đã có**, không chạy migration. Hai câu `SELECT` cho thấy dữ liệu trước và sau; giao dịch sẽ báo lỗi và hủy nếu không khớp đủ ba user, sai role, user inactive hoặc sub/issuer đang liên kết mâu thuẫn. Nếu các cột chưa tồn tại, dừng và áp dụng migration trước.

```bash
cd /opt/camerai

sudo docker compose \
  --env-file /opt/camerai/.env \
  -f /opt/camerai/compose.yaml \
  exec -T postgres sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'

SELECT email, role, is_active, cognito_issuer, cognito_sub
FROM users
WHERE email IN ('admin@camerai.local', 'caregiver@local', 'viewer@local')
ORDER BY role;

BEGIN;

DO $link$
DECLARE
  issuer CONSTANT text :=
    'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB';
  matched_count integer;
BEGIN
  UPDATE users AS u
  SET cognito_issuer = issuer,
      cognito_sub = m.sub
  FROM (VALUES
    ('admin@camerai.local', 'ADMIN',
     '59ea256c-4001-70b0-54c5-b3c6028d8cbd'),
    ('caregiver@local', 'CAREGIVER',
     'd91a055c-7081-70c5-c054-bafa4e98c8ae'),
    ('viewer@local', 'VIEWER',
     '19cac50c-f011-702d-b929-5a054a81698e')
  ) AS m(email, expected_role, sub)
  WHERE u.email = m.email::citext
    AND u.role::text = m.expected_role
    AND u.is_active = true
    AND (u.cognito_issuer IS NULL OR u.cognito_issuer = issuer)
    AND (u.cognito_sub IS NULL OR u.cognito_sub = m.sub);

  GET DIAGNOSTICS matched_count = ROW_COUNT;

  IF matched_count <> 3 THEN
    RAISE EXCEPTION
      'Chi khop %/3 ho so. Huy toan bo thay doi.',
      matched_count;
  END IF;
END
$link$;

COMMIT;

SELECT email, role, is_active, cognito_issuer, cognito_sub
FROM users
WHERE email IN ('admin@camerai.local', 'caregiver@local', 'viewer@local')
ORDER BY role;
SQL
```

Nếu lệnh báo lỗi, C không bỏ điều kiện trong SQL để ép cập nhật; cần gửi lại lỗi đã che dữ liệu nhạy cảm và kết quả `SELECT` trước khối để đối chiếu hồ sơ/role. Không gửi mật khẩu DB.

Các cặp hồ sơ/role đã được thống nhất để kiểm tra trong DB ứng dụng:

| Hồ sơ ứng dụng trong DB | Role        | Tài khoản Cognito     | Cognito sub                            |
| ----------------------- | ----------- | --------------------- | -------------------------------------- |
| `admin@camerai.local`   | `ADMIN`     | `admin@camerai.local` | `59ea256c-4001-70b0-54c5-b3c6028d8cbd` |
| `caregiver@local`       | `CAREGIVER` | `anhnksss7@gmail.com` | `d91a055c-7081-70c5-c054-bafa4e98c8ae` |
| `viewer@local`          | `VIEWER`    | `anhnksss6@gmail.com` | `19cac50c-f011-702d-b929-5a054a81698e` |

C cần đối chiếu sub từ đúng User Pool rồi kiểm tra liên kết trong đúng DB cloud, giữ nguyên application user ID, role và camera ownership. Không cấp role dựa vào email và không tạo lại hồ sơ nếu đã có. Một truy vấn trên DB local hoặc ảnh kết quả không ghi rõ host/database chưa chứng minh DB domain đã được cập nhật.

### D. Nối backend cloud tới máy Edge qua Tailscale để chạy camera

Máy Windows `DUCANH` và EC2 cần cùng tailnet, online và được phép truy cập theo ACL. IP Tailscale của máy Windows có thể thay đổi sau khi đăng ký lại, vì vậy C xác nhận IP hiện tại từ Tailscale trước khi lưu cấu hình. Không dùng IP LAN riêng kiểu `192.168.x.x` cho kết nối từ EC2.

Tên biến mà Orchestrator hiện đọc để gọi Edge:

```dotenv
FRIGATE_URL=http://<EDGE_TAILSCALE_IP>:5000
MEDIAMTX_RTSP_URL=rtsp://<EDGE_TAILSCALE_IP>:8554
MQTT_URL=mqtt://<EDGE_TAILSCALE_IP>:1883
```

`MQTT_URL` là biến ứng dụng dùng; không chỉ đặt `MQTT_HOST`. Sau khi cập nhật env, C recreate Orchestrator để nạp cấu hình rồi kiểm tra từ bên trong container EC2 tới Frigate, RTSP MediaMTX và MQTT. Giới hạn firewall/ACL ở các peer và port cần dùng; không public các port đó.

Live WHIP/WebRTC cần kiểm tra riêng. Backend trả cho browser một URL MediaMTX; URL đó phải dùng được từ máy đang mở trình duyệt, không được trỏ nhầm về `localhost` của EC2. Nếu browser mở domain HTTPS mà phải gọi MediaMTX trực tiếp, C cần chốt hostname/HTTPS, auth, ICE candidate và các cổng WebRTC phù hợp. Lỗi hộp đăng nhập `http://localhost:8889` hoặc Frigate chưa sẵn sàng cho thấy luồng này chưa được nghiệm thu xuyên suốt.

## 3. C cần gửi lại kết quả gì

Đề nghị C bàn giao một dòng trạng thái cho từng mục:

| Mục        | Kết quả cần báo                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cognito    | App client đã lưu callback/sign-out domain; xác nhận client ID và pool ID.                                                                                       |
| Release    | Commit SHA/tag và digest image web/backend đang chạy.                                                                                                            |
| Domain/API | HTTPS hợp lệ; `/api/v1/health` và `/api/v1/auth/config` trả kết quả đúng; web gọi API domain chứ không gọi localhost.                                            |
| DB         | Host/port/tên DB backend in ra; tên container Postgres; trạng thái migration 0017/0018; ba cặp issuer/sub/role đã kiểm tra trong đúng DB. Không gửi DB password. |
| Auth       | Kết quả login/logout cho ADMIN, CAREGIVER, VIEWER; `/api/v1/auth/me` trả role đúng; thử user không có quyền.                                                     |
| Edge       | Peer Tailscale online; kết nối từ container EC2 đến Frigate/MediaMTX/MQTT; tên/IP Edge và port đã dùng.                                                          |
| Camera     | Kết quả WHIP publish, MediaMTX publisher, Frigate `camera_fps > 0` và trạng thái sự kiện trên domain; nêu rõ phần nào chưa đạt.                                  |
| Vận hành   | Lệnh deploy/recreate, vị trí logs, backup và rollback về bản trước. Không gửi secrets.                                                                           |

## 4. Tin nhắn ngắn gửi C

> Nhờ C hoàn tất cấu hình domain `https://argusai.dynv6.net` theo cùng Cognito User Pool hiện tại (pool `ap-southeast-1_4WQxu8bnB`, SPA client `5p3hgqnkmjrdc5ktb99ur46hjr`): thêm callback `https://argusai.dynv6.net/auth/callback` và sign-out `https://argusai.dynv6.net`, giữ Authorization Code + PKCE và scopes `openid email profile`. Deploy cùng bản web/backend có Cognito; cấu hình `AUTH_PROVIDER=cognito`, `WEB_ORIGIN=https://argusai.dynv6.net`, build web với `NEXT_PUBLIC_API_BASE_URL=https://argusai.dynv6.net/api/v1`; proxy giữ nguyên `/api`. Trên DB cloud, trước tiên chạy hai lệnh chẩn đoán mục C để báo host/port/tên DB backend và tên Postgres container (không gửi credentials), xác nhận đúng DB, kiểm tra migration còn thiếu 0017/0018 và backup. Sau đó chạy khối SQL mục C để liên kết ba hồ sơ. Nếu nối camera Edge, đưa EC2 và máy Windows vào cùng Tailscale, cấu hình `FRIGATE_URL`, `MEDIAMTX_RTSP_URL`, `MQTT_URL` theo IP Tailscale hiện tại, recreate backend và kiểm tra WHIP/WebRTC riêng. Khi xong gửi lại commit/image đang chạy, kết quả `/health`, `/auth/config`, `/auth/me`, migration/DB, đăng nhập 3 role và camera; không gửi mật khẩu hay secret.

## 5. Phân biệt việc đã làm và việc còn cần xác nhận

- Đã có thông tin User Pool, domain Cognito, client ID, domain HTTPS ứng dụng và ba sub do người dùng cung cấp.
- Đã có code/migration trong repo cho Cognito và role management ở các nhánh làm tính năng; domain chỉ nhận được các thay đổi nếu C triển khai đúng phiên bản code đó.
- `0017` đã được chạy trên ít nhất một môi trường local; không lấy đó làm bằng chứng migration cloud đã chạy.
- Browser từng hiển thị được webcam preview, nhưng chưa có bằng chứng đầy đủ rằng WHIP publish → MediaMTX → Frigate → event domain chạy thành công.
- Các nội dung trên là checklist bàn giao cho C; chỉ đánh dấu hoàn tất sau khi C xác nhận cấu hình và có kết quả runtime tương ứng.
