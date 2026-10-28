# TÀI LIỆU CHI TIẾT CÁC THAY ĐỔI THUẬT TOÁN & THÔNG SỐ PHÁT HIỆN TÉ NGÃ (FALL DETECTION)

> **Phạm vi:** Sprint 3 (US-16, US-17, FR-DET-M2-01, FR-DET-M2-02)  
> **Cập nhật ngày:** 28/10/2026  
> **Dựa trên:** 5 commit gần nhất (`e0768a4`, `62be604`, `c0bccd8`, `36f6970`, `8e9a636`) và bản vá tích hợp góc hiệu quả 3D.

---

## 1. Tổng quan mục đích điều chỉnh

Trong quá trình thử nghiệm thực tế tính năng phát hiện té ngã (MediaPipe Pose + Bounding Box Tracking từ Frigate) qua webcam máy tính và camera giám sát, hệ thống ban đầu bộc lộ các vấn đề vật lý và hạ tầng:
1. **Góc máy ảnh hạn chế (Perspective Distortion):** Khi ngã dọc trục camera (người nằm hướng đầu/chân về phía camera), góc thân 2D phẳng không thể hiện tư thế nằm ngang, khiến thuật toán cũ bỏ sót 100% các ca ngã dọc.
2. **Khung hình sàn nhà bị che khuất (Occlusion):** Khi nằm trên sàn, các khớp vai/hông ở phía giáp sàn hoặc bị tay chân che khuất khiến điều kiện khớp ngặt nghèo (4/4 khớp) làm đứt chuỗi pose.
3. **Môi trường webcam cận cảnh có độ nhiễu cao:** Cử động hô hấp nhẹ và rung vi sai webcam khiến ngưỡng phát hiện chuyển động quá khắt khe bị kích hoạt sai (reset chuỗi đếm bất động liên tục).
4. **Hạ tầng WebRTC gián đoạn:** Kênh UDP trên WSL2/Windows bị NAT timeout làm ngắt luồng camera sau 20–40 giây.
5. **Xung đột hợp đồng bằng chứng giữa AI Service và Orchestrator:** Góc 2D không phản ánh đúng tư thế 3D dẫn đến Orchestrator từ chối bằng chứng ngã dọc.

Dưới đây là chi tiết thay đổi theo từng commit và từng cấu phần thuật toán.

---

## 2. Chi tiết thay đổi qua 5 Commit gần nhất

```mermaid
gitgraph
   commit id: "e0768a4" msg: "feat: Hỗ trợ té dọc (3D Torso Angle & Foreshortening)"
   commit id: "62be604" msg: "feat: Nới lỏng ràng buộc khớp vai/hông bị che khuất"
   commit id: "c0bccd8" msg: "fix: Tối ưu MediaPipe confidence & ROI padding"
   commit id: "36f6970" msg: "chore: Điều chỉnh bộ thông số thời gian & độ nhạy"
   commit id: "8e9a636" msg: "fix: WebRTC TCP MediaMTX & đồng bộ Compose"
```

---

### Commit 1: `e0768a4` — Hỗ trợ phát hiện té dọc camera (Axial Fall Detection)
* **File thay đổi:** 
  * [`services/ai-service/app/services/pose_geometry.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/services/pose_geometry.py)
  * [`services/ai-service/app/services/fall_tracker.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/services/fall_tracker.py)
  * [`services/ai-service/app/config.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/config.py)
* **Vấn đề thực tế:**
  * Thuật toán cũ chỉ dựa trên góc phẳng 2D: $\text{torsoAngleDeg} = \arctan2(|v_y|, |v_x|) < 30^\circ$.
  * Khi nạn nhân **ngã dọc theo trục ống kính camera** (đầu hướng về camera hoặc ngược lại), hình chiếu 2D của vai vẫn nằm phía trên hông ($v_x \approx 0, v_y > 0$), góc 2D đo được lên tới $75^\circ - 87^\circ$. Hệ thống hoàn toàn không thể đưa vào Candidate.
* **Thay đổi thuật toán:**
  1. **Tính toán góc thân trong không gian 3D (`torso_angle_3d_deg`):**
     * Trích xuất tọa độ trục sâu $z$ từ MediaPipe Pose World Landmarks giữa vai và hông:
       $$v_{\text{horiz\_3d}} = \sqrt{(v_x \cdot W)^2 + (|z_{\text{shoulder}} - z_{\text{hip}}| \cdot W)^2}$$
       $$\theta_{3D} = \arctan2(|v_y \cdot H|, \max(1.0, v_{\text{horiz\_3d}}))$$
     * Khi ngã dọc, độ chênh lệch trục $z$ lớn kéo $\theta_{3D}$ xuống dưới $30^\circ$ (thực tế đo được $3.2^\circ$).
  2. **Nhận diện hiện tượng co ngắn thân người do phối cảnh (Torso Foreshortening):**
     * Theo dõi độ dài thân $\text{torso\_length\_px} = \text{hypot}(S_x - H_x, S_y - H_y)$.
     * So sánh với độ dài thân chuẩn (trung vị các frame đứng thẳng trước đó):
       $$\text{torso\_shrink\_ratio} = \frac{\text{torso\_length\_px}}{\text{baseline\_torso\_length\_px}}$$
     * Bổ sung quy tắc vào Candidate: nếu thân co ngắn $> 45\%$ (`torso_shrink_ratio < 0.55`) kết hợp trọng tâm rơi (`drop >= 0.20`), hệ thống kích hoạt trạng thái `AXIAL_FALL_CANDIDATE`.

---

### Commit 2: `62be604` — Nới lỏng yêu cầu khớp sống còn khi nằm trên sàn
* **File thay đổi:** 
  * [`services/ai-service/app/services/pose_geometry.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/services/pose_geometry.py)
  * [`services/ai-service/tests/test_pose_geometry.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/tests/test_pose_geometry.py)
* **Vấn đề thực tế:**
  * Thuật toán gốc yêu cầu bắt buộc cả 4 điểm: Vai trái (11), Vai phải (12), Hông trái (23), Hông phải (24) đều phải có `visibility >= min_visibility`.
  * Trong thực tế khi té ngã (nằm nghiêng 1 bên hoặc nằm sấp), mặt sàn luôn che khuất ít nhất một bên vai hoặc hông. Yêu cầu 4/4 khớp khiến MediaPipe liên tục trả về `None` $\rightarrow$ rớt vào `NO_POSE` / `LOW_VISIBILITY`, làm đứt quãng chuỗi theo dõi bất động.
* **Thay đổi thuật toán:**
  * Chấp nhận các cấu hình khớp bất đối xứng hoặc dạng tam giác:
    1. Cặp song song một bên: (Vai trái + Hông trái) **HOẶC** (Vai phải + Hông phải).
    2. Cấu hình tam giác: (2 vai + 1 hông bất kỳ) **HOẶC** (2 hông + 1 vai bất kỳ).
  * Thuật toán tự động fallback trung điểm thân: Nếu một bên bị che khuất, sử dụng trực tiếp tọa độ của bên nhìn rõ thay vì bắt buộc tính trung bình 2 bên.

---

### Commit 3: `c0bccd8` — Tối ưu hóa MediaPipe Pose & Bộ đệm Candidate
* **File thay đổi:** 
  * [`services/ai-service/app/services/pose_estimator.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/services/pose_estimator.py)
  * [`services/ai-service/app/services/fall_tracker.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/services/fall_tracker.py)
* **Vấn đề thực tế:**
  * Mô hình MediaPipe Pose Landmarker được tối ưu cho người đứng/ngồi. Khi người nằm dài sát mặt sàn, confidence nội tại của model tụt dốc.
  * Hộp bao (bounding box) người ngã nằm ngang thường bị crop sát mép, khiến phần đầu hoặc chân lọt ra ngoài vùng cắt (ROI clipping).
* **Thay đổi kỹ thuật:**
  1. Hạ ngưỡng phát hiện của MediaPipe trong `PoseEstimator`:
     * `min_pose_detection_confidence: 0.50 -> 0.30`
     * `min_pose_presence_confidence: 0.50 -> 0.30`
  2. Mở rộng vùng đệm crop ảnh:
     * `pose_roi_padding_ratio: 0.10 -> 0.20` (+20% theo mỗi chiều $X$ và $Y$).
  3. Cải tiến bộ đệm lịch sử (`history buffer`):
     * Mở rộng dung lượng buffer từ $10$ lên $\max(50, \text{fall\_history\_frame\_count} \times 5)$.
     * Không xóa sạch buffer khi có khoảng ngắt ngắn, chỉ xóa khi khoảng gián đoạn $> \text{fall\_history\_max\_seconds}$.
  4. Đánh giá hồi phục (`RECOVERED`):
     * Sử dụng $\min(\text{angle}_{2D}, \text{angle}_{3D})$ khi kiểm tra điều kiện đứng dậy $\ge 60^\circ$ để tránh việc người ngã dọc bị nhận nhầm là đã đứng dậy.

---

### Commit 4: `36f6970` — Hợp lý hóa thông số vận hành và bổ sung giám sát Health
* **File thay đổi:** 
  * [`services/ai-service/app/config.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/config.py)
  * [`services/ai-service/app/routers/health.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/routers/health.py)
  * [`services/ai-service/app/main.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/main.py)
* **Vấn đề thực tế:**
  * Ngưỡng bất động mặc định 15 giây (hoặc 3 giây) không tương thích với chu trình kiểm thử webcam; ngưỡng vận tốc dịch chuyển cơ thể `0.05` quá nhạy, chỉ một cử động thở cũng làm reset chu kỳ đếm về 0.
* **Bảng so sánh thông số trước và sau điều chỉnh:**

| Tham số cấu hình | Giá trị cũ | Giá trị mới | Lý do điều chỉnh |
| :--- | :---: | :---: | :--- |
| `FALL_IMMOBILITY_SECONDS` | `15.0s` (hoặc `3.0s`) | **`5.0s`** | Chuẩn hóa thời gian xác nhận bất động phù hợp cho kiểm thử trực tiếp và kịch bản thực tế của Sprint 3. |
| `FALL_MOTION_SPEED_THRESHOLD` | `0.05` | **`0.20`** | Tránh việc bộ đếm bị reset về 0 do nhiễu rung webcam, thay đổi ánh sáng hoặc nhịp thở của người nằm. |
| `FALL_MAX_VALID_FRAME_GAP_SECONDS` | `0.6s` | **`5.0s`** | Cho phép độ trễ mạng và FPS không đều từ luồng WebRTC/Frigate mà không làm đứt quãng đếm bất động. |
| `FALL_MISSING_POSE_GRACE_SECONDS` | `5.0s` | **`10.0s`** | Giữ trạng thái Candidate sống sót khi MediaPipe tạm thời mất dấu khớp người nằm trên sàn. |
| `POSE_MIN_VISIBILITY` | `0.60` | **`0.30`** | Nới lỏng yêu cầu độ rõ nét khớp của MediaPipe để thích ứng ánh sáng yếu và góc nằm phức tạp. |
| `FALL_HISTORY_FRAME_COUNT` | `10` | **`5`** | Rút ngắn số lượng frame cần thiết để xây dựng baseline tư thế đứng trước khi ngã (giúp hệ thống phản ứng nhanh hơn). |
| `FALL_HISTORY_MAX_SECONDS` | `3.0s` | **`4.0s`** | Duy trì baseline tư thế trước đó dài hơn, tránh mất dữ liệu khi người ngã di chuyển chậm. |

* **Bổ sung giám sát:**
  * Expose trường `pose_min_visibility` vào endpoint `GET /health` của AI Service để tiện kiểm tra tính sẵn sàng từ bên ngoài.

---

### Commit 5: `8e9a636` — Chuyển đổi WebRTC sang TCP trên MediaMTX & Đồng bộ Compose
* **File thay đổi:** 
  * [`infra/mediamtx/mediamtx.yml`](file:///d:/Project1/aws-camera-ai/infra/mediamtx/mediamtx.yml)
  * [`docker-compose.yml`](file:///d:/Project1/aws-camera-ai/docker-compose.yml)
* **Vấn đề thực tế:**
  * Khi người dùng truyền hình ảnh từ webcam trình duyệt (WHIP) qua MediaMTX trên Windows (WSL2 Docker backend), kênh truyền mặc định là UDP.
  * Lớp mạng ảo NAT của WSL2 thường xuyên bị drop packet hoặc timeout sau 20–40 giây, dẫn đến hiện tượng luồng webcam bị tự ngắt kết nối ngay khi người dùng đang nằm bất động.
* **Thay đổi kỹ thuật:**
  1. Trong `mediamtx.yml`: Kích hoạt lắng nghe WebRTC TCP `webrtcLocalTCPAddress: :8189`.
  2. Trong `docker-compose.yml`: Mở ánh xạ cổng TCP song song UDP: `8189:8189/tcp`.
  3. Đồng bộ hóa toàn bộ các biến môi trường phát hiện té ngã từ `app/config.py` sang phần định nghĩa của `camerai-ai` trong `docker-compose.yml`.

---

## 3. Bản vá tích hợp: Chuẩn hóa góc trả về giữa AI Service và Orchestrator

* **File thay đổi:** [`services/ai-service/app/services/fall_tracker.py`](file:///d:/Project1/aws-camera-ai/services/ai-service/app/services/fall_tracker.py#L589)
* **Nguyên nhân cốt lõi khiến té dọc không báo:**
  * AI Service đã kích hoạt `CONFIRMED` thành công với thời gian bất động `6.797s > 5.0s`.
  * Tuy nhiên, API trả về trường `torsoAngleDeg = geometry.torso_angle_deg` (góc 2D mặt phẳng = `77.98°`).
  * Trong Orchestrator, hàm [`validConfirmation`](file:///d:/Project1/aws-camera-ai/apps/orchestrator/src/fall-detection/adapter/validate-fall-response.ts#L52) có điều kiện kiểm tra bảo vệ:
    ```typescript
    finiteRange(data.torsoAngleDeg, 0, 30) && data.torsoAngleDeg < 30
    ```
  * Vì `77.98° >= 30°`, Orchestrator ghi log `[PoseInferenceAdapter] Rejected invalid pose response identity or evidence` và hủy bỏ toàn bộ sự kiện.
* **Giải pháp khắc phục:**
  * Chuyển đổi trường `torsoAngleDeg` trả về API thành **góc hiệu quả** (lấy giá trị nhỏ nhất giữa góc phẳng 2D và góc không gian 3D):
    ```python
    "torsoAngleDeg": (
        min(geometry.torso_angle_deg, geometry.torso_angle_3d_deg)
        if geometry and geometry.torso_angle_3d_deg is not None
        else (geometry.torso_angle_deg if geometry else None)
    ),
    ```
  * **Kết quả:**
    * Khi té ngang: $\min(2D, 3D)$ giữ nguyên góc phẳng $\approx 10^\circ - 20^\circ < 30^\circ$.
    * Khi té dọc: $\min(2D, 3D)$ lấy góc 3D $\approx 3.2^\circ < 30^\circ$, thỏa mãn hoàn toàn điều kiện xác thực của Orchestrator, giúp cảnh báo chuông và dashboard hiển thị tức thì.

---

## 4. Hướng dẫn kiểm tra và nghiệm thu

Để kiểm tra hoạt động sau khi cập nhật:

1. **Khởi động lại các container liên quan:**
   ```powershell
   docker compose up -d ai-service orchestrator
   ```
2. **Theo dõi log Candidate và Confirm trên AI Service:**
   ```powershell
   docker logs -f camerai-ai | Select-String "CANDIDATE|CONFIRMED|immobile"
   ```
3. **Theo dõi log tiếp nhận và bắn thông báo trên Orchestrator:**
   ```powershell
   docker logs -f camerai-orchestrator | Select-String "M2A_CANDIDATE|FALL_DETECTED|PoseInferenceAdapter"
   ```
