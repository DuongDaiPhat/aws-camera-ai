# Lab 04 — Từ thử tay sang SAM và tích hợp NestJS

## Mục tiêu và điều kiện

Qua lab 01/02; lab 03 cần cho nghiệm thu face thật. Bạn học **IaC**: khai báo tài nguyên trong file để tạo lại được, sau đó chốt hợp đồng đưa job/result vào NestJS. Không bê handler lab đơn giản vào production rồi coi đã hoàn tất.

## A. Tạo lại pipeline nhỏ bằng SAM

1. Cài SAM CLI theo [hướng dẫn chính thức](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), chạy `sam --version`. SAM không thay AWS credentials; kiểm tra lại STS bằng profile lab.
2. Tạo thư mục `artifacts/aws-labs/04` và file `template.yaml` bên trong. Dán template học tập hoàn chỉnh sau:

   ```yaml
   AWSTemplateFormatVersion: '2010-09-09'
   Transform: AWS::Serverless-2016-10-31
   Description: CameraAI learning pipeline, not production
   Resources:
     JobsDLQ:
       Type: AWS::SQS::Queue
       Properties:
         MessageRetentionPeriod: 345600
     Jobs:
       Type: AWS::SQS::Queue
       Properties:
         VisibilityTimeout: 60
         MessageRetentionPeriod: 86400
         RedrivePolicy:
           deadLetterTargetArn: !GetAtt JobsDLQ.Arn
           maxReceiveCount: 5
     ResultsDLQ:
       Type: AWS::SQS::Queue
       Properties:
         MessageRetentionPeriod: 345600
     Results:
       Type: AWS::SQS::Queue
       Properties:
         VisibilityTimeout: 60
         RedrivePolicy:
           deadLetterTargetArn: !GetAtt ResultsDLQ.Arn
           maxReceiveCount: 5
     Worker:
       Type: AWS::Serverless::Function
       Properties:
         Runtime: python3.12
         Handler: index.lambda_handler
         Timeout: 10
         MemorySize: 128
         Environment:
           Variables:
             RESULT_QUEUE_URL: !Ref Results
         Policies:
           - SQSPollerPolicy:
               QueueName: !GetAtt Jobs.QueueName
           - SQSSendMessagePolicy:
               QueueName: !GetAtt Results.QueueName
         InlineCode: |
           import json
           import os
           import boto3
           sqs = boto3.client("sqs")
           def lambda_handler(event, context):
               failures = []
               for record in event.get("Records", []):
                   try:
                       body = json.loads(record["body"])
                       if body.get("forceError"):
                           raise ValueError("CONTROLLED_LAB_ERROR")
                       result = {"type": "lab.received", "mode": "fixture", "resultId": body["jobId"], "eventId": body["eventId"]}
                       sqs.send_message(QueueUrl=os.environ["RESULT_QUEUE_URL"], MessageBody=json.dumps(result))
                       print(json.dumps(result))
                   except Exception:
                       print(json.dumps({"messageId": record["messageId"], "status": "record-failed"}))
                       failures.append({"itemIdentifier": record["messageId"]})
               return {"batchItemFailures": failures}
         Events:
           FromQueue:
             Type: SQS
             Properties:
               Queue: !GetAtt Jobs.Arn
               BatchSize: 1
               FunctionResponseTypes:
                 - ReportBatchItemFailures
   Outputs:
     JobsUrl:
       Value: !Ref Jobs
     ResultsUrl:
       Value: !Ref Results
     WorkerName:
       Value: !Ref Worker
   ```

3. Chạy trong đúng thư mục lab. Lần đầu đọc change set, quyền IAM và các câu hỏi Guided; chọn không expose function công khai. Cả nhóm dùng một người deploy cùng stack, không ghi đè stack của người khác.

   ```powershell
   Push-Location artifacts/aws-labs/04
   sam validate --lint --template-file template.yaml --region ap-southeast-1 --profile camerai-lab
   sam build --template-file template.yaml
   sam deploy --guided --stack-name camerai-lab-sam --region ap-southeast-1 --profile camerai-lab --capabilities CAPABILITY_IAM
   Pop-Location
   ```

4. Console CloudFormation → stack `camerai-lab-sam` → Outputs. Mở đúng Jobs queue rồi gửi `{"jobId":"sam-job-01","eventId":"sam-event-01"}`. Results phải có `type=lab.received`, `mode=fixture`; đây chưa phải face inference.
5. Sửa mô tả template, validate/build/deploy lại cùng stack để hiểu update. Không sửa resources stack trong Console rồi quên cập nhật template.

## B. Nối vào project theo cặp B/C

Đây là bài lập trình tích hợp, không có sẵn script hoàn chỉnh trong repo. Tạo PR nhỏ theo thứ tự dưới đây, dùng code hiện tại làm nền:

| Bước                      | Làm ở đâu?                        | Cần làm và kiểm tra                                                                                        |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1. Chốt contract          | `api/*.yaml`, contracts; B review | Job/result v1, stable IDs, owner/camera/observation/revision; fixture hợp lệ/lỗi/trùng                     |
| 2. Chọn adapter transport | NestJS face orchestration         | Local BullMQ hoặc cloud SQS cho cùng job; chưa bật cả hai                                                  |
| 3. Producer               | Storage adapter + DB transaction  | Upload S3 trước publish; lưu job outbox bền vững; dispatcher retry publish                                 |
| 4. Consumer kết quả       | NestJS worker mới                 | Long-poll Results, validate, map vào `SubmitAiResultDto`, commit receipt/result rồi delete                 |
| 5. Hạ tầng dev            | `infra/aws/template.yaml` cần tạo | Từ template lab phát triển stack dev với S3, face handler, IAM đúng quyền, log retention và alarms         |
| 6. Thay echo bằng face    | `services/aws-workers` cần tạo    | Đưa logic lab 03 vào handler có UNDETERMINED/owner isolation/partial failures, không trả kết quả KNOWN giả |

Trước bước 4, đọc `apps/orchestrator/src/face-recognition/face-recognition.worker.ts` và `apps/orchestrator/src/ai-results/`. B chỉ ra cụ thể hàm nào map DTO và service nào commit AI result. Không viết thẳng SQL bỏ qua invariants của service chỉ để nhận được message.

Thử lần lượt:

1. Gửi fixture, thấy outbox → worker → result → receipt. `lab.received` chỉ dùng debug riêng, **không** tự map thành kết quả AI có confidence.
2. Dùng face job thật lab 03 sau khi mapper đúng contract.
3. Gửi cùng resultId 10 lần: một kết quả nghiệp vụ.
4. Gửi revision cũ sau revision mới: không ghi đè.
5. Dừng consumer sau commit trước delete: restart không nhân kết quả.
6. Invalid owner hoặc schema: bị từ chối/quarantine; không bị xóa im lặng.

## Kết quả cần thấy

Nhóm tạo lại được lab stack từ template; biết tìm Outputs/logs; integration PR có các kiểm thử trên. **Qua phần A** không tự chứng minh phần B đã implement. Khai báo `LAB_PASS_A`/`LAB_PASS_B` riêng nếu học nhiều phiên.

## Lỗi, dọn dẹp và bài tiếp

- SAM không thấy credentials: profile đúng chưa; `sam build` không chứng minh account access.
- `InsufficientCapabilities`: đọc IAM change set; SAM template này tạo execution role.
- Queue/worker resource ID khác lần Console: bình thường, stack dùng tài nguyên riêng. Không để cùng consumer đọc hai nguồn cho một incident.
- Python build báo thiếu runtime: cài runtime tương ứng hoặc dùng `sam build --use-container` sau khi Docker hoạt động; không đổi locks AI.

Nếu chưa dùng tiếp, dùng `sam delete --stack-name camerai-lab-sam --region ap-southeast-1 --profile camerai-lab` sau kiểm tra inventory. Kiểm kê thêm log groups và deployment artifacts/bucket có thể còn; không tự xóa bucket SAM dùng chung. Không chạy delete với stack dev/demo cần giữ.

**Bài song song:** [05 — Cognito](05_COGNITO.md). **Bài tiếp cho backend:** [06 — Step Functions](06_STEP_FUNCTIONS.md).
