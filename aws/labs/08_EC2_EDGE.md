# Lab 08 — Đưa app lên EC2, giữ camera và model ở edge

## Mục tiêu và điều kiện

Sau các lab tích hợp, bạn hiểu app tier khác camera tier và mở được dashboard/API qua HTTPS từ máy thứ hai. Đây là bài nhiều bước, nên chia thành ba phiên: server → HTTPS → edge. Không train model hoặc chuyển toàn bộ Compose dev lên máy nhỏ.

Chuẩn bị: code adapters đã review, Docker production images kiểm chứng được, private credentials theo role, tên miền/subdomain nếu muốn HTTPS công khai và người có quyền quản lý DNS. Nếu chưa có domain thì thử nội bộ qua tunnel/VPN; không tính HTTPS public gate đã đạt.

## A. Dựng server và kiểm tra phạm vi mạng

1. Console VPC: chọn/tạo VPC lab riêng không trùng mạng local/VPN; public subnet thuộc **một AZ**. Có Internet Gateway gắn VPC và route IPv4 `0.0.0.0/0` của subnet tới gateway. Nếu dùng default VPC, ghi chính xác subnet/AZ thay vì cho rằng mọi subnet đều đúng yêu cầu.
2. Tạo EC2 Linux x86, có public IPv4, thử app tier khoảng 4 GiB RAM rồi đo; đây không phải cam kết free-tier. Gắn EBS có dung lượng đủ images/DB và IAM instance role theo task. Không đặt access keys trong image.
3. Security group: HTTPS 443; nếu chọn Caddy HTTP redirect/challenge thì mở thêm 80 theo nhu cầu đó; VPN port theo cấu hình thực tế. Quản trị qua SSM nếu đã cấu hình được, hoặc SSH chỉ từ IP quản trị `/32` với key riêng. Không mở 5432/6379/1883/5000/8000 public.
4. Cài Docker Engine/Compose theo hướng dẫn hệ điều hành, ví dụ [Docker Engine trên Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Kiểm tra `docker version` và `docker compose version`. Chưa đưa `.env` lên Git hoặc dán secret vào user data/log.
5. Tạo Compose cloud ở `infra/deploy/` theo task AWS-08: web/orchestrator production images, postgres/redis private network, DB volume và reverse proxy. Dựng Compose edge riêng cho Frigate/MQTT/MediaMTX/AI. Các file này **cần được viết và review**, không có sẵn chỉ vì lab đề cập đường dẫn.
6. Trước deploy, kiểm tra entrypoint/image paths, quyền ghi volume và migration runner. Chạy migration trên DB dev mới trước; không `db:reset` để chữa lỗi trên dữ liệu cần giữ.

## B. Một domain đi vào hai ứng dụng

1. Trỏ DNS domain/subdomain lab tới IP server. Nếu dùng IP thay đổi khi stop/start, phải cập nhật DNS; Elastic IP giữ lại có thể vẫn tính tiền.
2. Chọn Caddy hoặc NGINX. Ví dụ Caddyfile sau dùng hostname từ environment variable `CAMERAI_DOMAIN`; Compose phải truyền biến đó cho container, gắn Caddyfile và volume certificate, cùng network với services `orchestrator`/`web`:

   ```caddyfile
   {$CAMERAI_DOMAIN} {
       handle /api/* {
           reverse_proxy orchestrator:3001
       }
       handle {
           reverse_proxy web:3000
       }
   }
   ```

   Đường `/api` được giữ nguyên khi forward. Tên service/cổng phải khớp Compose thật. Certificate issuance cần DNS/challenge/connectivity đúng; một Caddyfile chưa chứng minh TLS đã hoạt động.

3. Đặt `WEB_ORIGIN`, API base URL và callback/logout Cognito đúng domain. Next.js có thể nhúng `NEXT_PUBLIC_*` lúc build, nên đổi biến runtime chưa chắc đổi được bundle đã build.
4. Dùng browser máy thứ hai: mở dashboard, login, xem event/media và gọi API qua HTTPS. Quan sát reverse proxy routes; không truy cập backend bằng cổng 3001 từ Internet.

## C. Nối máy camera bằng VPN

1. Chọn software VPN phù hợp mạng nhóm, đăng ký peer và giới hạn access. Đây không mặc định là dịch vụ AWS Site-to-Site VPN. Ghi IP/route/port thực tế và kiểm tra không trùng subnet.
2. Kiểm tra các đường riêng: MQTT edge → NestJS; NestJS → Frigate lấy crop/clip; MediaMTX → API authorization; config/zone sync và AI request/result theo contract đã chốt.
3. Code source runner/FFmpeg hiện có trong backend không tự chạy ở edge chỉ nhờ VPN. Tách edge adapter/runner hoặc định tuyến có chủ đích rồi test upload video/webcam path.
4. Remote WebRTC/WHIP là một gate khác: HTTPS, ICE candidates và có thể TURN. Nếu chưa làm, dùng video fixture hoặc browser trong mạng/VPN có truy cập media; ghi rõ không bảo đảm mọi browser Internet xem live được.
5. Test EC2 restart và edge mất mạng. DB giữ dữ liệu nhờ volume; mất edge phải có heartbeat alarm, không giả tạo event AI.

## Cần nhìn thấy gì và lỗi thường gặp

| Gate     | Bằng chứng                                              |
| -------- | ------------------------------------------------------- |
| Server   | Containers healthy, DB/Redis không public               |
| HTTPS    | Browser máy thứ hai có TLS hợp lệ, routing đúng         |
| Auth     | Cognito callback/token/ownership đúng cloud domain      |
| Edge     | Event + crop/clip thực đi qua private connection        |
| Recovery | Restart không mất DB; restore backup sang DB test riêng |

Dashboard load nhưng API lỗi → kiểm tra URL build/CORS/proxy path. Lambda gọi claim/deadline timeout → API/network/auth; không mở DB public để né lỗi. Frigate không thấy event → kiểm tra MQTT host/port/credentials và đúng peer route. Video live lỗi dù API tốt → kiểm tra media path riêng.

## Dọn dẹp

Ghi start/stop hours. Stop EC2 khi không học không xóa EBS và không chặn mọi phí IPv4/storage/snapshot. Trước terminate phải backup dữ liệu cần giữ và kiểm tra DeleteOnTermination; không xóa môi trường demo chung. Kiểm kê DNS, IP và resources khác. **Bài tiếp: [09 — CloudWatch](09_CLOUDWATCH.md).**
