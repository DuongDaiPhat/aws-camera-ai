**Plan triển khai US-12 — Cấu hình vùng cấm cho từng camera**

> Phần giao với Camera, Frigate config, US-11, UI shell và migration tuân theo [kế hoạch tích hợp 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md).
> **1\. Hiện trạng và phạm vi**

**Hiện trạng đã xác minh**

| **Thành phần** | **Hiện trạng**                                                                                     | **Công việc cần làm**                                            |
| -------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Sidebar        | Đã có mục "Khu vực", gọi onSelectNav('zones')                                                      | Kết nối với nội dung quản lý zone                                |
| Dashboard      | DashboardView lưu activeNav nhưng vẫn render nội dung sự kiện                                      | Render ZonesView khi chọn zones                                  |
| Database       | Đã có bảng zones, polygon, loại vùng, ngưỡng thời gian, lịch và trạng thái bật/tắt                 | Tái sử dụng; chỉ thêm migration cho phần còn thiếu               |
| OpenAPI        | Đã có API camera, snapshot và CRUD zone                                                            | Triển khai đúng contract, bổ sung contract trước nếu cần mở rộng |
| Backend        | Chưa có module cameras và zones                                                                    | Bổ sung API đọc camera/preview và CRUD zone                      |
| MQTT           | Có zone bất kỳ là phân loại RESTRICTED_ZONE; chỉ lấy zone đầu tiên, có fallback sang entered_zones | Thay bằng đánh giá đúng loại vùng, lịch, trạng thái và dwell     |
| Dedup          | Một Frigate track tương ứng một event                                                              | Giữ tương thích, không tạo event lặp theo mỗi message            |
| Frigate        | Ghim phiên bản 0.18.0; file cấu hình đang mount read-only                                          | Bổ sung cơ chế cập nhật cấu hình thực sự có hiệu lực             |
| Giao diện      | Next.js, CSS Modules, token màu trong globals.css                                                  | Dùng cùng cấu trúc và phong cách                                 |

**Tên tài liệu thực tế trong repo:**

- Hợp đồng API là api/openapi.yaml
- Quy trình Git là docs/conventions/GIT_WORKFLOW.md
- Quy ước code là docs/conventions/CODING_CONVENTION.md.

Agent phải dùng những file thực tế này làm nguồn chuẩn.

**Trong phạm vi**

- Xem camera và các zone đã cấu hình.
- Hiển thị polygon và tên zone trực tiếp trên preview.
- Tạo, chọn, chỉnh sửa, xóa zone trực quan.
- Đổi loại vùng, bật/tắt, đặt thời gian lưu lại tối thiểu và lịch hoạt động.
- Đồng bộ cấu hình xuống Frigate.
- Phân loại sự kiện vùng cấm đúng điều kiện.
- Kiểm thử API, giao diện, MQTT và Frigate thực tế.

**Ngoài phạm vi**

- Nhận diện tuổi hoặc phân biệt trẻ em với người lớn.
- Xây mới toàn bộ chức năng thêm/sửa/xóa camera.
- Xây mới hệ thống gửi Telegram/email hoặc escalation.

"Vùng cấm trẻ em" trong story được biểu diễn bằng zoneType = RESTRICTED. Đối tượng kích hoạt là person như acceptance criteria; không suy diễn nhãn person thành "trẻ em".

**2\. Quy tắc nghiệp vụ cần triển khai**

**2.1. Zone**

- Mỗi zone thuộc đúng một camera.
- Tên hiển thị hỗ trợ tiếng Việt, ví dụ "Bếp".
- slug là khóa kỹ thuật dùng trong Frigate, duy nhất trong camera.
- Gợi ý slug khi tạo; cho phép chỉnh trước khi lưu.
- Không thay slug khi đổi tên zone; API PATCH hiện không cho sửa slug.
- Loại vùng gồm RESTRICTED, REST_AREA, NORMAL.
- Chỉ RESTRICTED được tạo cảnh báo M4.
- minDwellSeconds mặc định bằng 2, giới hạn 0–300 theo contract.
- Zone tắt vẫn hiển thị trên giao diện với nhãn "Đã tắt", nhưng không tạo cảnh báo.

**2.2. Polygon**

- Lưu dưới dạng \[\[x, y\], ...\], mọi giá trị thuộc \[0, 1\].
- Có ít nhất ba đỉnh khác nhau.
- Không chấp nhận diện tích bằng không, các điểm thẳng hàng hoặc polygon tự cắt.
- Không lưu lặp lại đỉnh đầu ở cuối mảng; lớp hiển thị tự đóng polygon.
- Kiểm tra cả frontend và backend.
- Backend từ chối tọa độ ngoài khoảng; không âm thầm sửa dữ liệu sai.
- Polygon phải giữ đúng vị trí khi preview thay đổi kích thước.

**2.3. Lịch hoạt động**

- Dùng múi giờ của camera, không dùng múi giờ trình duyệt hoặc múi giờ mặc định của máy chủ.
- Không đặt lịch: cả activeFrom và activeTo bằng null, hoạt động 24/7.
- Khoảng thời gian là \[activeFrom, activeTo):
  - 06:00: bắt đầu được phép cảnh báo.
  - 22:00: ngừng được phép cảnh báo.
- Hỗ trợ lịch qua nửa đêm, ví dụ 22:00–06:00.
- Từ chối trường hợp hai đầu bằng nhau; dùng lựa chọn "Cả ngày" cho 24/7.
- PATCH phải kiểm tra trạng thái sau khi gộp dữ liệu cũ và dữ liệu gửi lên.
- Đánh giá lịch theo thời điểm quan sát của Frigate; kiểm tra lại trước khi phát cảnh báo để không phát cảnh báo muộn ngoài lịch.
- Lịch chỉ điều khiển cảnh báo M4, không tắt camera.

**2.4. Sự kiện và chống lặp**

Giữ quy ước đang có: một track Frigate tương ứng một event.

- Người xuất hiện có thể vẫn được ghi nhận là PERSON_DETECTED.
- Chỉ nâng thành RESTRICTED_ZONE khi zone hợp lệ và đủ điều kiện.
- Đi qua dưới hai giây không tạo hoặc nâng thành cảnh báo M4.
- Không xóa bỏ luồng ghi nhận người thông thường của các story trước.
- Một track đã cảnh báo M4 không phát lại cảnh báo ở từng message MQTT.
- Khi người rời vùng, giữ thông tin vùng đã gây cảnh báo trong lịch sử.
- Nếu nhiều zone cùng đủ điều kiện, chọn zone đủ điều kiện đầu tiên; trường hợp đồng thời dùng thứ tự ổn định theo ID.
- Không thay tên vùng đã ghi nhận chỉ vì track tiếp tục sang vùng khác.

Việc tạo nhiều sự kiện cho nhiều zone trong cùng track là mở rộng riêng, không tự thay đổi quy ước dedup hiện tại.

**3\. Bước 1 — Xác minh tích hợp Frigate trước khi triển khai sâu**

Đây là bước kiểm chứng kỹ thuật bắt buộc vì cấu hình hiện tại đang read-only.

**Công việc**

1. Chạy môi trường với đúng image Frigate 0.18.0.
2. Kiểm tra API/schema cấu hình thực tế của phiên bản này.
3. Thử tạo, sửa, xóa một zone thử nghiệm bằng cơ chế cập nhật cấu hình được phiên bản hỗ trợ.
4. Xác minh thay đổi có cần restart hay có thể áp dụng trực tiếp.
5. Xác minh loitering_time, current_zones và hành vi khi:
   - Người đi qua dưới hai giây.
   - Người đứng yên trong vùng.
   - Người ra rồi vào lại vùng.
   - Track đi vào nhiều vùng.
6. Lưu payload MQTT mẫu vào fixture kiểm thử, không lưu ảnh hoặc credential nhạy cảm.

**Quyết định triển khai**

Ưu tiên Frigate thực hiện ngưỡng lưu lại bằng loitering_time = minDwellSeconds; backend kiểm tra loại vùng, lịch và trạng thái.

Không cộng thêm một bộ đếm hai giây sau khi Frigate đã xác nhận đủ dwell.

Tài liệu Frigate có hỗ trợ thời gian lưu lại tối thiểu của zone, nhưng Agent phải kiểm chứng hành vi trên phiên bản đang ghim, đặc biệt với trường hợp ra/vào lại. Tham khảo: [Frigate Zones](https://docs.frigate.video/configuration/zones/).

Nếu phiên bản thực tế không đảm bảo thời gian lưu lại liên tục theo yêu cầu, phải thiết kế bộ theo dõi occupancy ở backend với nguồn quan sát đủ tin cậy trước khi tiếp tục. Không dùng setTimeout(2000) rồi tự kết luận người vẫn còn trong vùng khi không có bằng chứng mới.

**Điều kiện hoàn thành:** có cách cập nhật Frigate đã chạy thử thành công và fixture chứng minh ngưỡng hai giây.

**4\. Bước 2 — Hoàn thiện contract trước code**

**API tái sử dụng**

Các đường dẫn dưới đây theo paths trong OpenAPI; client tiếp tục dùng base URL/prefix hiện tại.

| **API**                          | **Mục đích**            | **Thành công**            |
| -------------------------------- | ----------------------- | ------------------------- |
| GET /cameras                     | Chọn camera             | 200, { data: Camera\[\] } |
| GET /cameras/{cameraId}          | Đọc camera cần cấu hình | 200, Camera               |
| GET /cameras/{cameraId}/snapshot | Lấy preview             | 200, MediaUrl             |
| GET /cameras/{cameraId}/zones    | Đọc zone của camera     | 200, { data: Zone\[\] }   |
| POST /cameras/{cameraId}/zones   | Tạo zone                | 201, Zone                 |
| PATCH /zones/{zoneId}            | Sửa zone                | 200, Zone                 |
| DELETE /zones/{zoneId}           | Xóa zone                | 204, không có body        |

Không tạo endpoint CRUD trùng với contract đang có.

**Bổ sung contract cần thiết**

- Đồng nhất validation POST/PATCH:
  - Tên không rỗng sau trim, tối đa 60 ký tự.
  - minDwellSeconds là số nguyên từ 0 đến 300.
  - Thời gian có định dạng HH:mm.
  - Mô tả rõ lịch qua ngày và quy tắc null.
- Khai báo đầy đủ lỗi áp dụng: 400, 401, 403, 404, 409.
- Giữ lỗi theo ErrorResponse hiện có.
- Bổ sung trạng thái đồng bộ Frigate ở cấp camera để theo dõi được cả việc xóa zone:
  - zoneSyncStatus: PENDING | SYNCED | FAILED.
  - zoneConfigVersion.
  - zoneAppliedVersion.
  - Thông tin lỗi đã làm sạch, nếu cần hiển thị.
- Bổ sung thao tác thử đồng bộ lại nếu UI cần nút "Thử lại"; định nghĩa endpoint này trong OpenAPI trước khi triển khai.
- Mô tả rõ: lưu thành công vào DB chưa đồng nghĩa Frigate đã áp dụng thành công.

Sau khi sửa:

pnpm api:lint

pnpm contracts:generate

Frontend import kiểu API từ @cam/contracts; không viết lại kiểu bằng tay, không sửa trực tiếp file generated.

**Điều kiện hoàn thành:** contract đủ mô tả CRUD, validation, quyền và trạng thái đồng bộ.

**5\. Bước 3 — Database và lưu lịch sử vùng**

Không tạo lại bảng zones, không sửa migration đã tồn tại.

**Migration mới**

Lấy số migration tiếp theo tại thời điểm triển khai; hiện repo có đến 0004.

Bổ sung:

1. Ràng buộc min_dwell_seconds thuộc 0–300.
2. Trạng thái/version đồng bộ cấu hình theo camera.
3. Bản ghi công việc đồng bộ bền vững để phục hồi sau restart.
4. Cột snapshot tên vùng trong events, ví dụ zone_name.

Lý do cần snapshot tên vùng:

- Hiện event lấy tên bằng JOIN sang zones.
- Đổi tên zone làm thay đổi cách đọc lịch sử.
- Xóa zone khiến zone_id thành NULL do ON DELETE SET NULL.
- Story yêu cầu sự kiện ghi nhận được vị trí "Bếp".

Backfill tên cho event cũ còn liên kết với zone; event không còn nguồn dữ liệu thì giữ NULL, không tự đoán.

Khi nâng event thành RESTRICTED_ZONE, ghi zone_id và zone_name trong cùng transaction. Khi đọc API, ưu tiên tên snapshot; có thể fallback sang JOIN để tương thích dữ liệu cũ.

Cập nhật docs/database/ERD.md.

**Điều kiện hoàn thành:** migration chạy được trên DB mới và DB có dữ liệu; xóa/đổi tên zone không mất tên vùng trong sự kiện cũ.

**6\. Bước 4 — API backend và quyền ADMIN**

**Tổ chức module**

Trong apps/orchestrator/src/, bổ sung theo cấu trúc hiện tại:

cameras/

cameras.module.ts

cameras.controller.ts

cameras.service.ts

cameras.repository.ts

dto/

zones/

zones.module.ts

zones.controller.ts

zones.service.ts

zones.repository.ts

zone-geometry.validator.ts

zone-schedule.service.ts

dto/

frigate/

frigate.module.ts

frigate-config.service.ts

frigate-config-sync.service.ts

frigate-config.interface.ts

frigate-http.adapter.ts

Tên file có thể điều chỉnh theo trách nhiệm cuối cùng; không gom mọi logic vào controller hoặc MQTT consumer.

**API camera phục vụ zone**

- Triển khai đọc danh sách/chi tiết camera và snapshot cần cho màn hình.
- Snapshot phải lấy từ đúng camera.
- Tái sử dụng storage/presigned URL hiện có.
- Camera không tồn tại trả 404; không lấy được preview do offline trả 503.
- Không trả RTSP credential ra frontend.

**CRUD zone**

- Controller → Service → Repository.
- DTO dùng class-validator, kiểm tra UUID và nested polygon.
- Service kiểm tra camera tồn tại, quyền và tính hợp lệ nghiệp vụ.
- Repository dùng SQL tham số hóa, liệt kê cột rõ ràng.
- Phân biệt "không gửi field" với "gửi null" trong PATCH.
- Chuyển lỗi trùng tên/slug thành 409 với thông báo tiếng Việt.
- PATCH/DELETE theo ID không tồn tại trả 404.

**Quyền truy cập**

- CRUD và retry sync chỉ dành cho ADMIN.
- Bổ sung guard theo role vì JWT authentication hiện tại chưa đủ để bảo vệ thao tác quản trị.
- UI chỉ hiện thao tác chỉnh sửa cho ADMIN.
- Backend vẫn phải chặn trực tiếp request trái quyền.
- Quyền đọc camera/zone theo chính sách đọc camera hiện có; ghi rõ trong contract nếu chưa được định nghĩa.

**Điều kiện hoàn thành:** CRUD hoạt động qua API, validation đúng, người không phải ADMIN không ghi được dữ liệu.

**7\. Bước 5 — Đồng bộ Frigate có phục hồi lỗi**

**Luồng đồng bộ**

CRUD zone

→ Transaction: lưu zone + tăng version + ghi công việc đồng bộ

→ Trả dữ liệu đã lưu, trạng thái PENDING

→ Worker đọc cấu hình mong muốn mới nhất

→ Sinh và validate cấu hình Frigate

→ Áp dụng, restart nếu phiên bản yêu cầu

→ Kiểm tra cấu hình đang chạy

→ Đánh dấu SYNCED hoặc FAILED

**Yêu cầu kỹ thuật**

- PostgreSQL là nguồn dữ liệu chuẩn cho zone do ứng dụng quản lý.
- Sinh key Frigate từ zone.slug, không dùng tên tiếng Việt.
- Sinh tọa độ chuẩn hóa theo schema đã xác minh.
- Cấu hình dwell cho vùng cấm; giữ đúng ý nghĩa REST_AREA và NORMAL.
- Không ghi đè phần MQTT, detector, stream hoặc cấu hình khác.
- Xác định rõ zone nào do ứng dụng quản lý để không xóa nhầm zone ngoài phạm vi.
- Giải quyết mount read-only trong docker-compose.yml theo cơ chế cập nhật đã kiểm chứng.
- Không cấp Docker socket cho backend chỉ để restart container.
- Không log toàn bộ cấu hình có RTSP credential.

**Đồng thời và lỗi**

- Nếu nhiều camera dùng chung một file cấu hình, khóa cập nhật theo Frigate instance.
- Gộp các phiên bản chờ thành cấu hình mong muốn mới nhất.
- Không để retry phiên bản cũ ghi đè phiên bản mới.
- Retry có giới hạn/backoff từ cấu hình.
- Sau restart, tiếp tục công việc đang chờ và đối chiếu DB với cấu hình thực tế.
- Frigate lỗi không làm mất zone đã lưu.
- Chỉ hiển thị "Đã đồng bộ" sau khi xác nhận cấu hình có hiệu lực.
- Khi sửa polygon/ngưỡng mà chưa áp dụng xong, không đánh giá M4 bằng cấu hình cũ như thể đó là cấu hình mới.
- Zone đã tắt hoặc đã xóa bị backend chặn cảnh báo ngay cả khi Frigate chưa cập nhật xong.

**Điều kiện hoàn thành:** tạo/sửa/xóa zone thay đổi được cấu hình chạy thật; lỗi và retry có thể quan sát từ UI.

**8\. Bước 6 — Sửa luồng MQTT và sự kiện M4**

**Thay logic hiện tại**

Không còn dùng điều kiện:

Có bất kỳ zone nào → RESTRICTED_ZONE

Thay bằng đánh giá từng zone hiện tại:

label == person

AND camera hợp lệ, đang bật

AND zone thuộc đúng camera

AND zone.zoneType == RESTRICTED

AND zone.isEnabled

AND cấu hình zone đã được áp dụng

AND đủ dwell theo cơ chế đã kiểm chứng

AND đang trong lịch hoạt động

**Xử lý dữ liệu Frigate**

- Dùng current_zones để đánh giá hiện tại.
- Không fallback sang entered_zones để kết luận người vẫn ở trong vùng.
- entered_zones chỉ là lịch sử, không đủ chứng minh occupancy hiện tại.
- Không lấy phần tử đầu tiên rồi bỏ qua những zone còn lại.
- Zone lạ, camera không hợp lệ, zone tắt hoặc zone thường không kích hoạt M4.
- Không dùng start_time của track làm thời điểm bắt đầu đứng trong zone.
- Nếu Frigate đã thực hiện dwell, backend không đếm thêm lần nữa.

**Ghi nhận event**

- Giữ dedup key frigate:{camera_slug}:{track_id}.
- Khi đủ điều kiện, tạo mới hoặc nâng event hiện có thành:
  - event_type = RESTRICTED_ZONE.
  - priority = P1, phù hợp luồng hiện tại.
  - zone_id tương ứng.
  - zone_name = "Bếp".
- Ghi dấu thời điểm đủ điều kiện nếu cần phân biệt với thời điểm track xuất hiện.
- Việc nâng cấp phải atomic và chỉ thắng một lần khi nhận message trùng.
- Event đã là M4 giữ nguyên tên vùng kể cả khi current_zones rỗng sau đó.
- Phát event.updated qua SSE khi loại sự kiện/zone thay đổi; hiện code chủ yếu phát update khi có snapshot mới.
- Tái sử dụng luồng media hiện có.
- Không phát lại cảnh báo cho event đã nâng cấp khi retry hoặc restart.

**Điều kiện hoàn thành:** đi lướt qua không tạo M4; đủ ngưỡng trong giờ hoạt động tạo đúng một cảnh báo, tên vùng đúng và xuất hiện trên dashboard.

**9\. Bước 7 — Giao diện "Khu vực"**

**Tích hợp điều hướng**

Trong DashboardView:

- Giữ callback onSelectNav('zones') hiện tại.
- Khi activeNav === 'zones', render ZonesView trong workspace.
- Giữ Sidebar, phiên đăng nhập và bố cục chung.
- Nội dung bộ lọc/simulate sự kiện không xuất hiện như thao tác của màn hình zone.
- Không cần chuyển toàn bộ ứng dụng sang hệ routing mới cho story này.

**Bố cục**

**Danh sách camera:**

- Tên, trạng thái camera.
- Chọn camera cần cấu hình.
- Khi vào trang, chọn camera đầu tiên phù hợp nếu chưa có lựa chọn.
- Chuyển camera phải tải đúng zone của camera đó.

**Preview:**

- Ảnh camera giữ đúng tỷ lệ.
- Overlay tất cả zone của camera đang chọn.
- Mỗi zone có đường viền, nền trong suốt và tên.
- Zone được chọn có dấu hiệu rõ ràng.
- Zone tắt vẫn có polygon và nhãn trạng thái.

**Danh sách/cấu hình zone:**

- Hiển thị tên, loại vùng, bật/tắt, lịch và ngưỡng.
- Chọn item trong danh sách sẽ chọn polygon tương ứng, và ngược lại.
- Có thao tác "Thêm vùng", "Sửa", "Xóa".
- Có trạng thái "Đang đồng bộ", "Đã đồng bộ", "Đồng bộ thất bại".

**Yêu cầu bắt buộc:** màn hình phải hiển thị camera cùng polygon/tên zone; chỉ hiện danh sách camera là chưa đạt.

**Tương tác vẽ và chỉnh sửa**

1. Bấm "Thêm vùng".
2. Click/chạm lên preview để thêm đỉnh.
3. Hiện đường nối và polygon nháp.
4. Cho phép hoàn tác điểm cuối, hoàn tất hoặc hủy.
5. Hoàn tất khi có ít nhất ba đỉnh hợp lệ.
6. Nhập tên, loại vùng, ngưỡng và lịch.
7. Lưu qua API.
8. Chuyển từ vùng nháp sang dữ liệu server trả về.

Chỉnh sửa:

- Kéo đỉnh.
- Thêm/xóa đỉnh nhưng không giảm xuống dưới ba.
- Đổi thuộc tính trong form.
- "Hủy" khôi phục dữ liệu đã lưu.
- "Xóa" mở xác nhận có tên vùng và camera.
- Nếu có thay đổi chưa lưu khi chuyển camera/rời màn hình, yêu cầu giữ hoặc bỏ bản nháp.

**Hình học preview**

Dùng ảnh và SVG overlay chung vùng hiển thị:

x = (pointerX - imageLeft) / imageWidth

y = (pointerY - imageTop) / imageHeight

imageLeft, imageTop, imageWidth, imageHeight phải thuộc phần ảnh thật sau object-fit, không phải toàn bộ container có khoảng trống.

- Không tạo điểm khi click ngoài ảnh.
- Kéo đỉnh giới hạn trong ảnh.
- Freeze preview trong lúc chỉnh polygon để tránh ảnh đổi gây khó thao tác.
- Responsive không làm thay đổi tọa độ đã lưu.
- Dùng Pointer Events cho chuột và cảm ứng.
- Có nút hoàn tất/hủy rõ ràng; không phụ thuộc hoàn toàn vào double-click.

**Cấu trúc frontend**

components/zones/

ZonesView.tsx

CameraZonePreview.tsx

ZonePolygonEditor.tsx

ZoneList.tsx

ZoneForm.tsx

DeleteZoneDialog.tsx

\*.module.css

index.ts

hooks/

useCameras.ts

useZones.ts

useCameraSnapshot.ts

lib/

cameras-client.ts

zones-client.ts

zone-geometry.ts

- API client dùng apiFetch.
- Chống response cũ ghi đè khi chuyển camera nhanh.
- Không mất draft khi API lỗi.
- Loading/error của preview và zone được xử lý riêng.
- Camera offline vẫn đọc được danh sách zone; nếu không có ảnh phù hợp thì khóa vẽ mới, hiển thị lý do.
- Làm mới URL preview khi hết hạn theo MediaUrl.

**Style và accessibility**

- Tái sử dụng token --bg, --surface, --border, --accent, radius và font hiện có.
- CSS Modules, tiếng Việt có dấu.
- Responsive từ 360px.
- Không chỉ dùng màu để phân biệt loại/trạng thái zone.
- Input có label; dialog quản lý focus; thông báo lưu/lỗi có thể được đọc bởi screen reader.

**Điều kiện hoàn thành:** ADMIN có thể CRUD zone hoàn toàn từ preview, tải lại vẫn thấy đúng dữ liệu và giao diện đồng bộ với hệ thống.

**10\. Kiểm thử và nghiệm thu**

**Ma trận kiểm thử bắt buộc**

| **Nhóm**  | **Trường hợp**                                   | **Kết quả**                                |
| --------- | ------------------------------------------------ | ------------------------------------------ |
| CRUD      | Tạo "Bếp", tải lại                               | Polygon/tên/thuộc tính giữ nguyên          |
| CRUD      | Trùng tên hoặc slug trong cùng camera            | 409                                        |
| CRUD      | Cùng tên trên camera khác                        | Được phép                                  |
| Geometry  | Dưới ba đỉnh, tự cắt, thẳng hàng, ngoài \[0,1\]  | Bị từ chối                                 |
| Geometry  | Preview resize, có letterbox, màn hình 360px     | Overlay không lệch                         |
| Quyền     | Không đăng nhập / không phải ADMIN ghi dữ liệu   | 401 / 403                                  |
| Dwell     | 1,9 giây                                         | Không có cảnh báo M4                       |
| Dwell     | Đạt ít nhất 2 giây                               | M4 được tạo/nâng tại quan sát đủ điều kiện |
| Dwell     | Vào 1 giây, ra, vào 1 giây                       | Không cộng dồn thành hai giây              |
| Loại vùng | NORMAL, REST_AREA, zone tắt                      | Không có M4                                |
| Lịch      | Trước 06:00, đúng 06:00, trước 22:00, đúng 22:00 | Đúng quy tắc biên                          |
| Lịch      | 22:00–06:00, camera khác múi giờ máy chủ         | Đánh giá đúng                              |
| MQTT      | current_zones=\[\], entered_zones còn "Bếp"      | Không tạo cảnh báo mới                     |
| MQTT      | Message trùng, đảo thứ tự, restart               | Không nhân bản/nâng sai event              |
| Lịch sử   | Đổi tên/xóa "Bếp" sau cảnh báo                   | Event cũ vẫn giữ tên "Bếp"                 |
| Sync      | Frigate offline, cấu hình lỗi                    | UI báo chưa áp dụng, có retry              |
| Sync      | Hai camera cập nhật cùng lúc                     | Không mất cấu hình của nhau                |
| Sync      | Restart khi đang chờ đồng bộ                     | Công việc được phục hồi                    |
| SSE       | Event thường được nâng thành M4                  | Dashboard cập nhật không cần F5            |

**Cấp kiểm thử**

- Unit: geometry, lịch, đánh giá zone, sinh config, lựa chọn zone.
- Integration: API với DB, ràng buộc, transaction, quyền, dedup và outbox.
- Frontend: chọn camera, draft, CRUD, trạng thái lỗi, response đến sai thứ tự.
- End-to-end: trình duyệt → API → DB → Frigate → MQTT → event → giao diện.

Tái sử dụng Jest/Vitest và cách tổ chức test đang có. Không coi mock Frigate là đủ để nghiệm thu đồng bộ thực tế.

**Lệnh kiểm tra**

pnpm contracts:generate

pnpm api:lint

pnpm --filter @cam/orchestrator test

pnpm --filter @cam/web test

pnpm test:tools

pnpm check:all

Chạy thêm môi trường Docker với profile cv và kịch bản Frigate thực tế. Không chạy db:reset trên dữ liệu đang dùng.

**11\. Thứ tự thực thi và chia PR**

| **Thứ tự** | **Đầu ra**                                    | **Phụ thuộc**                |
| ---------- | --------------------------------------------- | ---------------------------- |
| 1          | Kiểm chứng Frigate 0.18, fixture dwell/config | Không                        |
| 2          | Contract và generated types                   | 1                            |
| 3          | Migration, API camera/zone, phân quyền        | 2                            |
| 4          | Đồng bộ Frigate, retry, phục hồi              | 3                            |
| 5          | Đánh giá M4, lịch, lịch sử tên vùng, SSE      | 4                            |
| 6          | Màn hình và polygon editor                    | 3; tích hợp hoàn chỉnh sau 4 |
| 7          | E2E, tài liệu vận hành, nghiệm thu            | 5, 6                         |

Chia PR theo từng phần có thể review và giữ main chạy được. PR contract đi trước theo quy trình repo; chức năng chưa hoàn chỉnh không được hiển thị như đã sẵn sàng.

**Quy ước thực thi**

- Kiểm tra working tree trước khi sửa; giữ nguyên thay đổi ngoài phạm vi.
- Nhánh theo GIT_WORKFLOW.md, ví dụ feat/US-12-cau-hinh-vung-cam.
- Không push thẳng main.
- Commit nhỏ, đúng scope, mô tả tiếng Việt, ví dụ:

feat(api): bổ sung trạng thái đồng bộ vùng camera

feat(db): lưu tên vùng trong lịch sử sự kiện

feat(orchestrator): thêm quản lý vùng theo camera

feat(orchestrator): đồng bộ vùng với Frigate

feat(web): thêm trình chỉnh sửa vùng trên preview

test(orchestrator): kiểm tra điều kiện cảnh báo vùng cấm

- Không bỏ qua hook bằng --no-verify.
- Điền đầy đủ .github/pull_request_template.md.
- Ghi issue/Sprint/Story Point từ dữ liệu thực tế; không tự bịa.
- PR giao diện kèm ảnh desktop/mobile.
- PR tích hợp kèm bằng chứng đồng bộ Frigate và kịch bản hai giây.
- Thay đổi api/ cần A và B review theo tài liệu.
- Có tối thiểu một người khác approve; tác giả không tự merge.
- Merge bằng squash sau CI và nghiệm thu.

**12\. Definition of Done**

- Click "Khu vực" mở đúng màn hình quản lý.
- Camera đang chọn hiển thị preview và tất cả zone bằng polygon/tên.
- ADMIN tạo, sửa, xóa, bật/tắt zone trực quan.
- Tọa độ lưu chuẩn hóa \[0,1\], không lệch khi resize.
- API và generated types khớp api/openapi.yaml.
- DB và Frigate được đồng bộ; UI phản ánh đúng trạng thái áp dụng.
- person đủ dwell trong vùng RESTRICTED đang hoạt động tạo đúng M4.
- Đi qua dưới hai giây hoặc ngoài lịch không tạo cảnh báo M4.
- Message lặp không gây cảnh báo trùng.
- Event ghi nhận và giữ được zone_name = "Bếp".
- Dashboard nhận cập nhật loại sự kiện qua SSE.
- Lỗi Frigate/restart/concurrent edits có kiểm thử phục hồi.
- Kiểm tra tự động và E2E thực tế đạt; thiếu môi trường phải được ghi rõ, không đánh dấu đạt thay.
- Code, migration, commit và PR tuân thủ quy ước repo.
