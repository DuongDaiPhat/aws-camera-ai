# Lab 09 — Nhìn thấy lỗi và nhận một alarm thật

## Mục tiêu và điều kiện

Qua lab 02 để có queue/DLQ/Lambda; phần EC2/edge cần lab 08. Học **log kể điều đã xảy ra, metric đo số lượng/tình trạng, alarm đánh giá metric để báo người vận hành**. Không cần model train xong để học giám sát.

## A. Tìm một event trong logs

1. Gửi message mới ở lab 02/03 có event ID riêng, mở CloudWatch Logs đúng Region và log group Lambda.
2. Tìm event ID; đối chiếu messageId/resultId. Đọc log timestamp, status và exception. Không copy log chứa ảnh/token hoặc số điện thoại nguyên vẹn vào báo cáo.
3. Chọn retention dev 7 ngày ở log group lab. Ghi lại: log retention khác lifecycle ảnh S3.
4. Với EC2, cấu hình CloudWatch Agent/log driver để lấy application logs. Không nối EBS → CloudWatch rồi coi đã có logs. RAM/filesystem/container health cần metric được cấu hình, không tự xuất hiện từ native EC2 CPU metrics.

## B. Một email alarm cho DLQ

1. SNS tạo Standard topic **riêng** `camerai-lab-ops-alerts`, Email subscription của nhóm và confirm. Không dùng incident sender để báo lỗi chính sender.
2. CloudWatch → Alarms → Create alarm → chọn metric SQS **ApproximateNumberOfMessagesVisible** của **đúng DLQ lab**.
3. Thử threshold `Greater than 0`, period 1 phút, 1 datapoint to alarm. Chọn missing data phù hợp metric này; với bài DLQ không tự coi thiếu metric là chắc chắn có lỗi. Action khi ALARM → ops topic bước 1. Ghi tên queue/metric/dimensions để tránh chọn nhầm queue chính.
4. Trong SQS, gửi **một message test trực tiếp vào DLQ lab riêng** để kích condition. Đây là test alarm, không chứng minh redrive hoạt động; redrive đã thử ở lab 02.
5. Đợi metric/alarm cập nhật, xem history và email. ALARM không nhất thiết xuất hiện ngay sau SendMessage. Nếu cần thử lại action, cho alarm về OK rồi tái tạo condition; không kỳ vọng cùng một ALARM state gửi email vô hạn.
6. Sau khi ghi bằng chứng, xóa đúng message test lab, chờ trạng thái OK theo dữ liệu/period.

## C. Giám sát CameraAI

1. Thêm native metrics Lambda Errors/Throttles/Duration, SQS oldest age/DLQ depth và Step Functions failed/timed out.
2. NestJS ghi pending-outbox age và notification final failures qua custom metrics/EMF hoặc metric filters đã cấu hình. Logs không tự thành alarms nếu thiếu bước đo/filter.
3. Edge gửi heartbeat mỗi 30 giây và timestamp frame cuối. Dùng checker/probe độc lập để phát hiện cả lúc NestJS/EC2 chết; nếu checker nằm trong app đó thì nó cũng ngừng cùng app.
4. Thử freshness threshold 90 giây; quyết định `treatMissingData` cho heartbeat/probe để thiếu tín hiệu không bị coi bình thường. Heartbeat agent còn sống không chứng minh camera còn frame mới.
5. Tạo dashboard vừa đủ: error, queue age, workflow failures, heartbeat và outbox age; kích thử từng alarm. Không log mọi frame và không dùng eventId riêng lẻ làm metric dimension vì tăng time series/chi phí.

## Giải thích kết quả

| Quan sát                | Có thể kết luận                 | Chưa thể kết luận                             |
| ----------------------- | ------------------------------- | --------------------------------------------- |
| Có Lambda log processed | Handler đã chạy tới bước log    | DB đã commit hoặc người nhận đã đọc           |
| DLQ có message          | Có việc cần điều tra            | Replay ngay sẽ thành công                     |
| Alarm email đã đến      | Kênh báo vận hành hoạt động     | Sự cố tự được khắc phục                       |
| CameraOnline còn 1      | Tín hiệu health đã chọn còn tốt | Model chính xác hoặc stream mọi camera đều ổn |

## Qua bài, lỗi và dọn dẹp

- [ ] Tìm được một event bằng ID, biết log retention.
- [ ] Có ALARM history và email thật, sau đó giải thích cách về OK.
- [ ] Một thành viên khác làm lại test bằng hướng dẫn ghi chép.

Không có email → kiểm tra subscription, SNS permission/action, metric đúng Region/queue và state transition. Metric trống → kiểm tra dịch vụ đã phát metric chưa; với custom metrics kiểm tra namespace/dimensions và code xuất metric.

Xóa alarm/topic/subscription lab không dùng tiếp, chỉnh retention và kiểm kê log groups/custom metrics. Logs/alarms/queries có thể có phí riêng; AWS Budgets không thay alarm vận hành. **Bài tiếp: [10 — Tích hợp AI](10_TICH_HOP_AI_BAN_GIAO.md).**

Nguồn: [CloudWatch Agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html), [CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html).
