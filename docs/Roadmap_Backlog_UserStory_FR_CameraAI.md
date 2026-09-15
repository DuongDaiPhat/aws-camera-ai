# PRODUCT ROADMAP · PRODUCT BACKLOG · USER STORY · FUNCTIONAL REQUIREMENTS
## Hệ thống Camera giám sát hành vi ứng dụng AI và AWS

**Phiên bản:** 1.0 · **Khung thời gian:** 30 ngày · **Nhóm:** 5 sinh viên

---

# PHẦN I — PRODUCT ROADMAP

## 1. Personas

Roadmap và backlog dưới đây được ưu tiên theo giá trị mang lại cho 4 nhóm người dùng sau.

| Ký hiệu | Persona | Mô tả | Nhu cầu cốt lõi |
|---|---|---|---|
| **P1** | **Người giám sát** (Caregiver) — chị Lan, 35 tuổi, đi làm cả ngày | Có mẹ già và con nhỏ ở nhà một mình | Biết ngay khi có chuyện, không phải ngồi xem camera |
| **P2** | **Người được giám sát** (Resident) — bà Hoa, 72 tuổi | Ở nhà ban ngày, không rành công nghệ | Không bị làm phiền vô cớ; được giúp nhanh khi thật sự cần |
| **P3** | **Quản trị viên** (Owner/Admin) — anh Nam, chủ nhà | Người cài đặt hệ thống | Cấu hình camera, vùng cấm, ngưỡng cảnh báo dễ dàng |
| **P4** | **Liên hệ khẩn cấp** (Emergency contact) — hàng xóm, người thân xa | Chỉ được gọi khi P1 không phản hồi | Nhận cuộc gọi rõ ràng, biết chuyện gì xảy ra ở đâu |

## 2. Product Goal

> Trong 30 ngày, xây dựng một hệ thống giám sát an toàn tại nhà tự động phát hiện tình huống nguy hiểm bằng AI và leo thang cảnh báo theo nhiều cấp, giảm thời gian từ lúc sự cố xảy ra đến lúc có người can thiệp xuống dưới 3 phút.

## 3. Roadmap theo Release

Roadmap chia thành 4 release nội bộ, mỗi release trùng một sprint và **đều phải demo được** (không có release nào là "làm nền, chưa thấy gì").

### ┃ Release 0.1 — "SKELETON" · Sprint 1 (Ngày 4–10)
**Chủ đề: Nhìn thấy & ghi lại**

| | |
|---|---|
| **Giá trị giao** | Hệ thống thấy được người trong khung hình và lưu lại sự kiện; P3 mở dashboard xem được lịch sử |
| **Epic liên quan** | EPIC-1, EPIC-2, EPIC-7 |
| **Năng lực mở khoá** | Toàn bộ đường ống dữ liệu camera → AI → DB → UI đã thông. Mọi module AI sau chỉ cắm thêm vào. |
| **Chưa có** | Chưa phân biệt người quen/lạ, chưa có cảnh báo |
| **Tiêu chí release** | Đi qua camera → sự kiện xuất hiện trên dashboard kèm ảnh trong < 5 giây |

### ┃ Release 0.2 — "GUARDIAN" · Sprint 2 (Ngày 11–17)
**Chủ đề: Biết ai, ở đâu, và leo thang**

| | |
|---|---|
| **Giá trị giao** | P1 nhận được cảnh báo thật khi người lạ vào nhà hoặc trẻ vào vùng cấm, và bấm xác nhận được |
| **Epic liên quan** | EPIC-3, EPIC-4 (M1, M4), EPIC-5, EPIC-6 |
| **Năng lực mở khoá** | Escalation state machine dùng chung cho mọi module sau. Module 3 và 2a chỉ việc phát sinh sự kiện, không phải tự viết lại logic cảnh báo. |
| **Chưa có** | Chưa phát hiện ngã/cháy; gọi điện còn giả lập |
| **Tiêu chí release** | Người lạ vào bếp → Telegram báo → không phản hồi 2 phút → trạng thái ESCALATED |

### ┃ Release 0.3 — "SENTINEL" · Sprint 3 (Ngày 18–24)
**Chủ đề: Phát hiện nguy hiểm thật sự**

| | |
|---|---|
| **Giá trị giao** | P2 được bảo vệ khỏi hai rủi ro nghiêm trọng nhất: té ngã và cháy/khói |
| **Epic liên quan** | EPIC-4 (M2a, M3), EPIC-8, EPIC-7, EPIC-10 |
| **Năng lực mở khoá** | Có số đo precision/recall/FAR — cơ sở để tinh chỉnh ngưỡng ở Sprint 4 |
| **Chưa có** | Vẫn chạy local, chưa lên AWS |
| **Tiêu chí release** | Video té ngã và video cháy đều sinh cảnh báo đúng mức ưu tiên; bảng đo được điền đầy đủ |

### ┃ Release 1.0 — "CLOUD" · Sprint 4 (Ngày 25–30)
**Chủ đề: Lên mây, hoàn thiện, bàn giao**

| | |
|---|---|
| **Giá trị giao** | Hệ thống chạy trên hạ tầng AWS thật, gọi điện tự động thật, tài liệu đầy đủ |
| **Epic liên quan** | EPIC-9, EPIC-6, EPIC-10 |
| **Năng lực mở khoá** | Có thể triển khai cho hộ gia đình khác mà không cần máy dev của nhóm |
| **Tiêu chí release** | ≥ 4 dịch vụ AWS thật đang chạy; 3 kịch bản E2E pass; video demo hoàn tất |

### ┃ Release 1.x+ — "LATER" (Ngoài phạm vi 30 ngày)
Ghi vào mục *Hướng phát triển* của báo cáo:

| Hạng mục | Lý do hoãn | Ước tính |
|---|---|---|
| Module 2c — nhận diện đánh nhau (RWF-2000) | Cần train action recognition, riêng việc này ≥ 2 tuần/người | 15–20 SP |
| Module 2b — đứng/ngồi bất thường 24/24 | Giá trị thấp hơn M2a/M3, để COULD | 5 SP |
| Amazon Kinesis Video Streams | Chi phí cao; Frigate đã xử lý ở edge | 8 SP |
| Rekognition Custom Labels cho cháy/khói | Cần gán nhãn dataset riêng, tốn credit | 10 SP |
| Mobile app native (React Native/Flutter) | Responsive web đủ cho demo | 20 SP |
| Gemini API sinh caption tường thuật sự kiện | Bổ trợ, không ảnh hưởng quyết định | 3 SP |
| Multi-tenant (nhiều hộ gia đình) | Ngoài phạm vi đồ án môn học | 15 SP |

## 4. Roadmap dạng Now / Next / Later

```
┌─────────────────┬──────────────────┬──────────────────┬─────────────────┐
│   NOW (S1)      │   NEXT (S2-S3)   │   NEXT (S4)      │     LATER       │
├─────────────────┼──────────────────┼──────────────────┼─────────────────┤
│ Thu video RTSP  │ Nhận diện        │ Migrate S3       │ Module 2c       │
│ Frigate detect  │  người lạ (M1)   │ Rekognition      │  đánh nhau      │
│ MQTT → DB       │ Vùng cấm (M4)    │ Cognito          │ Kinesis Video   │
│ Lưu media       │ Escalation       │ SNS + Connect    │ SageMaker       │
│ Auth cơ bản     │ Telegram + xác   │ CloudWatch       │ Mobile app      │
│ Dashboard list  │  nhận            │ Hardening + tune │ Multi-tenant    │
│                 │ Té ngã (M2a)     │ Tài liệu, demo   │ Caption Gemini  │
│                 │ Cháy/khói (M3)   │                  │ Module 2b       │
│                 │ Wellness (M5)    │                  │                 │
│                 │ Timeline + clip  │                  │                 │
│                 │ Đo P/R/FAR       │                  │                 │
└─────────────────┴──────────────────┴──────────────────┴─────────────────┘
```

---

# PHẦN II — PRODUCT BACKLOG

## 5. Danh sách Epic

| Epic ID | Tên Epic | Mô tả | Persona | SP | Release |
|---|---|---|---|---|---|
| **EPIC-1** | Hạ tầng & thu nhận video | Giả lập RTSP, Frigate, MQTT, Docker, CI | P3 | 11 | 0.1 |
| **EPIC-2** | Xác thực & quản lý người dùng | Đăng nhập, phân quyền, Cognito | P1, P3 | 6 | 0.1 → 1.0 |
| **EPIC-3** | Quản lý camera & vùng giám sát | Thêm camera, vẽ zone, gán loại module | P3 | 3 | 0.2 |
| **EPIC-4** | Module AI nhận diện | M1 người lạ, M2a té ngã, M3 cháy/khói, M4 vùng cấm | P1, P2 | 25 | 0.2 → 0.3 |
| **EPIC-5** | Engine sự kiện & leo thang | State machine, ngưỡng confidence, timeout theo loại | P1, P4 | 10 | 0.2 |
| **EPIC-6** | Kênh thông báo & xác nhận | Telegram → SNS → Connect; nút "Tôi ổn / Cần giúp" | P1, P4 | 8 | 0.2 → 1.0 |
| **EPIC-7** | Dashboard giám sát & lịch sử | Danh sách, timeline, lọc, xem clip | P1, P3 | 8 | 0.1 → 0.3 |
| **EPIC-8** | Wellness check | Kiểm tra hiện diện/vắng mặt theo lịch | P2 | 3 | 0.3 |
| **EPIC-9** | Triển khai cloud AWS | S3, Rekognition, Cognito, SNS, Connect, CloudWatch | P3 | 15 | 1.0 |
| **EPIC-10** | Chất lượng & đo lường AI | Bộ test có nhãn, precision/recall/FAR, hardening | Nhóm | 9 | 0.3 → 1.0 |

**Tổng SP trong phạm vi 30 ngày: 98 SP** (chưa tính 20 SP của Sprint 0 là công việc thiết kế/khởi tạo).

## 6. Product Backlog đầy đủ (đã ưu tiên)

Cột **Ưu tiên** dùng MoSCoW. Cột **Sprint** là dự kiến; backlog được refine lại mỗi thứ Năm.

| ID | Epic | User Story (rút gọn) | Ưu tiên | SP | Sprint | Người |
|---|---|---|---|---|---|---|
| US-01 | E1 | Thu luồng RTSP và phát hiện "person" bằng Frigate | MUST | 3 | S1 | C |
| US-02 | E1 | Bắn sự kiện phát hiện lên MQTT topic | MUST | 1 | S1 | C |
| US-03 | E1 | Orchestrator subscribe MQTT, parse và ghi bảng `events` | MUST | 3 | S1 | B |
| US-04 | E1 | Lưu snapshot/clip vào object storage | MUST | 2 | S1 | B,C |
| US-05 | E2 | Đăng nhập dashboard bằng email/mật khẩu | MUST | 3 | S1 | A |
| US-06 | E7 | Xem danh sách sự kiện gần nhất kèm ảnh | MUST | 3 | S1 | A |
| US-07 | E1 | Seed data + script reset môi trường | MUST | 1 | S1 | B |
| US-08 | E10 | Integration test MQTT → DB | MUST | 2 | S1 | B,E |
| US-09 | E4 | Đăng ký khuôn mặt người quen qua dashboard | MUST | 3 | S2 | A,D |
| US-10 | E4 | Crop ảnh person và so khớp danh sách đã đăng ký (M1) | MUST | 5 | S2 | D |
| US-11 | E4 | Gắn nhãn KNOWN/UNKNOWN + confidence vào sự kiện | MUST | 2 | S2 | D,B |
| US-12 | E3 | Cấu hình vùng cấm cho từng camera (M4) | MUST | 3 | S2 | C |
| US-13 | E5 | Escalation state machine theo loại sự kiện | MUST | 5 | S2 | B |
| US-14 | E6 | Nhận cảnh báo Telegram kèm ảnh và 2 nút xác nhận | MUST | 3 | S2 | B |
| US-15 | E5 | Cấu hình ngưỡng confidence & timeout theo loại sự kiện | MUST | 3 | S2 | A,B |
| US-16 | E4 | Phát hiện tư thế nằm/ngã bất thường bằng Pose (M2a) | SHOULD | 5 | S3 | E |
| US-17 | E4 | Xác nhận té ngã bằng ngưỡng thời gian bất động | SHOULD | 3 | S3 | E |
| US-18 | E4 | Phát hiện lửa/khói bằng YOLO pretrained (M3) | SHOULD | 5 | S3 | D |
| US-19 | E5 | Ưu tiên P0 cho cháy/khói với timeout rút ngắn | SHOULD | 2 | S3 | D,B |
| US-20 | E8 | Wellness check định kỳ, cảnh báo nếu quá hạn (M5) | MUST | 3 | S3 | E |
| US-21 | E7 | Timeline sự kiện, lọc theo loại/camera/thời gian, xem clip | SHOULD | 5 | S3 | A |
| US-22 | E10 | Báo cáo precision/recall/FAR từng module | MUST | 3 | S3 | E |
| US-23 | E9 | Chuyển lưu trữ media sang Amazon S3 | MUST | 3 | S4 | C |
| US-24 | E9 | Thay face recognition local bằng Amazon Rekognition | MUST | 5 | S4 | D |
| US-25 | E9 | Thay JWT tự viết bằng Amazon Cognito | MUST | 3 | S4 | A |
| US-26 | E6 | Gửi cảnh báo qua Amazon SNS (email + SMS) | SHOULD | 2 | S4 | B |
| US-27 | E6 | Amazon Connect gọi tự động khi ESCALATED | SHOULD | 3 | S4 | B,C |
| US-28 | E9 | Đẩy log lên CloudWatch + 1 alarm cơ bản | SHOULD | 2 | S4 | C |
| US-29 | E10 | Hardening: retry, rate limit, tinh chỉnh giảm báo giả | MUST | 3 | S4 | Nhóm |
| US-30 | E9 | Tài liệu: README, sơ đồ triển khai, ước tính chi phí | MUST | 2 | S4 | A |
| US-31 | E10 | Video demo + kịch bản demo live | MUST | 2 | S4 | A,E |
| US-32 | E4 | Phát hiện đứng/ngồi bất thường 24/24 bằng track ID (M2b) | COULD | 5 | — | E |
| US-33 | E7 | Biểu đồ thống kê sự kiện theo ngày/loại | COULD | 3 | — | A |
| US-34 | E6 | Sinh caption tường thuật sự kiện bằng Gemini API | COULD | 3 | — | D |
| US-35 | E4 | Phát hiện che mặt/khẩu trang bất thường (DetectProtectiveEquipment) | COULD | 3 | — | D |
| US-36 | E4 | Nhận diện hành vi đánh nhau giữa 2+ người (M2c) | WON'T | 15 | — | — |
| US-37 | E1 | Đưa luồng video lên Kinesis Video Streams | WON'T | 8 | — | — |
| US-38 | E2 | Ứng dụng mobile native | WON'T | 20 | — | — |

### Cảnh báo về tải Sprint 4

Tổng SP dự kiến Sprint 4 = **25 SP**, cao hơn velocity mục tiêu 24 và cao hơn con số 20 đã đặt ra trong kế hoạch sprint (vì Sprint 4 phải dành ~30% cho hardening, tài liệu và tập demo). Nếu đến ngày 25 nhóm thấy đuối, **thứ tự cắt bỏ đã chốt trước** để không phải tranh cãi lúc căng thẳng:

1. Cắt **US-28** (CloudWatch) — mất 2 SP, ảnh hưởng điểm ít nhất
2. Cắt **US-27** (Connect) — mất 3 SP, thay bằng gọi giả lập ghi log + giải thích trong báo cáo
3. Cắt **US-26** (SNS) — giữ Telegram làm kênh chính

Tuyệt đối **không** cắt US-29, US-30, US-31. Một hệ thống ít tính năng nhưng chạy mượt và có tài liệu tốt được điểm cao hơn một hệ thống nhiều tính năng mà demo lỗi.

---

# PHẦN III — USER STORIES CHI TIẾT

Mẫu: *Là `<persona>`, tôi muốn `<hành động>`, để `<giá trị>`* + Acceptance Criteria dạng Given/When/Then.

## EPIC-1 — Hạ tầng & thu nhận video

---
### US-01 · Thu luồng RTSP và phát hiện người · MUST · 3 SP
**Là** quản trị viên (P3), **tôi muốn** hệ thống nhận luồng video RTSP từ camera và tự phát hiện có người trong khung hình, **để** không phải tự viết thuật toán lọc chuyển động.

```
Given  một luồng RTSP hợp lệ đã được cấu hình trong Frigate
When   có người xuất hiện trong khung hình quá 1 giây
Then   Frigate tạo một detection object loại "person" kèm track ID,
       bounding box, timestamp và confidence score

Given  luồng RTSP bị ngắt kết nối
When   quá 30 giây không nhận được frame
Then   hệ thống ghi log lỗi và tự thử kết nối lại, không crash
```
**Ghi chú kỹ thuật:** giai đoạn dev dùng webcam → ffmpeg → mediamtx giả lập RTSP. Detector chọn CPU/OpenVINO tuỳ máy; nếu máy yếu thì giảm xuống 5 fps.

---
### US-02 · Phát sự kiện lên MQTT · MUST · 1 SP
**Là** hệ thống, **tôi muốn** đẩy sự kiện phát hiện lên MQTT broker, **để** orchestrator không phải polling liên tục.

```
Given  Frigate phát hiện một object mới
When   detection được xác nhận (qua ngưỡng min_score)
Then   một message JSON được publish lên topic frigate/events chứa
       camera_id, label, track_id, zones[], score, start_time, snapshot path

Given  object rời khỏi khung hình
When   Frigate kết thúc track
Then   message "end" được publish với cùng track_id và end_time
```

---
### US-03 · Orchestrator tiêu thụ MQTT và ghi DB · MUST · 3 SP
**Là** hệ thống, **tôi muốn** orchestrator NestJS lắng nghe MQTT, chuẩn hoá payload và ghi vào PostgreSQL, **để** mọi sự kiện đều có nguồn dữ liệu duy nhất.

```
Given  orchestrator đang kết nối tới MQTT broker
When   nhận được message hợp lệ trên topic frigate/events
Then   một bản ghi được tạo trong bảng events với các trường
       id, camera_id, event_type, track_id, confidence, zones,
       status='DETECTED', detected_at

Given  message có định dạng sai hoặc thiếu trường bắt buộc
When   orchestrator parse thất bại
Then   message được ghi vào dead-letter log, không làm dừng consumer

Given  cùng một track_id được gửi nhiều lần trong 10 giây
When   orchestrator xử lý
Then   chỉ một sự kiện được tạo (khử trùng lặp theo track_id)
```

---
### US-04 · Lưu media sự kiện · MUST · 2 SP
**Là** người giám sát (P1), **tôi muốn** mỗi sự kiện có ảnh và clip kèm theo, **để** tự đánh giá tình hình thay vì tin mù vào AI.

```
Given  một sự kiện vừa được tạo
When   orchestrator xử lý sự kiện
Then   snapshot được upload lên object storage và đường dẫn được lưu
       vào bảng event_media với loại 'SNAPSHOT'

Given  sự kiện có mức ưu tiên P0 hoặc P1
When   clip video đã sẵn sàng từ Frigate
Then   clip cũng được upload và lưu với loại 'CLIP'

Given  người dùng xem ảnh trên dashboard
When   frontend yêu cầu media
Then   backend trả về presigned URL có hiệu lực 15 phút, không lộ
       credential của bucket
```
**Ghi chú:** dev dùng MinIO, Sprint 4 đổi sang S3 qua interface `IStorageService`.

---
### US-07 · Seed data & reset môi trường · MUST · 1 SP
**Là** thành viên nhóm, **tôi muốn** một lệnh duy nhất tạo dữ liệu mẫu và reset sạch, **để** test lại nhanh mà không phải xoá tay.

```
Given  môi trường docker đang chạy
When   chạy `npm run seed`
Then   DB có sẵn 1 admin, 1 caregiver, 2 camera, 3 zone, 5 known_face
       và 20 sự kiện mẫu đủ các loại

Given  cần reset
When   chạy `npm run db:reset`
Then   toàn bộ bảng bị xoá, migration chạy lại, seed chạy lại
```

---
## EPIC-2 — Xác thực & quản lý người dùng

---
### US-05 · Đăng nhập dashboard · MUST · 3 SP
**Là** người giám sát (P1), **tôi muốn** đăng nhập bằng email và mật khẩu, **để** dữ liệu camera trong nhà tôi không ai khác xem được.

```
Given  tôi đã có tài khoản
When   nhập đúng email và mật khẩu
Then   nhận access token (hiệu lực 1 giờ) + refresh token và được
       chuyển tới dashboard

Given  nhập sai mật khẩu 5 lần liên tiếp
When   thử lần thứ 6
Then   tài khoản bị khoá tạm 15 phút và ghi vào audit log

Given  tôi chưa đăng nhập
When   truy cập bất kỳ URL nào ngoài /login
Then   bị chuyển hướng về trang đăng nhập

Given  token hết hạn
When   gọi API bất kỳ
Then   nhận HTTP 401 và frontend tự refresh token một lần trước khi
       bắt đăng nhập lại
```
**Ghi chú:** Sprint 1 dùng JWT tự viết; Sprint 4 (US-25) thay bằng Cognito. Mật khẩu hash bằng bcrypt/argon2 — không lưu plaintext.

---
### US-25 · Chuyển sang Amazon Cognito · MUST · 3 SP
**Là** quản trị viên (P3), **tôi muốn** hệ thống dùng Cognito User Pool, **để** không tự quản lý mật khẩu và có sẵn cơ chế khôi phục tài khoản.

```
Given  Cognito User Pool đã được cấu hình
When   người dùng đăng nhập
Then   token do Cognito cấp, backend xác thực bằng JWKS của user pool

Given  người dùng quên mật khẩu
When   bấm "Quên mật khẩu"
Then   Cognito gửi mã xác nhận qua email và cho phép đặt lại

Given  tài khoản đã tồn tại trong DB cũ
When   migration chạy
Then   người dùng được tạo tương ứng trong Cognito và ánh xạ qua
       trường cognito_sub trong bảng users
```

---
## EPIC-3 — Quản lý camera & vùng giám sát

---
### US-12 · Cấu hình vùng cấm · MUST · 3 SP
**Là** quản trị viên (P3), **tôi muốn** định nghĩa vùng nguy hiểm (bếp, cầu thang, ban công) trên khung hình camera, **để** hệ thống chỉ cảnh báo khi có người vào đúng vùng đó.

```
Given  một camera đã được thêm vào hệ thống
When   tôi vẽ một đa giác trên ảnh preview và đặt tên "Bếp"
Then   vùng được lưu vào bảng zones với toạ độ chuẩn hoá (0–1) và
       cấu hình Frigate được cập nhật

Given  vùng "Bếp" đã được đánh dấu là vùng cấm trẻ em
When   Frigate phát hiện person nằm trong vùng đó
Then   sự kiện được tạo với event_type='RESTRICTED_ZONE' và zone_name='Bếp'

Given  người đi ngang qua vùng < 2 giây
When   hệ thống đánh giá
Then   không tạo cảnh báo (tránh báo giả khi chỉ đi lướt qua)

Given  tôi muốn tắt giám sát vùng vào ban đêm
When   đặt lịch hoạt động cho zone từ 06:00–22:00
Then   ngoài khung giờ đó vùng không sinh cảnh báo
```

---
## EPIC-4 — Module AI nhận diện

---
### US-09 · Đăng ký khuôn mặt người quen · MUST · 3 SP
**Là** quản trị viên (P3), **tôi muốn** thêm ảnh của các thành viên trong nhà vào danh sách người quen, **để** hệ thống không báo động mỗi lần người nhà đi ngang camera.

```
Given  tôi đang ở trang "Người quen"
When   upload 1–5 ảnh và nhập tên
Then   hệ thống trích xuất face embedding, lưu vào known_faces và
       hiển thị trong danh sách

Given  ảnh upload không phát hiện được khuôn mặt nào
When   xử lý
Then   hiển thị lỗi rõ ràng và không tạo bản ghi

Given  ảnh có nhiều hơn 1 khuôn mặt
When   xử lý
Then   yêu cầu tôi chọn khuôn mặt nào là đúng người

Given  tôi xoá một người quen
When   xác nhận xoá
Then   embedding bị xoá hoàn toàn khỏi hệ thống (không soft-delete),
       ghi vào audit log
```
**Lưu ý riêng tư:** chỉ lưu vector embedding, **không** lưu ảnh gốc dài hạn.

---
### US-10 · Nhận diện người lạ (Module 1) · MUST · 5 SP
**Là** người giám sát (P1), **tôi muốn** biết ngay khi có người không quen bước vào nhà, **để** phản ứng kịp thời.

```
Given  Frigate phát hiện "person" và đã crop ảnh
When   AI service nhận ảnh crop
Then   trích xuất embedding và so khớp với toàn bộ known_faces bằng
       khoảng cách cosine, trả về best match + similarity score

Given  similarity ≥ ngưỡng T_known (mặc định 0.6)
When   so khớp xong
Then   sự kiện được gắn person_status='KNOWN' kèm tên người

Given  similarity < T_known
When   so khớp xong
Then   sự kiện được gắn person_status='UNKNOWN' và chuyển sang
       escalation engine

Given  ảnh crop không đủ rõ để trích xuất khuôn mặt (quay lưng, quá nhỏ,
       quá tối)
When   xử lý
Then   gắn person_status='UNDETERMINED', ghi log, KHÔNG báo động
       (tránh spam khi người nhà quay lưng vào camera)

Given  AI service không phản hồi quá 5 giây
When   orchestrator gọi
Then   timeout, sự kiện vẫn được lưu với status='AI_FAILED' và
       ghi CloudWatch/log để theo dõi
```

---
### US-11 · Gắn nhãn và confidence vào sự kiện · MUST · 2 SP
**Là** hệ thống, **tôi muốn** mọi sự kiện đều mang nhãn phân loại và điểm tin cậy, **để** escalation engine quyết định được mức phản ứng.

```
Given  AI service trả kết quả
When   orchestrator nhận
Then   cập nhật events với ai_label, confidence (0–1), ai_model_version
       và ai_processed_at

Given  một sự kiện có nhiều kết quả AI (vừa UNKNOWN vừa trong vùng cấm)
When   tổng hợp
Then   lấy mức ưu tiên cao nhất làm priority của sự kiện, giữ đủ
       chi tiết từng nhãn trong trường ai_results (JSONB)
```

---
### US-16 · Phát hiện tư thế nằm/ngã bất thường (Module 2a) · SHOULD · 5 SP
**Là** người giám sát (P1), **tôi muốn** biết khi người nhà bị ngã, **để** gọi cấp cứu kịp thời.

```
Given  Frigate cung cấp chuỗi frame chứa person
When   MediaPipe Pose trích xuất 33 keypoint
Then   hệ thống tính tỉ lệ chiều cao/chiều rộng bounding box, góc
       trục thân so với phương ngang, và độ cao trọng tâm

Given  trục thân gần nằm ngang (< 30°) và trọng tâm hạ thấp đột ngột
When   so với 10 frame trước đó
Then   đánh dấu candidate FALL và bắt đầu đếm thời gian

Given  không trích xuất được pose (bị che khuất, ra khỏi khung)
When   xử lý
Then   giữ trạng thái candidate thêm tối đa 5 giây rồi huỷ, không
       tạo cảnh báo từ dữ liệu thiếu
```

---
### US-17 · Xác nhận té ngã bằng ngưỡng bất động · SHOULD · 3 SP
**Là** người được giám sát (P2), **tôi muốn** hệ thống chỉ báo té ngã khi tôi thật sự nằm bất động, **để** không bị làm phiền mỗi lần cúi nhặt đồ.

```
Given  một candidate FALL đang được theo dõi
When   tư thế bất thường duy trì liên tục > 15 giây VÀ dịch chuyển
       keypoint giữa các frame dưới ngưỡng chuyển động
Then   tạo sự kiện FALL_DETECTED với priority P1

Given  một candidate FALL đang được theo dõi
When   người đó đứng dậy trong vòng 15 giây
Then   huỷ candidate, chỉ ghi log nội bộ, KHÔNG tạo cảnh báo

Given  người nằm trên giường/sofa trong vùng đã đánh dấu là "vùng nghỉ"
When   phát hiện tư thế nằm
Then   không tạo cảnh báo té ngã
```
**Tham số X = 15 giây phải cấu hình được**, không hard-code — đây là con số sẽ phải tinh chỉnh ở Sprint 4 dựa trên FAR đo được.

---
### US-18 · Phát hiện lửa/khói (Module 3) · SHOULD · 5 SP
**Là** người được giám sát (P2), **tôi muốn** hệ thống phát hiện cháy sớm, **để** thoát ra kịp.

```
Given  một frame từ camera
When   model YOLO fire/smoke chạy inference
Then   trả về danh sách bounding box với nhãn 'fire' hoặc 'smoke'
       kèm confidence

Given  phát hiện fire/smoke với confidence ≥ ngưỡng T_fire
When   dấu hiệu xuất hiện liên tục trên ≥ 3 frame trong 5 giây
Then   tạo sự kiện FIRE_SMOKE_DETECTED với priority P0

Given  chỉ 1 frame đơn lẻ có tín hiệu (nhiễu, đèn màu, ánh nắng)
When   các frame sau không xác nhận
Then   không tạo cảnh báo
```
**Kiểm thử:** chỉ dùng video mẫu từ dataset công khai (D-Fire, FireNet). **Tuyệt đối không tự tạo lửa để quay.**

---
## EPIC-5 — Engine sự kiện & leo thang

---
### US-13 · Escalation state machine · MUST · 5 SP
**Là** người giám sát (P1), **tôi muốn** hệ thống tự leo thang khi tôi không phản hồi, **để** người nhà vẫn được giúp kể cả khi tôi đang họp.

```
Given  một sự kiện mới với confidence < T_low
When   escalation engine xử lý
Then   trạng thái = LOGGED_ONLY, không gửi thông báo nào

Given  confidence nằm giữa T_low và T_high
When   engine xử lý
Then   trạng thái = NOTIFIED, gửi thông báo tới caregiver, đặt hẹn
       giờ theo T_wait của loại sự kiện

Given  sự kiện đang ở NOTIFIED
When   người dùng bấm "Tôi ổn"
Then   chuyển sang RESOLVED, huỷ hẹn giờ, ghi ai xác nhận và lúc nào

Given  sự kiện đang ở NOTIFIED
When   người dùng bấm "Cần giúp đỡ"
Then   chuyển ngay sang ESCALATED, không chờ hết timeout

Given  sự kiện đang ở NOTIFIED
When   hết T_wait mà không có phản hồi
Then   chuyển sang ESCALATED và kích hoạt kênh khẩn cấp

Given  sự kiện ở ESCALATED
When   liên hệ khẩn cấp đã được gọi và có người xác nhận xử lý
Then   chuyển sang CLOSED kèm thông tin người xử lý

Given  hệ thống restart giữa chừng
When   khởi động lại
Then   các sự kiện đang NOTIFIED được nạp lại và hẹn giờ được khôi
       phục theo detected_at (không mất cảnh báo đang chờ)
```

---
### US-15 · Cấu hình ngưỡng và timeout · MUST · 3 SP
**Là** quản trị viên (P3), **tôi muốn** tự đặt ngưỡng tin cậy và thời gian chờ cho từng loại sự kiện, **để** cân bằng giữa an toàn và bị làm phiền.

```
Given  tôi ở trang Cấu hình
When   chỉnh T_low, T_high, T_wait cho loại "Người lạ"
Then   thay đổi có hiệu lực với sự kiện mới trong vòng 60 giây,
       không cần restart service

Given  tôi nhập T_low > T_high
When   lưu
Then   hiển thị lỗi validation, không lưu

Given  hệ thống chưa được cấu hình
When   sự kiện đầu tiên xảy ra
Then   dùng giá trị mặc định đã định nghĩa sẵn
```

**Bảng mặc định:**

| event_type | Priority | T_low | T_high | T_wait |
|---|---|---|---|---|
| FIRE_SMOKE_DETECTED | P0 | 0.50 | 0.70 | 30 giây |
| FALL_DETECTED | P1 | 0.55 | 0.75 | 60 giây |
| RESTRICTED_ZONE | P1 | 0.60 | 0.80 | 60 giây |
| UNKNOWN_PERSON | P2 | 0.60 | 0.80 | 120 giây |
| WELLNESS_TIMEOUT | P2 | — | — | 300 giây |

---
### US-19 · Ưu tiên P0 cho cháy/khói · SHOULD · 2 SP
**Là** người được giám sát (P2), **tôi muốn** cảnh báo cháy đi nhanh hơn mọi loại khác, **để** có thêm thời gian thoát.

```
Given  một sự kiện FIRE_SMOKE_DETECTED
When   escalation engine xử lý
Then   bỏ qua bậc LOGGED_ONLY, vào thẳng NOTIFIED bất kể confidence,
       và dùng T_wait = 30 giây

Given  cùng lúc có nhiều sự kiện đang chờ
When   gửi thông báo
Then   sự kiện P0 được gửi trước, không xếp hàng sau P1/P2
```

---
## EPIC-6 — Kênh thông báo & xác nhận

---
### US-14 · Cảnh báo Telegram kèm nút xác nhận · MUST · 3 SP
**Là** người giám sát (P1), **tôi muốn** nhận cảnh báo có ảnh và hai nút bấm, **để** xử lý trong 5 giây mà không cần mở app.

```
Given  một sự kiện chuyển sang NOTIFIED
When   kênh Telegram được kích hoạt
Then   bot gửi tin nhắn chứa: loại sự kiện, tên camera, tên vùng,
       thời gian, ảnh snapshot và 2 inline button
       ["✅ Tôi ổn"] ["🆘 Cần giúp đỡ"]

Given  tôi bấm một trong hai nút
When   callback tới backend
Then   trạng thái sự kiện được cập nhật tương ứng và tin nhắn được
       chỉnh sửa thành "Đã xác nhận bởi <tên> lúc <giờ>"

Given  cùng một sự kiện đã được xác nhận
When   người khác bấm nút lần nữa
Then   hiển thị "Sự kiện đã được xử lý", không ghi đè trạng thái

Given  Telegram API lỗi
When   gửi thất bại
Then   retry 3 lần (backoff 2s/4s/8s), sau đó ghi notification với
       status='FAILED' và vẫn tiếp tục đếm giờ escalation
```

---
### US-26 · Thông báo qua Amazon SNS · SHOULD · 2 SP
**Là** người giám sát (P1), **tôi muốn** nhận cảnh báo qua email và SMS, **để** không phụ thuộc vào một ứng dụng duy nhất.

```
Given  một sự kiện chuyển sang NOTIFIED
When   kênh SNS được bật
Then   message được publish lên SNS topic và gửi tới các subscriber
       đã confirm (email và/hoặc SMS)

Given  số điện thoại chưa được verify (SNS sandbox)
When   gửi SMS
Then   ghi log rõ lý do thất bại, không im lặng bỏ qua
```

---
### US-27 · Gọi điện tự động qua Amazon Connect · SHOULD · 3 SP
**Là** liên hệ khẩn cấp (P4), **tôi muốn** nhận cuộc gọi tự động khi có chuyện nghiêm trọng, **để** biết mà chạy sang.

```
Given  một sự kiện chuyển sang ESCALATED
When   kênh Connect được bật
Then   Connect khởi tạo outbound call tới số liên hệ khẩn cấp đầu
       tiên trong danh sách

Given  cuộc gọi được nhận
When   người nghe máy
Then   phát nội dung TTS: loại sự kiện, địa điểm, thời gian; và mời
       bấm phím 1 để xác nhận đã tiếp nhận

Given  người nghe bấm phím 1
When   Connect gửi callback
Then   sự kiện chuyển sang CLOSED với người xử lý là liên hệ đó

Given  cuộc gọi không được nhận sau 3 hồi chuông
When   timeout
Then   gọi liên hệ tiếp theo trong danh sách (tối đa 3 liên hệ)
```
**Phạm vi đồ án:** chỉ demo với **1 số điện thoại đã verify**. Nếu Connect không kịp cấu hình, thay bằng gọi giả lập ghi log + giải thích trong báo cáo.

---
## EPIC-7 — Dashboard giám sát & lịch sử

---
### US-06 · Danh sách sự kiện · MUST · 3 SP
**Là** người giám sát (P1), **tôi muốn** thấy các sự kiện mới nhất ngay khi mở dashboard, **để** nắm tình hình trong 10 giây.

```
Given  tôi đã đăng nhập
When   mở trang chủ
Then   thấy danh sách 20 sự kiện mới nhất, mỗi dòng gồm ảnh thumbnail,
       loại sự kiện, camera, thời gian tương đối ("3 phút trước") và
       badge trạng thái

Given  có sự kiện mới phát sinh khi tôi đang mở trang
When   backend đẩy cập nhật
Then   sự kiện mới xuất hiện ở đầu danh sách mà không cần F5

Given  chưa có sự kiện nào
When   mở trang
Then   hiển thị trạng thái rỗng thân thiện, không phải bảng trắng
```

---
### US-21 · Timeline, bộ lọc và xem clip · SHOULD · 5 SP
**Là** người giám sát (P1), **tôi muốn** tra cứu lại sự kiện cũ theo nhiều tiêu chí, **để** kiểm tra khi có nghi ngờ.

```
Given  tôi ở trang Lịch sử
When   chọn khoảng thời gian, loại sự kiện, camera, trạng thái
Then   danh sách được lọc tương ứng, có phân trang 20 bản ghi/trang

Given  tôi bấm vào một sự kiện
When   trang chi tiết mở
Then   thấy ảnh snapshot, clip video phát được ngay trong trang,
       toàn bộ kết quả AI kèm confidence, và lịch sử chuyển trạng thái
       (ai xác nhận, lúc nào, qua kênh nào)

Given  một sự kiện là báo động giả
When   tôi đánh dấu "Báo động giả"
Then   cờ is_false_alarm được lưu để dùng cho việc đo FAR ở US-22
```
Ô đánh dấu báo động giả nhỏ nhưng quan trọng: đây là nguồn dữ liệu thật để nhóm chứng minh đã tinh chỉnh hệ thống, thay vì chỉ đo trên dataset.

---
## EPIC-8 — Wellness check

---
### US-20 · Kiểm tra hiện diện định kỳ (Module 5) · MUST · 3 SP
**Là** người giám sát (P1), **tôi muốn** hệ thống kiểm tra người nhà vẫn ổn theo lịch, **để** phát hiện cả những trường hợp camera không thấy gì bất thường nhưng thực tế có vấn đề.

```
Given  lịch wellness check được đặt lúc 09:00 và 18:00
When   đến giờ kiểm tra
Then   hệ thống xét: trong X giờ qua có phát hiện chuyển động của
       người đã đăng ký hay không

Given  KHÔNG có hoạt động nào trong khoảng thời gian quy định
When   scheduler chạy
Then   tạo sự kiện WELLNESS_TIMEOUT priority P2 và yêu cầu người
       được giám sát xác nhận

Given  người được giám sát xác nhận "Tôi ổn" trong 5 phút
When   nhận phản hồi
Then   sự kiện chuyển RESOLVED

Given  không có xác nhận sau 5 phút
When   hết timeout
Then   escalate tới caregiver

Given  Module 1 ghi nhận người đó đã rời khỏi nhà
When   scheduler chạy
Then   bỏ qua kiểm tra, không báo động vô nghĩa
```
Module này thuần logic scheduler, **không dùng computer vision** — là story rẻ nhất trong backlog nhưng mang lại một loại bảo vệ mà 4 module kia không có.

---
## EPIC-9 — Triển khai cloud AWS

---
### US-23 · Chuyển lưu trữ sang Amazon S3 · MUST · 3 SP
```
Given  biến môi trường STORAGE_PROVIDER=s3
When   hệ thống khởi động
Then   IStorageService trả về triển khai S3, không cần sửa business logic

Given  media được upload
When   lưu vào S3
Then   object nằm trong bucket với key dạng
       events/{yyyy}/{mm}/{dd}/{event_id}/{type}.{ext}

Given  object đã tồn tại quá 7 ngày
When   S3 lifecycle rule chạy
Then   object bị xoá tự động, trừ khi có tag retain=true
```

---
### US-24 · Chuyển sang Amazon Rekognition · MUST · 5 SP
```
Given  biến môi trường FACE_PROVIDER=rekognition
When   hệ thống khởi động
Then   IFaceService dùng Rekognition Face Collection

Given  một khuôn mặt mới được đăng ký
When   gọi IndexFaces
Then   FaceId được lưu vào known_faces để so khớp về sau

Given  cần nhận diện
When   gọi SearchFacesByImage với ảnh crop
Then   trả về FaceMatches kèm Similarity, ánh xạ về person_status

Given  Rekognition lỗi (quota, credential, region)
When   gọi thất bại
Then   hệ thống tự fallback về model local và ghi cảnh báo, KHÔNG
       để sự kiện bị mất
```
Feature flag ở story này là **bắt buộc**, không phải tuỳ chọn: nếu Rekognition trục trặc đúng hôm demo, nhóm bật lại model local trong 10 giây thay vì mất điểm.

---
### US-28 · CloudWatch logs & alarm · SHOULD · 2 SP
```
Given  ứng dụng đang chạy trên AWS
When   sinh log
Then   log được đẩy lên CloudWatch Log Group theo service, có
       correlation_id để trace một sự kiện xuyên nhiều service

Given  tỉ lệ lỗi xử lý sự kiện vượt 10% trong 5 phút
When   CloudWatch đánh giá metric
Then   alarm kích hoạt và gửi thông báo tới nhóm
```

---
## EPIC-10 — Chất lượng & đo lường

---
### US-08 · Integration test MQTT → DB · MUST · 2 SP
```
Given  môi trường test với MQTT broker và PostgreSQL trong container
When   publish một message frigate/events mẫu
Then   trong vòng 3 giây có đúng 1 bản ghi tương ứng trong bảng events

Given  publish message lỗi định dạng
When   consumer xử lý
Then   không có bản ghi nào được tạo, consumer vẫn sống, có log lỗi
```

---
### US-22 · Báo cáo precision/recall/FAR · MUST · 3 SP
**Là** nhóm, **tôi muốn** có số đo khách quan cho từng module, **để** trả lời được câu hỏi "hệ thống chính xác bao nhiêu" trước hội đồng.

```
Given  bộ test có nhãn (≥ 30 clip dương tính + ≥ 30 âm tính mỗi module)
When   chạy script đánh giá
Then   xuất bảng TP/FP/FN, Precision, Recall, F1 và FAR (số báo giả/giờ)
       cho từng module, kèm ngưỡng confidence đã dùng

Given  FAR của một module vượt 30%
When   xem kết quả
Then   module đó được đưa vào danh sách phải tinh chỉnh ở Sprint 4,
       và KHÔNG được thêm tính năng mới
```

---
### US-29 · Hardening · MUST · 3 SP
```
Given  một service phụ thuộc tạm thời lỗi
When   gọi thất bại
Then   retry với exponential backoff tối đa 3 lần rồi ghi vào
       dead-letter, không làm sập toàn hệ thống

Given  một camera liên tục sinh sự kiện (lỗi hoặc nhiễu)
When   vượt 20 sự kiện/phút từ cùng 1 camera
Then   kích hoạt rate limit, gộp thành 1 cảnh báo tổng hợp và ghi
       cảnh báo kỹ thuật cho admin

Given  kết quả đo FAR từ US-22
When   tinh chỉnh ngưỡng
Then   FAR giảm xuống dưới 20% cho ít nhất 3/4 module
```

---
# PHẦN IV — FUNCTIONAL REQUIREMENTS

Mã hoá: `FR-<NHÓM>-<số>`. Mức độ: **M** = Mandatory, **D** = Desirable, **O** = Optional.

## FR-AUT — Xác thực & phân quyền

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-AUT-01 | Hệ thống phải cho phép người dùng đăng nhập bằng email và mật khẩu | M | US-05 |
| FR-AUT-02 | Hệ thống phải cấp access token có thời hạn và refresh token | M | US-05 |
| FR-AUT-03 | Hệ thống phải khoá tài khoản tạm thời sau 5 lần đăng nhập sai | M | US-05 |
| FR-AUT-04 | Hệ thống phải hash mật khẩu bằng thuật toán một chiều, không lưu plaintext | M | US-05 |
| FR-AUT-05 | Hệ thống phải phân biệt 3 vai trò: ADMIN, CAREGIVER, VIEWER với quyền khác nhau | M | US-05 |
| FR-AUT-06 | Hệ thống phải chặn mọi truy cập API khi chưa xác thực, trả HTTP 401 | M | US-05 |
| FR-AUT-07 | Hệ thống phải hỗ trợ đăng nhập qua Amazon Cognito User Pool | M | US-25 |
| FR-AUT-08 | Hệ thống phải cho phép khôi phục mật khẩu qua email | D | US-25 |

## FR-DEV — Quản lý camera, vùng & người quen

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DEV-01 | Hệ thống phải cho phép thêm/sửa/xoá camera kèm URL RTSP và tên hiển thị | M | US-01 |
| FR-DEV-02 | Hệ thống phải cho phép định nghĩa vùng giám sát dạng đa giác trên khung hình | M | US-12 |
| FR-DEV-03 | Hệ thống phải cho phép gán loại vùng: RESTRICTED, REST_AREA, NORMAL | M | US-12, US-17 |
| FR-DEV-04 | Hệ thống phải cho phép đặt khung giờ hoạt động cho từng vùng | D | US-12 |
| FR-DEV-05 | Hệ thống phải cho phép đăng ký khuôn mặt người quen từ 1–5 ảnh | M | US-09 |
| FR-DEV-06 | Hệ thống phải từ chối ảnh không phát hiện được khuôn mặt và báo lỗi rõ ràng | M | US-09 |
| FR-DEV-07 | Hệ thống phải cho phép xoá vĩnh viễn dữ liệu khuôn mặt của một người | M | US-09 |
| FR-DEV-08 | Hệ thống chỉ được lưu face embedding, không lưu ảnh gốc quá thời hạn quy định | M | US-09 |

## FR-ING — Thu nhận & tiền xử lý video

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-ING-01 | Hệ thống phải nhận được luồng video qua giao thức RTSP | M | US-01 |
| FR-ING-02 | Hệ thống phải phát hiện đối tượng "person" trong khung hình kèm bounding box và track ID | M | US-01 |
| FR-ING-03 | Hệ thống phải tự kết nối lại khi luồng video bị ngắt, không làm dừng dịch vụ | M | US-01 |
| FR-ING-04 | Hệ thống phải publish sự kiện phát hiện lên MQTT broker dạng JSON | M | US-02 |
| FR-ING-05 | Hệ thống phải trích xuất và lưu snapshot cho mọi sự kiện | M | US-04 |
| FR-ING-06 | Hệ thống phải lưu clip video cho sự kiện mức ưu tiên P0 và P1 | M | US-04 |
| FR-ING-07 | Hệ thống phải khử trùng lặp sự kiện theo track ID trong cửa sổ thời gian quy định | M | US-03 |

## FR-DET — Nhận diện AI

### Module 1 — Người lạ
| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DET-M1-01 | Hệ thống phải trích xuất khuôn mặt từ ảnh crop của đối tượng "person" | M | US-10 |
| FR-DET-M1-02 | Hệ thống phải so khớp khuôn mặt với danh sách người quen và trả về điểm tương đồng | M | US-10 |
| FR-DET-M1-03 | Hệ thống phải phân loại person_status thành KNOWN / UNKNOWN / UNDETERMINED | M | US-10 |
| FR-DET-M1-04 | Hệ thống không được sinh cảnh báo khi trạng thái là UNDETERMINED | M | US-10 |
| FR-DET-M1-05 | Hệ thống phải hỗ trợ chuyển đổi giữa model local và Amazon Rekognition bằng cấu hình | M | US-24 |
| FR-DET-M1-06 | Hệ thống phải tự dùng model local khi dịch vụ đám mây lỗi | M | US-24 |
| FR-DET-M1-07 | Hệ thống nên phát hiện dấu hiệu che mặt/khẩu trang bất thường | O | US-35 |

### Module 2a — Té ngã
| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DET-M2-01 | Hệ thống phải trích xuất keypoint tư thế người từ chuỗi khung hình | D | US-16 |
| FR-DET-M2-02 | Hệ thống phải nhận diện tư thế nằm/ngã bất thường dựa trên góc trục thân và độ cao trọng tâm | D | US-16 |
| FR-DET-M2-03 | Hệ thống chỉ được xác nhận té ngã khi tư thế bất thường kéo dài quá ngưỡng thời gian cấu hình được | D | US-17 |
| FR-DET-M2-04 | Hệ thống phải huỷ candidate khi đối tượng đứng dậy trong thời gian theo dõi | D | US-17 |
| FR-DET-M2-05 | Hệ thống không được sinh cảnh báo té ngã trong vùng được đánh dấu REST_AREA | D | US-17 |

### Module 3 — Cháy/khói
| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DET-M3-01 | Hệ thống phải phát hiện dấu hiệu lửa và khói trong khung hình | D | US-18 |
| FR-DET-M3-02 | Hệ thống phải yêu cầu xác nhận trên nhiều khung hình liên tiếp trước khi cảnh báo | D | US-18 |
| FR-DET-M3-03 | Hệ thống phải gán mức ưu tiên cao nhất (P0) cho sự kiện cháy/khói | D | US-19 |

### Module 4 — Vùng cấm
| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DET-M4-01 | Hệ thống phải phát hiện đối tượng người đi vào vùng đã định nghĩa là RESTRICTED | M | US-12 |
| FR-DET-M4-02 | Hệ thống phải bỏ qua trường hợp đi lướt qua vùng dưới ngưỡng thời gian quy định | M | US-12 |
| FR-DET-M4-03 | Hệ thống phải ghi tên vùng vào sự kiện để người dùng biết vị trí xảy ra | M | US-12 |

### Module 5 — Wellness check
| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DET-M5-01 | Hệ thống phải cho phép cấu hình lịch kiểm tra hiện diện theo giờ trong ngày | M | US-20 |
| FR-DET-M5-02 | Hệ thống phải sinh sự kiện WELLNESS_TIMEOUT khi không ghi nhận hoạt động trong khoảng quy định | M | US-20 |
| FR-DET-M5-03 | Hệ thống phải bỏ qua kiểm tra khi ghi nhận người được giám sát đã rời khỏi nhà | M | US-20 |

## FR-EVT — Quản lý sự kiện

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-EVT-01 | Hệ thống phải lưu mọi sự kiện phát hiện vào cơ sở dữ liệu kèm metadata đầy đủ | M | US-03 |
| FR-EVT-02 | Hệ thống phải gắn điểm tin cậy (0–1) và nhãn AI cho mỗi sự kiện | M | US-11 |
| FR-EVT-03 | Hệ thống phải lưu phiên bản model AI đã dùng cho mỗi sự kiện | D | US-11 |
| FR-EVT-04 | Khi một sự kiện có nhiều nhãn AI, hệ thống phải lấy mức ưu tiên cao nhất làm ưu tiên chung | M | US-11 |
| FR-EVT-05 | Hệ thống phải lưu lịch sử chuyển trạng thái của mỗi sự kiện | M | US-13 |
| FR-EVT-06 | Hệ thống phải cho phép người dùng đánh dấu một sự kiện là báo động giả | D | US-21 |
| FR-EVT-07 | Hệ thống phải tạo presigned URL có thời hạn khi cung cấp media cho client | M | US-04 |

## FR-ESC — Leo thang cảnh báo

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-ESC-01 | Hệ thống phải phân loại sự kiện thành 3 mức phản ứng theo điểm tin cậy: chỉ ghi log / thông báo / thông báo khẩn | M | US-13 |
| FR-ESC-02 | Hệ thống phải chuyển sự kiện sang ESCALATED khi hết thời gian chờ mà không có phản hồi | M | US-13 |
| FR-ESC-03 | Hệ thống phải chuyển sang ESCALATED ngay lập tức khi người dùng chọn "Cần giúp đỡ" | M | US-13 |
| FR-ESC-04 | Hệ thống phải chuyển sang RESOLVED khi người dùng chọn "Tôi ổn" | M | US-13 |
| FR-ESC-05 | Hệ thống phải cho phép cấu hình ngưỡng tin cậy và thời gian chờ riêng cho từng loại sự kiện | M | US-15 |
| FR-ESC-06 | Hệ thống phải áp dụng thời gian chờ ngắn nhất cho sự kiện cháy/khói | D | US-19 |
| FR-ESC-07 | Hệ thống phải khôi phục các bộ đếm giờ đang chờ sau khi khởi động lại | M | US-13 |
| FR-ESC-08 | Hệ thống phải xử lý ưu tiên sự kiện P0 trước các sự kiện mức thấp hơn khi có hàng đợi | D | US-19 |
| FR-ESC-09 | Hệ thống phải ghi nhận ai đã xác nhận, vào lúc nào, qua kênh nào | M | US-13 |

## FR-NOT — Thông báo

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-NOT-01 | Hệ thống phải gửi thông báo kèm loại sự kiện, camera, vùng, thời gian và ảnh snapshot | M | US-14 |
| FR-NOT-02 | Thông báo phải chứa hai lựa chọn xác nhận: "Tôi ổn" và "Cần giúp đỡ" | M | US-14 |
| FR-NOT-03 | Hệ thống phải thử gửi lại khi kênh thông báo lỗi, tối đa 3 lần với backoff tăng dần | M | US-14 |
| FR-NOT-04 | Hệ thống phải ghi nhận trạng thái gửi của mỗi thông báo (SENT / FAILED / CONFIRMED) | M | US-14 |
| FR-NOT-05 | Việc gửi thông báo thất bại không được làm dừng tiến trình leo thang | M | US-14 |
| FR-NOT-06 | Hệ thống phải hỗ trợ gửi cảnh báo qua email và SMS bằng Amazon SNS | D | US-26 |
| FR-NOT-07 | Hệ thống phải khởi tạo cuộc gọi tự động tới liên hệ khẩn cấp khi sự kiện ESCALATED | D | US-27 |
| FR-NOT-08 | Cuộc gọi tự động phải truyền đạt loại sự kiện, địa điểm và thời gian | D | US-27 |
| FR-NOT-09 | Hệ thống phải gọi tuần tự các liên hệ khẩn cấp (tối đa 3) khi liên hệ trước không nhận máy | D | US-27 |
| FR-NOT-10 | Hệ thống phải hỗ trợ cấu hình danh sách liên hệ khẩn cấp theo thứ tự ưu tiên | D | US-27 |

## FR-DSH — Giao diện giám sát

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DSH-01 | Hệ thống phải hiển thị danh sách sự kiện mới nhất kèm ảnh, loại, camera, thời gian, trạng thái | M | US-06 |
| FR-DSH-02 | Danh sách phải tự cập nhật khi có sự kiện mới, không cần tải lại trang | D | US-06 |
| FR-DSH-03 | Hệ thống phải cho phép lọc sự kiện theo khoảng thời gian, loại, camera và trạng thái | D | US-21 |
| FR-DSH-04 | Hệ thống phải cho phép phân trang danh sách sự kiện | D | US-21 |
| FR-DSH-05 | Trang chi tiết sự kiện phải hiển thị snapshot, clip phát được trực tiếp, kết quả AI và lịch sử trạng thái | D | US-21 |
| FR-DSH-06 | Hệ thống phải cho phép xác nhận sự kiện trực tiếp trên dashboard | M | US-13 |
| FR-DSH-07 | Giao diện phải hiển thị được trên màn hình điện thoại | D | US-06 |
| FR-DSH-08 | Hệ thống nên hiển thị biểu đồ thống kê sự kiện theo ngày và theo loại | O | US-33 |

## FR-ADM — Cấu hình & quản trị

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-ADM-01 | Hệ thống phải cho phép ADMIN chỉnh ngưỡng tin cậy và thời gian chờ qua giao diện | M | US-15 |
| FR-ADM-02 | Thay đổi cấu hình phải có hiệu lực mà không cần khởi động lại dịch vụ | M | US-15 |
| FR-ADM-03 | Hệ thống phải kiểm tra tính hợp lệ của cấu hình trước khi lưu | M | US-15 |
| FR-ADM-04 | Hệ thống phải có giá trị mặc định cho mọi tham số cấu hình | M | US-15 |
| FR-ADM-05 | Hệ thống phải giới hạn tần suất sự kiện từ một camera để chống spam | M | US-29 |

## FR-LOG — Nhật ký & kiểm toán

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-LOG-01 | Hệ thống phải ghi audit log cho các hành động nhạy cảm: đăng nhập, xoá dữ liệu khuôn mặt, đổi cấu hình | M | US-05, US-09 |
| FR-LOG-02 | Mỗi sự kiện phải có correlation ID để truy vết xuyên các service | D | US-28 |
| FR-LOG-03 | Hệ thống phải đẩy log ứng dụng lên Amazon CloudWatch | D | US-28 |
| FR-LOG-04 | Hệ thống phải cảnh báo khi tỉ lệ lỗi xử lý sự kiện vượt ngưỡng | D | US-28 |
| FR-LOG-05 | Hệ thống phải ghi lại mọi lần gọi AI thất bại kèm nguyên nhân | M | US-10 |

## FR-DAT — Vòng đời & bảo vệ dữ liệu

| Mã | Yêu cầu chức năng | Mức | US |
|---|---|---|---|
| FR-DAT-01 | Media sự kiện phải tự động bị xoá sau thời hạn lưu trữ quy định (mặc định 7 ngày) | M | US-23 |
| FR-DAT-02 | Hệ thống phải cho phép đánh dấu giữ lại vĩnh viễn một sự kiện cụ thể | D | US-23 |
| FR-DAT-03 | Hệ thống phải cho phép người dùng yêu cầu xoá toàn bộ dữ liệu cá nhân của một người | M | US-09 |
| FR-DAT-04 | Hệ thống không được phép truy cập media nếu không qua xác thực | M | US-04 |

---

## 7. Yêu cầu phi chức năng (NFR) — tóm tắt

| Mã | Yêu cầu | Ngưỡng đo |
|---|---|---|
| NFR-01 | Độ trễ từ lúc sự kiện xảy ra đến khi người dùng nhận thông báo | < 10 giây |
| NFR-02 | Độ trễ từ lúc phát hiện đến khi hiện trên dashboard | < 5 giây |
| NFR-03 | Tỉ lệ báo động giả sau tinh chỉnh | < 20% cho ≥ 3/4 module |
| NFR-04 | Số camera xử lý đồng thời trên môi trường dev | ≥ 3 |
| NFR-05 | Hệ thống phục hồi sau restart mà không mất sự kiện đang chờ | 100% |
| NFR-06 | Toàn hệ thống khởi động bằng một lệnh `docker compose up` trên máy sạch | Đạt/Không |
| NFR-07 | Độ phủ unit test cho business logic cốt lõi | ≥ 60% |
| NFR-08 | Chi phí AWS trong tháng chạy đồ án | < 10 USD |
| NFR-09 | Mật khẩu và credential không xuất hiện trong repo hay log | 0 lần |
| NFR-10 | Giao diện hiển thị đúng trên màn hình từ 360px | Đạt/Không |

---

## 8. Ma trận truy vết (Traceability Matrix)

| Epic | User Story | Functional Requirements | Release |
|---|---|---|---|
| E1 | US-01, 02, 03, 04, 07 | FR-ING-01→07, FR-EVT-01, FR-EVT-07 | 0.1 |
| E2 | US-05, 25 | FR-AUT-01→08 | 0.1, 1.0 |
| E3 | US-12 | FR-DEV-01→04, FR-DET-M4-01→03 | 0.2 |
| E4 | US-09, 10, 11, 16, 17, 18 | FR-DEV-05→08, FR-DET-M1/M2/M3/M4/M5 | 0.2, 0.3 |
| E5 | US-13, 15, 19 | FR-ESC-01→09, FR-ADM-01→04 | 0.2 |
| E6 | US-14, 26, 27 | FR-NOT-01→10 | 0.2, 1.0 |
| E7 | US-06, 21 | FR-DSH-01→08 | 0.1, 0.3 |
| E8 | US-20 | FR-DET-M5-01→03 | 0.3 |
| E9 | US-23, 24, 25, 28 | FR-DAT-01→04, FR-LOG-02→04, FR-DET-M1-05/06 | 1.0 |
| E10 | US-08, 22, 29, 30, 31 | FR-ADM-05, FR-LOG-01/05, NFR toàn bộ | 0.3, 1.0 |

Ma trận này dùng để chứng minh trước hội đồng rằng **không có yêu cầu chức năng nào bị bỏ sót** và **không có story nào được viết ra mà không phục vụ yêu cầu nào** — hai lỗi phổ biến nhất trong đồ án môn Công nghệ phần mềm.
