# Người A — Đăng nhập, người nhận và gửi thông báo

Bạn làm song song với B/C sau G0. Đầu ra đầu tiên là login Cognito và một email SNS; chưa cần server cloud hoặc model. Khi chờ HTTPS/claim API, làm tiếp test quyền, email, kịch bản sender và evidence.

## A1. Tạo Cognito User Pool cho browser

Đọc [hướng dẫn từng trường đã kiểm tra trên Console](08_THUC_HANH_CONSOLE.md#a--tạo-cognito-và-sửa-callback-đúng-chỗ) trước khi thực hiện. Nút cuối wizard hiện tại là **Create user directory**.

1. Mở Search → **Cognito**, kiểm tra Singapore → **User pools → Create user pool**; tài khoản mới có thể hiện **Get started**.
2. Trong **Define your application**, chọn **Single-page application (SPA)** vì flow dự án chạy ở browser. Đặt application `camerai-s4-dev-web`.
3. Trong options, chọn Email làm định danh và email là thuộc tính bắt buộc; chưa thêm phone cho bài cơ bản.
4. **Add a return URL**: `http://localhost:3000/auth/callback`. Review rồi tạo. Ghi pool name/ID thực từ trang chi tiết; đặt tên hiển thị `camerai-s4-dev-users` nếu UI cho sửa.

[AWS wizard tạo ứng dụng](https://docs.aws.amazon.com/cognito/latest/developerguide/getting-started-user-pools-application.html).

5. Vào **Applications → App clients**, mở client vừa tạo; xác nhận không có client secret.
6. Mở tab **Login pages → Managed login pages configuration → Edit**; tránh nút Edit trong App client information. Chọn Cognito provider, Authorization code grant; scopes `openid`, `email`, `profile`. Tắt implicit grant.
7. Callback local phải đúng như bước 4; Allowed sign-out URL là `http://localhost:3000`.
8. Trong **Branding → Domain**, dùng domain có sẵn hoặc tạo Amazon Cognito domain prefix duy nhất. Copy origin HTTPS thực tế, không thêm `/oauth2/authorize` vào biến domain.
9. Kiểm tra plan: Essentials cho managed login; không tự bật Plus. Nếu dùng Lite, classic hosted UI có thể khác hình trong tài liệu. App client cần branding nếu Console yêu cầu.

[App client settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html), [feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html), [managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html).

**Nhìn thấy:** Pool ID dạng `ap-southeast-1_...`, client ID khác pool ID, một domain HTTPS và các URL đã lưu. Bàn giao ba giá trị này cho B/C; chúng không phải password.

## A2. Tạo hai user thật và tránh lỗi reset email ảo

1. **Users** trong pool → **Create user**; nhập email mà nhóm đọc được, dùng mật khẩu tạm theo wizard.
2. Tạo user thứ hai bằng hộp thư nhóm kiểm soát. Hoàn thành đổi mật khẩu tạm/xác minh theo flow. Không đánh dấu email verified khi chưa chứng minh quyền sở hữu.
3. Dùng **View login page** trong app client nếu có để thử credentials. Trang login thành công chưa chứng minh API/ownership chạy.
4. Mở từng user, lưu `sub` trong sổ mapping được bảo vệ. B liên kết `(issuer, sub)` tới application user; không ghép admin theo email.

Mật khẩu Cognito và mật khẩu local trong DB độc lập. Nếu đã bấm **Actions → Reset password**, user có thể ở `RESET_REQUIRED`; cần mã gửi tới kênh recovery. Email không tồn tại không nhận được mã. Với native user lab do nhóm quản lý, quản trị viên có thể dùng `admin-set-user-password --permanent` theo [AWS CLI](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-set-user-password.html), nhập password qua prompt bảo vệ thay vì lưu vào tài liệu. Đặt permanent password không chứng minh email đã verified. [Reset user password](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminResetUserPassword.html).

## A3. Nối code đã có và kiểm tra local

Thực hiện trên nhánh code tích hợp, không trên nhánh tài liệu. [AUTH_PROVIDERS](../../docs/architecture/AUTH_PROVIDERS.md) chứa cách chạy migration, mapping DB và rollback chi tiết.

1. Kiểm tra branch code có `auth.config.ts`, `cognito-token.service.ts`, frontend `auth-config.ts` và `/auth/config`. Nếu thiếu, review/đưa commit từ `lab-test` qua PR, không chỉ thêm biến môi trường.
2. Trong `.env` root, giữ đúng một khai báo cho mỗi biến:

   ```dotenv
   AUTH_PROVIDER=cognito
   COGNITO_USER_POOL_ID=<pool-id-thuc>
   COGNITO_CLIENT_ID=<public-client-id-thuc>
   COGNITO_DOMAIN=https://<domain-thuc>
   ```

3. B chạy migration bổ sung issuer và liên kết hai users theo ID đã kiểm tra. Giữ nguyên ID/role/ownership application.
4. Build lần đầu bằng `docker compose up -d --build orchestrator web`. Những lần chỉ sửa `.env`: `docker compose up -d --no-deps --force-recreate orchestrator`.
5. Mở `http://localhost:3001/api/v1/auth/config`: phải có `provider=cognito`. Nếu báo thiếu biến dù file có, tìm khai báo trùng phía cuối; dòng trống có thể ghi đè dòng đúng. Restart đơn thuần không nạp env mới.
6. Mở `/login`, đăng nhập. Network có authorize code + PKCE S256, token exchange thành công; API gửi access token. Không chụp token vào evidence.
7. Test thiếu token 401, user chưa map 403, user thiếu role 403 và truy cập camera của user khác bị chặn. Dùng hai user không có quyền admin toàn hệ thống cho cross-owner test.
8. Thử refresh sau access token expiry, logout và reset bằng email thật. Ghi chính sách expiry; logout không tự làm mọi JWT cũ mất hiệu lực tức thì ở verifier local.

**Bàn giao A3:** kết quả 200/401/403, pool/client/domain, hai application IDs, scope, chính sách phiên và checklist cloud callback còn chờ C.

## A4. SNS email độc lập với B/C

1. Search **Simple Notification Service**, chọn **Topics → Create topic**.
2. Type **Standard**, Name `camerai-s4-dev-incident-email`; giữ access private, Create topic. Copy ARN.
3. Trong topic, **Create subscription**; Protocol Email, Endpoint email thật của bạn; Create subscription.
4. Mở hộp thư và bấm Confirm subscription. Quay lại Console, refresh; subscription phải hết PendingConfirmation.
5. **Publish message**, subject `CameraAI test`, body ghi event test không chứa thông tin cá nhân; Publish message.
6. Ghi MessageId, thời điểm và xác nhận email nhận được. Không dùng topic này làm ops alarm của hệ thống gửi thông báo.

[Tạo topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html), [subscription](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html), [publish](https://docs.aws.amazon.com/sns/latest/dg/sns-publishing.html).

## A5. Kiểm tra SMS/Connect ngay phiên đầu

Không đợi ngày demo để phát hiện tài khoản chưa được gửi. Ghi hai dòng trạng thái riêng `SMS_REAL` và `CALL_REAL` vào sổ, kể cả khi chọn dry-run trước.

**SMS:** mở phần SMS của SNS/AWS End User Messaging tùy UI; kiểm tra sandbox, destination country, số nhận đã xác minh, origination identity và mức chi. Trong sandbox chỉ gửi tới số đã xác minh. Thêm số của người thử đồng ý, hoàn thành mã OTP theo UI; kiểm tra điều kiện gửi của quốc gia trước khi gửi một tin. Lưu provider MessageId và xác nhận trên điện thoại. Nếu bị chặn, ghi `BLOCKED_ACCOUNT`, tiếp tục sender dry-run. [SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html).

**Connect:** tìm Amazon Connect; tài liệu AWS hiện hành có thể gọi **Connect Customer**. Mở **Add an instance/Create instance** nếu có, đi qua identity management → admin → telephony → storage → review. Chỉ tạo sau khi chủ tài khoản duyệt chi phí và tính khả dụng tại Region. Trong instance, tài liệu mới dùng **Channels and communications → Telephony → Make outbound calls with Connect Customer → Save**; UI cũ có thể ghi Telephony settings/Outbound calling. Không bật outbound campaigns cho bài gọi thông báo thông thường.

[Tạo instance](https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-instances.html), [bật outbound](https://docs.aws.amazon.com/connect/latest/adminguide/enable-outbound-calls.html).

Đăng nhập trang admin của Connect instance, chuẩn bị số nguồn được phép gọi ra, flow outbound có Play prompt rồi Disconnect, lưu và Publish flow. Tên menu có thể là Routing/Flows; dùng ô tìm navigation nếu khác. Ghi instance ID, flow ID/ARN và source number/queue theo cấu hình. Dùng adapter gọi `StartOutboundVoiceContact` với `ClientToken` ổn định cho cùng notification; thử đúng một số allowlist. Có ContactId mới chứng minh provider nhận yêu cầu, chưa chứng minh người nhận đã nghe. Không có quyền claim số/đích gọi thì ghi blocked, không chuyển Region âm thầm. [Outbound voice API](https://docs.aws.amazon.com/connect/latest/APIReference/API_StartOutboundVoiceContact.html).

## A6. Từ sender lab sang sender ứng dụng

Làm [Lab 07 phần A](../labs/07_THONG_BAO.md) bằng notification queue lab riêng: log phải có `providerCalled=false`. Sau đó A viết sender thật ở `services/aws-workers/sender/` (đích cần tạo), B review backend contract, C review role/template.

1. B commit incident state, notification intent và outbox cùng transaction; B cung cấp fixture + claim/outcome contract đã review.
2. A parse/validate job, gọi claim API HTTPS từ C. Claim phải kiểm tra trạng thái hiện tại, allowlist, lease, cooldown và daily cap. Chưa có API thì test với mock có nhãn, chưa bật provider thật.
3. Nếu no-op/cancelled/already sent: ghi outcome, không gọi provider. Nếu dry-run: publish outcome có `providerCalled=false` về Results Queue.
4. Khi được phép, gọi SNS/Connect và lưu provider ID qua ledger. Retry dùng cùng notification ID; Connect dùng cùng ClientToken. Với SNS, không hứa exactly-once khi crash giữa publish và lưu receipt: trạng thái không chắc chắn phải reconcile, không blind resend cuộc gọi/tin thật.
5. Publish result thành công rồi mới coi record đã xử lý. Nếu dùng partial batch failures, cả code và event source mapping phải bật ReportBatchItemFailures; batch 1 trước khi tăng tải.
6. Test lỗi trước claim, sau claim, sau provider nhận nhưng trước lưu result; cả duplicate và expired lease. Chỉ cho phép số/email allowlist trong đợt đầu.

**A hoàn thành:** auth E2E, SNS email thật, sender dry-run đi qua application result, real SMS/call có evidence hoặc được ghi blocked. A kiểm tra browser/cloud sau khi C gửi HTTPS URL và bổ sung đúng callback/sign-out URLs.
