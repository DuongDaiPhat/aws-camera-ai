# Mẫu bàn giao cho ba người

Copy mẫu vào ghi chép nhóm được kiểm soát hoặc `docs/test/sprint-4-aws/` khi không có dữ liệu nhạy cảm. Đây là template chưa chạy. Không ghi password, AWS key, token, signed URL, số điện thoại đầy đủ hoặc ảnh mặt vào Git.

Khi ghép, điền thêm [bảng nối config và phiếu R0–R7](09_RUNBOOK_GHEP_HE_THONG.md). Ghi tên biến thực, file đọc biến và commit PR triển khai; không chỉ ghi ARN/URL mà thiếu service nào nhận giá trị đó.

Trạng thái đồng bộ với 05/09: PASS phải ghi phạm vi LAB_PASS/INTEGRATION_PASS/E2E_PASS. Thiếu implementation ghi NEEDS_IMPLEMENTATION và PR/owner; có code nhưng lỗi ghi NEEDS_FIX; thiếu điều kiện tài khoản/model ghi BLOCKED_ACCOUNT/BLOCKED_AI. Mẫu này chưa điền không phải báo cáo đã đạt.

## 1. Chốt phạm vi

| Mục                                               | Nhóm điền                                     |
| ------------------------------------------------- | --------------------------------------------- |
| Account ID/alias và role A/B/C                    | Chưa điền                                     |
| Region                                            | ap-southeast-1                                |
| Ngân sách/người duyệt chi phí                     | Chưa điền                                     |
| Commit code/môi trường lab-dev-staging-production | Chưa điền                                     |
| A/B/C là ai; ai review ai                         | Chưa điền                                     |
| Domain/DNS owner/VPN được chọn                    | Chưa điền                                     |
| AI artifact sẵn sàng hay còn chờ                  | Chưa điền                                     |
| Producer/transport/deadline owner đang bật        | Chưa điền                                     |
| Phạm vi Console đã kiểm tra / chỉ dựa nguồn AWS   | Theo bảng cuối 08; bổ sung evidence người học |

## 2. Inventory — mỗi resource một dòng

| Environment | Service/tên | ARN-ID-URL | Region/AZ | Owner | Stack hay Console | Giữ tới/dọn bởi |
| ----------- | ----------- | ---------- | --------- | ----- | ----------------- | --------------- |
| lab         | Chưa điền   | Chưa điền  | Singapore | A/B/C | Chưa điền         | Chưa điền       |

Thêm bucket/prefix/retention, từng queue/DLQ, Lambda/role/log group, collection, workflow, pool/client/domain, topic incident/ops, Connect instance/flow, EC2/volume/IP/security group, DNS, ECR/release/backup nơi dùng. Chỉ ghi tên tham chiếu secret store, không ghi secret.

## 3. A bàn giao

```text
Pool ID / issuer / public client ID / domain:
Callback và sign-out URLs:
Application user IDs + Cognito sub (ghi ở nơi bảo vệ):
Role/ownership đã kiểm tra:
Topic incident ARN/subscription confirmed:
SMS_REAL / CALL_REAL status, blocker, owner xử lý:
Sender artifact/version/dry-run policy:
Claim/outcome contract PR và trạng thái implementation:
Notification outcome type (không gửi vào AI result DTO):
Fixture/result schema version:
Evidence auth/refresh/logout/403:
```

## 4. B bàn giao

```text
Schema version/OpenAPI/fixtures:
Face jobs + results queue URLs/ARNs/DLQs:
Collection isolation rule/lab collection ID:
Face/deadline handler path/runtime/timeout:
Deadline command: METHOD/path/auth/request/response:
Sender claim: METHOD/path/auth/request/response:
Notification outcome API hoặc message type:
Endpoint nào đã có, endpoint nào NEEDS_IMPLEMENTATION + PR/owner:
Baseline AI result: POST /api/v1/internal/events/{eventId}/ai-result; X-Internal-Token; HTTP 202:
Config ref INTERNAL_SERVICE_TOKEN (không ghi giá trị):
Transport face thực tế: BullMQ hay SQS; cơ chế tắt producer cũ:
Idempotency/revision/deadlineVersion/lease semantics:
Migration filename và procedure:
Workflow ARN/execution naming/reconcile:
Evidence duplicate/stale/crash-before-delete:
```

## 5. C bàn giao

```text
HTTPS URL/certificate test từ máy thứ hai:
Commit + web/backend digests:
CloudFormation stack/Outputs:
EC2 role/instance ID/container credential check:
VPN route/ACL/private connectivity:
Log groups/retention/dashboard:
Alarm/ops topic/email confirmed/test evidence:
Backup location/timestamp/checksum/restore DB test:
Deploy/migration runner/rollback:
Config S3_BUCKET/STORAGE_PROVIDER, auth provider, queue/workflow thực trong từng service:
Health endpoint và kết quả smoke DB/S3/job/result riêng:
Chi phí/inventory/tài nguyên cần dọn:
```

## 6. Mẫu test và blocker

```text
Case ID/AWS-xx/chặng R0–R7/mốc G/owner/reviewer:
Account/Region/environment/commit:
Điều kiện trước test/input reference:
Các bước đã làm:
Expected/actual:
Event/job/result/execution/notification/provider IDs:
Thời gian UTC và địa phương:
Evidence reference đã che dữ liệu nhạy cảm:
PASS / NEEDS_IMPLEMENTATION / NEEDS_FIX / BLOCKED_ACCOUNT / BLOCKED_AI:
Phạm vi PASS: LAB_PASS / INTEGRATION_PASS / E2E_PASS:
Blocker: action/resource/quota/API thiếu, ai xử lý, khi nào kiểm tra lại:
```

## 7. Ma trận role cho C tạo và B/A review

IAM role → **Permissions → Add permissions → Create inline policy** nếu UI cung cấp. Chọn service/actions/resource trong editor hoặc JSON đã review, Save rồi thử đúng thao tác. Không dùng Action:* Resource:* cho cả bài. Một số create/list API cần resource *, nhưng quyền dữ liệu phải giới hạn tài nguyên thực.

| Role                | Trust service        | Quyền công việc                                                                             | Giới hạn                                                  |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Face Lambda         | lambda.amazonaws.com | Logs, consume face SQS, GetObject, SearchFacesByImage, SendMessage results                  | Log group, queues, bucket/prefix, collection              |
| Enrollment nếu tách | lambda.amazonaws.com | IndexFaces/ListFaces/DeleteFaces theo tác vụ                                                | Collection đúng owner, S3 input kiểm soát                 |
| Deadline Lambda     | lambda.amazonaws.com | Logs; đọc service auth secret nếu dùng                                                      | Log group và secret/parameter cụ thể, không DB            |
| Sender Lambda       | lambda.amazonaws.com | Consume notification SQS, SendMessage results, SNS Publish/Connect outbound, service secret | Queues/topics/Connect resources; allowlist còn phải ở app |
| Workflow            | states.amazonaws.com | InvokeFunction                                                                              | Deadline Lambda ARN chính xác                             |
| EC2                 | ec2.amazonaws.com    | SSM, app calls, registry/config, logs/metrics                                               | Tài nguyên đúng environment                               |

Review trust/confused-deputy conditions phù hợp từng service. Không thêm SourceArn tùy ý làm service không assume được role. Nếu dùng KMS riêng, review cả key policy và IAM. Bảng này là yêu cầu để viết policy, không phải JSON có thể dán nguyên vào IAM.

## 8. Bảng nối config và dọn tài nguyên sau kiểm tra

| Chặng/service nhận           | Tên biến/config thực                                         | File đọc biến/PR                                 | Nguồn ARN/URL/Name hoặc secret ref     | SET và hành vi đã kiểm tra | Owner/reviewer |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------- | -------------------------- | -------------- |
| Backend storage              | STORAGE_PROVIDER, S3_BUCKET                                  | StorageModule/S3StorageService của commit deploy | Bucket Name dev                        | Chưa                       | B/C            |
| Auth backend/web             | AUTH_PROVIDER và config provider được chọn                   | PR auth thực                                     | Pool/client/domain hoặc secret ref JWT | Chưa                       | A/B            |
| Dispatcher/consumer/worker   | Điền theo schema PR, không tự đoán tên env                   | PR thực                                          | Queue URL cho SDK, ARN cho IAM/mapping | Chưa                       | A/B/C          |
| Deadline/sender service auth | Theo contract PR; AI result hiện dùng INTERNAL_SERVICE_TOKEN | PR thực                                          | Secret ref, không ghi token            | Chưa                       | B/C            |

Đối chiếu bảng đầy đủ §2 của 09; kiểm tra SET không thay thế kiểm tra đúng resource/hành vi. Chỉ giữ một khai báo cho mỗi biến. Không đưa cặp key tạm thiếu session token vào nhánh credentials thủ công của S3 adapter baseline.

| Resource tạm do người học tạo | Region/owner | Đã kiểm tra tác động/pending | Thao tác dọn hoặc bàn giao | Bằng chứng không còn/owner giữ |
| ----------------------------- | ------------ | ---------------------------- | -------------------------- | ------------------------------ |
| Điền resource thực            | Điền         | Điền                         | Điền                       | Chưa                           |

Khảo sát 08 đã tạo/xóa riêng topic `camerai-s4-temp-console-20261104`, xác nhận deleted successfully và Topics (0); đây là lịch sử khảo sát, không phải yêu cầu người học tạo lại hoặc quyền xóa resource khác. Không có resource tạm chờ dọn từ khảo sát đó.
