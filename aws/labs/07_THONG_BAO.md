# Lab 07 — Sender dry-run, email SNS, rồi SMS/cuộc gọi có kiểm soát

## Mục tiêu và điều kiện

Qua lab 02; phần tích hợp cần lab 04. Học khác biệt giữa **intent** (quyết định cần gửi), **submission** (provider nhận request) và **delivery/answered** (người nhận đã nhận/nghe). SMS/call thực có chi phí và điều kiện tài khoản/quốc gia; kiểm tra sớm, không đợi ngày demo.

## A. Sender chưa gửi gì ra ngoài

1. Tạo `camerai-lab-sender` Python 3.12 và notification SQS/DLQ riêng theo lab 02. Gắn mapping batch 1, execution role có Logs và quyền consume queue đó.
2. Deploy handler học tập sau. Nó chỉ log ID và trả kết quả cho invoker; **không** ghi Results Queue hay claim API, nên chưa phải sender CameraAI hoàn chỉnh:

   ```python
   import json

   def lambda_handler(event, context):
       outcomes = []
       for record in event.get("Records", []):
           job = json.loads(record["body"])
           outcome = {
               "notificationId": job["notificationId"],
               "eventId": job["eventId"],
               "mode": "dry-run",
               "providerCalled": False
           }
           print(json.dumps(outcome))
           outcomes.append(outcome)
       return {"outcomes": outcomes}
   ```

3. Gửi `{"notificationId":"lab-notify-01","eventId":"lab-event-01"}`. Log phải có `providerCalled=false`. Gửi trùng để thấy handler hiện chạy lại; đây là lý do cần ledger ở phần D.

## B. SNS email trước khi SMS

1. Console SNS → tạo **Standard topic** `camerai-lab-incident-email`.
2. Create subscription protocol Email, địa chỉ của chính thành viên học lab. Người nhận tự bấm Confirm subscription; topic không gửi tới subscription còn PendingConfirmation.
3. Publish một message test không chứa thông tin cá nhân, subject `CameraAI lab`. Kiểm tra email, rồi ghi MessageId và thời điểm. Đây là thử gửi thủ công, chưa chứng minh sender Lambda hoạt động.
4. Cấp `sns:Publish` cho role sender trên đúng topic ARN; B/C thêm adapter và result publish/claim ở phần D trước khi nối với incident thật.

## C. SMS và Connect — bài mở rộng khi tài khoản đủ điều kiện

**SMS:** Console SNS/SMS hoặc AWS End User Messaging theo giao diện tài khoản. Kiểm tra SMS sandbox, số thử được phép, destination country, origination identity và spend/quota. Gửi **một** SMS tới số người học đồng ý sau khi kiểm tra giá; lưu MessageId/outcome. Không giả định có SMS miễn phí hoặc email subscription confirmation tương đương SMS setup.

**Connect:** tạo/configure instance trong Region hỗ trợ, outbound calling và source phone number/queue, contact flow phát nội dung lab. Kiểm tra destination permission/quota và phí giữ số. Thử flow với một số đồng ý; sau đó Sender dùng `StartOutboundVoiceContact` cùng stable ClientToken để retry cùng hành động không tạo call mới tùy cơ chế API. Lưu ContactId. Không dùng danh bạ thật để thử hàng loạt.

Nếu tài khoản bị chặn, ghi `BLOCKED_ACCOUNT` cho real channel và tiếp tục dry-run/queue/ledger. Không gọi thật vẫn học được phần lớn kiến trúc, nhưng không được ghi SMS/Connect real AC pass. DTMF/answered callback và gọi nhiều liên hệ là bài riêng nếu cần.

## D. Tích hợp vào CameraAI

1. NestJS commit notification intent và outbox cùng trạng thái incident; dispatcher publish SQS.
2. Sender claim intent qua HTTPS service API. API check notification ID, incident state, recipient allowlist, lease, cooldown và daily cap trong transaction. Không dùng dry-run handler A cho production.
3. Nếu được phép, adapter SNS/Connect gửi. Nếu intent cũ/trùng/bị hủy thì no-op có kết quả rõ.
4. Sender publish outcome/provider ID vào Application Results Queue. NestJS commit receipt rồi delete result. Publish result thất bại không được coi input job đã hoàn tất.
5. Lỗi retryable backoff hữu hạn; lỗi terminal tới DLQ. Timeout sau submit là trạng thái không chắc chắn, không retry mù SMS; ledger không xóa hết crash window của external side effect.

## Kiểm tra qua bài

| Test                          | Cần thấy                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| Dry-run                       | Không có SMS/call thật, log ID đầy đủ                             |
| Email đã confirm              | Nhận một mail test                                                |
| Duplicate notification        | Một quyết định nghiệp vụ, không gửi vô hạn                        |
| Incident resolved/stale       | Claim từ chối theo policy                                         |
| Provider timeout              | Có trạng thái lỗi/uncertain và retry policy                       |
| Real SMS/Connect nếu được cấp | Provider ID và evidence riêng; không suy ra đã đọc/nghe chỉ từ ID |

## Dọn dẹp và lỗi

Subscription Pending → người nhận chưa confirm. Publish AccessDenied → sai role/topic ARN. Lambda timeout khi gọi local API → endpoint không reachable hoặc auth/network chưa đúng, không bỏ claim để chữa.

Disable mapping lab, xóa topic/subscription, queues và function lab không dùng tiếp. Với Connect, kiểm kê source phone number và instance để tránh phí tiếp tục; không tự release số chung hoặc xóa contact flow cần demo. **Bài tiếp: [08 — EC2/edge](08_EC2_EDGE.md).**

Nguồn: [SNS email subscription](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html), [Connect outbound call API](https://docs.aws.amazon.com/connect/latest/APIReference/API_StartOutboundVoiceContact.html).
