# Phiên 0 — Cả ba chuẩn bị, rồi tách luồng

> BẢN CŨ ĐƯỢC LƯU NGÀY 05/11/2026. Không dùng làm hướng dẫn hiện hành. Mở file theo vai trò A/B/C ở thư mục cha.

**G0 đã chốt contract v1 ngày 05/11/2026:** dùng [hợp đồng chung](00_HOP_DONG_G0.md) và [schema/fixtures](../contracts/README.md) làm nguồn thống nhất cho type/field/API/config/owner. Account, quyền, resource IDs và release thực tế vẫn cần xác minh; không ghi G0 access hoặc E2E PASS chỉ vì contract đã chốt.

**Đầu ra sau phiên chuẩn bị:** cả ba mở [10 — hoàn thiện tính năng và demo](10_HOAN_THIEN_TINH_NANG_VA_DEMO.md), nhận owner F1–F6 và ghi phạm vi đồ án vào 06. Các bài dịch vụ độc lập là bước học để thực hiện các gói tính năng; chưa thay thế phần lập trình và tích hợp.

Đọc [trang bắt đầu](README.md) trước. Mục tiêu phiên này: mỗi người biết mình đang ở tài khoản nào, được làm gì, và có thể bắt đầu bài riêng mà không làm đè tài nguyên của nhau.

**Cách dùng bộ tài liệu:** 01–04 chia việc học/lập trình cho ba người; [08](08_THUC_HANH_CONSOLE.md) là chi tiết màn hình và giới hạn đã kiểm chứng; [09](09_RUNBOOK_GHEP_HE_THONG.md) là thứ tự ghép R0–R7. Dùng 05 để nghiệm thu, 06 để bàn giao và 07 để tìm màn hình/lỗi. Một biểu mẫu đã xem trong 08 không đồng nghĩa bài của người học đã PASS.

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

Người quản lý đọc [IAM service roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html). Console có ba bước **Select trusted entity → Add permissions → Name, review, and create**; xem [luồng EC2 role đã kiểm tra](08_THUC_HANH_CONSOLE.md#c--iam-tạo-ec2-role-bằng-ba-bước-rõ-ràng). Chỉ chọn đúng service tin cậy; không chọn trust cho một AWS account khác để né lỗi. Tạo role không tự cấp PassRole cho người deploy.

## 3. Kiểm tra account, giao diện và Region trên từng máy

1. Mở AWS access portal/Console bằng tài khoản được cấp.
2. Chọn English trong phần ngôn ngữ của Console nếu muốn khớp nhãn trong tài liệu.
3. Mở menu tài khoản góc trên, ghi account ID và role đang dùng vào sổ nhóm.
4. Ở Region selector chọn **Asia Pacific (Singapore)**.
5. Gõ tên service trong ô Search trên cùng, rồi mở kết quả **service**, không mở quảng cáo hoặc tài liệu.
6. Cả ba đối chiếu account ID và Region trước khi tạo resource. IAM/Billing có giao diện global; điều đó không có nghĩa SQS/Cognito là global.

## 4. Tạo budget bằng email thật

Chủ tài khoản mở **Billing and Cost Management → Budgets → Create budget**. Nếu dùng wizard tùy chỉnh: **Customize (advanced) → Cost budget → Next**, đặt tên `camerai-s4-budget`, Period Monthly, số tiền nhóm đã duyệt. Thêm ngưỡng actual/forecast và email nhóm, review rồi tạo. Kiểm tra địa chỉ nhận cảnh báo đúng.

Wizard budget chưa được kiểm tra trực tiếp trong phiên 08; các bước này dựa trên nguồn AWS, cần đối chiếu quyền và nhãn thực tế trước khi tạo.

Budget có độ trễ và không tự ngắt mọi dịch vụ. Không ghi mặc định EC2, SMS hoặc Connect miễn phí. C ghi mức dự toán từ pricing của Region/tài khoản trước khi nhóm bấm tạo. [AWS tạo cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html).

## 5. CLI trên Windows: làm theo prompt

CLI là cách gọi AWS bằng lệnh; dùng cho phần Console không có luồng tương đương, đặc biệt Rekognition collections. Cài AWS CLI v2 theo [AWS Windows installer](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), mở PowerShell mới:

```powershell
aws --version
aws configure sso --profile camerai-lab
aws sso login --profile camerai-lab
aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
```

Trong `configure sso`, nhập start URL/SSO Region/role do người quản lý cấp. SSO Region có thể khác Singapore. Nếu tổ chức không dùng SSO, thực hiện đúng phương thức credential mà quản trị viên cấp theo [Lab 00](../../labs/00_CHUAN_BI.md); không tự tạo root access key.

**Đạt:** lệnh STS trả đúng Account và Arn. CLI error không được sửa bằng cách dán keys vào `.env` rồi commit. Mỗi lệnh tiếp theo giữ `--profile` và `--region` như ví dụ.

CLI dùng được SSO trên laptop chưa chứng minh Docker container có credentials. Trên EC2 dùng instance role; xem [bảng config và lưu ý credential chain](09_RUNBOOK_GHEP_HE_THONG.md#2-bảng-nối-cấu-hình-lấy-gì-đưa-vào-đâu) trước khi thử S3 từ backend.

## 6. Đặt tên và ghi tài nguyên

Tên lab riêng: `camerai-s4-lab-a-*`, `camerai-s4-lab-b-*`, `camerai-s4-lab-c-*`. Tài nguyên ghép thật: `camerai-s4-dev-*`; chỉ một owner tạo. Bài S3 chọn **Global namespace** để khớp mẫu; tên bucket trong namespace này cần duy nhất, ví dụ `camerai-s4-dev-media-<account-id>-<suffix>`. Thay placeholder bằng giá trị thật; không đặt email hoặc tên người trong tên resource. Không chuyển sang Account Regional namespace mà chưa điều chỉnh template/naming theo 08.

Tag các resource hỗ trợ tag: `Project=CameraAI`, `Environment=lab|dev|staging|production`, `Owner=A|B|C`, `Sprint=4`. Ghi tên, ARN/URL, Region, owner, stack và ngày dự kiến dọn vào mẫu bàn giao. Resource do SAM quản lý được sửa bằng template; bài Console riêng không dùng trùng tên stack.

## 7. Áp dụng contract G0 đã chốt và xác minh access trong 30–60 phút

1. Cả ba chốt commit code để làm việc, không chạy nhánh docs. Review các commit `lab-test` trước khi tích hợp; hướng dẫn không tự merge chúng vào main.
2. B lập schema job/result và fixture hợp lệ, lỗi, trùng. Dùng UUID thực cho field mà API yêu cầu UUID; chuỗi `lab-event-01` chỉ dùng handler lab riêng.
3. A chốt user A/B, role và camera nào thuộc ai; email test phải nhận được thư.
4. C chốt tên tài nguyên dev, người deploy stack duy nhất, tên miền và giờ sử dụng tài nguyên.
5. Đưa API deadline và claim/outcome đã chốt ở G0 §4/5 vào OpenAPI và triển khai theo 10; không tự chọn lại đường dẫn. Ghi trạng thái endpoint thực tế. Nếu chưa có endpoint, ghi **NEEDS_IMPLEMENTATION** cùng owner/PR; dừng chặng tích hợp phụ thuộc theo 09, không cho Lambda gọi URL giả.
6. Chọn một producer cho từng incident, một deadline owner. Local và cloud không cùng xử lý một sự kiện để demo.
7. Chốt output bàn giao: A pool/client/domain/topic; B queues/schema/workflow; C HTTPS URL, role và stack outputs.
8. Điền bảng config của 09: tên biến thực, file đọc biến, service nhận và nguồn giá trị. Chốt S3_BUCKET khác STORAGE_BUCKET, queue URL khác ARN, AI result khác notification outcome; không tự đặt tên env SQS khi code chưa đọc.

**G0 contract đã chốt v1; G0 đầy đủ chỉ đạt khi:** STS cả ba đúng; quyền/account blockers có owner; bảng tài nguyên và schema v1 có người review. Sau đó mở đồng thời tài liệu A/B/C.

Trạng thái dùng thống nhất: **LAB_PASS** cho bài dịch vụ riêng, **INTEGRATION_PASS** cho chặng ghép, **E2E_PASS** cho chuỗi thật đúng phạm vi; **NEEDS_IMPLEMENTATION**, **NEEDS_FIX**, **BLOCKED_ACCOUNT**, **BLOCKED_AI** cho việc chưa đạt. Phiếu từng ca có thể ghi PASS nhưng phải kèm chặng/phạm vi; xem [mẫu 06](06_MAU_BAN_GIAO.md).
