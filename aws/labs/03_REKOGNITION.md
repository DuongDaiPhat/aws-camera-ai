# Lab 03 — Nhận diện một khuôn mặt, sau đó đưa vào Lambda

## Mục tiêu và điều kiện

Qua lab 01/02; hiểu input crop, collection và kết quả search. Dùng ảnh người tham gia đã đồng ý, không commit ảnh thật. Lab này độc lập model YOLO/fall đang phát triển.

## A. Thử Rekognition trực tiếp bằng CLI

1. Trong bucket lab Singapore, upload `lab/known.jpg` (một mặt rõ để đăng ký), `lab/query.jpg` (ảnh khác cùng người), `lab/unknown.jpg` (người khác), `lab/no-face.jpg` (không có mặt). Ghi loại ảnh trong báo cáo, không xuất bản ảnh.
2. Trong PowerShell nhập bucket và tạo collection lab riêng:

   ```powershell
   $labBucket = Read-Host 'Ten bucket lab chua anh'
   $labCollection = 'camerai-lab-faces'
   aws rekognition create-collection --collection-id $labCollection --profile camerai-lab --region ap-southeast-1
   ```

   Nếu collection đã tồn tại từ lần học trước, kiểm tra owner và `list-faces` trước; không xóa collection chung để tạo lại.

3. Tạo request JSON không có credentials, tránh lỗi escape JSON trên PowerShell:

   ```powershell
   New-Item -ItemType Directory -Path artifacts/aws-labs/03 -Force | Out-Null
   $labUtf8 = [System.Text.UTF8Encoding]::new($false)
   $labIndex = @{CollectionId=$labCollection; Image=@{S3Object=@{Bucket=$labBucket; Name='lab/known.jpg'}}; ExternalImageId='lab-person-01'; MaxFaces=1; QualityFilter='AUTO'}
   [System.IO.File]::WriteAllText((Join-Path $PWD.Path 'artifacts/aws-labs/03/index.json'), ($labIndex | ConvertTo-Json -Depth 6), $labUtf8)
   aws rekognition index-faces --cli-input-json file://artifacts/aws-labs/03/index.json --profile camerai-lab --region ap-southeast-1
   ```

   Lưu FaceId trong ghi chép bảo vệ riêng. Chỉ index một lần cho lượt học; chạy lặp có thể làm collection khó kiểm tra.

4. Search ảnh query:

   ```powershell
   $labSearch = @{CollectionId=$labCollection; Image=@{S3Object=@{Bucket=$labBucket; Name='lab/query.jpg'}}; FaceMatchThreshold=90; MaxFaces=1}
   [System.IO.File]::WriteAllText((Join-Path $PWD.Path 'artifacts/aws-labs/03/search.json'), ($labSearch | ConvertTo-Json -Depth 6), $labUtf8)
   aws rekognition search-faces-by-image --cli-input-json file://artifacts/aws-labs/03/search.json --profile camerai-lab --region ap-southeast-1
   ```

   90 là ngưỡng minh họa API, không phải ngưỡng đã đánh giá cho sản phẩm. Thử đổi `Name` thành unknown/no-face trong file request rồi chạy lại. Không có match khác không có mặt: no-face có thể trả exception và phải phân loại.

## B. Nối face job vào Lambda và Results Queue

1. Tạo queue **mới** `camerai-lab-face-jobs`, DLQ riêng và `camerai-lab-results`; dùng cấu hình lab 02. Tạo Lambda `camerai-lab-face`, Python 3.12, timeout 10 giây; chưa gắn mapping vội.
2. Role face Lambda cần: Logs; receive/delete/get attributes trên face-jobs; `s3:GetObject` trên `lab/` của bucket; `rekognition:SearchFacesByImage` trên collection ARN; `sqs:SendMessage` trên results queue. Nếu mã hóa bằng KMS riêng thì cấp quyền key phù hợp. **Deployer CLI** cũng cần quyền đọc S3/search để phần A chạy.
3. Đặt environment variables không chứa secret: `LAB_BUCKET`, `LAB_COLLECTION_ID`, `RESULT_QUEUE_URL` theo tài nguyên thực tế. Dán đoạn code đầy đủ vào `lambda_function.py` rồi Deploy:

   ```python
   import json
   import os
   import boto3

   rek = boto3.client("rekognition")
   sqs = boto3.client("sqs")

   def lambda_handler(event, context):
       for record in event.get("Records", []):
           job = json.loads(record["body"])
           if not job["key"].startswith("lab/"):
               raise ValueError("LAB_PREFIX_REQUIRED")
           response = rek.search_faces_by_image(
               CollectionId=os.environ["LAB_COLLECTION_ID"],
               Image={"S3Object": {"Bucket": os.environ["LAB_BUCKET"], "Name": job["key"]}},
               FaceMatchThreshold=90,
               MaxFaces=1,
           )
           matches = response.get("FaceMatches", [])
           result = {
               "schemaVersion": 1,
               "type": "lab.face.result",
               "eventId": job["eventId"],
               "resultId": job["jobId"],
               "personStatus": "KNOWN" if matches else "UNKNOWN",
               "similarity": matches[0]["Similarity"] if matches else None,
           }
           sqs.send_message(QueueUrl=os.environ["RESULT_QUEUE_URL"], MessageBody=json.dumps(result))
           print(json.dumps({"eventId": job["eventId"], "resultId": job["jobId"], "status": "result-published"}))
       return {"processed": len(event.get("Records", []))}
   ```

   Đây là **handler học tập**, không phải production adapter. No-face/provider lỗi ở handler này cố ý đi retry/DLQ để bạn quan sát; lab 04 mới phân loại UNDETERMINED, owner/collection isolation và partial failures. Không bật nhận event camera thật bằng handler này.

4. Gắn trigger face-jobs, batch 1; đảm bảo echo Lambda không consume queue này. Gửi:

   ```json
   { "jobId": "lab-face-job-01", "eventId": "lab-face-event-01", "key": "lab/query.jpg" }
   ```

5. Trong Console results queue, Poll một lần và mở body để thấy `lab.face.result`. Queue này chưa có consumer project; đọc thủ công ở lab là có chủ đích. Tạo job mới cho unknown/no-face, không tái sử dụng jobId cho một nội dung khác.

## Kết quả và liên hệ project

- Known query có match theo ảnh/ngưỡng; unknown không có match hoặc báo false match cần đánh giá; no-face là lỗi riêng, không tự coi unknown.
- Lambda gửi result; S3 không gửi result. Retry có thể gọi Rekognition và tính phí lại; lab chưa có business dedup.
- Rekognition search dùng mặt lớn nhất trong input, nên chọn crop một người. Collection của sản phẩm phải phân tách đúng owner; không dùng collection lab cho nhiều hộ gia đình.
- Local embedding không nhập thẳng vào collection; cần re-enroll bằng ảnh hợp lệ.

## Lỗi và dọn dẹp

| Lỗi                            | Kiểm tra                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| InvalidS3Object / AccessDenied | Key, cùng Region, quyền caller/worker và KMS nếu có              |
| Không thấy result              | Mapping, environment queue URL, SendMessage permission, logs/DLQ |
| ResourceNotFound               | Tên collection và Region                                         |
| Người quen không match         | Chất lượng/crop/pose; không hạ ngưỡng chỉ để bài hiện KNOWN      |

Giữ resources nếu làm lab 04 ngay. Nếu dọn: disable mapping trước, xóa collection **lab** sau kiểm tra tên (xóa vectors trong collection), ảnh test, queues/function/log group/role riêng không còn dùng. Ảnh và face vectors có vòng đời khác nhau, phải dọn cả hai theo sự đồng ý của người tham gia.

**Qua bài:** giải thích được IndexFaces khác SearchFacesByImage; có result queue thật và một failure/DLQ case. **Bài tiếp: [04 — Nối project và SAM](04_TICH_HOP_NESTJS_SAM.md).**

Nguồn: [Rekognition collections](https://docs.aws.amazon.com/rekognition/latest/dg/collections.html), [SearchFacesByImage](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_SearchFacesByImage.html).
