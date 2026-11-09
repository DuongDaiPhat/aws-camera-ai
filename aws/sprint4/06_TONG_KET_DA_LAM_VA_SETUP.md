# Tổng kết phần Cognito và kết nối Edge

Ngày cập nhật: 09/11/2026 · Nhánh: `feat/us-05-cognito-account-roles` · Commit trước tài liệu này: `9c96e60`

Tài liệu này ghi lại phần đã có trong nhánh, cấu hình đã cung cấp/kiểm tra trong quá trình làm, và các bước còn chờ. Trạng thái “đã xác nhận” chỉ áp dụng cho đúng máy hoặc ảnh/log được nêu; không thay cho nghiệm thu toàn hệ thống trên cloud.

## 1. Tóm tắt kiến trúc đang dùng

- Trình duyệt vào CameraAI qua `https://argusai.dynv6.net`.
- Backend Orchestrator và DB của bản domain chạy trong môi trường triển khai của nhóm. Việc chạy migration trên PostgreSQL local **không tự cập nhật DB của cloud**.
- Máy Windows `DUCANH` đóng vai trò Edge: webcam, MediaMTX, Frigate và Mosquitto chạy tại máy; Tailscale dùng để nối Edge với EC2.
- Tailscale chỉ cung cấp mạng riêng giữa các thiết bị. Nó không tự đổi `DATABASE_URL`, đồng bộ DB, hay cấu hình backend trên EC2.

## 2. Code và tài liệu đã làm

Các commit liên quan trên nhánh hiện tại:

| Commit    | Nội dung                                                                       |
| --------- | ------------------------------------------------------------------------------ |
| `517c8a8` | Frontend đăng nhập Cognito và quản lý phiên.                                   |
| `defc47c` | Backend xác thực Cognito và kiểm tra quyền sở hữu tài nguyên.                  |
| `8a7a18a` | Hợp đồng API cho quản lý tài khoản.                                            |
| `25fe212` | Backend liệt kê tài khoản, tạo/liên kết hồ sơ và đổi role có kiểm tra quyền.   |
| `4325ce8` | Giao diện danh sách tài khoản và chỉnh role.                                   |
| `df0e0a3` | Hiển thị email Cognito đã liên kết trong danh sách tài khoản.                  |
| `a831f97` | Cấu hình MediaMTX gọi API xác thực HTTPS và image có CA để xác thực chứng chỉ. |
| `9c96e60` | Hướng dẫn setup Cognito cho máy mới.                                           |

Trong code hiện có:

- Chọn một nhà cung cấp xác thực bằng `AUTH_PROVIDER`.
- Với Cognito, backend xác minh chữ ký, thời hạn, issuer, client ID và `token_use=access`; tra user bằng `(cognito_issuer, cognito_sub)` rồi dùng role/quyền trong DB.
- Token hợp lệ nhưng chưa liên kết hoặc tài khoản inactive bị từ chối; role không tự cấp theo email.
- `GET /api/v1/auth/config` cung cấp cấu hình công khai cho frontend.
- Frontend dùng authorization code + PKCE, có login, `/auth/callback`, refresh và logout qua Cognito.
- Trang Quản lý tài khoản hiển thị email đăng nhập Cognito; role được quản lý trong CameraAI, không phải Cognito Groups.

File hướng dẫn setup và SQL liên kết hồ sơ: [05_SETUP_COGNITO.md](05_SETUP_COGNITO.md).

Hướng dẫn luồng webcam/MediaMTX: [CAMERA_WEBCAM_SETUP_TEST.md](../../docs/CAMERA_WEBCAM_SETUP_TEST.md) và [FFMPEG_MEDIAMTX_SETUP.md](../../docs/FFMPEG_MEDIAMTX_SETUP.md).

## 3. Cognito đã cung cấp

Pool ở vùng Singapore:

| Thuộc tính        | Giá trị                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| User Pool ID      | `ap-southeast-1_4WQxu8bnB`                                                  |
| Issuer            | `https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB` |
| SPA app client ID | `5p3hgqnkmjrdc5ktb99ur46hjr`                                                |
| Domain            | `https://ap-southeast-14wqxu8bnb.auth.ap-southeast-1.amazoncognito.com`     |

App client cần là public SPA, dùng Authorization code grant và scopes `openid`, `email`, `profile`. Không đưa client secret, mật khẩu, access key hay token vào frontend, Git hoặc file bàn giao.

Các URL cần cho cùng app client:

| Môi trường | Callback URL                              | Sign-out URL                |
| ---------- | ----------------------------------------- | --------------------------- |
| Local dev  | `http://localhost:3000/auth/callback`     | `http://localhost:3000`     |
| Domain     | `https://argusai.dynv6.net/auth/callback` | `https://argusai.dynv6.net` |

Ảnh App Client đã cho thấy callback local cũ được thêm nhưng sign-out URL chưa hiện. Cần đối chiếu lại cấu hình trong Cognito Console và thêm chính xác URL domain ở trên trước khi kết luận login/logout cloud đã xong. Client cũ `73vpf912fer5s4j4afpkee5iu6` từng trả `redirect_mismatch`; cấu hình hiện tại trong hướng dẫn dùng client SPA `5p3hgqnkmjrdc5ktb99ur46hjr`.

## 4. Tài khoản và dữ liệu DB

Ba hồ sơ ứng dụng được thống nhất như sau:

| Hồ sơ CameraAI        | Role        | Cognito identity đã ghép                                           |
| --------------------- | ----------- | ------------------------------------------------------------------ |
| `admin@camerai.local` | `ADMIN`     | `admin@camerai.local` — sub `59ea256c-4001-70b0-54c5-b3c6028d8cbd` |
| `caregiver@local`     | `CAREGIVER` | `anhnksss7@gmail.com` — sub `d91a055c-7081-70c5-c054-bafa4e98c8ae` |
| `viewer@local`        | `VIEWER`    | `anhnksss6@gmail.com` — sub `19cac50c-f011-702d-b929-5a054a81698e` |

Ảnh kết quả truy vấn PostgreSQL do người dùng gửi cho thấy cả ba hồ sơ có `is_active=true`, issuer Cognito đúng pool và `cognito_sub` tương ứng. Điều này xác nhận DB mà lệnh trong ảnh kết nối tới; cần đảm bảo đó chính là DB mà backend domain đang dùng.

Migration liên quan:

- `0017_cognito_issuer.sql`: thêm issuer và unique index cho `(cognito_issuer, cognito_sub)`. Ảnh terminal cho thấy migration `0017` đã chạy thành công trên một môi trường.
- `0018_cognito_email.sql`: thêm email Cognito để UI hiển thị email đăng nhập. Chưa có bằng chứng trong phiên làm việc rằng migration này đã chạy trên DB cloud.

Không chạy lại migration bằng tay nếu chưa kiểm tra trạng thái bảng lịch sử migration của đúng DB đích. Dùng quy trình `pnpm db:migrate` của repo trên đúng môi trường.

## 5. Trạng thái Edge/Tailscale

Các thông tin dưới đây là lần kiểm tra gần nhất trong phiên setup; hãy xem IP hiện thời trong Tailscale trước khi dùng vì IP có thể thay đổi sau khi thiết bị bị đăng ký lại.

| Hạng mục              | Kết quả gần nhất                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Windows Edge `DUCANH` | Đã kết nối tailnet `psyaugust@gmail.com`; IP được thấy gần nhất `100.126.229.63`.                                    |
| EC2 của nhóm          | Peer `100.95.187.50` online; `tailscale ping` từ Windows thành công qua DERP.                                        |
| Frigate local         | API `/api/version` qua IP Tailscale trả HTTP 200 trong lần kiểm tra tại Edge.                                        |
| MediaMTX local        | RTSP `8554` được kiểm tra TCP từ container Frigate; cấu hình webhook auth trỏ HTTPS về domain đã được thêm vào code. |
| Mosquitto local       | Container chạy tại Edge trên cổng MQTT `1883`; chưa xác nhận kết nối từ Orchestrator cloud.                          |
| Webcam                | Browser preview đã hiện hình. Chưa xác nhận WHIP publish, Frigate nhận frame và xử lý event xuyên suốt đến domain.   |

Việc cấu hình env trên EC2 chưa được xác nhận hoàn tất: cổng backend `3001` không truy cập được từ Windows; quyền SSM bị từ chối và máy Windows chưa có SSH key để vào EC2. Vì vậy chưa thể kết luận cloud Orchestrator đã nối tới Edge.

Khi C cập nhật env trên EC2, tên biến Orchestrator của repo là:

```dotenv
FRIGATE_URL=http://<EDGE_TAILSCALE_IP>:5000
MEDIAMTX_RTSP_URL=rtsp://<EDGE_TAILSCALE_IP>:8554
MQTT_URL=mqtt://<EDGE_TAILSCALE_IP>:1883
```

Ứng dụng đọc `MQTT_URL`; không dùng `MQTT_HOST` cho cấu hình này. Sau khi sửa env, cần recreate Orchestrator trên EC2 và kiểm tra kết nối từ **bên trong container cloud**. Các cổng cần cho browser xem WebRTC/WHIP (MediaMTX `8889` và ICE `8189`) là một gate riêng; API Frigate trả 200 không chứng minh live video hoạt động.

## 6. Sự cố đã gặp và cách hiểu hiện tại

### Login trên `localhost:3000` báo không tải được cấu hình

Local web gọi API theo `NEXT_PUBLIC_API_BASE_URL`. Nếu giá trị là `http://localhost:3001/api/v1` thì backend Orchestrator phải chạy trên chính máy đó. Trong lúc setup Edge, Orchestrator local đã được dừng để tránh nhầm với backend cloud; vì vậy màn hình `localhost:3000/login` không lấy được `/auth/config`. Đây không tự nó chứng minh Cognito hoặc domain đang lỗi.

### Trang domain báo chưa được cấp quyền / không tải được dữ liệu

Kiểm tra theo thứ tự:

1. `https://argusai.dynv6.net/api/v1/auth/config` trả đúng `provider=cognito`, pool/client/domain mong đợi.
2. Đăng nhập domain rồi kiểm tra `/api/v1/auth/me` trả 200 và đúng role.
3. Xác nhận user tương ứng đã liên kết trong **DB mà cloud Orchestrator thực sự dùng**, không chỉ DB local.
4. Xác nhận `0018_cognito_email.sql` đã áp dụng nếu UI cần hiện email Cognito.
5. Kiểm tra CloudWatch/container log và trạng thái EC2 → Tailscale → Edge cho các lỗi camera.

## 7. Việc còn lại để nghiệm thu

- [ ] Đối chiếu callback/sign-out URLs và app client SPA trong Cognito Console.
- [ ] Xác nhận 0017 và 0018 đã chạy trên đúng DB cloud; đối chiếu ba liên kết bằng truy vấn chỉ đọc.
- [ ] C xác nhận env EC2 (`FRIGATE_URL`, `MEDIAMTX_RTSP_URL`, `MQTT_URL`) và recreate Orchestrator.
- [ ] Kiểm tra mạng từ container Orchestrator cloud tới Edge: Frigate, RTSP MediaMTX và MQTT.
- [ ] Đăng nhập domain bằng cả ba role; kiểm tra `/auth/me`, quyền camera và đổi role từ giao diện admin.
- [ ] Phát webcam WHIP và xác nhận publisher trong MediaMTX, `camera_fps > 0` trong Frigate, rồi event xuất hiện trên domain.
- [ ] Ghi lại commit/image thực sự đang deploy trên cloud. Chưa có xác nhận rằng domain đang chạy commit `9c96e60` hoặc các commit phía trên.
- [ ] Nếu cần chia sẻ nhánh với máy khác, push nhánh sau khi sẵn sàng: `git push -u origin feat/us-05-cognito-account-roles`.

Trong lần tạo commit `9c96e60`, hook chạy Prettier và secret scan thành công. Chưa chạy bộ test hoặc nghiệm thu end-to-end trong lần viết tài liệu tổng kết này.
