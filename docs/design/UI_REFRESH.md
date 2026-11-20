# CameraAI interface refresh

Branch: feat/3d-camera-showcase. Do not create or switch branches or worktrees.

The primary users monitor home cameras and respond to incidents. The dashboard gives priority to actual API status and pending incidents. The 3D camera lives in a separate exploration view, not in the emergency attention flow.

Palette: navy #101d36 for navigation, white #ffffff surfaces, cool #f3f6fb workspace, blue #175cd3 actions, cyan #1b9aaa product illustration, semantic red for urgent incidents. Maintain contrast and readable sentence-case labels. System sans fonts avoid external font-loading dependencies.

Desktop uses persistent grouped navigation, a compact page header, three live-data metrics and a structured event list. Mobile uses native page selection with every section available, controls of at least 44px and one-column content. Do not show fictional users, device counts or guaranteed safety claims.

Existing authentication, API contracts, roles, camera source controls, confirmation workflows and emergency overlays remain authoritative. Keep WebGL lazily loaded and provide a static fallback. The procedural camera is an illustrative construction, not a claim about a specific physical camera.

Antigravity contributes the login visual styling from supplied source excerpts. Codex owns integration, navigation, the camera interaction and verification. Antigravity returns generated suggestions; Codex reviews them and writes changes only on this branch.

## Ghi chú tương thích 3D

Cảnh 3D dùng Three.js và OrbitControls trực tiếp, tải riêng khi mở trang khám phá. Không nâng phiên bản React của ứng dụng. Renderer và các tài nguyên GPU được hủy khi rời trang; trình duyệt thiếu WebGL2 hiển thị hình tĩnh cùng mô tả linh kiện.

## Kiểm tra và chạy thử

- `pnpm --filter @cam/web dev`: mở giao diện tại localhost:3000 với backend hiện có của dự án.
- Mục “Khám phá camera 3D” có tách/lắp, xoay bằng kéo hoặc nút, phóng to/thu nhỏ, đặt lại, tự xoay theo lựa chọn và chọn từng linh kiện.
- Danh sách khu vực được lấy từ các sự kiện đã tải, lọc bằng ID khu vực; không dùng danh sách phòng giả định. Thống kê tổng hợp vẫn phản ánh toàn hệ thống.
- 222 kiểm thử frontend đã qua, gồm kiểm tra hai khu vực trùng tên vẫn được phân biệt bằng ID.
- Chrome: 29 kiểm tra bố cục ở 320, 375, 768 và 1440px; đăng nhập, tám mục điều hướng, tương tác 3D thực tế, điều khiển bằng nút, giảm chuyển động, thiếu WebGL và lớp cảnh báo cháy. Các API được thay bằng fixture chỉ trong trình duyệt kiểm thử; chưa kiểm thử backend/camera vật lý trong lượt này.
- Ảnh xem trước và kết quả kiểm tra nằm trong `artifacts/ui-refresh/` (được Git bỏ qua).
- Build Windows dùng đầu ra Next.js thông thường để tránh lỗi quyền symlink. Docker/Linux vẫn xuất bundle standalone như trước.

Kết quả cuối: production build trên Windows, TypeScript, Prettier và git diff --check đều qua. Lint không có lỗi; các thành phần mới không phát sinh cảnh báo. Những cảnh báo về độ dài hàm trong mã cũ vẫn còn.
