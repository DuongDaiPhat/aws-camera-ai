# KẾ HOẠCH SDLC (AGILE/SCRUM) — HỆ THỐNG CAMERA GIÁM SÁT HÀNH VI ỨNG DỤNG AI & AWS

**Thời gian:** 30 ngày (4 sprint × 1 tuần + Sprint 0)
**Nhân sự:** 5 sinh viên
**Khung áp dụng:** Scrum rút gọn + XP practices (CI, pair programming, TDD cho core logic)

---

## 0. Tóm tắt điều hành

Dự án gốc có 5 module AI + 9 dịch vụ AWS. Với 5 sinh viên làm part-time trong 30 ngày, **không thể** làm hết. Kế hoạch này áp dụng nguyên tắc *walking skeleton trước, tính năng sau*: dựng luồng end-to-end chạy được từ tuần 1, rồi mỗi sprint gắn thêm một module AI vào khung đã chạy.

Phạm vi được cắt theo MoSCoW ở mục 3. Thay đổi lớn nhất so với đề bài: **Module 2c (nhận diện đánh nhau, RWF-2000) bị loại khỏi phạm vi 1 tháng** và chuyển thành hướng phát triển tương lai.

---

## 1. Vision & mục tiêu sản phẩm

> Cho phép người thân giám sát an toàn tại nhà mà không cần ngồi xem camera: hệ thống tự phát hiện tình huống nguy hiểm, cảnh báo theo cấp độ, và leo thang lên cuộc gọi khẩn khi không ai phản hồi.

**Sản phẩm bàn giao cuối tháng (Definition of Success):**

| # | Tiêu chí | Ngưỡng đạt |
|---|---|---|
| S1 | Luồng E2E hoạt động: camera → phát hiện → lưu DB/S3 → cảnh báo → xác nhận → leo thang | Demo live không lỗi |
| S2 | Số module AI hoạt động | ≥ 4/5 (M1, M3, M4, M5 bắt buộc; M2a ưu tiên cao) |
| S3 | Độ trễ từ lúc xảy ra sự kiện đến lúc nhận cảnh báo | < 10 giây |
| S4 | Tỉ lệ báo động giả trên tập test | < 20% (FAR) |
| S5 | Triển khai được trên AWS (≥ 4 dịch vụ thật) | S3, Rekognition, Cognito, SNS/Connect |
| S6 | Tài liệu + video demo + báo cáo | Hoàn chỉnh, nộp trước hạn 1 ngày |

---

## 2. Ánh xạ SDLC ↔ Agile

SDLC truyền thống chạy tuần tự; ở đây mỗi pha được lặp lại trong từng sprint. Bảng dưới cho thấy pha nào "nặng" ở sprint nào.

| Pha SDLC | Sprint 0 | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 |
|---|---|---|---|---|---|
| Requirements | ●●● | ● | ● | ● | ○ |
| Design / Architecture | ●●● | ●● | ● | ● | ● |
| Implementation | ○ | ●●● | ●●● | ●●● | ●● |
| Testing | ● | ●● | ●● | ●●● | ●●● |
| Deployment | ●● | ●● | ● | ● | ●●● |
| Maintenance / Retro | ● | ● | ● | ● | ●● |

**Artifact bắt buộc của từng pha** (nộp kèm báo cáo):
- Requirements: User Story Map, Product Backlog, Non-Functional Requirements
- Design: Sơ đồ kiến trúc C4 (Context + Container), ERD, OpenAPI spec, State machine cảnh báo
- Implementation: Repo có CI xanh, coding convention, PR review log
- Testing: Test plan, bộ test AI có nhãn, báo cáo precision/recall, bug log
- Deployment: docker-compose + hướng dẫn cài, sơ đồ triển khai AWS, ước tính chi phí
- Retro: Biên bản 4 buổi retro + action item

---

## 3. Phạm vi — MoSCoW

### MUST (không có thì đồ án không đạt)
- Hạ tầng dev: mediamtx/ffmpeg giả lập RTSP, Frigate, MQTT, PostgreSQL, Docker Compose
- Orchestrator NestJS: nhận MQTT → quyết định → ghi DB → gửi thông báo
- **Module 1**: phát hiện người lạ (face recognition) + đăng ký khuôn mặt
- **Module 4**: vùng cấm (Frigate zone) — gần như miễn phí công sức
- **Module 5**: wellness check (scheduler thuần logic)
- Escalation engine nhiều cấp + xác nhận "Tôi ổn / Cần giúp đỡ"
- Dashboard Next.js: đăng nhập, danh sách sự kiện, ảnh/clip, xác nhận
- Triển khai AWS tối thiểu: S3 + Rekognition + Cognito

### SHOULD (mục tiêu thực tế nên đạt)
- **Module 2a**: phát hiện té ngã (MediaPipe Pose + logic bất động > X giây)
- **Module 3**: phát hiện cháy/khói (YOLO pretrained)
- Thông báo qua Amazon SNS (email/SMS)
- Amazon Connect: gọi tự động tới 1 số đã verify (demo)
- CloudWatch logs + alarm cơ bản

### COULD (làm nếu còn thời gian)
- **Module 2b**: đứng/ngồi bất thường 24/24 dựa trên track ID Frigate
- Gemini API sinh caption tường thuật sự kiện
- Rekognition Custom Labels cho cháy/khói (thay YOLO local)
- Biểu đồ thống kê trên dashboard

### WON'T (chốt loại khỏi 1 tháng — ghi vào phần "Hướng phát triển")
- **Module 2c**: nhận diện đánh nhau (cần train action recognition trên RWF-2000 — riêng việc này đã ≥ 2 tuần)
- Amazon Kinesis Video Streams (chi phí cao, và Frigate đã xử lý ở edge)
- Training model tùy chỉnh trên SageMaker
- Mobile app native (dùng responsive web thay thế)

> **Quy tắc kiểm soát phạm vi:** mọi yêu cầu mới phát sinh giữa sprint đi vào Product Backlog, **không** chèn vào Sprint Backlog đang chạy. Muốn thêm việc vào sprint thì phải bỏ ra một việc có điểm tương đương.

---

## 4. Tổ chức nhóm & vai trò

| Ký hiệu | Vai trò chính | Phụ trách kỹ thuật | Vai trò Scrum |
|---|---|---|---|
| **A** | Team Lead | Frontend Next.js (dashboard, luồng xác nhận) | Product Owner |
| **B** | Backend Lead | NestJS orchestrator, MQTT consumer, escalation state machine, PostgreSQL | Scrum Master |
| **C** | Infra/DevOps | Frigate, mediamtx, Docker Compose, CI/CD, migration AWS, quản lý chi phí | — |
| **D** | AI Engineer #1 | Module 1 (face/PPE), Module 3 (fire/smoke), service FastAPI | — |
| **E** | AI Engineer #2 | Module 2a (pose/fall), Module 2b, Module 5, bộ dữ liệu test & đo metrics | — |

**Lưu ý phân công:**
- PO và SM là hai người khác nhau — tránh việc một người vừa quyết phạm vi vừa bảo vệ nhóm.
- Mỗi người có **một backup**: A↔B (web), D↔E (AI), C↔B (hạ tầng). Bất kỳ task nào cũng phải có người thứ hai review PR.
- Không ai sở hữu độc quyền code: bắt buộc review chéo, cấm merge PR của chính mình.

**RACI cho quyết định lớn**

| Quyết định | A | B | C | D | E |
|---|---|---|---|---|---|
| Cắt/thêm phạm vi | **A** | C | C | C | C |
| Thiết kế kiến trúc | C | **A** | R | C | C |
| Chọn model AI | I | C | I | **A** | R |
| Chi tiêu AWS | R | I | **A** | I | I |

*(A = Accountable, R = Responsible, C = Consulted, I = Informed)*

---

## 5. Capacity & velocity

**Giả định:** mỗi sinh viên 15h/tuần → **75 giờ-người/tuần**. Trừ 20% buffer (học môn khác, deadline chồng chéo, ốm) → **60 giờ hiệu quả/tuần**.

Quy ước Story Point: **1 SP ≈ 2.5 giờ hiệu quả** → **velocity mục tiêu 24 SP/sprint**.

| Sprint | SP cam kết | Lý do điều chỉnh |
|---|---|---|
| Sprint 1 | 18 | Ramp-up, dựng môi trường, chưa quen tool |
| Sprint 2 | 24 | Chạy ổn định |
| Sprint 3 | 26 | Đỉnh năng suất |
| Sprint 4 | 20 | Dành 30% cho hardening, tài liệu, tập demo |

Sau Sprint 1, velocity thực tế thay thế con số giả định. Nếu Sprint 1 chỉ đạt < 12 SP → **cắt ngay Module 3 hoặc 2a** ở buổi retro, không chờ đến tuần 3.

---

## 6. Nhịp làm việc (Scrum ceremonies)

Sprint 1 tuần, bắt đầu **Thứ Hai**, kết thúc **Chủ Nhật**.

| Nghi thức | Thời điểm | Thời lượng | Ghi chú |
|---|---|---|---|
| Sprint Planning | Thứ Hai 20:00 | 60 phút | Chốt Sprint Goal + Sprint Backlog, ước lượng bằng Planning Poker |
| Daily Standup | Hằng ngày trước 21:00 | 10 phút hoặc async | Async qua Discord theo mẫu: *Hôm qua / Hôm nay / Vướng gì* |
| Backlog Refinement | Thứ Năm 20:30 | 45 phút | Làm mịn story cho sprint sau, đảm bảo DoR |
| Sprint Review (Demo) | Chủ Nhật 19:00 | 45 phút | Demo trên môi trường thật, mời giảng viên/bạn ngoài nhóm xem |
| Retrospective | Chủ Nhật 20:00 | 30 phút | Start/Stop/Continue + chốt ≤ 3 action item có người chịu trách nhiệm |

**Board:** GitHub Projects với cột `Backlog → Ready → In Progress → In Review → Testing → Done`. Giới hạn WIP: tối đa **2 task In Progress/người**.

---

## 7. Definition of Ready (DoR) & Definition of Done (DoD)

### DoR — story chỉ được đưa vào sprint khi:
- [ ] Viết theo mẫu *Là một <vai trò>, tôi muốn <hành động>, để <giá trị>*
- [ ] Có acceptance criteria dạng Given/When/Then
- [ ] Đã ước lượng SP và ≤ 8 SP (lớn hơn thì phải tách)
- [ ] Rõ phụ thuộc kỹ thuật (API nào, service nào phải xong trước)
- [ ] Với story AI: đã có sẵn dữ liệu test để đánh giá

### DoD — task chỉ được coi là Done khi:
- [ ] Code merge vào `main`, CI xanh (lint + unit test)
- [ ] Có unit test cho business logic mới; coverage core logic ≥ 60%
- [ ] Được ít nhất 1 người khác review và approve PR
- [ ] Chạy được bằng `docker compose up` trên máy người khác (không chỉ máy tác giả)
- [ ] Cập nhật README/API docs nếu có thay đổi interface
- [ ] Story AI: có số đo precision/recall trên tập test, ghi vào bảng theo dõi
- [ ] Đã demo được cho ít nhất 1 thành viên khác

---

## 8. Kế hoạch chi tiết theo Sprint

### SPRINT 0 — Khởi tạo (Ngày 1–3)

**Mục tiêu:** Hết ngày 3, mọi thành viên `git clone` + `docker compose up` là chạy được khung rỗng.

| # | Công việc | Người | SP |
|---|---|---|---|
| 0.1 | Chốt Vision, User Story Map, Product Backlog đầy đủ | A + cả nhóm | 3 |
| 0.2 | Sơ đồ kiến trúc C4 (Context, Container) + luồng dữ liệu | B | 3 |
| 0.3 | Thiết kế ERD: `users, devices, cameras, zones, known_faces, events, event_media, confirmations, notifications, escalation_rules` | B | 2 |
| 0.4 | OpenAPI spec cho API orchestrator (contract-first để FE/BE làm song song) | A, B | 2 |
| 0.5 | Khởi tạo monorepo + docker-compose skeleton + CI GitHub Actions (lint, test) | C | 3 |
| 0.6 | Dựng mediamtx + ffmpeg phát webcam thành luồng RTSP giả lập | C | 2 |
| 0.7 | **Thu thập bộ dữ liệu test** — việc nằm trên đường găng, phải bắt đầu ngay | E, D | 3 |
| 0.8 | Tạo AWS account, IAM user, bật Budget Alert $10, bật MFA | C | 1 |
| 0.9 | Chốt coding convention, quy trình Git, mẫu PR | B | 1 |

**Bộ dữ liệu test cần có (task 0.7)** — đây là thứ hay bị quên và làm hỏng tiến độ tuần 3:
- Té ngã: UR Fall Detection Dataset, Le2i Fall Detection (công khai)
- Cháy/khói: D-Fire dataset, FireNet — **tuyệt đối không tự tạo lửa để quay**
- Người lạ: nhóm tự quay, có người quen (đã enroll) và người lạ, ≥ 3 điều kiện ánh sáng
- Mỗi module ≥ 30 clip dương tính + ≥ 30 clip âm tính (để đo được báo động giả)

**Kết quả Sprint 0:** Frigate UI mở được, thấy luồng webcam giả lập RTSP, CI xanh.

---

### SPRINT 1 — Walking Skeleton (Ngày 4–10) · 18 SP

> **Sprint Goal:** Một người đi qua camera → sự kiện hiện lên dashboard trong vòng 5 giây, có ảnh snapshot.

Đây là sprint quan trọng nhất. Chưa có AI thông minh nào cả, nhưng **toàn bộ đường ống** phải thông. Mọi module sau chỉ là cắm thêm vào đường ống này.

| ID | User Story | Người | SP |
|---|---|---|---|
| US-01 | Là hệ thống, tôi nhận luồng RTSP và phát hiện "person" bằng Frigate | C | 3 |
| US-02 | Là hệ thống, tôi bắn sự kiện phát hiện lên MQTT topic | C | 1 |
| US-03 | Là orchestrator, tôi subscribe MQTT, parse payload và ghi vào bảng `events` | B | 3 |
| US-04 | Là hệ thống, tôi lưu snapshot/clip vào object storage (MinIO local, sau đổi S3) | B, C | 2 |
| US-05 | Là người dùng, tôi đăng nhập dashboard bằng email/mật khẩu (JWT, sau thay Cognito) | A | 3 |
| US-06 | Là người dùng, tôi xem danh sách sự kiện gần nhất kèm ảnh và thời gian | A | 3 |
| US-07 | Là dev, tôi có seed data + script reset môi trường | B | 1 |
| US-08 | Là dev, tôi có integration test: giả lập message MQTT → kiểm tra record trong DB | B, E | 2 |

**Rủi ro sprint này:** Frigate cấu hình detector (CPU / OpenVINO / TensorRT) tuỳ máy — C phải thử sớm ngày 4–5, không để đến cuối tuần.

**Demo Chủ Nhật:** Đi qua webcam → dashboard hiện sự kiện kèm ảnh.

---

### SPRINT 2 — Nhận diện người & cơ chế leo thang (Ngày 11–17) · 24 SP

> **Sprint Goal:** Người lạ bước vào vùng cấm → người thân nhận cảnh báo có nút xác nhận → không bấm sau N phút thì hệ thống leo thang.

| ID | User Story | Người | SP |
|---|---|---|---|
| US-09 | Là người dùng, tôi đăng ký khuôn mặt người quen qua dashboard (upload ảnh) | A, D | 3 |
| US-10 | Là hệ thống, tôi crop ảnh person từ Frigate và so khớp với danh sách đã đăng ký | D | 5 |
| US-11 | Là hệ thống, tôi gắn nhãn `KNOWN / UNKNOWN` kèm confidence score vào sự kiện | D, B | 2 |
| US-12 | Là người dùng, tôi vẽ/cấu hình vùng cấm cho từng camera (Frigate zone) | C | 3 |
| US-13 | Là hệ thống, tôi áp dụng **escalation state machine** theo loại sự kiện | B | 5 |
| US-14 | Là người thân, tôi nhận cảnh báo qua Telegram bot kèm ảnh và 2 nút xác nhận | B | 3 |
| US-15 | Là người dùng, tôi cấu hình ngưỡng confidence và thời gian chờ theo loại sự kiện | A, B | 3 |

**Escalation state machine (US-13)** — thiết kế chốt:

```
DETECTED
   │  (confidence < T_low)          → LOGGED_ONLY  (chỉ ghi log, không làm phiền)
   │  (T_low ≤ confidence < T_high) → NOTIFIED     (gửi app/Telegram)
   │  (confidence ≥ T_high)         → NOTIFIED + hẹn giờ ngắn
   ▼
NOTIFIED ──(user bấm "Tôi ổn")────────────────────► RESOLVED
   │      ──(user bấm "Cần giúp đỡ")──────────────► ESCALATED
   │      ──(hết timeout T_wait, không phản hồi)──► ESCALATED
   ▼
ESCALATED ── gọi điện tự động (Connect) / thông báo liên hệ dự phòng
   │
   ▼
CLOSED (có ghi nhận ai xử lý, lúc nào)
```

Tham số theo loại sự kiện (cấu hình được, không hard-code):

| Loại sự kiện | T_wait | Ưu tiên |
|---|---|---|
| Cháy / khói | 30 giây | P0 |
| Té ngã | 60 giây | P1 |
| Người lạ | 120 giây | P2 |
| Vùng cấm (trẻ em) | 60 giây | P1 |
| Wellness check thất bại | 300 giây | P2 |

**Demo:** Người lạ vào bếp → Telegram báo → không bấm gì → sau 2 phút trạng thái chuyển ESCALATED và log cuộc gọi giả lập.

---

### SPRINT 3 — Module AI nguy hiểm (Ngày 18–24) · 26 SP

> **Sprint Goal:** Hệ thống phát hiện được té ngã và cháy/khói từ video test, có số đo precision/recall công bố được.

| ID | User Story | Người | SP |
|---|---|---|---|
| US-16 | Là hệ thống, tôi chạy MediaPipe Pose trên chuỗi frame để phát hiện tư thế nằm bất thường | E | 5 |
| US-17 | Là hệ thống, tôi xác nhận té ngã chỉ khi tư thế bất thường kéo dài > X giây (chống báo giả) | E | 3 |
| US-18 | Là hệ thống, tôi phát hiện lửa/khói bằng YOLO pretrained trên frame Frigate | D | 5 |
| US-19 | Là hệ thống, tôi ưu tiên P0 cho cháy/khói với timeout rút ngắn | D, B | 2 |
| US-20 | Là hệ thống, tôi chạy wellness check định kỳ và cảnh báo nếu quá hạn không xác thực | E | 3 |
| US-21 | Là người dùng, tôi xem timeline sự kiện, lọc theo loại/camera/thời gian và xem lại clip | A | 5 |
| US-22 | Là nhóm, tôi có báo cáo đo precision/recall/FAR cho từng module trên tập test | E | 3 |

**Bảng đo bắt buộc (US-22)** — điền vào cuối Sprint 3 và Sprint 4:

| Module | TP | FP | FN | Precision | Recall | F1 | FAR (báo giả/giờ) |
|---|---|---|---|---|---|---|---|
| M1 Người lạ | | | | | | | |
| M2a Té ngã | | | | | | | |
| M3 Cháy/khói | | | | | | | |
| M4 Vùng cấm | | | | | | | |

Nếu FAR > 30% ở module nào → dành thời gian Sprint 4 để chỉnh ngưỡng, **không** thêm tính năng mới cho module đó.

**Demo:** Phát video té ngã → hệ thống cảnh báo sau X giây bất động. Phát video cháy → cảnh báo P0 ngay.

---

### SPRINT 4 — Lên AWS, hardening & bàn giao (Ngày 25–30) · 20 SP

> **Sprint Goal:** Hệ thống chạy trên AWS với ≥ 4 dịch vụ thật, tài liệu đầy đủ, demo cuối trơn tru.

| ID | Công việc | Người | SP |
|---|---|---|---|
| US-23 | Chuyển lưu trữ media từ MinIO sang **Amazon S3** (presigned URL, lifecycle 7 ngày) | C | 3 |
| US-24 | Thay face_recognition local bằng **Amazon Rekognition** (Face Collection + DetectProtectiveEquipment), bật/tắt bằng feature flag | D | 5 |
| US-25 | Thay JWT tự viết bằng **Amazon Cognito** User Pool | A | 3 |
| US-26 | Gửi cảnh báo qua **Amazon SNS** (email + SMS) | B | 2 |
| US-27 | **Amazon Connect**: gọi tự động tới 1 số đã verify khi ESCALATED (demo) | B, C | 3 |
| US-28 | Đẩy log ứng dụng lên **CloudWatch** + 1 alarm cơ bản | C | 2 |
| US-29 | Hardening: xử lý lỗi, retry, rate limit, tinh chỉnh ngưỡng giảm báo giả | Cả nhóm | 3 |
| US-30 | Tài liệu: README, sơ đồ triển khai, hướng dẫn cài đặt, ước tính chi phí AWS | A | 2 |
| US-31 | Quay video demo 5–7 phút + chuẩn bị kịch bản demo live | A, E | 2 |

**Feature flag (US-24) là bắt buộc**, không phải tuỳ chọn: nếu Rekognition gặp trục trặc (quota, region, credential) đúng hôm demo, nhóm bật lại model local trong 10 giây thay vì mất điểm.

**Lịch cứng cuối sprint:**
- **Ngày 28**: code freeze cho tính năng. Từ đây chỉ sửa bug.
- **Ngày 29**: UAT — 2 người ngoài nhóm dùng thử theo kịch bản, ghi nhận bug. Chạy thử demo đầy đủ 2 lần.
- **Ngày 30**: demo + nộp. **Không viết code.**

---

## 9. Kiến trúc triển khai (2 môi trường)

**Dev (local, dùng suốt Sprint 1–3):**
```
Webcam → ffmpeg → mediamtx (RTSP) → Frigate ─MQTT→ NestJS Orchestrator
                                         │              ├→ PostgreSQL
                                         │              ├→ MinIO (media)
                                         └→ AI services │
                                            (FastAPI)   └→ Telegram bot
                                                              ↑
                                                        Next.js Dashboard
```

**Cloud (Sprint 4):**
```
Frigate (edge/EC2) ─MQTT→ NestJS (EC2/ECS) ─┬→ Amazon RDS hoặc Postgres container
                                            ├→ Amazon S3          (media)
                                            ├→ Amazon Rekognition (M1)
                                            ├→ Amazon Cognito     (auth)
                                            ├→ Amazon SNS         (email/SMS)
                                            ├→ Amazon Connect     (gọi khẩn)
                                            └→ Amazon CloudWatch  (log/alarm)
```

**Nguyên tắc chống khoá cứng:** mọi dịch vụ AWS được bọc sau một interface trong NestJS (`IStorageService`, `IFaceService`, `INotificationService`). Đổi provider = đổi 1 dòng config, không sửa business logic. Điều này cũng giúp test được bằng mock.

---

## 10. Chiến lược kiểm thử

| Loại test | Công cụ | Ai làm | Khi nào |
|---|---|---|---|
| Unit test (logic nghiệp vụ, state machine) | Jest (NestJS), pytest (AI service) | Người viết code | Mỗi PR |
| Integration test (MQTT → DB → S3) | Jest + testcontainers | B | Mỗi sprint |
| E2E dashboard | Playwright (3 kịch bản chính) | A | Sprint 3–4 |
| Đánh giá mô hình AI | Script Python trên tập test có nhãn | E | Cuối Sprint 3, 4 |
| Kiểm thử phi chức năng | Đo latency E2E, tải 3 camera đồng thời | C | Sprint 4 |
| UAT | 2 người ngoài nhóm theo kịch bản | A | Ngày 29 |

**Ba kịch bản E2E bắt buộc pass trước demo:**
1. Người lạ vào nhà → cảnh báo → bấm "Tôi ổn" → sự kiện RESOLVED
2. Video té ngã → cảnh báo → không phản hồi → ESCALATED → gọi điện
3. Video cháy → cảnh báo P0 trong < 30 giây → gọi điện

---

## 11. Quản lý rủi ro

| # | Rủi ro | Xác suất | Tác động | Cách xử lý |
|---|---|---|---|---|
| R1 | Ôm quá nhiều module, tuần 4 chưa có gì chạy trọn vẹn | Cao | Nghiêm trọng | Walking skeleton ở Sprint 1; MoSCoW đã cắt M2c; quy tắc "thêm việc phải bỏ việc" |
| R2 | Chi phí AWS vượt tầm sinh viên | Trung bình | Cao | Budget Alert $10; **bỏ Kinesis Video Streams** (đắt nhất); S3 lifecycle 7 ngày; tắt tài nguyên sau giờ làm; dùng free tier |
| R3 | Không có dữ liệu test cho ngã/cháy | Cao | Cao | Dùng dataset công khai (UR Fall, Le2i, D-Fire); thu thập từ Sprint 0 |
| R4 | Máy không đủ mạnh chạy Frigate + model | Trung bình | Trung bình | Detector CPU/OpenVINO; giảm xuống 5 fps; chỉ 1 camera khi dev |
| R5 | Báo động giả quá nhiều | Cao | Trung bình | Xác nhận đa khung hình; ngưỡng confidence nhiều mức; đo FAR từ Sprint 3 để còn kịp chỉnh |
| R6 | Thành viên bận thi/deadline môn khác | Cao | Trung bình | Buffer 20% capacity; mỗi task có người backup; cấm bus factor = 1 |
| R7 | Rekognition/Connect trục trặc đúng hôm demo | Trung bình | Cao | Feature flag về model local; **quay sẵn video demo dự phòng** |
| R8 | Tích hợp muộn, mọi thứ vỡ ở tuần cuối | Trung bình | Nghiêm trọng | Tích hợp liên tục từ Sprint 1; không ai làm module rời rạc quá 3 ngày mà chưa merge |

---

## 12. Chỉ số theo dõi

**Chỉ số quy trình (báo cáo cuối mỗi sprint):**
- Velocity thực tế vs cam kết
- Burndown chart
- Tỉ lệ đạt Sprint Goal (mục tiêu: 4/4)
- Lead time từ mở PR đến merge (mục tiêu < 24 giờ)
- Số bug lọt sang sprint sau

**Chỉ số sản phẩm:**
- Latency E2E từ sự kiện đến thông báo (mục tiêu < 10s)
- Precision / Recall / F1 từng module
- FAR — số báo động giả mỗi giờ
- Tỉ lệ sự kiện được xác nhận trước khi leo thang

---

## 13. Vấn đề đạo đức & pháp lý (cần có 1 mục trong báo cáo)

Hệ thống giám sát bằng camera + nhận diện khuôn mặt đụng đến dữ liệu cá nhân. Nhóm nên chuẩn bị sẵn, vì hội đồng rất hay hỏi:

- **Phạm vi giám sát**: chỉ trong nhà riêng, có sự đồng ý của người sống trong nhà; không hướng camera ra không gian công cộng
- **Dữ liệu sinh trắc học**: chỉ lưu face embedding (vector), không lưu ảnh gốc dài hạn; cho phép xoá hoàn toàn
- **Vòng đời dữ liệu**: media tự xoá sau 7 ngày (S3 lifecycle), trừ sự kiện được đánh dấu giữ lại
- **Đối chiếu Nghị định 13/2023/NĐ-CP** về bảo vệ dữ liệu cá nhân — nêu được các nguyên tắc áp dụng
- **Giới hạn của hệ thống**: nêu rõ đây là công cụ hỗ trợ, không thay thế thiết bị y tế hay dịch vụ cứu hộ; báo động giả và bỏ sót đều có thể xảy ra

---

## 14. Danh sách kiểm tra bàn giao

- [ ] Repo public/private có README chạy được từ đầu
- [ ] `docker compose up` khởi động toàn hệ thống trên máy sạch
- [ ] Sơ đồ kiến trúc C4 + ERD + state machine
- [ ] OpenAPI spec
- [ ] Báo cáo test: unit coverage, kết quả E2E, bảng precision/recall/FAR
- [ ] Sơ đồ triển khai AWS + bảng ước tính chi phí hàng tháng
- [ ] 4 biên bản retro + action item
- [ ] Burndown/velocity chart 4 sprint
- [ ] Video demo 5–7 phút + video dự phòng
- [ ] Slide báo cáo
- [ ] Mục "Hướng phát triển": Module 2c (RWF-2000), Kinesis Video Streams, SageMaker custom model, mobile app

---

## Phụ lục A — Mẫu user story

```
US-XX: [Tiêu đề ngắn]

Là <vai trò>, tôi muốn <hành động>, để <giá trị nhận được>.

Acceptance Criteria:
  Given  <bối cảnh>
  When   <hành động>
  Then   <kết quả mong đợi>

Ước lượng: X SP        Người làm: Y        Phụ thuộc: US-ZZ
```

**Ví dụ điền đầy đủ (US-17):**

```
US-17: Xác nhận té ngã bằng ngưỡng thời gian bất động

Là người thân, tôi muốn hệ thống chỉ báo té ngã khi người đó thật sự
nằm bất động một lúc, để tôi không bị làm phiền mỗi lần ai đó cúi xuống
nhặt đồ.

Acceptance Criteria:
  Given  camera phát hiện tư thế nằm/ngã bất thường
  When   tư thế đó duy trì liên tục quá 15 giây và không có chuyển động
         đáng kể giữa các khung hình
  Then   hệ thống tạo sự kiện FALL_DETECTED với priority P1

  Given  camera phát hiện tư thế nằm/ngã bất thường
  When   người đó đứng dậy trong vòng 15 giây
  Then   hệ thống KHÔNG tạo cảnh báo, chỉ ghi log nội bộ

Ước lượng: 3 SP        Người làm: E        Phụ thuộc: US-16
```

---

## Phụ lục B — Lịch tổng quan

| Tuần | Ngày | Sprint | Cột mốc |
|---|---|---|---|
| — | 1–3 | Sprint 0 | Môi trường chạy, backlog chốt, dataset bắt đầu thu thập |
| 1 | 4–10 | Sprint 1 | **M1: Luồng E2E thông** |
| 2 | 11–17 | Sprint 2 | **M2: Nhận diện người lạ + escalation hoạt động** |
| 3 | 18–24 | Sprint 3 | **M3: Té ngã + cháy/khói có số đo** |
| 4 | 25–28 | Sprint 4 | **M4: Chạy trên AWS** — code freeze ngày 28 |
| 4 | 29 | — | UAT + tổng duyệt demo |
| 4 | 30 | — | **Demo & nộp bài** |
