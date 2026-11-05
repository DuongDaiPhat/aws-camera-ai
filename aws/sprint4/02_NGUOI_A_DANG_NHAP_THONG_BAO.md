# Người A — Làm đăng nhập và gửi thông báo

Bạn chỉ cần làm theo file này. Đọc từ trên xuống, làm xong một phần rồi sang phần tiếp theo. Những tên tiếng Anh in đậm là tên nút trên AWS; những tên trong dấu `...` là tên biến hoặc tên trong mã nguồn, cần giữ nguyên.

Mục tiêu cuối cùng: người dùng đăng nhập trên trang web của nhóm, chỉ xem được dữ liệu được phép, nhận được thông báo từ một sự kiện thật và xác nhận ngay trên ứng dụng. Tài liệu này chỉ hướng dẫn hoàn thiện tính năng trên bản dùng chung để demo đồ án. Các bài làm quen dịch vụ nằm ở bộ lab khác; ở đây không tạo tài nguyên thử riêng.

**Đi tới phần đang làm (vẫn trong file này):** [Bạn làm gì, cần ai giúp?](#1-bạn-làm-gì-cần-ai-giúp) · [Chuẩn bị trên máy của bạn](#2-chuẩn-bị-trên-máy-của-bạn) · [Nhận cấu hình Cognito và chuẩn bị tài khoản](#3-nhận-cấu-hình-cognito-và-chuẩn-bị-tài-khoản) · [Nối đăng nhập vào ứng dụng](#4-nối-đăng-nhập-vào-ứng-dụng) · [Nối kênh nhận thông báo vào tính năng](#5-nối-kênh-nhận-thông-báo-vào-tính-năng) · [Viết hàm gửi thông báo](#6-viết-hàm-gửi-thông-báo) · [Nối với B/C và kiểm tra từ đầu đến cuối](#7-nối-với-bc-và-kiểm-tra-từ-đầu-đến-cuối) · [Khi gặp lỗi, kiểm tra ở đâu?](#8-khi-gặp-lỗi-kiểm-tra-ở-đâu) · [Bàn giao và diễn tập demo](#9-bàn-giao-và-diễn-tập-demo)

## 1. Bạn làm gì, cần ai giúp?

| Phần bạn làm                                           | Có thể bắt đầu ngay?                 | Khi nào phải chờ?                                                      |
| ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------- |
| Hoàn thiện đăng nhập Cognito và hai tài khoản kiểm tra | Viết code ngay                       | Đợi C đưa pool/client/domain để nối thật                               |
| Nối đăng nhập vào ứng dụng                             | Có, trên máy cá nhân                 | B kiểm tra phần liên kết tài khoản với dữ liệu cũ                      |
| Nối email/SMS/cuộc gọi vào sender                      | Viết code và kiểm thử ngay           | Đợi C tạo kênh, A xác nhận email/số nhận và cùng C xử lý điều kiện gửi |
| Viết hàm gửi thông báo                                 | Có, dùng dữ liệu giả khi API chưa có | Đợi B hoàn thiện API xin quyền gửi và nhận kết quả; đợi C có HTTPS     |
| Chạy trọn luồng trên máy chủ                           | Chưa                                 | Đợi C đưa địa chỉ web và B tạo được yêu cầu gửi từ sự kiện             |

Bạn viết đăng nhập và gửi C yêu cầu cấu hình Cognito/kênh nhận trước. Khi đang chờ B/C, tiếp tục viết và kiểm tra hàm gửi bằng dữ liệu giả; không cần ngồi chờ cả nhóm.

## 2. Chuẩn bị trên máy của bạn

Cả nhóm dùng **Singapore**, mã `ap-southeast-1`. C là người duy nhất triển khai bộ tài nguyên dùng chung. C tạo và quản lý Cognito, SNS, Connect, queue và Lambda dùng chung. Bạn không tạo thêm bộ riêng; bạn đưa yêu cầu, viết mã và kiểm tra chức năng trên bộ C cấp.

1. Nhóm dùng **một tài khoản AWS do C quản lý, bên trong có ba IAM User A/B/C**. Bạn đăng nhập bằng IAM User của A và dùng access key riêng của user này. C cấp quyền, không cấp một tài khoản AWS mới. Không chia sẻ root hoặc gửi key trong nhóm chat.
2. Cài AWS CLI v2, Docker và pnpm theo yêu cầu repo. Nếu đã có access key và profile đúng thì giữ lại, không cần tạo key mới cho mỗi lần làm bài.
3. Mở PowerShell ở thư mục gốc dự án:

   ```powershell
   aws --version
   aws configure --profile camerai-lab
   aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
   git rev-parse HEAD
   docker compose version
   pnpm --version
   ```

   Khi được hỏi, nhập **Access Key ID và Secret Access Key của chính IAM User mình**, Region `ap-southeast-1`, output `json`. Nếu đã có profile này, chỉ cấu hình lại khi cần thay key. Không nhập key vào lệnh để tránh lưu trong lịch sử terminal.

   Ba người kiểm tra kết quả STS: `Account` phải giống nhau, `Arn` phải khác nhau và đúng tên IAM User của từng người. Tên profile `camerai-lab` giống nhau trên ba máy vẫn được; nó chỉ là tên cấu hình local, không phải tài khoản hay key dùng chung. Gửi C Account/Arn để đối chiếu, không gửi key.

   `aws configure` chỉ khai báo danh tính cho CLI, **không cấp quyền**. C cấp quyền cho IAM User trước. Không dùng `aws configure sso` hoặc `aws sso login` trong cách làm hiện tại của nhóm. Nguồn tra cứu: [AWS cấu hình CLI bằng IAM User](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-user.html).

4. Giữ `.env` hiện tại. Biến mới đang trống chỉ điền khi có giá trị thật. Không đổi cả bộ sang AWS trước khi code tương ứng đã có. Không đưa `.env`, ảnh mặt hay mật khẩu vào Git.
5. Làm trên nhánh riêng, đưa thay đổi qua yêu cầu gộp mã (PR) để người khác kiểm tra. Các đường dẫn ghi **cần tạo** bên dưới là phần bạn phải lập trình, chưa có sẵn để chạy.

**Khi ghép hệ thống:** A/B/C dùng key khác nhau vẫn làm việc với cùng tài nguyên nếu đúng tài khoản, Region và được cấp quyền. Bàn giao tên bucket, queue URL/ARN, API và cấu hình; không bàn giao key cá nhân. Backend trên EC2 dùng role của EC2; Lambda dùng execution role riêng. C cấu hình các role này, nên bản cloud không phụ thuộc key laptop của ai. Việc cấu hình CLI trên laptop cũng không tự truyền quyền vào Docker local; nếu cần chạy SDK trong container local, phải cấu hình riêng mà không đưa key vào image/Git.

## 3. Nhận cấu hình Cognito và chuẩn bị tài khoản

Cognito là dịch vụ quản lý mật khẩu và cấp mã đăng nhập. Quyền xem camera vẫn do ứng dụng quyết định.

### 3.1. Gửi C yêu cầu và nhận cấu hình Cognito

**Đưa yêu cầu cho C ngay:** pool `camerai-s4-dev-users`, browser client `camerai-s4-dev-web`, đăng nhập bằng email, không tự đăng ký, public client không có secret, authorization code + PKCE, scope `openid email profile`. Callback local là `http://localhost:3000/auth/callback`, sign-out là `http://localhost:3000`. Khi có HTTPS, gửi C thêm hai URL cloud tương ứng. Không tự tạo pool thứ hai.

**Đợi C tạo Cognito và đưa pool ID, client ID, domain HTTPS, issuer cùng các URL đã lưu để nối đăng nhập thật.** Trong lúc chờ, viết backend verifier và frontend login/callback ở §4 bằng cấu hình giả trong test. Không đánh dấu login thật đã đạt bằng test giả.

Kiểm tra cấu hình C bàn giao: pool/client khác ID, domain chỉ có HTTPS origin, không chứa `/oauth2/authorize`; callback đúng scheme/host/port/path. Nếu sai, gửi C chỗ cần sửa và kết quả mong đợi. Bạn phụ trách kiểm tra hành vi đăng nhập; C phụ trách thay đổi cấu hình tài nguyên AWS.

### 3.2. Tạo hai người dùng thử

1. Trong pool, mở **Users → Create user**. Tạo hai tài khoản bằng hai hộp thư nhóm đọc được.
2. Hoàn thành đổi mật khẩu tạm và xác minh email theo trang đăng nhập. Không dùng email giả để thử quên mật khẩu.
3. Mở từng user, ghi `sub`. Đây là mã người dùng của Cognito; **khác** mã người dùng trong DB ứng dụng.
4. Chọn hai tài khoản ứng dụng tương ứng, mỗi tài khoản có camera riêng và không có quyền quản trị toàn hệ thống.

**Đưa kết quả cho B:** pool ID, issuer dạng `https://cognito-idp.ap-southeast-1.amazonaws.com/<pool-id>`, client ID, domain và hai cặp application user ID ↔ Cognito sub. Gửi qua nơi nhóm quản lý cấu hình, không đưa mật khẩu vào bảng bàn giao.

**Đưa kết quả cho C:** PR auth, callback/sign-out cần dùng trên HTTPS, kết quả thử hai tài khoản và cấu hình nào cần sửa. Pool/client/domain dùng đúng bộ C đã bàn giao, không tạo thêm.

## 4. Nối đăng nhập vào ứng dụng

### 4.1. Kiểm tra code và viết phần còn thiếu

1. Kiểm tra `apps/orchestrator/src/auth/` và phần đăng nhập trong `apps/web/`. Tài liệu cũ có nhắc code ở nhánh `lab-test`; chỉ dùng sau khi đã xem thay đổi và gộp qua PR. Không mặc định code đó đã có trên nhánh hiện tại.
2. Backend cần chọn đúng một cách đăng nhập từ `AUTH_PROVIDER`. Với Cognito, kiểm tra chữ ký, hạn dùng, issuer, client ID và `token_use=access`; giữ kiểm tra scope theo thiết kế auth của repo. Token sai trả 401, không thử lại bằng cách đăng nhập local.
3. Backend tìm người dùng theo cặp `(issuer, sub)` rồi dùng ID, role và quyền camera đang có trong DB. Token hợp lệ nhưng chưa liên kết hoặc tài khoản bị vô hiệu hóa trả 403. Không tự cấp quản trị theo email.
4. Thêm/hoàn thiện `GET /api/v1/auth/config` để frontend biết đang dùng Cognito. Chỉ trả cấu hình công khai, không trả mật khẩu/secret. Nếu thêm API, cập nhật `api/openapi.yaml` và phần mã tạo từ hợp đồng API.
5. Frontend cần trang login, `/auth/callback`, làm mới phiên và logout. Dùng authorization code + PKCE S256: có thể hiểu là browser tạo một mã kiểm chứng cho mỗi lần đăng nhập. API phải nhận access token, không lấy ID token thay thế.
6. Logout cần dọn phiên ứng dụng và đi qua trang logout của Cognito. Xác minh JWT tại backend không có nghĩa mọi token cũ bị vô hiệu tức thì ngay khi logout; ghi rõ thời hạn phiên đã chọn.

### 4.2. Liên kết với tài khoản cũ

**Đợi B kiểm tra migration và hai người dùng trong DB trước khi thử đăng nhập đầy đủ.** Trong lúc chờ, bạn vẫn kiểm tra màn hình login/callback và các trường cấu hình.

B chạy migration bổ sung `cognito_issuer` nếu nhánh tích hợp chưa có, giữ nguyên users.id, role và camera. Sau khi đã xác nhận đúng người dùng, B có thể dùng câu lệnh sau trong DB thử; thay placeholder bằng ID thật, không chạy nguyên mẫu:

```sql
UPDATE users
SET cognito_sub = '<sub-da-xac-minh>',
    cognito_issuer = 'https://cognito-idp.ap-southeast-1.amazonaws.com/<pool-id>'
WHERE id = '<application-user-id>' AND cognito_sub IS NULL;
```

Phải cập nhật đúng một dòng. Nếu đã có sub, B kiểm tra liên kết cũ rồi xử lý riêng; không ghi đè người dùng khác. Không đổi password_hash hoặc role chỉ để login qua được.

### 4.3. Điền biến và chạy thử local

```dotenv
AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=<pool-id-thuc>
COGNITO_CLIENT_ID=<client-id-thuc>
COGNITO_DOMAIN=<https-origin-cognito>
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
```

Đây là mẫu giá trị cần thay, không chép nguyên dấu `<...>` vào `.env`. Nếu code cũ còn dùng `COGNITO_REDIRECT_URI`/`COGNITO_LOGOUT_URI`, giữ chúng khớp callback/sign-out đã đăng ký; không tự xóa cấu hình đang dùng.

```powershell
pnpm --filter @cam/orchestrator typecheck
pnpm --filter @cam/orchestrator test -- --runInBand
pnpm --filter @cam/orchestrator build
pnpm --filter @cam/web build
pnpm api:lint
docker compose up -d --build orchestrator web
Invoke-RestMethod 'http://localhost:3001/api/v1/auth/config'
```

API config phải báo `provider=cognito`. Mở `http://localhost:3000/login` và đăng nhập bằng hai tài khoản. Nếu chỉ thay `.env`, dùng `docker compose up -d --no-deps --force-recreate orchestrator`; lệnh restart đơn thuần không nạp biến mới. Kiểm tra Compose có truyền các biến vào container.

| Cách thử                                         | Kết quả cần thấy                                           |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Không có token, token sai/hết hạn, dùng ID token | API trả 401                                                |
| Token đúng nhưng user chưa liên kết              | API trả 403                                                |
| User A mở camera/ảnh của user B                  | Bị từ chối, không lộ URL ảnh                               |
| User đúng mở camera/sự kiện của mình             | Xem được theo quyền                                        |
| Hết hạn access token                             | Làm mới phiên đúng cách hoặc yêu cầu đăng nhập lại         |
| Logout rồi tải lại trang                         | Phải đăng nhập lại, không giữ dữ liệu riêng của user trước |

**Đưa kết quả đăng nhập cho C:** PR đã gộp, tên biến, lệnh chạy, cách tạo/liên kết hai user và kết quả bảng trên. C dùng code này cho bản máy chủ. B kiểm tra chéo ca truy cập camera của người khác.

## 5. Nối kênh nhận thông báo vào tính năng

### 5.1. Nối email vào sender

1. **Đưa yêu cầu cho C:** topic Standard `camerai-s4-dev-incident-email`, email người nhận đã đồng ý và phạm vi dữ liệu họ được phép nhận. C tạo topic/subscription và đưa topic ARN.
2. **Đợi C đưa ARN topic và xác nhận subscription đã tạo.** Bạn mở hộp thư, bấm Confirm subscription rồi báo C kết quả. Không dùng topic có nhiều người không cùng quyền nhận để gửi dữ liệu riêng của một người.
3. Đặt `SNS_TOPIC_ARN` đúng ARN C cấp; đưa B để backend tạo delivery/claim. Viết adapter SNS nhận topic/message từ claim hợp lệ, lưu MessageId trong outcome.
4. Không dùng Publish thủ công trên Console để nghiệm thu. Kiểm tra email bằng sự kiện do ứng dụng tạo theo §7: intent → queue → claim → SNS → outcome → DB/UI và thư đến người nhận.

### 5.2. Nối SMS và cuộc gọi nếu thuộc phạm vi đồ án

- **Đưa yêu cầu cho C sớm:** kênh cần dùng, quốc gia/số nhận đã đồng ý, lời nhắc cuộc gọi và mức chi được phép. C kiểm tra tài khoản, số nguồn/quota, tạo Connect instance/flow và bật quyền cần thiết. A thực hiện xác minh người nhận/OTP khi được yêu cầu.
- **Đợi C đưa cấu hình kênh đã sẵn sàng:** SMS đủ điều kiện gửi; Connect có instance ID, flow ID và số nguồn/queue. Viết adapter trước bằng nhà cung cấp giả để kiểm tra cách xử lý thành công/lỗi.
- Sender gọi `StartOutboundVoiceContact` với ClientToken cố định theo notificationId; lưu ContactId. SNS SMS lưu MessageId. Không log đầy đủ số nhận.
- Kiểm tra từ **sự kiện trong app**, người nhận nhận được SMS/nghe được lời nhắc, outcome lưu trong ứng dụng. Có providerId mới là AWS nhận yêu cầu, chưa thay thế xác nhận trên thiết bị người nhận.
- Nếu bị chặn quyền/số/quota, báo C và chủ đồ án ngay; ghi kênh chưa hoàn thành. Email không thay thế tiêu chí SMS/cuộc gọi, không tự đổi Region.

**Đưa kết quả cho B và C:** cấu hình đã nối, PR sender, người nhận tham chiếu, kết quả từng kênh và providerId mẫu đã che dữ liệu riêng. B dùng để đối chiếu nhật ký; C dùng để kiểm tra quyền và bản triển khai.

## 6. Viết hàm gửi thông báo

Bạn viết `services/aws-workers/sender/` (**cần tạo**), kèm cách đóng gói, chạy và kiểm thử. Hàm này chạy trên Lambda. Không mở Function URL, không truy cập DB trực tiếp.

Luồng cần viết: nhận việc từ SQS → hỏi backend có được gửi không → gửi thật hoặc chạy thử → đưa kết quả về hàng đợi kết quả. SQS là nơi giữ công việc; Lambda là chương trình lấy công việc đó ra làm.

### 6.1. Dữ liệu nhận từ B

Mọi gói việc có phần ngoài:

```json
{
  "schemaVersion": 1,
  "type": "notification.job",
  "messageId": "<notificationId-UUID>",
  "correlationId": "<eventId-UUID>",
  "occurredAt": "<thoi-diem-UTC-ket-thuc-bang-Z>",
  "payload": {
    "notificationId": "<UUID>",
    "eventId": "<UUID>",
    "ownerScopeId": "<ID-user-ung-dung-UUID>",
    "expectedEventVersion": 3,
    "channel": "SNS_EMAIL"
  }
}
```

Các chuỗi trong `<...>` chỉ để giải thích, phải thay bằng dữ liệu đúng trước khi chạy. `channel` còn có SNS_SMS hoặc CONNECT_CALL. Không lấy người nhận từ message; backend sẽ trả về người nhận được phép.

### 6.2. API xin quyền gửi do B làm

Gọi `POST /api/v1/internal/notifications/{notificationId}/claim` qua HTTPS, header `X-Internal-Token` lấy từ `INTERNAL_SERVICE_TOKEN`:

```json
{
  "schemaVersion": 1,
  "claimId": "<UUID-giu-nguyen-khi-thu-lai>",
  "eventId": "<UUID>",
  "expectedEventVersion": 3
}
```

| Backend trả về                           | Hàm gửi phải làm gì?                                     |
| ---------------------------------------- | -------------------------------------------------------- |
| 200, disposition=CLAIMED                 | Dùng attemptId, leaseUntil, mode và delivery được trả về |
| 200, disposition=NO_OP                   | Không gửi; backend đã ghi lý do. Hoàn tất message        |
| 409, code=BUSY và retryAt                | Chờ/thử lại theo thời điểm đó, không bỏ việc             |
| 400/401/404 hoặc conflict không sửa được | Ghi lý do, chuyển xử lý lỗi; không gửi                   |
| Mất mạng/429/5xx                         | Thử lại có giới hạn, giữ cùng claimId                    |

Khi CLAIMED, response có `notificationId`, `attemptId`, `leaseUntil`, `mode=DRY_RUN|REAL`, `delivery={channel,recipientRef,topicArn?,destination?,message,subject?}`. Không ghi nguyên response vào log vì có thể chứa người nhận. Hết thời gian lease thì không gửi.

Chạy thử DRY_RUN nghĩa là đi đủ luồng nhưng không gọi SNS/Connect. Backend quyết định mode; sender chỉ được giảm REAL thành DRY_RUN để an toàn, không tự nâng ngược lại.

### 6.3. Gửi và trả kết quả

1. Kiểm tra version/type/UUID, không nhận message của bài echo cũ. Chốt `claimId=notificationId` để mỗi việc có mã xin quyền cố định; Lambda chạy lại vẫn dùng mã này, không sinh mã mới.
2. Sau khi được phép, gọi SNS email/SMS hoặc Connect theo delivery. Không thêm người nhận do message tự khai báo.
3. Tạo outcomeId ổn định cho kết quả của attempt. Gửi vào `APPLICATION_RESULTS_QUEUE_URL`, type=`notification.outcome`, messageId=outcomeId, correlationId=eventId; giữ các trường ngoài giống §6.1.
4. Payload kết quả gồm `outcomeId, notificationId, eventId, ownerScopeId, attemptId, status, providerCalled, providerId, reason`.

   | status            | Ý nghĩa                                                        |
   | ----------------- | -------------------------------------------------------------- |
   | DRY_RUN           | Không gọi AWS gửi tin; providerCalled=false, providerId=null   |
   | PROVIDER_ACCEPTED | AWS nhận yêu cầu; providerCalled=true và có providerId         |
   | FAILED            | Thất bại đã biết rõ; reason giải thích                         |
   | UNCERTAIN         | Chưa biết AWS đã gửi hay chưa; phải đối soát trước khi gửi lại |

5. Chỉ báo message đã xử lý khi kết quả đã được đưa đi thành công. Với xử lý từng phần trong lô, code và cấu hình kích hoạt Lambda đều phải bật `ReportBatchItemFailures`. C khởi đầu bằng batch size 1.
6. Nếu AWS đã nhận yêu cầu mà gửi kết quả về bị lỗi, thử gửi lại **kết quả đã lưu**, không gọi nhà cung cấp để gửi thông báo lần nữa. B cần lưu nhật ký attempt/kết quả bền vững; nếu không khôi phục được kết quả, giữ trạng thái UNCERTAIN để người phụ trách kiểm tra. Không hứa SNS chỉ gửi đúng một lần trong mọi tình huống.

**Đợi B hoàn thiện API claim, nơi lưu nhật ký và nhận outcome để làm tiếp luồng thật. Đợi C hoàn thiện HTTPS và Lambda có quyền đúng.** Trong lúc chờ, viết các ca kiểm thử bằng API/nhà cung cấp giả có nhãn rõ ràng.

**Đưa kết quả cho C:** thư mục mã sender, runtime, lệnh build/test, handler, timeout, biến cần truyền, queue nguồn/đích và quyền SNS/Connect cần dùng. **Đưa kết quả cho B:** ví dụ job/outcome hợp lệ, cách giữ claimId/outcomeId và kết quả các ca lỗi.

## 7. Nối với B/C và kiểm tra từ đầu đến cuối

Các biến sender cần có: `AWS_REGION`, `APPLICATION_RESULTS_QUEUE_URL`, `INTERNAL_API_BASE_URL`, `INTERNAL_SERVICE_TOKEN`, `SENDER_DRY_RUN`. Backend của B cần thêm `NOTIFICATION_DRIVER=sqs`, `NOTIFICATION_JOBS_QUEUE_URL`, `SNS_TOPIC_ARN` và cấu hình Connect khi dùng. `INTERNAL_API_BASE_URL` là `https://<domain>/api/v1`, không có slash cuối. B/C phải viết phần đọc biến và truyền vào chương trình; file `.env` có giá trị chưa đủ.

1. **Đợi C đưa HTTPS origin và bản đã triển khai code A/B.** Gửi C callback `https://<domain>/auth/callback` và sign-out `https://<domain>` để C cập nhật Cognito; kiểm tra lại sau khi C xác nhận đã lưu. C đặt WEB_ORIGIN và build web với API URL đúng; không dùng localhost trên bản cloud.
2. Cả nhóm dùng một bản code. Đăng nhập từ máy thứ hai, chạy lại bảng kiểm tra ở §4.3.
3. **Đợi B tạo được yêu cầu gửi từ sự kiện trong ứng dụng.** Giữ SENDER_DRY_RUN=true. Tạo sự kiện → nhìn notificationId ở backend → sender xin quyền → kết quả về DB → xem trạng thái chạy thử trong ứng dụng.
4. Thử message trùng, sự kiện đã xác nhận, claim hết hạn, đã đủ mức gửi/người nhận và đang phải chờ giữa hai lần gửi. Không trường hợp nào được vượt quy tắc backend. Mặc định bản dev giới hạn 5 lần/ngày/người nhận/kênh và chờ 60 giây giữa hai lần.
5. Thử lỗi sau khi nhà cung cấp nhận nhưng chưa lưu kết quả bằng nhà cung cấp giả; hệ thống phải giữ trạng thái chưa rõ, không tự gửi lại thật.
6. Khi chạy thử đạt, cho phép gửi thật trên đúng tài khoản/email thử. Tạo **sự kiện mới từ ứng dụng**, nhận email và kiểm tra ứng dụng lưu providerId. Console publish không thay thế bước này.
7. Làm tương tự với SMS/cuộc gọi nếu có trong yêu cầu đồ án. Nếu thiếu quyền, phần đó vẫn chưa hoàn thành.
8. Tạo sự kiện, xác nhận trước hạn: không có gửi nâng mức mới. Tạo sự kiện khác, không xác nhận: sau hạn có đúng một quyết định nâng mức và yêu cầu gửi hợp lệ theo kênh đã chọn.

## 8. Khi gặp lỗi, kiểm tra ở đâu?

| Hiện tượng                            | Kiểm tra theo thứ tự                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Login quay vòng                       | callback đúng client/origin → domain → code callback/PKCE → biến trong container          |
| API auth/config trả 404               | Nhánh code/PR auth đã gộp chưa; chỉnh Cognito không tạo ra endpoint thiếu                 |
| Có token nhưng 403                    | issuer/sub đã liên kết đúng users.id chưa → role → camera ownership                       |
| Sender báo 401                        | INTERNAL_API_BASE_URL đúng chưa → token API/Lambda có cùng secret ref chưa                |
| Sender chạy nhưng không có thư        | mode chạy thử hay thật → claim → MessageId → subscription đã confirm → hộp thư            |
| Có thư nhưng app không đổi trạng thái | message outcome → Results consumer của B → nhật ký/receipt DB                             |
| Có thông báo trùng                    | Có hai chương trình gửi cùng việc không → mã claimId/attempt → tình huống chưa rõ sau gửi |

Không gửi token, signed URL hoặc mật khẩu trong ảnh chụp lỗi. Gửi B/C eventId, notificationId, thời điểm và thông báo lỗi đã che dữ liệu riêng.

## 9. Bàn giao và diễn tập demo

Dùng ngay mẫu này trong ghi chép nhóm; không phải mở tài liệu bàn giao khác:

```text
Phần của A / ngày / người làm / người kiểm tra:
Commit hoặc PR đã gộp:
Pool ID / client ID / Cognito domain / callback và sign-out:
Hai application user IDs đã liên kết (không ghi mật khẩu):
Topic email / trạng thái email, SMS, cuộc gọi:
Sender: đường dẫn, runtime, lệnh build/test, tên handler:
Bản triển khai của C / URL HTTPS:
Các ca đã chạy / kết quả mong đợi / kết quả thực tế / nơi lưu bằng chứng:
EventId / notificationId / attemptId / providerId mẫu:
Phần còn chờ ai / cần kết quả gì:
```

Phần A xong khi B/C làm lại được: login đúng quyền → sự kiện tạo yêu cầu gửi → sender xin phép → email thật tới người nhận → trạng thái được lưu → xác nhận trên app đúng tác dụng. Chạy thêm trường hợp không xác nhận và một trường hợp lỗi. Lưu bản ghi demo dự phòng của cùng bản code, nói rõ đó là bản ghi nếu phải dùng.

Ghi trạng thái bằng tiếng Việt: **Đã chạy đạt / Cần sửa / Đang chờ B hoặc C / Bị chặn quyền AWS**. Mỗi kết quả phải nói rõ chạy bằng dữ liệu mẫu hay model thật, gửi thử hay gửi thật. Chưa nhận được thư thật thì không ghi tính năng thông báo đã hoàn thành.
