# Lab 02 — Một message SQS gọi Lambda, rồi chủ động tạo lỗi

## Mục tiêu và điều kiện

Qua lab 00, có quyền IAM/Lambda/SQS/Logs. Học execution role, event source mapping, retry và DLQ bằng một event JSON nhỏ. **Chưa gọi Rekognition, SMS, điện thoại hay API project.**

## A. Tạo Lambda đầu tiên

1. Console → Lambda → Create function → Author from scratch. Tên `camerai-lab-echo`, runtime **Python 3.12**, architecture x86_64. Runtime lab tách khỏi Python/locks AI; không sửa runtime project để chạy bài này.
2. Chọn tạo execution role mới có basic Lambda permissions. Ghi tên role; role này phải có log permissions. Lambda chưa gắn VPC.
3. Trong file `lambda_function.py`, thay code bằng đoạn đầy đủ dưới đây; handler là `lambda_function.lambda_handler`. Chọn **Deploy** sau mỗi lần sửa:

   ```python
   import json

   def lambda_handler(event, context):
       for record in event.get("Records", []):
           body = json.loads(record["body"])
           if body.get("forceError") is True:
               raise ValueError("CONTROLLED_LAB_ERROR")
           print(json.dumps({
               "lab": "02",
               "eventId": body.get("eventId"),
               "messageId": record["messageId"],
               "status": "processed"
           }))
       return {"processed": len(event.get("Records", []))}
   ```

4. Configuration → General configuration: timeout **10 giây**. Test bằng event sau, rồi mở Monitor → CloudWatch logs:

   ```json
   {
     "Records": [
       {
         "messageId": "manual-test-01",
         "body": "{\"eventId\":\"lab-event-01\"}"
       }
     ]
   }
   ```

Test thủ công chỉ chứng minh handler chạy, chưa chứng minh trigger SQS.

## B. Thêm SQS và trigger thật

1. SQS → Create queue, **Standard**, tên `camerai-lab-echo-dlq`, retention 4 ngày cho lab.
2. Tạo Standard queue `camerai-lab-echo-jobs`: visibility **60 giây**, retention 1 ngày; bật redrive DLQ ở bước 1, `maxReceiveCount=5`. Hai queue cùng Region.
3. IAM → role của Lambda: thêm quyền `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` giới hạn vào ARN **echo-jobs**. Người tạo mapping cũng cần quyền thích hợp; đừng nhầm quyền deployer và execution role.
4. Lambda → Add trigger → SQS → chọn **echo-jobs**, batch size **1**, batch window **0** nếu có tùy chọn; enable mapping. Không gắn Lambda vào DLQ và không bật provisioned polling.
5. SQS **echo-jobs** → Send and receive messages → gửi:

   ```json
   { "eventId": "lab-event-02", "forceError": false }
   ```

6. Mở log Lambda: tìm đúng `eventId=lab-event-02` và SQS messageId. Message input phải được xóa sau handler thành công. Log có thể hiển thị trễ vài giây.

## C. Chủ động gây lỗi để hiểu DLQ

1. Gửi một message mới với `forceError=true` và event ID khác.
2. Quan sát lỗi `CONTROLLED_LAB_ERROR`. Message bị ẩn trong visibility timeout rồi được đọc lại. Sau số lần nhận theo redrive policy, nó xuất hiện ở DLQ; có thể cần vài phút.
3. Không liên tục Poll/Receive queue chính để nhìn message vì thao tác đó cũng tăng số lần nhận và ảnh hưởng bài retry. Theo dõi logs/metrics và kiểm tra DLQ sau khi chờ.
4. Chưa redrive message lỗi y nguyên; nếu không sửa nguyên nhân thì nó sẽ lỗi lại. Có thể xóa đúng message thử trong DLQ khi đã ghi bằng chứng, hoặc sửa handler có kiểm soát rồi thử redrive lab.

## Vì sao hoạt động?

AWS quản lý poller đọc queue và gọi Lambda. Handler thành công thì mapping xóa message; handler lỗi thì message có thể được giao lại. Bài dùng batch 1 để dễ hiểu. Khi tích hợp project, phải thêm partial batch failures và idempotency: retry không được tạo incident/call trùng.

## Qua bài, lỗi và dọn dẹp

- [ ] Test thủ công pass và message SQS thật tạo log đúng ID.
- [ ] Lỗi có chủ đích đến DLQ; giải thích được visibility khác delay/retention.
- `AccessDenied`: kiểm tra role Lambda có quyền queue đúng ARN và Logs; trigger không tự khắc phục role sai.
- Không invoke: kiểm tra Region, mapping Enabled/healthy và queue ARN; không dùng DLQ làm input.
- Log lặp: có thể là retry, không kết luận hệ thống chỉ xử lý một lần.

Giữ resources nếu học lab 03, nhưng **tắt mapping echo trước khi đổi queue/handler cho face**; không cho echo và face consume chung job queue. Nếu dọn, xóa mapping/function và hai queue lab đã kiểm tra, rồi dọn log group và role lab không còn dùng. Không xóa role dùng chung.

**Bài tiếp: [03 — Rekognition](03_REKOGNITION.md).** Nguồn: [tutorial AWS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs-example.html), [cấu hình SQS–Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).
