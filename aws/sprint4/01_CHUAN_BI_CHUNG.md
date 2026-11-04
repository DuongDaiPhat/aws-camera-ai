# Phiên 0 — Cả ba chuẩn bị, rồi tách luồng

Đọc [trang bắt đầu](README.md) trước. Mục tiêu phiên này: mỗi người biết mình đang ở tài khoản nào, được làm gì, và có thể bắt đầu bài riêng mà không làm đè tài nguyên của nhau.

## 1. Hiểu các từ bạn sẽ nhìn thấy

| Từ trên Console | Hiểu đơn giản                                | Ví dụ trong bài                 |
| --------------- | -------------------------------------------- | ------------------------------- |
| Region          | Khu vực triển khai                           | Singapore `ap-southeast-1`      |
| ARN             | Địa chỉ định danh tài nguyên                 | IAM policy dùng queue ARN       |
| URL             | Địa chỉ để chương trình gọi                  | SQS SDK dùng Queue URL          |
| Role            | Quyền mà một chương trình được dùng          | Role Lambda đọc ảnh S3          |
| Policy          | Quy tắc cho phép/từ chối                     | Cho `GetObject` trên một prefix |
| Trigger         | Nguồn làm hàm chạy                           | SQS gọi Lambda                  |
| Log             | Dấu vết chương trình đã làm                  | `resultId`, trạng thái xử lý    |
| DLQ             | Hàng đợi giữ công việc lỗi sau nhiều lần thử | Job hỏng không bị mất           |
| Stack           | Một nhóm tài nguyên được tạo từ template     | SAM/CloudFormation dev          |
| Fixture         | Dữ liệu mẫu biết trước kết quả               | Ảnh đã gắn nhãn                 |

## 2. Người quản lý tài khoản cấp quyền một lần

Đây là điều kiện của tổ chức, không giả định ba người mới học có sẵn AdministratorAccess. Người có quyền quản lý tài khoản thực hiện cấp access. Nếu cả ba chưa có quyền này, nhờ chủ tài khoản; trong lúc chờ vẫn đọc contract và chạy ứng dụng local.

1. Chủ tài khoản cấp ba phiên đăng nhập riêng qua IAM Identity Center nếu tổ chức đã dùng; mỗi người nhận đường dẫn access portal và permission set phù hợp nhiệm vụ.
2. Chủ tài khoản bật MFA theo chính sách; ba người không chia sẻ root hoặc một access key chung.
3. Trong IAM, người quản lý kiểm tra quyền tạo/quản lý các tài nguyên ở bảng dưới. Khi thao tác bị `AccessDenied`, gửi tên action, resource ARN, Region và thời điểm; không gửi credential.
4. Phân biệt quyền **người tạo tài nguyên**, quyền **PassRole** đúng role, và quyền **service role**. Có quyền mở Lambda Console không tự có quyền đọc S3 trong hàm.

| Actor | Quyền cần cho bài                                                                              | Giới hạn cần giữ                                           |
| ----- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A     | Quản lý User Pool/app client; SNS topic/subscription; Lambda sender; Connect/SMS khi được phép | Tài nguyên nhóm, số/email thử đã đồng ý                    |
| B     | S3 lab; SQS; Rekognition; Lambda face/deadline; Step Functions                                 | Bucket/prefix, queue và collection của bài                 |
| C     | EC2/VPC/SSM, role/policy, CloudFormation/SAM, CloudWatch; ECR/S3 release cho CD                | Resource theo môi trường; không tự mở quyền toàn tài khoản |

Người quản lý đọc [IAM service roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html). Nếu dùng Console: **IAM → Roles → Create role → AWS service → chọn use case → Next → permissions → Next → Role name → Create role**. Chỉ chọn đúng service tin cậy; không chọn trust cho một AWS account khác để né lỗi.

## 3. Kiểm tra account, giao diện và Region trên từng máy

1. Mở AWS access portal/Console bằng tài khoản được cấp.
2. Chọn English trong phần ngôn ngữ của Console nếu muốn khớp nhãn trong tài liệu.
3. Mở menu tài khoản góc trên, ghi account ID và role đang dùng vào sổ nhóm.
4. Ở Region selector chọn **Asia Pacific (Singapore)**.
5. Gõ tên service trong ô Search trên cùng, rồi mở kết quả **service**, không mở quảng cáo hoặc tài liệu.
6. Cả ba đối chiếu account ID và Region trước khi tạo resource. IAM/Billing có giao diện global; điều đó không có nghĩa SQS/Cognito là global.

## 4. Tạo budget bằng email thật

Chủ tài khoản mở **Billing and Cost Management → Budgets → Create budget**. Nếu dùng wizard tùy chỉnh: **Customize (advanced) → Cost budget → Next**, đặt tên `camerai-s4-budget`, Period Monthly, số tiền nhóm đã duyệt. Thêm ngưỡng actual/forecast và email nhóm, review rồi tạo. Kiểm tra địa chỉ nhận cảnh báo đúng.

Budget có độ trễ và không tự ngắt mọi dịch vụ. Không ghi mặc định EC2, SMS hoặc Connect miễn phí. C ghi mức dự toán từ pricing của Region/tài khoản trước khi nhóm bấm tạo. [AWS tạo cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html).

## 5. CLI trên Windows: làm theo prompt

CLI là cách gọi AWS bằng lệnh; dùng cho phần Console không có luồng tương đương, đặc biệt Rekognition collections. Cài AWS CLI v2 theo [AWS Windows installer](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), mở PowerShell mới:

```powershell
aws --version
aws configure sso --profile camerai-lab
aws sso login --profile camerai-lab
aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
```

Trong `configure sso`, nhập start URL/SSO Region/role do người quản lý cấp. SSO Region có thể khác Singapore. Nếu tổ chức không dùng SSO, thực hiện đúng phương thức credential mà quản trị viên cấp theo [Lab 00](../labs/00_CHUAN_BI.md); không tự tạo root access key.

**Đạt:** lệnh STS trả đúng Account và Arn. CLI error không được sửa bằng cách dán keys vào `.env` rồi commit. Mỗi lệnh tiếp theo giữ `--profile` và `--region` như ví dụ.

## 6. Đặt tên và ghi tài nguyên

Tên lab riêng: `camerai-s4-lab-a-*`, `camerai-s4-lab-b-*`, `camerai-s4-lab-c-*`. Tài nguyên ghép thật: `camerai-s4-dev-*`; chỉ một owner tạo. S3 cần tên duy nhất, ví dụ `camerai-s4-dev-media-<account-id>-<suffix>`; không đặt email hoặc tên người trong tên resource.

Tag các resource hỗ trợ tag: `Project=CameraAI`, `Environment=lab|dev|staging|production`, `Owner=A|B|C`, `Sprint=4`. Ghi tên, ARN/URL, Region, owner, stack và ngày dự kiến dọn vào mẫu bàn giao. Resource do SAM quản lý được sửa bằng template; bài Console riêng không dùng trùng tên stack.

## 7. Chốt hợp đồng G0 trong 30–60 phút

1. Cả ba chốt commit code để làm việc, không chạy nhánh docs. Review các commit `lab-test` trước khi tích hợp; hướng dẫn không tự merge chúng vào main.
2. B lập schema job/result và fixture hợp lệ, lỗi, trùng. Dùng UUID thực cho field mà API yêu cầu UUID; chuỗi `lab-event-01` chỉ dùng handler lab riêng.
3. A chốt user A/B, role và camera nào thuộc ai; email test phải nhận được thư.
4. C chốt tên tài nguyên dev, người deploy stack duy nhất, tên miền và giờ sử dụng tài nguyên.
5. Ghi trước vị trí service API deadline và claim sender trong OpenAPI. Nếu chưa có endpoint, ghi **CẦN IMPLEMENT** cùng owner; không cho Lambda gọi URL giả.
6. Chọn một producer cho từng incident, một deadline owner. Local và cloud không cùng xử lý một sự kiện để demo.
7. Chốt output bàn giao: A pool/client/domain/topic; B queues/schema/workflow; C HTTPS URL, role và stack outputs.

**G0 đạt:** STS cả ba đúng; quyền/account blockers có owner; bảng tài nguyên và schema v1 có người review. Sau đó mở đồng thời tài liệu A/B/C.
