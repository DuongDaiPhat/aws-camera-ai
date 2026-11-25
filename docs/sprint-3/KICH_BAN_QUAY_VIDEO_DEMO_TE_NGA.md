# KỊCH BẢN QUAY VIDEO DEMO TOÀN DIỆN: PHÁT HIỆN TÉ NGÃ (MODULE M2a)

> **Mục đích:** Bộ Test Case đầy đủ để quay video demo phục vụ bảo vệ đồ án cuối kỳ, bao phủ mọi góc độ té ngã, cơ chế tự hồi phục, chống báo giả và luồng cảnh báo End-to-End (Camera $\rightarrow$ AI $\rightarrow$ Web Dashboard $\rightarrow$ Telegram).  
> **Cấu hình áp dụng:** Theo `.env` Production (`FALL_TORSO_ANGLE_THRESHOLD_DEG=30`, `FALL_CENTER_DROP_RATIO=0.20`, `FALL_IMMOBILITY_SECONDS=15`, `FALL_MOTION_SPEED_THRESHOLD=0.20`, `FALL_RECOVERY_ANGLE_DEG=60`, `FALL_MISSING_POSE_GRACE_SECONDS=10`).

---

## 0. Checklist chuẩn bị trước khi bấm máy quay

1. **Kiểm tra tài khoản nhận Telegram:** Đảm bảo user `CAREGIVER` (hoặc user nhận cảnh báo theo rule) đã liên kết Telegram thành công (`telegram_linked_at IS NOT NULL`) để không bị lỗi `TELEGRAM_LINK_NOT_VERIFIED`.
2. **Kiểm tra vùng `REST_AREA`:** Vẽ sẵn polygon cho **Sofa / Giường ngủ** trên Web Dashboard (phục vụ `TC-10`), và đảm bảo sàn nhà nơi quay té ngã nằm **ngoài** vùng `REST_AREA`.
3. **Mẹo diễn xuất để quay 1 lần đạt ngay:**
   - Khi diễn **ngã thật**, sau khi chạm sàn hãy nằm **yên hoàn toàn từ 18–20 giây** (dư ra 3–5 giây so với ngưỡng `15s` để bù độ trễ frame).
   - Hạn chế ngã vào góc bị bàn/ghế che kín người quá `10 giây` (trừ `TC-09` cố tình test che khuất).
   - **Ghi hình:** Quay song song **màn hình Web Dashboard** (thấy Live Camera + Banner/Chuông cảnh báo P1) và **màn hình điện thoại/Desktop Telegram** để ghép Picture-in-Picture khi dựng video.

---

## 1. Nhóm 1 — Té ngã thật ở các góc độ khác nhau (True Positive $\rightarrow$ `CONFIRMED` + Telegram P1)

| Mã TC     | Tên kịch bản & Góc độ                                                      | Cách thực hiện khi quay                                                                                 | Thông số kỹ thuật được kiểm chứng                                                                                                  | Kết quả mong đợi                                                                                                                                                |
| :-------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-01** | **Ngã ngang vuông góc camera** (ngã sang trái hoặc phải)                   | Đứng giữa khung hình, đi bộ chậm rồi ngã nằm ngang song song với mặt sàn, nằm yên $18\text{s}$.         | $\theta_{2D} < 30^\circ$, `centerDropRatio >= 0.20`, `aspect_ratio < 0.90`.                                                        | Vào `CANDIDATE` ngay lúc chạm sàn $\rightarrow$ sau `15s` chuyển `CONFIRMED` $\rightarrow$ Web hú còi P1 + Telegram gửi ảnh snapshot.                           |
| **TC-02** | **Ngã dọc hướng ĐẦU về phía camera** (Axial Fall Forward)                  | Đứng đối diện camera, ngã sấp/ngồi bệt chúi thẳng đầu về phía ống kính, nằm yên $18\text{s}$.           | Dù $\theta_{2D}$ vẫn cao ($\sim 70^\circ - 85^\circ$), thuật toán bắt qua $\theta_{3D} < 30^\circ$ và `torso_shrink_ratio < 0.55`. | Kích hoạt `AXIAL_FALL_CANDIDATE` $\rightarrow$ sau `15s` chuyển `CONFIRMED` + gửi Telegram. _(Điểm nhấn kỹ thuật quan trọng nhất để trình bày trước hội đồng!)_ |
| **TC-03** | **Ngã dọc hướng CHÂN về phía camera** (Axial Fall Backward)                | Đứng quay mặt hoặc quay lưng, ngã ngửa ra sau dọc theo trục nhìn camera, nằm yên $18\text{s}$.          | Tương tự TC-02 ($\theta_{3D} < 30^\circ$, co ngắn thân phối cảnh).                                                                 | Bắt được `CANDIDATE` $\rightarrow$ sau `15s` `CONFIRMED` + gửi Telegram.                                                                                        |
| **TC-04** | **Ngã chéo góc $45^\circ$ & nằm nghiêng 1 bên** (Che khuất một nửa cơ thể) | Đi chéo $45^\circ$ so với camera rồi ngã nằm nghiêng (1 bên vai/hông áp sát sàn bị che khuất).          | Cơ chế **Occlusion Fallback** trong `pose_geometry.py` (chỉ cần thấy rõ cặp vai–hông bên phía trên).                               | Vẫn trích xuất được góc thân $\rightarrow$ `CANDIDATE` $\rightarrow$ `CONFIRMED` sau `15s`.                                                                     |
| **TC-05** | **Ngã trượt từ tư thế ngồi ghế thấp**                                      | Ngồi trên ghế vài giây (để ổn định baseline), sau đó trượt người ngã xuống sàn và nằm yên $18\text{s}$. | `centerDropRatio >= 0.20` vẫn đạt ngay cả khi xuất phát từ tư thế ngồi.                                                            | Vào `CANDIDATE` $\rightarrow$ `CONFIRMED` sau `15s` + gửi Telegram.                                                                                             |
| **TC-06** | **Ngã ở khoảng cách xa camera (~4–6m) hoặc gần mép khung hình**            | Đứng lùi ra xa camera (người nhỏ trên khung hình) rồi ngã nằm yên $18\text{s}$.                         | Tính bất biến tỷ lệ của `centerDropRatio` và `motionScore` (chia cho `scale_prev`), cùng `POSE_ROI_PADDING_RATIO=0.20`.            | Vẫn phát hiện chính xác, không bị phụ thuộc khoảng cách gần/xa.                                                                                                 |

---

## 2. Nhóm 2 — Các trạng thái chuyển tiếp, tự hồi phục & ngoại lệ (FSM Transitions)

| Mã TC     | Tên kịch bản                                                          | Cách thực hiện khi quay                                                                                          | Cơ chế hệ thống được kiểm chứng                                              | Kết quả mong đợi                                                                                                 |
| :-------- | :-------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **TC-07** | **Ngã rồi tự đứng dậy ngay** (`CANDIDATE` $\rightarrow$ `RECOVERED`)  | Ngã xuống sàn nằm $4 - 5\text{ giây}$, sau đó tự chống tay đứng dậy thẳng người ($\ge 60^\circ$).                | `FALL_RECOVERY_ANGLE_DEG = 60°` hủy trạng thái nghi vấn trước khi hết `15s`. | Log ghi nhận `CANDIDATE` $\rightarrow$ `CANCELLED (RECOVERED)`. **KHÔNG** báo còi, **KHÔNG** gửi Telegram.       |
| **TC-08** | **Ngã xuống nhưng cựa quậy / bò liên tục** (`motionScore` reset)      | Ngã xuống sàn, cứ mỗi $5 - 7\text{ giây}$ lại lăn người hoặc vung tay mạnh, sau đó mới nằm yên hẳn $18\text{s}$. | `motionScore >= 0.20` làm reset bộ đếm `immobile_seconds` về `0s`.           | Trong lúc còn cựa quậy: giữ `CANDIDATE`, **chưa** báo động. Chỉ `CONFIRMED` sau khi nằm yên hẳn đủ $15\text{s}$. |
| **TC-09** | **Ngã vào góc khuất mất tầm nhìn $> 10\text{s}$** (`MISSING_TIMEOUT`) | Ngã xuống ngay trước gầm bàn/ghế rồi lăn khuất hẳn vào sau vật cản $> 12\text{ giây}$.                           | `FALL_MISSING_POSE_GRACE_SECONDS = 10s` ngăn xác nhận mù khi mất pose lâu.   | Vào `CANDIDATE` lúc ngã, sau `10s` mất pose chuyển `CANCELLED (MISSING_TIMEOUT)`, không báo giả.                 |

---

## 3. Nhóm 3 — Chống báo động giả trong sinh hoạt thường ngày (True Negative — Zero False Alarm)

| Mã TC     | Tên kịch bản                                               | Cách thực hiện khi quay                                                                                         | Cơ chế bảo vệ được kiểm chứng                                                  | Kết quả mong đợi                                                                                               |
| :-------- | :--------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| **TC-10** | **Nằm ngủ / ngả lưng trên Sofa hoặc Giường (`REST_AREA`)** | Đi tới sofa/giường đã cấu hình vùng `REST_AREA`, nằm xuống ngủ hoặc xem điện thoại $20\text{s}$.                | Kiểm tra polygon `REST_AREA` ở Orchestrator & `fall_tracker.py`.               | Trạng thái trả về `REST_AREA`, **không** vào `CANDIDATE`, **0 cảnh báo**.                                      |
| **TC-11** | **Cúi người nhặt đồ / buộc dây giày rồi đứng dậy**         | Đang đi bộ, cúi gập người xuống sàn nhặt đồ trong $2 - 3\text{ giây}$ rồi đứng thẳng lên đi tiếp.               | Có thể chớp vào `CANDIDATE`, nhưng bộ đếm `15s` + `RECOVERED >= 60°` chặn lại. | **KHÔNG** phát còi, **KHÔNG** gửi Telegram.                                                                    |
| **TC-12** | **Ngồi xuống sàn / tập thể dục nhẹ (Squat, ngồi thiền)**   | Ngồi bệt xuống sàn hoặc tập squat $15 - 20\text{s}$ (thân giữ thẳng $\ge 45^\circ - 80^\circ$ hoặc có cử động). | Góc thân không $< 30^\circ$ hoặc có chuyển động liên tục.                      | Giữ `MONITORING`, **0 cảnh báo**.                                                                              |
| **TC-13** | **Nhiều người trong khung hình (Multi-person Tracking)**   | Người A đứng đi lại bình thường trong phòng; Người B ngã nằm yên $18\text{s}$ trên sàn.                         | Tracking theo từng `track_id` độc lập + ghép pose theo `IoU >= 0.30`.          | Chỉ track của Người B vào `CANDIDATE` $\rightarrow$ `CONFIRMED` đúng sau `15s`; không bị Người A làm hủy nhầm. |

---

## 4. Nhóm 4 — Luồng xử lý sự cố End-to-End (Web Dashboard + Telegram Bot)

| Mã TC     | Tên kịch bản                                                     | Cách thực hiện khi quay                                                                                                                 | Kết quả mong đợi                                                                                                                                                 |
| :-------- | :--------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-14** | **Xác nhận an toàn ("Tôi ổn") qua Telegram**                     | Tiếp nối `TC-01`: ngay khi Telegram nhận ảnh cảnh báo té ngã, bấm nút **`[✅ Tôi ổn]`**.                                                | - Tin nhắn Telegram tự cập nhật thành _"Đã xác nhận: Tôi ổn"_.<br>- Trên Web Dashboard (qua SSE): sự kiện chuyển sang xanh (`RESOLVED`), chuông báo động tự tắt. |
| **TC-15** | **Xác nhận khẩn cấp ("Cần giúp đỡ") hoặc Quá hạn (`ESCALATED`)** | Kích hoạt 1 ca té ngã `CONFIRMED`, bấm **`[🆘 Cần giúp đỡ]`** (hoặc chờ hết thời gian đếm ngược `t_wait_seconds = 60s` không phản hồi). | - Sự kiện chuyển trạng thái **`ESCALATED`**.<br>- Web Dashboard hiển thị cảnh báo leo thang khẩn cấp.<br>- Hệ thống kích hoạt luồng liên hệ khẩn cấp tiếp theo.  |

---

## 5. Gợi ý ghép thành Video Demo hoàn chỉnh cho buổi bảo vệ (3–4 phút)

Để hội đồng xem mượt mà, không bị nhàm chán khi phải đợi $15\text{s}$ nằm yên ở mọi clip, bạn nên dựng video theo **4 chương** (có thể tua nhanh `x3` đoạn đếm `15s` ở các góc phụ, giữ nguyên tốc độ `1x` ở **TC-01** và **TC-02**):

1. **Chương 1 (45s) — Bắt ngã đa góc độ:** `TC-01` (ngã ngang) + `TC-02` (ngã dọc thẳng camera — nhấn mạnh 3D Angle & Foreshortening) + `TC-04` (ngã nghiêng bị che khuất).
2. **Chương 2 (45s) — Chống báo động giả (Zero False Alarm):** `TC-10` (nằm sofa `REST_AREA`) + `TC-11` (cúi nhặt đồ đứng dậy) + `TC-07` (ngã nhẹ tự đứng dậy $\rightarrow$ `RECOVERED`).
3. **Chương 3 (30s) — Xử lý tình huống phức tạp:** `TC-13` (2 người trong khung hình, vẫn bắt đúng người ngã).
4. **Chương 4 (45s) — Chuỗi cứu hộ End-to-End:** Hiện màn hình Web Dashboard + Telegram cùng lúc khi `TC-01` chuyển `CONFIRMED` $\rightarrow$ nhận ảnh snapshot trên Telegram $\rightarrow$ bấm **`[✅ Tôi ổn]`** (`TC-14`) tắt còi trên Web, và minh họa nhanh **`[🆘 Cần giúp đỡ]`** (`TC-15`).
