# US-18 — Hướng dẫn chạy và nghiệm thu lửa/khói

Ngày cập nhật: **28/10/2026**. Dùng cho buổi test tay với lead trên máy local đã
được chuẩn bị, sử dụng giao diện hiện có tại **http://localhost:3000**.

Mục tiêu demo: **webcam → Frigate → AI → sự kiện P0 → ảnh khoanh vùng/video →
Telegram → xác nhận đồng bộ trên web**.

Tài liệu này là hướng dẫn thao tác và mẫu ghi kết quả; các ô chưa được đánh dấu
không phải kết quả test đã đạt. Nghiệm thu chức năng local không tự đóng toàn bộ
Definition of Done trong [plan US-18](PLAN_US-18_YOLO_FIRE_SMOKE_E2E.md).

## 1. Chuẩn bị trước buổi demo

- Docker Desktop đang chạy.
- Webcam hoạt động; trình duyệt được cấp quyền camera.
- Một điện thoại/màn hình khác để phát video lửa có sẵn trước webcam.
- Video khói có sẵn nếu nghiệm thu thêm nhãn khói. Không tự tạo lửa/khói thật.
- Telegram mở sẵn chat **CameraAI Test — @camerai_test_bot**, đã liên kết với tài
  khoản **Quản trị CameraAI** nếu demo kênh này.
- Model ONNX và cấu hình đã được chuẩn bị trên máy này; không cần train/export
  lại mỗi lần mở hệ thống.

Mở **hai tab web riêng**:

| Tab   | Mục đích                                           |
| ----- | -------------------------------------------------- |
| Tab A | Camera thử nghiệm, giữ webcam truyền phát liên tục |
| Tab B | Danh sách sự kiện, popup và chi tiết bằng chứng    |

Giữ Tab A mở trong suốt buổi test. Có ảnh xem trước chưa có nghĩa là webcam đã
truyền tới AI. Tải lại hoặc đóng tab phát có thể làm ngắt nguồn hình.

## 2. Khởi động ứng dụng

Mở PowerShell tại thư mục dự án:

```powershell
Set-Location 'D:\studies\Hk1-Nam4\pr1\BTL1\aws-camera-ai'
docker compose -f docker-compose.yml -f infra/dev/compose.us18-webcam.yml --profile cv up -d --build
docker compose -f docker-compose.yml -f infra/dev/compose.us18-webcam.yml --profile cv ps
```

Nếu ứng dụng đã chạy đúng cấu hình này, không cần khởi động lại giữa buổi demo.
Giữ file override `infra/dev/compose.us18-webcam.yml` trong lệnh khởi động: file
này bật nhận diện M3 và nguồn frame, đồng thời mặc định tắt gửi Telegram.

Đăng nhập **http://localhost:3000/login** bằng tài khoản phát triển local:

| Trường   | Giá trị               |
| -------- | --------------------- |
| Email    | `admin@camerai.local` |
| Mật khẩu |                       |

Không chạy `db:reset`, seed lại hoặc xóa volume để chuẩn bị demo; cần giữ nguyên
camera, khu vực, tài khoản và lịch sử đang có.

## 3. Bật webcam thật ở Tab A

1. Vào **Camera → Camera thu nghiem**. Nếu camera đang tắt, bật camera trước.
2. Mở **Cấu hình nguồn phát → Webcam Trình duyệt (WHIP)**.
3. Chọn webcam vật lý, bấm **Bật xem trước Webcam**, cho phép quyền camera.
4. Kiểm tra hình xem trước đúng nguồn cần thử.
5. Bấm **Bắt đầu truyền phát WHIP**.
6. Chờ thông báo **Đang truyền phát trực tiếp lên MediaMTX** và camera online.
7. Có thể mở **Luồng xem trực tiếp & Debug View** để kiểm tra nguồn hình.

Chỉ demo tiếp khi nguồn đã truyền phát. Không cần bật tất cả camera phòng bếp/
phòng khách; camera chưa có người phát webcam có thể offline.

## 4. Kịch bản A — Cảnh bình thường, phát hiện và xem bằng chứng

### A1. Kiểm tra cảnh bình thường

1. Mở **http://localhost:3000 → Sự kiện** ở Tab B; chọn tất cả khu vực nếu đang lọc.
2. Giữ webcam nhìn cảnh bình thường khoảng **15–30 giây**.
3. Ghi nhận có hay không sự kiện **lửa/khói mới**. Sự kiện nhận diện người thuộc
   tính năng khác có thể xuất hiện.

**Mong đợi:** không có sự kiện lửa mới chỉ vì vừa bật webcam. Đây là kiểm tra âm
tính ngắn, không phải số đo tỷ lệ báo nhầm trong nhiều giờ.

### A2. Đưa video lửa vào webcam

1. Phát video lửa có sẵn trên điện thoại/màn hình khác.
2. Đưa video vào vùng nhìn của webcam, để ngọn lửa rõ, tránh chói hoặc quá nhỏ.
3. Giữ khoảng **10 giây**, quan sát Tab B.
4. Ghi lại **camera, ngày giờ phát hiện và mã sự kiện** để đối chiếu các kênh.
   Mã sự kiện nằm trong phần thông tin phân tích của chi tiết.
5. Sau khi có sự kiện, bỏ màn hình lửa ra khỏi webcam.

**Mong đợi:** sự kiện `FIRE_SMOKE_DETECTED`, ưu tiên **P0**, đúng camera và thời
gian. Thẻ có kích thước như các thẻ khác, nền đỏ nhạt, viền đỏ nét đứt chạy vòng.
Popup giữa màn hình xuất hiện nếu đây là đợt nhắc mới còn trong thời hạn.

Không dùng phần trăm tin cậy để kết luận kích thước đám cháy. Ví dụ 61% là độ
tin cậy mô hình, không có nghĩa đám cháy nhỏ hay chiếm 61% căn phòng.

### A3. Kiểm tra chi tiết

Bấm **Xem chi tiết ngay** trong popup hoặc nút trên đúng thẻ vừa tạo.

| Nội dung           | Kết quả cần kiểm tra                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| Ảnh khoanh vùng    | Ảnh có vùng lửa nhìn thấy; khung đỏ bao đúng vùng, có nhãn/độ tin cậy         |
| Dấu hiệu lửa/khói  | Có bằng chứng xác nhận từ 3 khung hình liên tiếp trong tối đa 5 giây          |
| Thông tin sự kiện  | Đúng camera, khu vực nếu đã gán, ngày giờ, P0 và trạng thái                   |
| Video diễn biến    | Phát, tạm dừng và tua được; đoạn ghi có diễn biến lửa                         |
| Tải lại bằng chứng | Nút chỉ có icon; rê chuột thấy chú thích, bấm để tải lại                      |
| Đóng cửa sổ        | Dấu X đóng phần chi tiết khi không còn ở bước bắt buộc xem cảnh báo           |
| Gọi 114            | Nút gọn, icon điện thoại dạng nét, liên kết `tel:114`; không gọi thử khi demo |
| Bố cục             | Nội dung không tràn ngang; khi cần cuộn chỉ có một vùng nội dung cuộn         |

Clip cần thêm thời gian để được ghi và lấy từ Frigate. Nếu chưa sẵn sàng, chờ
thêm vài giây rồi bấm icon tải lại. Đầu clip có thể là cảnh bình thường vì có
phần ghi trước phát hiện; hãy phát/tua tới đoạn lửa thay vì chỉ nhìn frame đầu.

**Phân biệt ba loại hình ảnh:** khung M3 nằm trên ảnh bằng chứng trong chi tiết
và ảnh gửi Telegram. Thumbnail danh sách và MP4 là media gốc; video chưa có khung
YOLO di chuyển theo ngọn lửa. Live Debug View có thể hiển thị box người/khu vực
của luồng khác, không thay cho ảnh bằng chứng lửa.

### A4. Kết thúc lượt xem bằng chứng

Việc xem ảnh/video có thể kéo dài hơn thời hạn phản hồi **30 giây**. Khi đó
chuyển sang **Đang leo thang khẩn cấp** là hành vi mong đợi.

- **Đã xem cảnh báo** chỉ giải phóng phần bắt buộc xem; không xác nhận an toàn.
- Nếu đã leo thang, bấm **Đóng sự kiện khẩn cấp** sau khi kiểm tra xong. Ghi lại
  trạng thái cuối là **Đã đóng sự kiện khẩn cấp** (`CLOSED`).
- Nút X chỉ đóng cửa sổ, không đóng sự kiện.

## 5. Kịch bản B — Xác nhận an toàn trực tiếp trên web

Đây là lượt riêng để không phải xem toàn bộ video trong 30 giây.

1. Giữ webcam truyền phát cảnh bình thường ít nhất **15 giây** sau lượt A.
2. Đưa video lửa rõ vào webcam để tạo sự kiện mới.
3. Tìm đúng thẻ theo thời điểm vừa phát hiện, mở chi tiết.
4. Trong **30 giây**, bấm **Tôi ổn (An toàn)**.
5. Kiểm tra đúng sự kiện chuyển sang **Đã xác nhận an toàn** (`RESOLVED`), số
   sự kiện chờ xử lý được cập nhật, không cần tải lại trang.

Nếu đã quá hạn và chỉ còn nút đóng khẩn cấp, ghi nhận lượt này đã leo thang;
không coi `CLOSED` là đã kiểm chứng nút **Tôi ổn**. Chuẩn bị lượt mới để thử lại.

## 6. Kịch bản C — Bật Telegram và xác nhận đồng bộ về web

### C1. Chuẩn bị phiên gửi

Giữ camera enabled, webcam đang truyền phát, mở sẵn chat **CameraAI Test** và
Tab B. Chỉ bắt đầu khi đã sẵn sàng nhận cảnh báo thật kèm ảnh webcam.

Trên **máy hiện tại**, kiểm tra helper cục bộ:

```powershell
Test-Path artifacts/m3/main-telegram-bounded-session.mjs
```

Nếu trả về `True`, mở terminal riêng tại thư mục dự án và chạy:

```powershell
& 'D:\important\Nodejs\node.exe' artifacts/m3/main-telegram-bounded-session.mjs
```

Helper này nằm trong `artifacts/` bị Git ignore, không tự có khi clone sang máy
khác. Nó dùng cấu hình bot/ngrok đã có trên máy, kiểm tra tài khoản liên kết,
thiết lập webhook vào backend cổng 3001 và khởi động lại riêng backend để bật
phiên gửi có giới hạn. Không đưa video lửa vào trong lúc đang chuẩn bị phiên.

Giới hạn phiên:

- **15 phút**, chỉ camera thử nghiệm và tài khoản nhận đã liên kết.
- **Tối đa 3 lần gửi, gồm cả retry**; không bảo đảm là 3 tin nhận được.
- Chỉ nhận sự kiện mới sau mốc bắt đầu, không phát lại backlog cảnh báo cũ.
- Giữ terminal chạy; chờ có **`"ready":true`** trước khi tạo đầu vào thử.

Nếu helper không có hoặc báo lỗi, phần Telegram chưa sẵn sàng. Giữ dòng lỗi để
xử lý cấu hình; không chỉ đổi `TELEGRAM_ENABLED=true` để bỏ qua giới hạn phiên.
Không chép token bot, secret webhook hoặc nội dung `.env` vào biên bản.

### C2. Nhận ảnh và bấm “Tôi ổn”

1. Sau khi phiên báo ready, giữ webcam nhìn cảnh bình thường ít nhất **15 giây**.
2. Đưa video lửa rõ vào webcam; quan sát tin mới trên Telegram.
3. Đối chiếu **Camera thu nghiem** và **thời gian phát hiện** với sự kiện mới ở
   Tab B. Không bấm nhầm tin lịch sử `US18 TEST bucket11`.
4. Kiểm tra ảnh có **khung đỏ quanh lửa**.
5. Bấm **Tôi ổn** trên Telegram trong **30 giây kể từ lúc phát hiện**; thời hạn
   không bắt đầu lại từ lúc bạn mở tin.
6. Quan sát đúng sự kiện trên Tab B chuyển sang **Đã xác nhận an toàn** mà không
   tải lại trang. Tin Telegram phải hiển thị đã xác nhận.

**Mong đợi:** một sự kiện thống nhất giữa hai kênh. Có ảnh gửi thành công nhưng
bấm nút không cập nhật về web thì chưa đạt kiểm tra callback/webhook.

### C3. Tắt phiên sau demo

Nhấn **Ctrl+C một lần** ở terminal helper, chờ:

```text
Telegram delivery disabled; main application and data retained.
```

Nếu hết thời gian hoặc hết ngân sách gửi, phiên cũng sẽ kết thúc theo giới hạn.
Chờ helper hoàn tất dọn phiên, không đóng cưỡng bức cửa sổ terminal giữa chừng.
Dữ liệu sự kiện và web vẫn được giữ lại.

## 7. Thử lại, chống trùng và thời hạn popup

| Tình huống                                                   | Hành vi mong đợi                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Giữ lửa liên tục sau khi đã có sự kiện                       | Không tạo lặp P0 cho cùng incident đang active                                                        |
| Đã bấm an toàn/đóng nhưng webcam vẫn nhìn lửa                | Không tự xem đây là một đợt cháy mới                                                                  |
| Muốn tạo lượt detector mới                                   | Cần ít nhất 10 giây frame mới liên tục không còn lửa/khói; dùng 15 giây cảnh bình thường khi thao tác |
| Ngắt webcam, chỉ chờ không có frame                          | Không được coi là bằng chứng hết lửa                                                                  |
| Sự kiện mới cùng camera cách nhau không quá 5 phút           | Có thể được nhóm cùng đợt nhắc; popup không bật lặp, vẫn kiểm tra thẻ theo thời gian                  |
| Đã xem popup rồi tải lại/đăng nhập lại trên cùng trình duyệt | Không nhắc lại cùng đợt chỉ vì tải lại hoặc đổi trạng thái leo thang                                  |
| Sự kiện đã quá 3 giờ                                         | Vẫn có trong lịch sử nhưng không tự bật popup khẩn cấp                                                |

Ví dụ: sự kiện 09:00 chỉ đủ điều kiện tự nhắc trước 12:00. Để demo popup của một
đợt riêng trên cùng camera, tạo lượt sau khoảng cách hơn 5 phút từ phát hiện cuối
của đợt trước, đồng thời bảo đảm detector đã quan sát hết lửa. Không xóa lịch sử
hay sửa trạng thái bằng SQL để làm demo trông như đã đạt.

## 8. Kiểm tra khói nếu nằm trong phạm vi nghiệm thu

Sau khi trở về cảnh bình thường ít nhất 15 giây, dùng video khói có sẵn thay cho
video lửa và lặp lại phần xem bằng chứng. Kiểm tra đúng nhãn **Khói**, box khói
màu vàng và sự kiện P0 theo cùng quy tắc temporal.

Nếu chỉ demo lửa, ghi **khói: chưa test tay ở buổi này**. Không dùng kết quả lửa
để đánh dấu đã nghiệm thu nhận diện khói, hoặc suy ra recall/precision từ vài lượt
đưa điện thoại trước webcam.

## 9. Xử lý nhanh khi không thấy kết quả

| Hiện tượng                                | Kiểm tra trước                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Thấy preview nhưng không có cảnh báo      | Đã bấm bắt đầu WHIP chưa; camera có online không; Tab A còn mở không                          |
| Không có sự kiện lửa mới                  | Giữ hình lửa rõ, kiểm tra nguồn truyền; nếu vừa test xong, cần 15 giây cảnh thường để re-arm  |
| Có sự kiện nhưng không có popup           | Đã nhắc cùng đợt chưa, có tab khác đã nhận popup không, sự kiện đã quá 3 giờ/đã kết thúc chưa |
| Không thấy thẻ trong danh sách            | Bỏ lọc khu vực/trạng thái, đối chiếu đúng camera và ngày giờ                                  |
| Ảnh/video chưa tải được                   | Bấm icon tải lại; chờ ghi clip; nếu vẫn lỗi, ghi nhận lỗi thay vì đánh dấu đạt                |
| Đầu video không có lửa                    | Phát/tua qua đoạn pre-roll tới thời điểm phát hiện                                            |
| Web có cảnh báo nhưng Telegram im lặng    | Phiên đã ready chưa, đã hết 15 phút/3 lượt chưa, đang xem đúng bot/tin mới chưa               |
| Telegram nhận ảnh nhưng bấm không đồng bộ | Kiểm tra webhook/tunnel và thời hạn 30 giây; đối chiếu đúng sự kiện                           |

Có thể mở terminal chẩn đoán M3 tại thư mục dự án:

```powershell
pnpm fire:health --watch
```

Theo dõi `cam_test`, frame mới, số frame đã xử lý, lỗi và trạng thái model. Hai
camera khác không phát có thể làm health tổng là `DEGRADED`; cần xem riêng
camera đang nghiệm thu. Không nới ngưỡng temporal/freshness để ép lượt test đạt.

## 10. Lưu bằng chứng cho lead

Lưu ảnh/quay màn hình tại một thư mục riêng, ví dụ
`artifacts/m3/manual-acceptance-20261028/`:

- Webcam online và trạng thái đang truyền phát WHIP.
- Sự kiện mới có camera, thời gian, mức P0 và viền nét đứt.
- Ảnh chi tiết có box đúng vùng lửa/khói và bằng chứng 3 frame.
- Video phát/tua được, có đoạn diễn biến cần kiểm tra.
- Trạng thái sau thao tác web hoặc Telegram.
- Nếu test Telegram: ảnh tin mới có box và đoạn quay thao tác **Tôi ổn → web
  chuyển an toàn**, cùng camera/thời gian/mã sự kiện.

Ảnh webcam và đầu ra local không cần đưa vào Git. Khi bàn giao cho lead, cung
cấp riêng thư mục bằng chứng hoặc đường dẫn lưu trữ được nhóm thống nhất.

### Biên bản test tay

Người test: __________ · Lead/reviewer: __________  
Ngày giờ: __________ · Branch/commit hoặc bản chạy: __________  
Camera: __________ · Video nguồn: __________  
Mã sự kiện A/B/C: __________ · Thời điểm phát hiện: __________

| Mục kiểm tra                                          | Kết quả: Đạt / Lỗi / Chưa test | Bằng chứng / ghi chú |
| ----------------------------------------------------- | ------------------------------ | -------------------- |
| Webcam truyền tới hệ thống, không chỉ preview         |                                |                      |
| Cảnh thường không tạo cảnh báo lửa trong lượt thử     |                                |                      |
| Lửa tạo đúng sự kiện P0, camera và thời gian          |                                |                      |
| Box và nhãn đúng vùng lửa                             |                                |                      |
| Bằng chứng 3 frame liên tiếp                          |                                |                      |
| Clip có diễn biến, phát và tua được                   |                                |                      |
| Nút tải lại, X, bố cục và 114                         |                                |                      |
| Web “Tôi ổn” chuyển RESOLVED                          |                                |                      |
| Hết hạn phản hồi chuyển ESCALATED; đóng chuyển CLOSED |                                |                      |
| Chống trùng incident và re-arm sau observed clear     |                                |                      |
| Popup không lặp cùng đợt; sự kiện cũ không tự nhắc    |                                |                      |
| Telegram có ảnh khoanh vùng                           |                                |                      |
| Telegram “Tôi ổn” cập nhật đúng sự kiện trên web      |                                |                      |
| Khói, nếu thuộc phạm vi buổi nghiệm thu               |                                |                      |
| Phiên Telegram đã tắt sau demo                        |                                |                      |

Lỗi còn lại: __________  
Kết luận nghiệm thu chức năng local: __________  
Người xác nhận và ngày giờ: __________

## 11. Điều kiện để chốt US-18

Buổi demo trên xác nhận hành vi sử dụng và E2E local. Các trường hợp một frame,
frame lỗi/gap/duplicate, no-person, restart, persistence và retry cần đối chiếu
thêm kết quả kiểm thử kỹ thuật; không thể suy ra đã đạt chỉ từ một lượt webcam.

- [ ] Lead đã xem và xác nhận kết quả test tay, có bằng chứng đúng sự kiện.
- [ ] Đối chiếu đủ AC/DoD trong [plan](PLAN_US-18_YOLO_FIRE_SMOKE_E2E.md), đánh dấu
      từng mục theo bằng chứng thực tế.
- [ ] Có kết quả kiểm thử tự động/hồi quy và CI cho đúng bản bàn giao.
- [ ] Có review độc lập, xử lý các nhận xét và hoàn tất quy trình merge của nhóm.
- [ ] Lead chốt phạm vi chất lượng model và các giới hạn đã ghi nhận.
- [ ] Chốt riêng các hạng mục còn mở: CPU/RAM soak đang được hoãn, tải kết hợp
      M1/M2 và điều kiện release. Nếu chưa làm, ghi là hoãn/chưa đạt, không tự
      đánh dấu hoàn tất toàn bộ DoD.

Trạng thái phù hợp sau một buổi demo đạt nhưng còn gate release là:
**“Đạt nghiệm thu chức năng/E2E local; các gate còn lại được liệt kê riêng.”**

Tài liệu đối chiếu:

- [Trạng thái model và các gate còn mở](US-18_YOLO26_EXPORT_STATUS.md).
- [Bằng chứng webcam và xác nhận cùng sự kiện](US-18_YOLO26_EXPORT_STATUS.md#main-webcam-and-telegram-acceptance).
- [Hành vi UI, media, popup và Telegram hiện tại](US-18_YOLO26_EXPORT_STATUS.md#fire-alert-ux-and-evidence).
- [Runtime, chẩn đoán và recovery](US-18_RUNTIME_RUNBOOK.md).
