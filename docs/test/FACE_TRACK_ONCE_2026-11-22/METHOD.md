# Phương pháp và phạm vi bằng chứng

Đợt kiểm thử ngày 22/11/2026 chạy trên nhánh `feat/face-track-once-optimization`, baseline `cc9e5e1`, có các thay đổi chưa commit trong working tree. Múi giờ giao diện là UTC+7; JSON và CloudWatch dùng UTC. Kết luận từng kịch bản nằm trong [REPORT.md](REPORT.md).

## Luồng thực tế

Video local → FFmpeg phát RTSP theo thời gian thực → MediaMTX → Frigate 0.18 → MQTT → Orchestrator → AI Service `/face/assess` → S3/SQS dev → Lambda `camerai-s4-dev-face` → Rekognition → callback HTTPS → PostgreSQL → giao diện web.

Không chèn kết quả nhận diện giả vào event. Instrumentation trong script chỉ quan sát kết quả của các service thật, ghi request ID, và đặt lại bộ nhớ track/cache giữa các video độc lập. Trong cùng video, bộ nhớ được giữ nguyên. Cặp chạy trước/sau xóa người quen giữ cache giữa hai lần phát. Các bài Jest/Python dùng dữ liệu tổng hợp được ghi riêng, không tính là kết quả E2E AWS.

Tài khoản, camera và collection QA được tạo riêng. `fixture.json` công khai chỉ có UUID/slug/collection; mật khẩu ngẫu nhiên và JWT secret nằm trong thư mục `artifacts/` bị Git bỏ qua. Backend QA dùng JWT ở tiến trình riêng trên cổng 3001, web trên cổng 3002; không sửa AUTH_PROVIDER trong `.env`. Không có người nhận email/Telegram trong fixture.

## Cấu hình lượt acceptance

- Video gốc 1920×1080, 30 fps; RTSP replay giữ 1920×1080, 15 fps, CRF 18; Frigate detect 5 fps.
- Mỗi video được chèn 10 giây nền phòng trước và 20 giây nền sau. Nền lấy từ video 5 tại giây 15. Thời gian nền không thuộc thời lượng kịch bản nguồn.
- `max_disappeared=75`, `min_initialized=2`, stationary threshold/interval 50. 75 frame ở 5 fps tương đương 15 giây danh nghĩa; không suy ra thời gian thực chỉ từ con số cấu hình.
- Best-Shot 1200 ms, tối đa 4 mẫu, early dispatch ≥ 0.82, nhịp mẫu tối thiểu 350 ms.
- `FACE_QUALITY_GATE_FAIL_OPEN=false` trong lượt chính; lỗi AI không tự động gửi ảnh lên cloud.
- Cache 300000 ms, SFace cosine ≥ 0.72; Spatial Re-ID gap ≤ 20000 ms, appearance ≥ 0.78, proximity ≥ 0.35.
- Lambda `REKOGNITION_SKIP_DETECT_FACES=true`. Ngưỡng nhận diện Rekognition 0.9; không hạ ngưỡng để đổi một kết quả UNKNOWN thành KNOWN.
- A dùng 5 ảnh `known_face*`; B dùng 4 ảnh `stranger_face*`. Chạy case 8/9 khi B chưa đăng ký; sau đó mới đăng ký B để chạy case 7. Thao tác collection chỉ áp dụng owner QA.

Tệp [manifest.json](data/manifest.json) ghi kích thước, thời lượng, số frame và SHA-256 của 9 ảnh/22 video. Không có file trùng byte. Tên file có chữ `known` không tự chứng minh người trong ảnh đã được nhận diện.

## Các pha kiểm thử

Pha `acceptance` bắt đầu 22:45:58 UTC+7, chạy bộ video đến phần hai người. Sau phát hiện nguy cơ lệch box/ảnh khi người giao nhau, pha `aligned` từ 23:12 chạy lại 4 video tailgating (gồm 2 video bổ sung), 4 video hai người, rồi các control cache/collectionVersion. Kết quả pha trước vẫn được giữ để thấy lỗi và tác dụng bản sửa; không mô tả toàn bộ chúng là chạy trên cùng một build cuối.

Ở bản sửa cuối, bridge bật `FRIGATE_FACE_FRAMES_ENABLED=true` để tái sử dụng envelope JPEG/box có timestamp. Backend giữ tối đa 24 frame cho 24 camera (≤1 MiB/frame), loại frame quá 2 giây hoặc person box lệch thời điểm frame quá 250 ms. Khi có nhiều người, thiếu cặp JPEG/box hợp lệ thì chờ tiếp. Nhánh một người có fallback ảnh hiện tại khi cần. Bộ lọc freshness riêng của Pose consumer tiếp tục áp dụng cho luồng té ngã.

Lượt `TC01-head-down-warmup-supplement` dùng nền trước 30 giây, vì lượt đầu bỏ lỡ person event lúc khởi động luồng/detector. Các control embedding tắt riêng Spatial Re-ID, giữ nguyên SFace ≥0.72, và khôi phục cờ Spatial sau đó. Control không thay thế kết quả video 6 đổi áo.

SDK request ID được ghi từ 22:45:58.901 UTC+7. Control collection rỗng chạy trước thời điểm đó: số Search kiểm chứng bằng CloudWatch, nhưng không có request ID SDK S3/SQS; bảng ghi `?`, không suy ra 0 từ log thiếu.

## Đếm request

Theo xác nhận của người yêu cầu, “0 request S3” chỉ áp dụng **ảnh face-crop của luồng nhận diện**. Snapshot/clip chung của event PERSON_DETECTED không thuộc chỉ tiêu này.

- `jobs`: số dòng `cloud_jobs` gắn event trong khoảng replay. Đây là số job, không mặc định bằng số API call.
- S3: đếm `PutObjectCommand` có key `owners/<QA>/.../events/<event>/face/<job>.jpg`, có request ID/attempts trong `pipeline.jsonl`.
- SQS: đếm `SendMessageCommand` của `face.job` cùng job ID; không tính polling `ReceiveMessage`, kết quả trả về hoặc hàng đợi khác.
- Rekognition: đếm request ID riêng biệt của `SearchFacesByImage` theo job ID trong CloudWatch. Tách biệt `IndexFaces`/`DeleteFaces` dùng quản lý collection. `operation=none reason=empty-collection-v1` chứng minh nhánh Lambda không gọi nhận diện khi collection rỗng.
- `cached_result` và `ai_results` chứng minh kết quả đã về và được áp dụng. `cloud_jobs.status=SENT` là trạng thái vận chuyển, không có nghĩa chưa nhận kết quả.
- Không dùng chỉ số AWS tổng toàn tài khoản để kết luận số call của một video.

## Cách đọc file

| File                                    | Nội dung                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `data/*-acceptance.json`                | Snapshot DB + state/metrics trước/sau từng video của lượt tổng hợp                            |
| `data/*-supplement*.json`               | Lượt bổ sung, nêu điều kiện riêng trong báo cáo                                               |
| `data/TC10-empty-long.json`             | Control collection rỗng ở phiên đầu                                                           |
| `data/acceptance-summary.json`          | Bảng tổng hợp chọn đúng lượt acceptance/control                                               |
| `data/summary.csv`, `data/summary.json` | Toàn bộ lượt, gồm cả chẩn đoán trước bản sửa                                                  |
| `evidence/pipeline.jsonl`               | Quality Gate, dispatch, chuyển state, kết quả, AWS SDK request ID; không lưu vector embedding |
| `evidence/frigate-events.jsonl`         | MQTT gốc của camera QA, có track, stationary, snapshot timestamp                              |
| `evidence/cloudwatch.txt`, `.json`      | Log Lambda thật, thu bằng CLI có phân trang tự động                                           |
| `evidence/backend-acceptance.txt`       | Log backend lượt tổng hợp                                                                     |
| `screenshots/`                          | Ảnh chụp giao diện thật bằng tab IAB riêng                                                    |

Log backend sau sửa nằm trong `evidence/backend-aligned.txt`. `data/crop-index.json` liên kết một số crop đầu vào dispatch trong `evidence/crops/`, giữ nguyên byte và đối chiếu SHA-256 với trace; đây không phải ảnh chụp UI.

Các file hậu tố `native`, `validated`, `final` và file không hậu tố là **lượt chẩn đoán trước lượt acceptance**, không gộp vào tỷ lệ đạt sau sửa. Tên `final` của một lượt chẩn đoán không có nghĩa đó là bản kết luận cuối.

## Hạ tầng callback đã thiết lập

Caddy bind loopback `127.0.0.1:18080`, chỉ reverse proxy `/api/v1/internal/cloud/face-jobs/*` sang backend QA; đường dẫn khác trả 404. Cloudflare Quick Tunnel cung cấp HTTPS cho Lambda. `INTERNAL_API_BASE_URL` dev được cập nhật thành `https://four-wishlist-waves-now.trycloudflare.com/api/v1`, giữ toàn bộ biến khác và dùng RevisionId khi cập nhật. Package Lambda giữ các dependency hiện có và thay handler bằng code trong nhánh. Các thông số không bí mật nằm trong [lambda-config.json](data/lambda-config.json) và [lambda-deploy.json](data/lambda-deploy.json).

URL Quick Tunnel là tạm thời và chỉ hoạt động khi tiến trình tunnel/backend còn chạy. Lần mở lại cần lấy URL mới và cập nhật lại Lambda. Backup cấu hình gốc, package gốc và fixture riêng nằm trong `artifacts/face-track-once-2026-11-22`, không nằm trong gói bằng chứng.

## Giới hạn

Đây là một lượt replay thực tế trên máy dev, không phải thống kê độ chính xác trên tập dữ liệu lớn. Góc camera từ trên xuống, kích thước mặt và thời gian giữ mặt rõ ảnh hưởng trực tiếp khả năng qua gate. Không tự coi một đoạn không có person event là “Quality Gate đã chặn”. Không coi một lần trả `local-session-cache` là đã chứng minh embedding cache: phải kiểm tra thêm `matchMethod=embedding` hay `spatial-appearance`. Các nhánh retry không xuất hiện trong video được ghi là chưa phủ E2E dù unit test đạt.

Tài liệu đối chiếu: [Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [SearchFacesByImage](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_SearchFacesByImage.html), [Frigate stationary objects](https://docs.frigate.video/configuration/stationary_objects/).
