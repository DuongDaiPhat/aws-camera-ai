# Lab 06 — Chờ 10 giây bằng Step Functions, rồi nối deadline thật

## Mục tiêu và điều kiện

Qua lab 02; phần B cần service command của lab 04. Học cách workflow chờ mà không giữ Lambda chạy. Chưa gửi cuộc gọi trong phần A.

## A. Workflow nhỏ nhìn thấy được

1. Tạo Lambda `camerai-lab-deadline`, Python 3.12, basic Logs role, timeout 10 giây; Deploy:

   ```python
   import json

   def lambda_handler(event, context):
       if event.get("forceError"):
           raise ValueError("CONTROLLED_DEADLINE_ERROR")
       result = {
           "mode": "lab-only",
           "eventId": event["eventId"],
           "action": "deadline-observed-no-notification"
       }
       print(json.dumps(result))
       return result
   ```

2. Step Functions → Create state machine, **Standard**, tên `camerai-lab-deadline-flow`. Dùng Code editor với định nghĩa sau. Task gọi function vừa tạo cùng Region; dùng execution role có `lambda:InvokeFunction` đúng ARN. Nếu Console không tự suy ra policy từ tên function, chọn function bằng Workflow Studio hoặc sửa FunctionName thành ARN thực từ Lambda Console rồi cấp role đúng.

   ```json
   {
     "Comment": "Learning wait, not production escalation",
     "StartAt": "WaitForDeadline",
     "States": {
       "WaitForDeadline": {
         "Type": "Wait",
         "SecondsPath": "$.waitSeconds",
         "Next": "CheckDeadline"
       },
       "CheckDeadline": {
         "Type": "Task",
         "Resource": "arn:aws:states:::lambda:invoke",
         "Parameters": {
           "FunctionName": "camerai-lab-deadline",
           "Payload.$": "$"
         },
         "OutputPath": "$.Payload",
         "Retry": [
           {
             "ErrorEquals": ["States.TaskFailed", "States.Timeout"],
             "IntervalSeconds": 2,
             "MaxAttempts": 2,
             "BackoffRate": 2
           }
         ],
         "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "DeadlineFailed" }],
         "Next": "Done"
       },
       "Done": { "Type": "Succeed" },
       "DeadlineFailed": { "Type": "Fail", "Error": "LabDeadlineFailed" }
     }
   }
   ```

3. Start execution với input `{"eventId":"lab-deadline-01","waitSeconds":10,"forceError":false}`. Nhìn graph: đứng ở Wait rồi tới Lambda và Succeeded.
4. Chạy execution mới với `forceError=true`: quan sát retry rồi Failed. Tên execution khác cho mỗi thí nghiệm, không cố tái sử dụng tên execution hoàn tất.
5. Đối chiếu Lambda duration/log: không có hàm nào đang sleep 10 giây; việc chờ thuộc workflow. Độ trễ thực tế còn overhead, không hứa gọi chính xác tới từng mili giây.

## B. Thay thử nghiệm bằng incident deadline

1. B giữ logic state machine trong NestJS/PostgreSQL. Tạo command deadline có service authentication, stable commandId, eventId và deadlineVersion; kiểm thử idempotency trước khi mở cloud access.
2. Khi NOTIFIED, transaction ghi deadline và workflow-start outbox. Dispatcher start Standard execution có stable name/ARN mapping. Dùng **Wait tới timestamp**, không luôn chờ thêm N giây từ lúc workflow nhận job.
3. Deadline Lambda gọi API qua HTTPS proxy. API lock/check state/version: resolved/stale thì no-op; còn due thì commit ESCALATED + notification intent. Lambda không tự quyết định từ event cũ và không truy cập DB trực tiếp.
4. API ở laptop phải truy cập được bằng endpoint dev HTTPS đã bảo vệ hoặc dev deploy; Lambda không gọi được localhost của máy bạn. Chưa có endpoint thì giữ lab A, ghi phần B chưa xong; không mở PostgreSQL public.
5. Test acknowledgement và deadline cạnh tranh, workflow lỗi/restart, duplicate command. Tắt deadline owner cũ hoặc chỉ dùng làm reconciler qua cùng operation để không tạo hai call intents.

## Kết quả và lỗi thường gặp

- **Lab A pass:** Wait và controlled failure quan sát được, giải thích Standard khác một hàm sleep.
- **Lab B pass:** resolved event không sinh intent mới; stale version no-op; API down tạo lỗi/retry và runbook reconcile, không báo thành công giả.
- `AccessDenied` invoke: kiểm tra **role Step Functions**, không chỉ role Lambda.
- Wait lỗi input: `waitSeconds` phải là số hợp lệ; production chuyển timestamp đúng định dạng.
- Graph xanh không chứng minh incident thật đúng: function lab chỉ echo command, không đọc DB.

## Dọn dẹp

Stop execution lab còn chạy trước, rồi xóa state machine/function/log groups/role riêng nếu không cần giữ. Chỉ stop/delete resources đã nhận diện đúng. Production pending deadline phải được inventory/reconcile, không xóa workflow để làm dashboard hết lỗi.

**Bài tiếp: [07 — Thông báo](07_THONG_BAO.md).** Nguồn: [Wait state](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html), [Standard workflow](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html).
