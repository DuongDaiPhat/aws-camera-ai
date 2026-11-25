# CƠ SỞ TOÁN HỌC, PHƯƠNG PHÁP TÍNH TOÁN VÀ CHỨNG MINH ĐỘ TIN CẬY CÁC NGƯỠNG PHÁT HIỆN TÉ NGÃ (MODULE M2a)

> **Dự án:** Hệ thống camera giám sát thông minh ứng dụng AI và AWS (ARGUS-AI)  
> **Tài liệu liên quan:** [BAO_CAO_AI_TE_NGA_GIUA_KY.md](./BAO_CAO_AI_TE_NGA_GIUA_KY.md)  
> **Mã nguồn đối chiếu:**
>
> - `services/ai-service/app/services/pose_geometry.py`
> - `services/ai-service/app/services/fall_tracker.py`
> - `services/ai-service/app/config.py`
> - `.env` (cấu hình thực nghiệm hiện trường)

---

## MỤC LỤC

1. [Tổng quan bài toán chứng minh ngưỡng](#1-tổng-quan-bài-toán-chứng-minh-ngưỡng)
2. [Bảng tổng hợp toàn bộ ngưỡng trong hệ thống](#2-bảng-tổng-hợp-toàn-bộ-ngưỡng-trong-hệ-thống)
3. [Giải thích chi tiết các công thức tính toán & Cơ sở chọn ngưỡng](#3-giải-thích-chi-tiết-các-công-thức-tính-toán--cơ-sở-chọn-ngưỡng)
4. [Phân tích chênh lệch giữa cấu hình mặc định và thực tế triển khai](#4-phân-tích-chênh-lệch-giữa-cấu-hình-mặc-định-và-thực-tế-triển-khai)
5. [Phương pháp & Thực nghiệm chứng minh độ tin cậy cho báo cáo cuối kỳ](#5-phương-pháp--thực-nghiệm-chứng-minh-độ-tin-cậy-cho-báo-cáo-cuối-kỳ)
6. [Biểu mẫu bảng số liệu cần hoàn thiện trước bảo vệ cuối kỳ](#6-biểu-mẫu-bảng-số-liệu-cần-hoàn-thiện-trước-bảo-vệ-cuối-kỳ)

---

## 1. Tổng quan bài toán chứng minh ngưỡng

Hệ thống sử dụng mô hình **MediaPipe Pose Landmarker Lite** của Google để trích xuất **33 điểm mốc cơ thể 3D** $(x, y, z, \text{visibility})$, sau đó đưa qua **thuật toán động học hình học kết hợp Máy trạng thái hữu hạn (Kinematic FSM)** để phát hiện té ngã qua 2 pha:

- **Pha 1 — `CANDIDATE` (US-16):** Phát hiện khoảnh khắc chuyển tư thế ngã đột ngột (ưu tiên **Recall cao**, không bỏ sót ca ngã).
- **Pha 2 — `CONFIRMED` (US-17):** Theo dõi bất động liên tục sau ngã để xác nhận cảnh báo khẩn cấp P1 (ưu tiên **Precision cao**, triệt tiêu báo giả).

Để bảo vệ đồ án cuối kỳ trước hội đồng, mỗi con số ngưỡng đều cần được chứng minh dựa trên **3 trụ cột**:

1. **Cơ sở hình học / vật lý (First Principles):** Công thức tính ra sao, đại lượng vật lý mang ý nghĩa gì, có bất biến với khoảng cách camera và độ phân giải ảnh không.
2. **Thực nghiệm định lượng trên tập dữ liệu lớn (Grid Search / Sensitivity Analysis & Ablation Study):** Tại sao chọn ngưỡng $X$ mà không phải $X - \Delta$ hay $X + \Delta$ (thể hiện qua Precision, Recall, F1, FPR và đường cong ROC/PR).
3. **Đo đạc nhiễu thực tế tại hiện trường (Field Calibration):** Chứng minh ngưỡng chịu được sai số (jitter) của MediaPipe Lite trên camera thật ở 5 FPS.

---

## 2. Bảng tổng hợp toàn bộ ngưỡng trong hệ thống

### 2.1. Nhóm ngưỡng trích xuất Pose & Bộ đệm lịch sử

| Tham số                    | Giá trị trong `config.py` | Giá trị trong `.env` |  Đơn vị  | Vai trò                                                                       |
| :------------------------- | :-----------------------: | :------------------: | :------: | :---------------------------------------------------------------------------- |
| `POSE_SAMPLE_FPS`          |             —             |         `5`          |   FPS    | Tần suất lấy mẫu frame gửi từ Frigate sang AI Service ($200\text{ ms/frame}$) |
| `POSE_MIN_VISIBILITY`      |  `0.30` (cap $\le 0.30$)  |        `0.30`        | $[0, 1]$ | Độ tin cậy tối thiểu để chấp nhận một landmark hợp lệ                         |
| `POSE_MIN_ASSOCIATION_IOU` |          `0.30`           |        `0.30`        | $[0, 1]$ | Ngưỡng IoU tối thiểu để ghép pose với bounding box của Frigate                |
| `POSE_ROI_PADDING_RATIO`   |          `0.10`           |        `0.20`        |  Tỷ lệ   | Mở rộng vùng crop quanh bbox người để không cắt mất đầu/tay khi ngã           |
| `FALL_HISTORY_FRAME_COUNT` |           `10`            |         `5`          |  frame   | Số frame hợp lệ tối thiểu trong bộ đệm trước khi bắt đầu xét ngã              |
| `FALL_HISTORY_MAX_SECONDS` |           `3.0`           |        `4.0`         |   giây   | Cửa sổ thời gian tối đa của bộ đệm lịch sử làm baseline                       |

### 2.2. Nhóm ngưỡng Pha 1 — Phát hiện khoảnh khắc ngã (`MONITORING` $\rightarrow$ `CANDIDATE`)

| Tham số                          | Giá trị trong `config.py` | Giá trị trong `.env` |    Đơn vị     | Điều kiện kích hoạt                                               |
| :------------------------------- | :-----------------------: | :------------------: | :-----------: | :---------------------------------------------------------------- |
| `FALL_TORSO_ANGLE_THRESHOLD_DEG` |          `30.0`           |         `30`         | độ ($^\circ$) | $\min(\theta_{2D}, \theta_{3D}) < 30^\circ$                       |
| `FALL_CENTER_DROP_RATIO`         |          `0.20`           |        `0.20`        |     Tỷ lệ     | $\text{centerDropRatio} \ge 0.20$                                 |
| `FALL_TORSO_SHRINK_RATIO`        |          `0.55`           |        `0.55`        |     Tỷ lệ     | $\text{torso\_shrink\_ratio} < 0.55$ (thân co ngắn $> 45\%$)      |
| `FALL_ASPECT_RATIO_THRESHOLD`    |          `0.90`           |        `0.90`        |     $H/W$     | $\text{aspect\_ratio} = H_{\text{bbox}} / W_{\text{bbox}} < 0.90$ |

### 2.3. Nhóm ngưỡng Pha 2 — Xác nhận bất động & Hủy (`CANDIDATE` $\rightarrow$ `CONFIRMED` / `CANCELLED`)

| Tham số                            | Giá trị trong `config.py` | Giá trị trong `.env` |    Đơn vị     | Vai trò                                                                                |
| :--------------------------------- | :-----------------------: | :------------------: | :-----------: | :------------------------------------------------------------------------------------- |
| `FALL_IMMOBILITY_SECONDS`          |           `3.0`           |         `15`         |     giây      | Thời gian bất động liên tục tối thiểu để xác nhận `CONFIRMED`                          |
| `FALL_MOTION_SPEED_THRESHOLD`      |          `0.05`           |        `0.20`        | body-height/s | Tốc độ chuyển động dưới ngưỡng này được coi là "bất động"                              |
| `FALL_RECOVERY_ANGLE_DEG`          |          `60.0`           |         `60`         | độ ($^\circ$) | Góc thân $\ge 60^\circ$ $\rightarrow$ người đã đứng dậy (`RECOVERED`)                  |
| `FALL_MAX_VALID_FRAME_GAP_SECONDS` |          `0.60`           |        `5.00`        |     giây      | Khoảng trống tối đa giữa 2 frame hợp lệ trước khi reset bộ đếm bất động                |
| `FALL_MISSING_POSE_GRACE_SECONDS`  |           `5.0`           |         `10`         |     giây      | Thời gian mất pose liên tục tối đa trong `CANDIDATE` trước khi hủy (`MISSING_TIMEOUT`) |
| `FALL_CANDIDATE_MAX_SECONDS`       |          `60.0`           |         `60`         |     giây      | Thời gian tối đa giữ trạng thái `CANDIDATE` nếu không xác nhận được                    |

---

## 3. Giải thích chi tiết các công thức tính toán & Cơ sở chọn ngưỡng

Tất cả phép tính hình học trong `pose_geometry.py` đều quy đổi tọa độ chuẩn hóa $(x, y) \in [0, 1]$ về **hệ tọa độ pixel ảnh gốc $(W, H)$** để tránh biến dạng tỷ lệ khung hình (ví dụ ảnh $1920 \times 1080$ có $W \neq H$).

Các khớp cốt lõi được dùng:

- Vai trái (`11`), Vai phải (`12`) $\rightarrow$ trung điểm vai $S = (S_x, S_y)$
- Hông trái (`23`), Hông phải (`24`) $\rightarrow$ trung điểm hông $H = (H_x, H_y)$
- _(Nếu 1 bên bị che khuất khi nằm nghiêng, `pose_geometry.py` tự động fallback sang bên còn lại đạt `visibility >= POSE_MIN_VISIBILITY`)_

### 3.1. Góc nghiêng thân 2D ($\theta_{2D}$) và 3D ($\theta_{3D}$)

**Công thức trong code (`pose_geometry.py`):**
$$\vec{v} = (v_x, v_y) = (S_x - H_x,\; S_y - H_y)$$
$$\theta_{2D} = \text{degrees}\big(\operatorname{atan2}(|v_y|, |v_x|)\big) \in [0^\circ, 90^\circ]$$

Để xử lý **ngã dọc theo trục camera** (vai vẫn nằm phía trên hông trên ảnh 2D), hệ thống bổ sung tọa độ chiều sâu $z$ (MediaPipe chuẩn hóa $z$ theo tỷ lệ chiều rộng ảnh $W$):
$$v_z = |z_S - z_H| \cdot W$$
$$v_{\text{horiz\_3d}} = \sqrt{|v_x|^2 + v_z^2}$$
$$\theta_{3D} = \text{degrees}\big(\operatorname{atan2}(|v_y|, \max(1.0,\; v_{\text{horiz\_3d}}))\big)$$

Trục góc hiệu dụng dùng để đánh giá là:
$$\theta_{\text{eff}} = \min(\theta_{2D}, \theta_{3D})$$

**Cơ sở chọn ngưỡng `< 30°` (ngã) và `>= 60°` (hồi phục):**

- **Tư thế đứng / đi bộ:** Thân người gần thẳng đứng, $\theta \in [75^\circ, 90^\circ]$.
- **Tư thế ngồi hơi ngả lưng hoặc cúi nhẹ:** $\theta \in [40^\circ, 75^\circ]$.
- **Tư thế nằm trên sàn:** Thân người gần song song mặt phẳng ngang, lý thuyết $\theta \in [0^\circ, 20^\circ]$, cộng thêm góc phối cảnh camera lắp trên cao nhìn xuống ($15^\circ - 25^\circ$) nên góc đo thực tế nằm trong khoảng $[0^\circ, 30^\circ]$.
- **Vùng trễ (Hysteresis band) $[30^\circ, 60^\circ]$:** Đặt ngưỡng ngã $< 30^\circ$ và ngưỡng đứng dậy $\ge 60^\circ$ tạo ra vùng đệm rộng $30^\circ$, ngăn hiện tượng nhiễu góc quanh mốc $30^\circ$ làm hủy nhầm `CANDIDATE`.

---

### 3.2. Tỷ lệ hạ trọng tâm (`centerDropRatio >= 0.20`)

**Công thức trong code (`pose_geometry.py` & `fall_tracker.py`):**
Trọng tâm thân người tại mỗi frame là trung điểm đoạn nối vai và hông:
$$C_y = \frac{S_y + H_y}{2}$$

So sánh $C_y$ hiện tại với **trung vị (median)** của cửa sổ lịch sử $N$ frame trước đó (trong vòng `FALL_HISTORY_MAX_SECONDS`), chuẩn hóa theo **trung vị chiều cao bounding box** của người đó khi chưa ngã ($\text{scale}_{\text{prev}}$):
$$\text{centerDropRatio} = \frac{C_{y,\text{now}} - \operatorname{median}(C_{y,\text{history}})}{\max(10.0,\; \operatorname{median}(H_{\text{bbox,history}}))}$$

_(Do trục $Y$ của ảnh hướng từ trên xuống dưới, khi người ngã xuống sàn, $C_{y,\text{now}}$ tăng $\Rightarrow \text{centerDropRatio} > 0$.)_

**Cơ sở chọn `median` và ngưỡng `>= 0.20`:**

- **Tại sao dùng `median` thay vì `mean`:** Trong $5 - 10$ frame lịch sử có thể có $1 - 2$ frame bounding box bị nhảy hoặc khớp bị giật. Trung vị miễn nhiễm với ngoại lai (outlier-robust).
- **Tại sao chia cho $\text{scale}_{\text{prev}}$:** Giúp đại lượng trở nên **vô hướng (dimensionless)** và **bất biến theo khoảng cách camera** (dù người đứng cách camera $2\text{ m}$ với bbox cao $400\text{ px}$ hay $6\text{ m}$ với bbox cao $150\text{ px}$).
- **Ý nghĩa con số `0.20`:** Khi đứng thẳng, trọng tâm $C_y$ nằm ở khoảng $0.35 H_{\text{bbox}}$ tính từ đỉnh đầu; khi nằm bệt trên sàn, trọng tâm hạ xuống gần chân, mức dịch chuyển dọc trục $Y$ thường đạt $0.35 - 0.60$ lần chiều cao cơ thể. Chọn ngưỡng $\ge 0.20$ (tức hạ ít nhất $20\%$ chiều cao cơ thể trong cửa sổ $4\text{ giây}$) đủ để loại bỏ việc nằm sẵn từ trước hoặc rung nhẹ đầu gối, đồng thời vẫn bắt được cả trường hợp ngã từ tư thế ngồi ghế thấp.

---

### 3.3. Nhận diện ngã dọc trục camera (`torso_shrink_ratio < 0.55` và `aspect_ratio < 0.90`)

Khi người ngã thẳng về phía camera, $\theta_{2D}$ có thể vẫn $> 60^\circ$. Do đó trong `fall_tracker.py` có **Điều kiện B (`AXIAL_FALL_CANDIDATE`)**:
$$\big(\text{torso\_shrink\_ratio} < 0.55 \;\;\lor\;\; \text{aspect\_ratio} < 0.90\big) \;\;\land\;\; \text{centerDropRatio} \ge 0.20$$

Trong đó:
$$\text{torso\_len} = \sqrt{(S_x - H_x)^2 + (S_y - H_y)^2}$$
$$\text{torso\_shrink\_ratio} = \frac{\text{torso\_len}_{\text{now}}}{\max(10.0,\; \operatorname{median}(\text{torso\_len}_{\text{history}}))}$$
$$\text{aspect\_ratio} = \frac{H_{\text{bbox}}}{W_{\text{bbox}}}$$

**Cơ sở chọn ngưỡng `0.55` và `0.90`:**

- **Phép chiếu phối cảnh (`0.55`):** Nếu coi thân người là đoạn thẳng dài $L$ nghiêng góc $\alpha$ so với mặt phẳng ảnh, độ dài hình chiếu là $L \cos\alpha$. Khi thân co ngắn còn $< 55\%$ ($\cos\alpha < 0.55 \Rightarrow \alpha > 56.6^\circ$ ngả dọc theo trục nhìn), người đó chắc chắn đang nằm/gập dọc về phía camera.
- **Tỷ lệ khung bao (`0.90`):** Người đứng bình thường luôn có $H_{\text{bbox}} > W_{\text{bbox}}$ (thường $\text{aspect\_ratio} \in [1.8, 3.5]$). Khi ngã nằm ngang hoặc bẹp xuống sàn, chiều rộng vượt chiều cao nên $H_{\text{bbox}} / W_{\text{bbox}} < 0.90$.

---

### 3.4. Chỉ số chuyển động chuẩn hóa (`motionScore < 0.20`)

**Công thức trong code (`pose_geometry.py`):**
Tính khoảng cách dịch chuyển Euclid tính theo pixel giữa 2 frame liên tiếp trên **10 cặp khớp chính** (`KEY_LANDMARK_PAIRS`: vai, khuỷu tay, hông, đầu gối, mắt cá hai bên). Yêu cầu có ít nhất **6/10 cặp khớp** đạt `visibility >= POSE_MIN_VISIBILITY`:
$$d_k = \sqrt{\big((x_k^{(t)} - x_k^{(t-1)}) W\big)^2 + \big((y_k^{(t)} - y_k^{(t-1)}) H\big)^2}$$
$$\text{motionScore} = \frac{\operatorname{median}(d_k)}{\text{baseline\_scale\_px} \cdot \Delta t}$$

**Ý nghĩa vật lý:**

- Đơn vị của $\text{motionScore}$ là **tỷ lệ chiều cao cơ thể mỗi giây (body-heights / second)**.
- Ví dụ với người cao $1.7\text{ m}$ (tương ứng $\text{baseline\_scale\_px}$):
  - $\text{motionScore} = 0.05 \approx 8.5\text{ cm/giây}$ (rất khắt khe, dễ bị nhiễu jitter của landmark phá vỡ).
  - $\text{motionScore} = 0.20 \approx 34\text{ cm/giây}$ (cho phép nhiễu rung lắc nhỏ của MediaPipe Lite trên khớp khi người nằm yên, nhưng vẫn bắt được ngay khi người cử động tay chân hoặc đứng dậy).

---

### 3.5. Thời gian bất động (`FALL_IMMOBILITY_SECONDS`) & Thời gian dung sai mất pose (`FALL_MISSING_POSE_GRACE_SECONDS`)

- **`FALL_IMMOBILITY_SECONDS = 15s` (trên thực tế) vs `3s` (mặc định unit test):**
  - Hành vi sinh hoạt bình thường (cúi nhặt đồ, buộc dây giày, ngồi xổm) thường kết thúc hoặc có chuyển động đáng kể trong vòng $1 - 5\text{ giây}$.
  - Đặt ngưỡng $15\text{ giây}$ giúp loại bỏ gần như $100\%$ báo động giả khi cúi người lâu, đồng thời vẫn kịp kích hoạt cảnh báo P1 khẩn cấp trong ngưỡng vàng y tế.
- **`FALL_MISSING_POSE_GRACE_SECONDS = 10s`:**
  - Khi người ngã sát mép tường hoặc bị bàn ghế che tạm thời trong vài giây, track được giữ lại tối đa $10\text{ giây}$ trước khi hủy (`MISSING_TIMEOUT`).
- **Quy tắc quan trọng hiện tại trong `fall_tracker.py` (dòng 216):**
  - Bất kỳ 1 frame nào mất pose (`pose=False`) đều reset `immobile_seconds = 0.0`. Điều này giúp chống xác nhận nhầm trên dữ liệu mù, nhưng đòi hỏi tỷ lệ bắt pose liên tục tại hiện trường phải đủ ổn định (xem mục 4 & 5 bên dưới).

---

## 4. Phân tích chênh lệch giữa cấu hình mặc định và thực tế triển khai

Khi kiểm tra giữa `config.py` và `.env`, cần giải thích rõ cho hội đồng lý do điều chỉnh các thông số trong `.env`:

1. **`FALL_MOTION_SPEED_THRESHOLD`: `0.05` (`config.py`) $\rightarrow$ `0.20` (`.env`)**
   - _Nguyên nhân:_ Qua quan sát log thực nghiệm trực tiếp với `pose_landmarker_lite.task` ở 5 FPS, khi người nằm bất động hoàn toàn trên sàn, tọa độ khớp dự đoán bởi MediaPipe Lite vẫn dao động tự nhiên (landmark jitter) tạo ra `motionScore` phổ biến trong khoảng $0.05 - 0.15$. Ngưỡng `0.05` làm bộ đếm bất động liên tục bị reset về $0$. Nâng lên `0.20` khắc phục nhiễu jitter này.
2. **`FALL_IMMOBILITY_SECONDS`: `3.0s` (`config.py`) $\rightarrow$ `15s` (`.env`)**
   - _Nguyên nhân:_ `3.0s` phù hợp cho kịch bản kiểm thử nhanh (demo/unit test), còn `15s` phù hợp vận hành thực tế để tránh báo giả khi người dùng cúi xuống lau sàn hoặc tìm đồ trong vài giây.
3. **`FALL_MAX_VALID_FRAME_GAP_SECONDS`: `0.60s` (`config.py`) $\rightarrow$ `5.00s` (`.env`)**
   - _Nguyên nhân:_ `0.60s` chỉ cho phép trễ tối đa 3 frame ở 5 FPS; trong môi trường thực tế qua MQTT + CPU inference, đôi khi có độ trễ mạng/hàng đợi $> 0.6\text{s}$ nên cần nới lên `5.00s` để không ngắt quãng tính `motionScore`.

---

## 5. Phương pháp & Thực nghiệm chứng minh độ tin cậy cho báo cáo cuối kỳ

Để chứng minh các con số trên **không phải đoán mò (arbitrary magic numbers)** mà có cơ sở khoa học, trên nhánh `test/us-17-fall-threshold-validation`, bạn nên thực hiện **4 thực nghiệm** sau:

### Thực nghiệm 1: Quét lưới tham số (Grid Search / Sensitivity Analysis) trên tập 500 video

- **Cách làm:** Viết script Python import trực tiếp `calculate_pose_geometry` và `FallTracker` (hoặc chạy trên cache landmarks đã trích xuất sẵn từ 500 video `Test_Dataset_70_30` + 103 video `Le2i` để chạy nhanh trong vài phút).
- **Thay đổi từng ngưỡng quanh giá trị chọn** (giữ nguyên các ngưỡng khác):
  - `FALL_TORSO_ANGLE_THRESHOLD_DEG` $\in \{20^\circ, 25^\circ, \mathbf{30^\circ}, 35^\circ, 40^\circ\}$
  - `FALL_CENTER_DROP_RATIO` $\in \{0.10, 0.15, \mathbf{0.20}, 0.25, 0.30\}$
  - `FALL_TORSO_SHRINK_RATIO` $\in \{0.45, 0.50, \mathbf{0.55}, 0.60, 0.65\}$
  - `FALL_ASPECT_RATIO_THRESHOLD` $\in \{0.75, 0.85, \mathbf{0.90}, 1.00, 1.10\}$
- **Đầu ra cần vẽ:** Biểu đồ **Precision – Recall – F1 theo từng giá trị ngưỡng**, chỉ rõ điểm giao tối ưu (ví dụ: tại $\theta = 30^\circ$ đạt F1 cao nhất $87.92\%$; nếu hạ xuống $20^\circ$ thì Recall tụt mạnh, nếu tăng lên $40^\circ$ thì False Positive tăng vọt do cúi người).

### Thực nghiệm 2: Thử nghiệm loại bỏ thành phần (Ablation Study)

So sánh trên cùng tập dữ liệu với **3 phiên bản thuật toán**:

1. **Baseline (Chỉ 2D Angle + Drop):** Chỉ dùng $\theta_{2D} < 30^\circ$ và `drop >= 0.20`.
2. **+ 3D Angle & Foreshortening (Pha 1 Candidate):** Bổ sung $\theta_{3D} < 30^\circ$, `shrink < 0.55`, `aspect < 0.90`.
3. **+ Immobility FSM (Full Pipeline US-16 + US-17):** Kết hợp thêm kiểm tra bất động (`motionScore < 0.20`, `immobile > T`).

- **Mục tiêu chứng minh:** Tầng 3D/Foreshortening cứu được các ca ngã dọc (tăng Recall), còn tầng FSM triệt tiêu các ca cúi nhặt đồ (tăng Precision và giảm False Positive Rate xuống gần $0\%$).

### Thực nghiệm 3: Đo phân phối `motionScore` & độ ổn định khớp ở hiện trường (Jitter Profiling)

- **Cách làm:** Ghi lại log hoặc chạy script trên 5–10 video quay trực tiếp từ camera phòng khách/làm việc ở 2 trạng thái:
  1. _Nằm bất động hoàn toàn trên sàn_ (đo phân vị p50, p95, p99 của `motionScore` và tỷ lệ frame bị `NO_POSE`/`AMBIGUOUS_POSE`).
  2. _Cử động nhẹ / lăn người / ngồi dậy_ (đo `motionScore`).
- **Mục tiêu chứng minh:**
  - Nếu p95 của `motionScore` khi nằm yên là ~`0.15 - 0.18` (như log thực tế từng ghi nhận `0.12 - 0.2043`), điều đó **chứng minh bằng số liệu thực** tại sao ngưỡng `0.05` bị reset liên tục và tại sao `0.20` (hoặc `0.22 - 0.25` nếu cần an toàn hơn) là ngưỡng phân tách hợp lý giữa _nhiễu khớp_ và _cử động thật_.

### Thực nghiệm 4: Khoảng tin cậy thống kê (95% Confidence Interval bằng Bootstrap)

- **Cách làm:** Dùng kỹ thuật **Bootstrap Resampling ($n = 1000$ lần lấy mẫu có hoàn lại)** trên kết quả dự đoán của 500 video để tính **khoảng tin cậy $95\%$ (95% CI)** cho `Precision`, `Recall`, `F1-Score`.
- **Ý nghĩa:** Thay vì chỉ báo cáo một con số đơn lẻ (`F1 = 87.92%`), bạn báo cáo `F1 = 87.92% (95% CI: 84.8% – 90.8%)` — chuẩn mực khoa học rất thuyết phục trước hội đồng.

---

## 6. Kết quả thực nghiệm đã kiểm chứng (Số liệu thực tế trên 603 video)

### 6.1. Độ tin cậy thống kê (Bootstrap 95% CI, $n = 1000$)

| Tập dữ liệu                                   |        Giai đoạn đánh giá         |      Precision (95% CI)      |       Recall (95% CI)        |      F1-Score (95% CI)       |
| :-------------------------------------------- | :-------------------------------: | :--------------------------: | :--------------------------: | :--------------------------: |
| **Le2i (`Dataset_Classified`, 103 clip)**     |            `CANDIDATE`            | **82.05%** (74.03% – 90.41%) | **88.89%** (80.77% – 95.89%) | **85.33%** (78.87% – 91.03%) |
| **Le2i (`Dataset_Classified`, 103 clip)**     | `CONFIRMED` (`3s`, `motion=0.20`) | **100.0%** (100.0% – 100.0%) | **25.0%** (15.19% – 34.67%)  | **40.0%** (26.37% – 51.49%)  |
| **Test 500 (`Test_Dataset_70_30`, 500 clip)** |            `CANDIDATE`            | **96.31%** (93.98% – 98.33%) | **82.00%** (77.81% – 85.76%) | **88.58%** (85.85% – 91.05%) |

### 6.2. Kết quả Ablation Study (Chứng minh đóng góp từng tầng thuật toán)

| Tập dữ liệu    | Cấu hình thuật toán                          | TP  | FP  | FN  | TN  | Precision (%) | Recall (%) | F1-Score (%) |
| :------------- | :------------------------------------------- | :-: | :-: | :-: | :-: | :-----------: | :--------: | :----------: |
| **Le2i (103)** | 1. Chỉ 2D Angle (`< 30° & drop >= 0.20`)     | 48  |  0  | 24  | 31  |     100.0     |   66.67    |  **80.00**   |
| **Le2i (103)** | 2. + 3D Angle & Foreshortening (`CANDIDATE`) | 64  | 14  |  8  | 17  |     82.05     | **88.89**  |  **85.33**   |
| **Le2i (103)** | 3. Full Pipeline (`+ Immobility FSM 3.0s`)   | 18  |  0  | 54  | 31  |   **100.0**   |   25.00    |  **40.00**   |
| **Test 500**   | 1. Chỉ 2D Angle (`< 30° & drop >= 0.20`)     | 233 |  4  | 117 | 146 |     98.31     |   66.57    |  **79.39**   |
| **Test 500**   | 2. + 3D Angle & Foreshortening (`CANDIDATE`) | 287 | 11  | 63  | 139 |     96.31     | **82.00**  |  **88.58**   |

> **Kết luận Ablation:** Tầng 3D Angle & Foreshortening giúp tăng mạnh Recall thêm **+22.22%** trên Le2i (từ $66.67\% \rightarrow 88.89\%$) và **+15.43%** trên tập 500 video (từ $66.57\% \rightarrow 82.00\%$). Khi qua tầng `Immobility FSM 3.0s` trên Le2i, toàn bộ $14$ ca báo nhầm ở `CANDIDATE` bị loại bỏ hoàn toàn (`FP = 0`, Precision = $100\%$).

### 6.3. Kết quả Sensitivity Analysis (Quét lưới từng ngưỡng trên tập 500 video)

#### A. `FALL_TORSO_ANGLE_THRESHOLD_DEG` (`CANDIDATE`, tập 500 video)

|  Ngưỡng góc ($\theta$)   |   TP    |   FP   |   FN   |   TN    | Precision (%) | Recall (%) | F1-Score (%) | Ghi chú                                   |
| :----------------------: | :-----: | :----: | :----: | :-----: | :-----------: | :--------: | :----------: | :---------------------------------------- |
|        $20^\circ$        |   287   |   10   |   63   |   140   |     96.63     |   82.00    |  **88.72**   | Chặt hơn $1$ FP                           |
|        $25^\circ$        |   287   |   11   |   63   |   139   |     96.31     |   82.00    |  **88.58**   |                                           |
| **$30^\circ$ (Đã chọn)** | **287** | **11** | **63** | **139** |   **96.31**   | **82.00**  |  **88.58**   | **Ổn định, dung sai góc camera trên cao** |
|        $35^\circ$        |   287   |   11   |   63   |   139   |     96.31     |   82.00    |  **88.58**   | Bão hòa                                   |
|        $40^\circ$        |   287   |   12   |   63   |   138   |     95.99     |   82.00    |  **88.44**   | Báo giả tăng                              |

#### B. `FALL_CENTER_DROP_RATIO` (`CANDIDATE`, tập 500 video)

|    Ngưỡng `drop`     |   TP    |   FP   |   FN   |   TN    | Precision (%) | Recall (%) | F1-Score (%) | Ghi chú                              |
| :------------------: | :-----: | :----: | :----: | :-----: | :-----------: | :--------: | :----------: | :----------------------------------- |
|        `0.10`        |   298   |   21   |   52   |   129   |     93.42     |   85.14    |  **89.09**   | Báo giả tăng gấp đôi (`FP = 21`)     |
|        `0.15`        |   292   |   16   |   58   |   134   |     94.81     |   83.43    |  **88.75**   | `FP = 16`                            |
| **`0.20` (Đã chọn)** | **287** | **11** | **63** | **139** |   **96.31**   | **82.00**  |  **88.58**   | **Điểm cân bằng tối ưu (`FP = 11`)** |
|        `0.25`        |   274   |   8    |   76   |   142   |     97.16     |   78.29    |  **86.71**   | Recall giảm mạnh                     |
|        `0.30`        |   257   |   8    |   93   |   142   |     96.98     |   73.43    |  **83.58**   | Bỏ sót nhiều ca ngã                  |

#### C. `FALL_TORSO_SHRINK_RATIO` & `FALL_ASPECT_RATIO_THRESHOLD` (`CANDIDATE`, tập 500 video)

- `FALL_TORSO_SHRINK_RATIO = 0.55`: Đạt TP = 287, FP = 11, Precision = **96.31%**, Recall = **82.00%**, F1 = **88.58%** (ổn định trong dải `0.45 – 0.55`).
- `FALL_ASPECT_RATIO_THRESHOLD = 0.90`: Đạt TP = 287, FP = 11, Precision = **96.31%**, Recall = **82.00%**, F1 = **88.58%** (tăng lên `1.00 – 1.10` làm FP tăng từ 11 lên 12).

#### D. `FALL_MOTION_SPEED_THRESHOLD` (Đánh giá tại `CONFIRMED 3.0s` trên Le2i 103 video)

|   Ngưỡng `motion`    |   TP   |  FP   |   FN   |   TN   | Precision (%) | Recall (%) | F1-Score (%) | Ghi chú                                |
| :------------------: | :----: | :---: | :----: | :----: | :-----------: | :--------: | :----------: | :------------------------------------- |
| `0.05` (`config.py`) |   5    |   0   |   67   |   31   |     100.0     |    6.94    |  **12.99**   | Quá nhạy với jitter của MediaPipe Lite |
|        `0.10`        |   13   |   0   |   59   |   31   |     100.0     |   18.06    |  **30.59**   |                                        |
|        `0.15`        |   15   |   0   |   57   |   31   |     100.0     |   20.83    |  **34.48**   |                                        |
| **`0.20` (`.env`)**  | **18** | **0** | **54** | **31** |   **100.0**   | **25.00**  |  **40.00**   | **Tăng 3.6x Recall mà vẫn giữ FP = 0** |
|        `0.25`        |   20   |   0   |   52   |   31   |     100.0     |   27.78    |  **43.48**   |                                        |
|        `0.30`        |   21   |   0   |   51   |   31   |     100.0     |   29.17    |  **45.16**   |                                        |

### 6.4. Kết quả thực nghiệm ngưỡng hồi phục `FALL_RECOVERY_ANGLE_DEG` (Multiple Cameras Fall Dataset — 192 clip)

Thực nghiệm trên bộ **Multiple Cameras Fall Dataset** (24 kịch bản × 8 góc camera = 192 video `.avi`, trong đó nhiều kịch bản có chuỗi _ngã $\rightarrow$ tự đứng dậy_):

| `FALL_RECOVERY_ANGLE_DEG` | Vào `CANDIDATE` | Hủy (`RECOVERED`) | Tỷ lệ hồi phục (%) | Vào `CONFIRMED` | Trung vị thời gian đứng dậy (s) | Góc thân TB lúc hủy ($^\circ$) | Nhận xét                                                                |
| :-----------------------: | :-------------: | :---------------: | :----------------: | :-------------: | :-----------------------------: | :----------------------------: | :---------------------------------------------------------------------- |
|          `40.0°`          |       149       |        120        |     **80.54%**     |        1        |               1.1               |             53.20              | Hủy quá sớm khi mới chống tay/ngẩng đầu                                 |
|          `45.0°`          |       149       |        113        |     **75.84%**     |        1        |               1.2               |             57.14              | Góc TB $< 60^\circ$, chưa đứng thẳng hẳn                                |
|          `50.0°`          |       149       |        105        |     **70.47%**     |        1        |               1.2               |             60.18              |                                                                         |
|          `55.0°`          |       149       |        89         |     **59.73%**     |        1        |               1.4               |             64.78              |                                                                         |
|   **`60.0°` (Đã chọn)**   |     **149**     |      **68**       |     **45.64%**     |      **1**      |             **1.7**             |           **69.47**            | **Đứng/ngồi thẳng an toàn ($\approx 69.5^\circ$), vùng đệm $30^\circ$** |
|          `65.0°`          |       149       |        55         |     **36.91%**     |        1        |               1.8               |             73.68              |                                                                         |
|          `70.0°`          |       149       |        45         |     **30.20%**     |        1        |               2.2               |             77.29              | Bỏ sót nhiều ca đã đứng dậy hơi khom                                    |
|          `75.0°`          |       149       |        35         |     **23.49%**     |        1        |               2.6               |             80.46              | Quá khắt khe, giữ `CANDIDATE` quá lâu                                   |

> **Kết luận cho `FALL_RECOVERY_ANGLE_DEG = 60°`:**
>
> - Nếu đặt thấp (`40° – 45°`), hệ thống hủy `CANDIDATE` chỉ sau `1.1 – 1.2s` khi góc thân trung bình mới đạt `53° – 57°` (người mới chỉ chống tay hoặc gượng dậy một nửa — dễ bỏ sót nếu nạn nhân ngã gục lại).
> - Nếu đặt quá cao (`70° – 75°`), tỷ lệ nhận diện tự đứng dậy giảm sâu xuống `23% – 30%` vì người cao tuổi đứng dậy thường hơi khom lưng (`60° – 70°`).
> - Tại **`60.0°`**, góc thân trung bình lúc hủy đạt **`69.47°`** (tư thế ngồi thẳng/đứng an toàn), thời gian phản hồi trung vị chỉ **`1.7s`**, đồng thời giữ được vùng đệm trễ $30^\circ$ so với ngưỡng ngã (`30°`).

### 6.5. Phân phối nhiễu chuyển động (`motionScore`) khi nằm bất động vs cử động thật (Thực nghiệm hiện trường)

| Kịch bản thực tế               | Số frame | `motionScore` p50 | `motionScore` p95 | `motionScore` max | Tỷ lệ mất pose (%) |
| :----------------------------- | :------: | :---------------: | :---------------: | :---------------: | :----------------: |
| Nằm yên trên sàn (camera thật) |   ...    |        ...        |        ...        |        ...        |        ...         |
| Cúi nhặt đồ / đứng dậy         |   ...    |        ...        |        ...        |        ...        |        ...         |
| Vẫy tay / lăn người trên sàn   |   ...    |        ...        |        ...        |        ...        |        ...         |

---

## 7. Tài liệu tham khảo khoa học (Cơ sở cho ngưỡng Pha 2 — `CONFIRMED`)

Do các bộ dữ liệu benchmark chuẩn (như Le2i) thường cắt clip ngay sau khi người ngã chạm sàn mà không kéo dài đoạn nằm yên $15\text{ giây}$, các ngưỡng xác nhận bất động (`FALL_IMMOBILITY_SECONDS`, `FALL_MOTION_SPEED_THRESHOLD`) được luận giải dựa trên các công trình nghiên cứu và tiêu chuẩn y khoa sau:

1. **Cơ sở cho cửa sổ xác nhận bất động sau ngã (`3s` – `15s`):**
   - **ElderFallGuard (2025):** _"ElderFallGuard: Real-Time IoT and Computer Vision-Based Fall Detection System for Elderly Safety"_, arXiv:2505.11845 (05/2025). Hệ thống sử dụng **MediaPipe** trích xuất pose thời gian thực và quy định chỉ xác nhận ngã để gửi cảnh báo **Telegram kèm ảnh snapshot** khi tư thế nằm được duy trì **$> 3\text{ giây}$** kết hợp sụt giảm chuyển động **$> 2\text{ giây}$** — khớp trực tiếp với giá trị mặc định `FALL_IMMOBILITY_SECONDS = 3.0s` trong `config.py`.
   - **Charfi et al. (2013):** _"Optimised spatio-temporal descriptors for real-time fall detection: comparison of support vector machine and Adaboost-based classification"_, _Journal of Electronic Imaging_ (tác giả bộ dữ liệu **Le2i**). Công trình chỉ ra việc theo dõi trạng thái **bất động / không hoạt động (inactivity/immobility)** sau chuyển tiếp tư thế đột ngột là yếu tố then chốt để phân biệt té ngã thật với các hoạt động sinh hoạt (ADLs) như ngồi xuống hoặc cúi nhặt đồ.
2. **Cơ sở y khoa cho giới hạn trên (`15s` thay vì đợi quá lâu):**
   - **Định nghĩa y khoa "Long Lie" (PubMed / NIH):** Trong lão khoa, tình trạng người cao tuổi ngã và nằm bất động kéo dài trên sàn (**"long lie"**, định nghĩa lâm sàng $\ge 1\text{ giờ}$, và các nghiên cứu tiền viện đánh giá nguy cơ từ mốc $\ge 15\text{ phút}$) dẫn đến các biến chứng nghiêm trọng như tiêu cơ vân (rhabdomyolysis), tổn thương thận cấp (AKI), mất nước và hạ thân nhiệt. Do đó, ngưỡng `15 giây` trong cấu hình triển khai thực tế (`.env`) vừa đủ dài để loại bỏ hoàn toàn các hành vi cúi/ngồi tạm thời ($1 - 5\text{ giây}$), vừa kích hoạt cảnh báo khẩn cấp P1 đủ sớm để tránh nguy cơ "long lie".
3. **Cơ sở cho ngưỡng góc thân & tỷ lệ khung bao (`< 30°`, `aspect_ratio < 0.90`):**
   - Các nghiên cứu dùng **MediaPipe Pose** kết hợp đặc trưng hình học đều sử dụng góc trục thân (vai–hông) và tỷ lệ khung bao ($H/W < 1.0$) làm đặc trưng nhận diện tư thế nằm, kết hợp bộ lọc thời gian (temporal state machine) để giảm thiểu báo động giả.
