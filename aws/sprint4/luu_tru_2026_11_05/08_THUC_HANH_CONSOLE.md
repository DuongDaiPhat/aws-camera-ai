# Thao tác Console đã kiểm tra trên trình duyệt

> BẢN CŨ ĐƯỢC LƯU NGÀY 05/11/2026. Không dùng làm hướng dẫn hiện hành. Mở file theo vai trò A/B/C ở thư mục cha.

Kiểm tra ngày **04/11/2026**, Console English, Singapore; riêng IAM hiển thị Global. Đọc phần tương ứng cùng tài liệu A/B/C. Đã tạo và xóa thử một SNS Standard topic; các dịch vụ khác mới kiểm tra biểu mẫu. Giá trị dưới đây là lựa chọn cho bài lab, không phải mọi giá trị mặc định của AWS. Bảng cuối tài liệu ghi giới hạn kiểm chứng của từng phần.

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

## A — SNS: tạo topic, mở subscription và publish

Áp dụng cho A4 và topic ops của C8. Topic chứa danh sách người nhận; tạo topic thành công chưa có nghĩa đã có người đăng ký nhận email.

1. Search `SNS`, mở **Simple Notification Service** trong nhóm Services.
2. Nếu thấy trang giới thiệu **Amazon Simple Notification Service**, nhập tên vào **Topic name**, bấm **Next step**. Nếu đang ở dashboard, vào **Topics → Create topic**.
3. Trong trang **Create topic → Details**, chọn **Standard**. Với email incident dùng `camerai-s4-dev-incident-email`; với ops dùng `camerai-s4-dev-ops-alerts`. Hai mục đích dùng hai topic riêng.
4. Đối chiếu bảng trước khi tạo. Không thêm `.fifo` cho topic Standard.

| Trường/khung                    | Giá trị cho bài email cơ bản                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Type                            | Standard                                                                       |
| Name                            | Tên topic theo bước 3                                                          |
| Display name - optional         | Để trống                                                                       |
| Maximum message size            | Giữ 256 KiB như mặc định đã thấy; nội dung test ngắn không cần tăng            |
| Encryption                      | Giữ cấu hình cơ bản của nhóm; chưa thêm customer-managed KMS key trong bài này |
| Access policy                   | Giữ quyền private; không mở publish/subscribe cho Everyone                     |
| Delivery policy (HTTP/S)        | Không sửa cho bài Email                                                        |
| Message delivery status logging | Không coi đây là bằng chứng email đã đến hộp thư                               |
| Tags - optional                 | Project=CameraAI, Environment=dev, Owner=A hoặc C, Sprint=4                    |
| Active tracing - optional       | Giữ tắt nếu chưa có nhu cầu X-Ray                                              |

5. Cuộn xuống cuối, bấm **Create topic**. Đợi trang có tiêu đề đúng tên topic, khung **Details** và tab **Subscriptions**. Ghi ARN bằng nút **Copy ARN**; đừng nhầm ARN với Name.
6. Trong tab **Subscriptions**, bấm **Create subscription**. Trang mới có **Topic ARN** điền sẵn; đối chiếu đúng topic incident hoặc ops.
7. Mở **Protocol → Select protocol**, chọn **Email**. Không chọn Email-JSON cho bài đọc email thông thường. Sau khi chọn Email mới xuất hiện ô **Endpoint**.
8. Nhập địa chỉ email thật mà người thử kiểm soát vào **Endpoint**. Giữ **Subscription filter policy - optional** và **Redrive policy (dead-letter queue) - optional** chưa cấu hình cho bài email đầu tiên.
9. Bấm **Create subscription** khi người nhận đã đồng ý. Bước này gửi yêu cầu xác nhận tới email; mở hộp thư, tìm thư Amazon SNS và tự bấm **Confirm subscription**. Đây là bước người học thực hiện; phiên khảo sát chưa gửi thư xác nhận.
10. Quay lại topic → Subscriptions và làm mới trang. Kiểm tra cột **Status** hết PendingConfirmation. Nếu chưa xác nhận, kiểm tra địa chỉ/spam; không coi việc tạo subscription là email đã nhận được.
11. Trên đầu trang topic, bấm **Publish message**. Trang kế tiếp có tiêu đề **Publish message to topic**.

| Trường                             | Nhập/chọn                                              |
| ---------------------------------- | ------------------------------------------------------ |
| Subject - optional                 | `CameraAI lab email test`                              |
| Message group ID - optional        | Để trống cho bài email Standard này                    |
| Time to Live (TTL) - optional      | Để trống                                               |
| Message body                       | Chọn **Identical payload for all delivery protocols.** |
| Ô soạn nội dung trong Message body | `CameraAI lab: eventId=lab-email-01. This is a test.`  |
| Message attributes                 | Không thêm thuộc tính nếu chưa dùng filter policy      |

12. Cuộn cuối, bấm **Publish message** khi topic chỉ có người nhận thử đã đồng ý. Ghi MessageId và giờ gửi; kiểm tra hộp thư thực tế. MessageId chỉ xác nhận SNS nhận yêu cầu, không thay thế kiểm tra email đến.

**Đã kiểm tra thực tế:** tạo topic Standard tạm `camerai-s4-temp-console-20261104`, xem Details, mở form subscription, chọn Email và thấy Endpoint, mở form publish. Không tạo subscription và không publish message trong phiên khảo sát.

### Dọn topic lab sau khi dùng

1. Mở **Topics → đúng topic lab**. Kiểm tra Name, ARN và người sở hữu trước khi tiếp tục; không chọn topic dev dùng chung.
2. Bấm **Delete** cạnh Edit/Publish message ở đầu trang, không nhầm nút Delete của bảng subscriptions.
3. Hộp thoại có tiêu đề **Delete topic <tên-topic>**. Đọc lại tên; nhập chính xác `delete me` vào ô xác nhận.
4. Khi nút **Delete** sáng, bấm một lần. Đợi quay về Topics và thông báo **Topic <tên-topic> deleted successfully.**
5. Tìm lại tên trong danh sách để xác nhận đã biến mất. Với phiên kiểm tra này, Console báo xóa thành công và **Topics (0)**. Topic tạm không có subscription nên không còn subscription tạm cần dọn.

## A — SMS: nhận biết màn hình và lỗi sandbox

1. Trong SNS, mở menu trái; nếu đang thu gọn, bấm biểu tượng mở side navigation.
2. Chọn **Mobile → Text messaging (SMS)**. Tiêu đề trang là **Mobile text messaging (SMS)**.
3. Tìm **Account information** để đọc trạng thái tài khoản. Phiên kiểm tra hiển thị: **An error occurred while displaying the status of your AWS account. AWS can't determine whether your AWS account is in the SMS sandbox.**
4. Nếu thấy lỗi này, ghi `BLOCKED_ACCOUNT` và nội dung lỗi vào bàn giao; chưa kết luận tài khoản đã ra sandbox. Nhờ người quản lý tài khoản kiểm tra quyền/trạng thái với AWS; không tự tăng spending limit để xử lý lỗi hiển thị.
5. Trang có **Origination IDs** và **Go to AWS End User Messaging** dẫn tới phần quản lý số nguồn. Các nút **Subscribe number to topic**, **Publish text message**, **Edit preferences** là các thao tác khác nhau; không dùng Publish text message để kiểm tra sandbox.
6. Chỉ tiếp tục xác minh số/gửi SMS theo A5 sau khi trạng thái và origination identity được xác nhận. Phiên này không nhập số điện thoại, gửi OTP hoặc SMS; luồng xác minh số chưa được kiểm tra.

## B — Step Functions: từ wizard tới Code và Config

Áp dụng cho B8. Chuẩn bị ARN deadline Lambda và toàn bộ JSON của [Lab 06](../../labs/06_STEP_FUNCTIONS.md) trước khi tạo workflow thật.

1. Search **Step Functions**, mở dịch vụ. Nếu gặp trang giới thiệu, mở menu trái → **State machines**. Không cần bấm Copy agent prompt hoặc cài công cụ được giới thiệu trên trang.
2. Trong **State machines**, bấm **Create state machine**. Đợi hộp thoại **Create state machine** xuất hiện trên Workflow Studio.
3. Chọn **Create from blank**, nhập **State machine name = camerai-s4-lab-b-deadline**, chọn **Standard**, bấm **Continue**. Continue chỉ mở trình thiết kế; chưa lưu workflow lên AWS.
4. Trên thanh đầu trang có ba chế độ **Design**, **Code**, **Config** và nút **Create**. Trong Design, khi chọn Workflow, phần cấu hình có **JSONata - recommended** và **JSONPath**.
5. Lab 06 dùng `SecondsPath` và `Payload.$`, vì vậy chọn **JSONPath** trước khi đi tiếp. Không giữ JSONata rồi dán nguyên code JSONPath.
6. Bấm **Code** trên thanh đầu trang. Editor có các nút **Undo, Redo, Format, Copy, Commands, View docs**. Bấm vào vùng code trước khi chọn toàn bộ và thay bằng JSON của Lab 06; thay FunctionName bằng ARN Lambda thật, giữ nguyên cấu trúc JSONPath của mẫu. Việc dán/validate code chưa được chạy trong phiên khảo sát.
7. Bấm **Config**. Tiêu đề là **State machine configuration**. Kiểm tra từng khung sau.

| Khung/trường                      | Lựa chọn cho lab                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Details → State machine name      | `camerai-s4-lab-b-deadline`                                                            |
| Type                              | Standard                                                                               |
| Permissions → Execution role      | Role C chuẩn bị hoặc Create new role sau khi review quyền                              |
| Review auto-generated permissions | Mở để kiểm tra quyền trước khi tạo; Lambda InvokeFunction phải trỏ đúng function lab   |
| Logging → Log level               | Màn hình quan sát đang là OFF; nếu bật logging phải cấu hình log group/quyền tương ứng |
| Additional configuration          | Kiểm tra các lựa chọn bổ sung trước khi bật tracing/tính năng khác                     |

8. Khi Code và Config đã đúng, bấm **Create**. Nếu AWS yêu cầu review quyền, đọc và kiểm tra lại resource ARN trước khi xác nhận. Phiên này dừng trước Create; chưa tạo role hay state machine.
9. Sau tạo, chạy bài **Start execution** của B8 với input Lab 06; kiểm tra Wait → Lambda → Succeeded và kịch bản forceError. Các màn hình execution/result chưa được mở thực tế; không ghi workflow pass chỉ vì đã vào được editor.

## C — IAM: tạo EC2 role bằng ba bước rõ ràng

Áp dụng C2. IAM là dịch vụ Global; thanh Region chuyển sang **Global** không có nghĩa bạn tạo nhầm Region. Trong Search chọn **IAM**, không chọn IAM Identity Center hoặc Roles Anywhere.

1. Mở **IAM → Access Management → Roles → Create role**.
2. Bước **Select trusted entity**: **Trusted entity type = AWS service**.
3. Trong **Use case → Service or use case**, mở danh sách, gõ `EC2` vào **Filter service or use case**, chọn **EC2**.
4. Phía dưới xuất hiện thêm các radio use case: chọn **EC2** thông thường. Trong luồng này không chọn EC2 Spot Fleet hoặc **EC2 Role for AWS Systems Manager**; policy SSM sẽ được thêm rõ ràng ở bước tiếp theo.
5. Cuộn cuối → **Next**. Bước 2 có tiêu đề **Add permissions**, chọn **Use existing policy**.
6. Trong ô Search của bảng **Permissions policies**, nhập `AmazonSSMManagedInstanceCore`. Phân biệt ô này với ô Search AWS trên thanh đầu trang.
7. Đợi đúng policy loại **AWS managed** xuất hiện. Đánh dấu checkbox bên trái tên policy; bấm chữ tên policy sẽ mở tài liệu policy ở tab mới, không phải chọn policy.
8. Kiểm tra số policy được chọn, bấm **Next**. Trang thứ ba là **Name, review, and create**.

| Trường/khung                                         | Giá trị cần kiểm tra                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Role details → Role name                             | `camerai-s4-dev-ec2`                                                                        |
| Description                                          | Mô tả vai trò EC2 app/Session Manager của nhóm                                              |
| Step 1: Select trusted entities → Trust policy       | Trusted service là EC2; không thêm AWS account hoặc principal ngoài dự kiến                 |
| Step 2: Add permissions → Permissions policy summary | Có AmazonSSMManagedInstanceCore; quyền ứng dụng thêm theo C2, không gắn AdministratorAccess |
| Step 3: Add tags → Add new tag                       | Project=CameraAI, Environment=dev, Owner=C, Sprint=4                                        |

9. Bấm **Create role** khi đã review xong. Sau tạo, chọn instance profile tương ứng trong EC2 → Advanced details như phần C ở trên. Nếu không thấy, refresh dropdown và kiểm tra quyền PassRole của người triển khai.
10. Policy SSM không tự cấp quyền S3/SQS/Step Functions cho ứng dụng. Tiếp tục bổ sung policy theo resource ARN của C2 và thử credentials từ container.

**Đã kiểm tra:** đi hết ba trang wizard, chọn policy SSM trong bản nháp và thấy policy ở Permissions policy summary. Chưa bấm Create role, chưa attach role vào EC2.

## Phạm vi kiểm chứng và tài nguyên tạm

| Dịch vụ              | Đã xem/thực hiện                                                                                | Chưa kiểm tra thực tế                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Cognito              | Wizard và form callback/scopes của client                                                       | Tạo pool/user, lưu thay đổi, login E2E                   |
| S3, SQS, Lambda, EC2 | Các biểu mẫu trong phần hướng dẫn phía trên                                                     | Tạo mới, upload, invoke, mapping, launch/SSM             |
| SNS                  | Tạo topic Standard; xem subscription Email và publish; xóa topic thành công                     | Tạo/xác nhận subscription, gửi và nhận email             |
| SMS                  | Trang Text messaging, lỗi không đọc được sandbox, các liên kết origination                      | OTP, cấu hình số nguồn, gửi SMS                          |
| Step Functions       | Create from blank → Continue; Design/Code/Config                                                | Lưu workflow/role, validate code, Start execution        |
| CloudWatch           | Metrics/Classic, chọn SQS Queue Metrics, điều kiện, Additional configuration, Configure actions | Hai bước cuối, tạo alarm, chuyển ALARM và gửi email      |
| IAM                  | Ba trang tạo EC2 role; chọn SSM policy trong bản nháp                                           | Create role, instance profile và PassRole thực tế        |
| Connect              | Kết quả Search ghi **Amazon Connect Customer**                                                  | Trang instance, wizard tạo instance, telephony/flow/call |

CloudWatch có hướng dẫn riêng ngay dưới bảng này. Connect chưa mở được vì công cụ điều khiển trình duyệt dừng khi không xác định được URL đủ chắc chắn để kiểm tra chính sách; phần A5 vẫn dựa trên [nguồn AWS](07_CONSOLE_VA_NGUON.md). Kết quả Search còn có Direct Connect và Connect Health; chúng không phải dịch vụ gọi thông báo cần chọn.

Tài nguyên tạm duy nhất đã tạo là SNS topic `camerai-s4-temp-console-20261104` ở Singapore. Đã xóa và xác nhận **deleted successfully**, **Topics (0)**. Không tạo subscription, role, workflow hoặc alarm tạm; không có tài nguyên tạm chờ dọn từ phiên khảo sát này.

## C — CloudWatch: chọn đúng metric và cấu hình actions

Áp dụng C8. Chuẩn bị tên DLQ từ B và SNS ops topic có email đã xác nhận. Các bước sau mô tả lựa chọn cho bài DLQ; trong phiên khảo sát chỉ đi đến Configure actions, chưa tạo alarm.

1. Search **CloudWatch**, vào **Alarms** trong menu trái. Console kiểm tra hiển thị trực tiếp danh sách Alarms và tab **Mute rules**; không bắt buộc có menu con All alarms.
2. Bấm **Create alarm**. Wizard có bốn bước: **Specify metric and conditions → Configure actions → Add alarm details → Preview and create**.
3. Trong bước đầu, chọn **Data source = Metrics**, **Type = Classic**. Bài này chưa dùng Logs, composite Alarms hoặc PromQL.
4. Bấm **Select metric**. Trong hộp thoại, mở tab **Browse**. Tìm **SQS → Queue Metrics**. Nếu ô SQS nằm dưới vùng đang nhìn thấy, cuộn bên trong phần Browse, không cuộn biểu đồ phía trên.
5. Có thể nhập `SQS` vào ô **Filter by any metric, dimension, resource id or account id**, nhấn Enter, rồi chọn **SQS > Queue Metrics** trong kết quả.
6. Trong bảng, dùng ô **Filter metrics** để tìm `ApproximateNumberOfMessagesVisible`, nhấn Enter. Bộ lọc có thể trả cả tên dài kết thúc bằng **InQuietGroups**; chọn đúng tên metric nguyên vẹn, không chọn tên gần giống.
7. Đối chiếu cột **QueueName** là DLQ B bàn giao. Chọn checkbox của đúng một hàng; không chọn checkbox đầu bảng vì nó chọn nhiều metric.
8. Khi có một metric được chọn, nút dưới phải đổi từ **Select a single metric to continue** sang **Select metric**. Bấm nút đó.
9. Quay về wizard, đọc lại **Metric name** và **QueueName**. Các mặc định quan sát là Average và 5 minutes; phải chủ động đổi theo bảng lab.

| Trường                                         | Giá trị bài DLQ                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Statistic                                      | Maximum                                                                                                       |
| Period                                         | 1 minute                                                                                                      |
| Conditions → Threshold type                    | Static                                                                                                        |
| Whenever…                                      | Greater                                                                                                       |
| than…                                          | Nhập `0`; không để placeholder `10000`                                                                        |
| Additional configuration → Datapoints to alarm | 1 out of 1                                                                                                    |
| Missing data treatment                         | Chọn lựa chọn coi missing là không vi phạm (notBreaching); mặc định quan sát là Treat missing data as missing |
| Evaluation window                              | Default (Sliding window)                                                                                      |
| Enable warm-up treatment                       | Giữ tắt cho bài cơ bản                                                                                        |

10. Bấm **Additional configuration** để hiện datapoints/missing data; chúng không nằm trong trang Configure actions. Cuộn cuối rồi **Next**.
11. Trang **Configure actions → Notification** có các lựa chọn sau. Giữ các action Lambda, Auto Scaling, EC2, Systems Manager và Investigation chưa thêm cho bài email DLQ.

| Trường                                         | Chọn                             |
| ---------------------------------------------- | -------------------------------- |
| Alarm state trigger                            | In alarm                         |
| Send a notification to the following SNS topic | Select an existing SNS topic     |
| Send a notification to…                        | Chọn `camerai-s4-dev-ops-alerts` |

12. Nếu dropdown chưa có topic, kiểm tra Region và topic ops đã được tạo. Không chọn incident topic chỉ để đi tiếp. Nếu giữ **Create new topic**, đó là luồng tạo topic khác; bài này dùng topic ops chuẩn bị trước.
13. Theo C8, tiếp tục **Next → Add alarm details**, đặt tên rõ queue/mục đích, rồi **Preview and create** để review và tạo. Hai trang này chưa được mở trong khảo sát; kiểm tra các nhãn thực tế trước khi bấm tạo.
14. Sau tạo mới chạy bài test DLQ/email của C8. Chọn metric và xem graph thành công chưa chứng minh alarm/email hoạt động. Phiên khảo sát không gửi message vào queue hiện có và không lưu alarm.
