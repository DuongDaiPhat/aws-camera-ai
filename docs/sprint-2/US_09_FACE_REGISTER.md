**Đăng ký khuôn mặt người quen qua Dashboard**

> Phần giao với US-10, UI shell, face collection, contract và migration tuân theo [kế hoạch tích hợp 5 thành viên](PLAN_AGILE_5_MEMBER_EXECUTION.md).
> **1\. Mục tiêu**

ADMIN có thể:

- Mở trang "Người quen".
- Nhập tên và quan hệ.
- Upload từ 1 đến 5 ảnh.
- Chọn đúng khuôn mặt nếu ảnh có nhiều người.
- Trích xuất embedding.
- Lưu người quen và hiển thị trong danh sách.
- Xóa vĩnh viễn embedding.
- Ghi audit log khi xóa.

Hệ thống chỉ lưu dữ liệu sinh trắc học cần thiết:

- Local provider: vector embedding.
- Rekognition provider: Face ID/Collection ID.
- Không lưu ảnh gốc dài hạn.
- Không trả embedding qua public API.

**2\. Hiện trạng**

Repo đã có:

- Bảng known_faces.
- Bảng audit_logs.
- OpenAPI cho:
  - GET /known-faces.
  - POST /known-faces.
  - DELETE /known-faces/{knownFaceId}.
- Contract nội bộ AI:
  - POST /face/embed.
  - POST /face/match.
  - POST /face/collection/sync.
- Cấu hình LOCAL và REKOGNITION.
- Ràng buộc DB:
  - Từ 1 đến 5 ảnh nguồn.
  - Tên duy nhất theo owner.
  - Local phải có embedding.
  - Rekognition phải có Face ID.
  - Không có deleted_at.

Repo chưa có:

- KnownFacesModule trong Orchestrator.
- Face router/model implementation trong AI service.
- Giao diện "Người quen".
- Role guard dành cho ADMIN.
- Luồng chọn một khuôn mặt trong ảnh có nhiều người.
- Cơ chế tổng hợp 1–5 embedding thành một bản ghi.
- Đồng bộ collection sau khi thêm/xóa.

**3\. Quy tắc nghiệp vụ**

**3.1. Quyền**

- Chỉ ADMIN được thêm hoặc xóa người quen.
- Quyền đọc danh sách theo phạm vi owner/hộ gia đình hiện có.
- Backend lấy ownerUserId từ access token.
- Client không được tự gửi ownerUserId.

**3.2. Tên**

- Trim khoảng trắng đầu/cuối.
- Không nhận chuỗi rỗng.
- Tối đa 120 ký tự.
- Tên duy nhất theo owner, không phân biệt hoa/thường nếu nghiệp vụ mong muốn.
- Trùng tên trả 409 KNOWN_FACE_NAME_EXISTS.

**3.3. Ảnh**

- Số lượng: 1–5.
- Chỉ nhận JPEG, PNG hoặc WebP.
- Kiểm tra magic bytes, không chỉ tin MIME từ browser.
- Giới hạn dung lượng từng ảnh và tổng request qua biến môi trường.
- Giới hạn kích thước pixel để tránh ảnh giải nén quá lớn.
- Tự sửa orientation theo EXIF trước khi detect.
- Không ghi filename, ảnh hoặc base64 vào log.

**3.4. Xử lý nguyên tử**

Một request đăng ký chỉ thành công khi tất cả ảnh đã được xử lý hợp lệ.

Nếu một ảnh:

- Không có khuôn mặt.
- Không decode được.
- Chọn face index không hợp lệ.
- Model/provider thất bại.

thì không tạo record known_faces.

Không lưu trước rồi hoàn thiện embedding sau.

**3.5. Nhiều ảnh cho cùng người**

Mỗi ảnh tạo một embedding. Với local provider:

1. Chuẩn hóa từng vector.
2. Kiểm tra tất cả có cùng embeddingDim và modelVersion.
3. Có thể kiểm tra độ tương đồng giữa các ảnh để phát hiện người dùng chọn nhầm người.
4. Tính centroid trung bình.
5. Chuẩn hóa lại centroid.
6. Lưu một embedding đại diện vào known_faces.
7. Lưu source_image_count bằng số ảnh đã dùng.

Ngưỡng kiểm tra ảnh cùng người phải lấy từ cấu hình, không hard-code.

Nếu các embedding không đủ giống nhau, trả lỗi:

FACE_IMAGES_INCONSISTENT

và yêu cầu người dùng kiểm tra lại lựa chọn.

**4\. Luồng chọn mặt khi ảnh có nhiều người**

Contract hiện tại chỉ trả bounding box khi có nhiều mặt nhưng chưa định nghĩa cách gửi lựa chọn lại. Cần hoàn thiện contract trước code.

**4.1. Không lưu ảnh tạm ở server để chờ lựa chọn**

Luồng đề xuất:

Browser giữ File trong bộ nhớ

→ gửi ảnh để phân tích

→ server trả bounding boxes

→ browser vẽ các ô đánh số trên ảnh local

→ người dùng chọn một mặt

→ browser gửi lại chính File cùng selectedFaceIndex

→ server trích embedding đã chọn

Ưu điểm:

- Không cần lưu ảnh gốc ở server giữa hai request.
- Không cần registration session chứa ảnh.
- Preview dùng URL.createObjectURL() trên browser.
- Khi bỏ ảnh/rời form, gọi URL.revokeObjectURL().

**4.2. Request đăng ký**

Mở rộng multipart request:

personName

relationship?

linkedUserId?

images\[\] 1–5 file

faceSelections JSON array

Ví dụ:

\[

{ "imageIndex": 0, "faceIndex": 1 },

{ "imageIndex": 1, "faceIndex": 0 }

\]

Ảnh chỉ có một mặt không cần entry hoặc dùng faceIndex = 0.

**4.3. Response khi cần chọn**

Trả 422 MULTIPLE_FACES:

{

"error": {

"code": "MULTIPLE_FACES",

"message": "Ảnh 1 có nhiều khuôn mặt. Hãy chọn đúng người cần đăng ký.",

"details": {

"images": \[

{

"imageIndex": 0,

"faces": \[

{

"faceIndex": 0,

"boundingBox": {

"x": 0.12,

"y": 0.18,

"width": 0.22,

"height": 0.31

}

}

\]

}

\]

},

"traceId": "..."

}

}

Không trả crop khuôn mặt hoặc nội dung ảnh từ server. Frontend đã có file local để hiển thị.

Nếu nhiều ảnh cùng có nhiều mặt, trả toàn bộ kết quả cần chọn trong một response để người dùng xử lý một lần.

**5\. OpenAPI contract**

Sửa api/openapi.yaml và api/openapi-ai-service.yaml trước khi triển khai.

**5.1. Public Orchestrator API**

Giữ:

GET /known-faces

POST /known-faces

DELETE /known-faces/{knownFaceId}

Mở rộng POST với faceSelections.

Bổ sung response:

400 INVALID_IMAGE

401 UNAUTHORIZED

403 FORBIDDEN

409 KNOWN_FACE_NAME_EXISTS

413 IMAGE_TOO_LARGE

422 NO_FACE_DETECTED

422 MULTIPLE_FACES

422 FACE_SELECTION_INVALID

422 FACE_IMAGES_INCONSISTENT

503 FACE_PROVIDER_UNAVAILABLE

KnownFace không chứa:

- Embedding.
- Embedding base64.
- Rekognition collection ID.
- Ảnh hoặc URL ảnh.
- Bounding box của ảnh đăng ký.

**5.2. Internal AI API**

Mở rộng POST /face/embed:

image

selectedFaceIndex?

Response cần đủ thông tin:

faces\[\]

selectedFaceIndex

embeddingBase64

embeddingDim

modelVersion

provider

error

Quy tắc:

- Không có face: error.code = NO_FACE_DETECTED.
- Một face: tự chọn 0.
- Nhiều face và không có selection: trả danh sách face, không trả embedding.
- Có selection hợp lệ: trả embedding của face đó.
- Selection ngoài phạm vi: FACE_SELECTION_INVALID.

AI API dùng X-Internal-Token; frontend không gọi trực tiếp AI service.

Sau khi sửa contract:

pnpm api:lint

pnpm contracts:generate

**6\. AI Service**

**6.1. Cấu trúc**

services/ai-service/app/

routers/

face.py

models/

face.py

services/

face_detector.py

face_embedder.py

face_collection.py

embedding_codec.py

**6.2. Face detection**

- Decode ảnh trong bộ nhớ.
- Sửa EXIF orientation.
- Chuyển đúng color space.
- Detect toàn bộ khuôn mặt.
- Trả bounding box chuẩn hóa 0–1.
- Thứ tự face phải ổn định:
  - Trên xuống dưới.
  - Trái sang phải khi cùng hàng.
- Không chọn tự động "khuôn mặt lớn nhất" khi có nhiều người.

**6.3. Embedding**

- Crop/alignment theo model được chọn.
- Trả float32 đã pack rồi encode base64 qua internal API.
- Luôn trả embeddingDim và modelVersion.
- Không ghi embedding vào log.
- Không ghi ảnh ra filesystem.
- Giải phóng buffer sau request.

**6.4. Collection**

POST /face/collection/sync:

- Nhận toàn bộ known faces đang hoạt động.
- Validate dimension/model version.
- Tạo collection mới trong bộ nhớ trước.
- Chỉ swap collection đang dùng sau khi validate thành công.
- Request match đang chạy không nhìn thấy collection nửa cập nhật.
- Không log embedding payload.

**7\. Orchestrator Backend**

**7.1. Cấu trúc module**

apps/orchestrator/src/known-faces/

known-faces.module.ts

known-faces.controller.ts

known-faces.service.ts

known-faces.repository.ts

face-inference.interface.ts

ai-face-inference.service.ts

face-collection-sync.service.ts

dto/

apps/orchestrator/src/audit/

audit.module.ts

audit.repository.ts

audit.service.ts

Nếu audit module đã được tạo bởi story khác, tái sử dụng thay vì tạo module trùng.

**7.2. Luồng tạo người quen**

1\. Xác thực ADMIN.

2\. Validate tên, quan hệ và 1–5 file.

3\. Đọc từng file trong bộ nhớ.

4\. Gọi AI /face/embed.

5\. Thu thập tất cả trường hợp no-face/multiple-face.

6\. Nếu cần chọn mặt, trả 422 và không ghi DB.

7\. Nếu đã đủ selection, lấy các embedding.

8\. Kiểm tra model version/dimension.

9\. Kiểm tra tính nhất quán giữa ảnh.

10\. Tạo embedding đại diện.

11\. INSERT known_faces trong transaction.

12\. Đồng bộ collection AI.

13\. Trả KnownFace không chứa embedding.

14\. Xóa/giải phóng mọi buffer ảnh.

Không ghi một phần dữ liệu nếu ảnh thứ ba trong năm ảnh bị lỗi.

**7.3. Xử lý collection sync**

Sau khi tạo hoặc xóa:

- Đánh dấu collection version mới.
- Gọi AI service sync collection.
- Nếu AI service tạm thời offline:
  - Dữ liệu DB vẫn là nguồn chuẩn.
  - Ghi công việc retry bền vững.
  - Không trả thành công giả rằng collection đã dùng dữ liệu mới.
- Khi AI service khởi động, nạp lại collection từ DB.

Với thao tác thêm, response có thể chứa trạng thái:

recognitionStatus: READY | SYNC_PENDING | FAILED

nếu cần hiển thị cho ADMIN. Phải thêm vào OpenAPI trước.

**8\. Xóa vĩnh viễn và audit log**

**8.1. Xác nhận trên UI**

Dialog phải ghi rõ:

Xóa người quen "Nguyễn Văn A"?

Dữ liệu khuôn mặt sẽ bị xóa vĩnh viễn và không thể khôi phục.

Nút destructive ghi "Xóa vĩnh viễn".

**8.2. Local provider**

Trong cùng một DB transaction:

1. Lock record cần xóa.
2. Lấy thông tin tối thiểu phục vụ audit.
3. DELETE FROM known_faces.
4. INSERT audit_logs:
   - action = KNOWN_FACE_DELETED.
   - actor_user_id.
   - entity_type = KNOWN_FACE.
   - entity_id.
   - IP.
   - User-Agent.
   - Metadata không chứa embedding.
5. Commit.

Sau đó đồng bộ lại AI collection.

Audit log có thể lưu personName nếu chính sách cho phép, nhưng không được chứa:

- Embedding.
- Face crop.
- Ảnh.
- Rekognition Face ID đầy đủ nếu được coi là identifier nhạy cảm.

**8.3. Rekognition provider**

Trình tự:

1. Kiểm tra quyền và lock record.
2. Gọi xóa Face ID khỏi Rekognition.
3. Nếu remote delete thất bại, không xóa DB và trả lỗi có thể retry.
4. Sau khi remote xác nhận xóa, transaction xóa DB và ghi audit.
5. Đồng bộ lại local collection/cache.

Vì không thể tạo transaction ACID chung giữa PostgreSQL và Rekognition, cần job reconciliation cho trường hợp remote đã xóa nhưng DB transaction thất bại.

**8.4. Quan hệ với event cũ**

Bảng events.matched_known_face_id hiện tham chiếu known face. Agent phải kiểm tra ON DELETE thực tế:

- Nên dùng ON DELETE SET NULL.
- Lịch sử event không được chặn thao tác xóa dữ liệu sinh trắc học.
- Không sao chép embedding vào event hoặc audit log.
- Nếu cần giữ tên hiển thị lịch sử, lưu snapshot tên không chứa dữ liệu sinh trắc học bằng migration riêng.

**9\. Frontend**

**9.1. Điều hướng**

Sidebar hiện chưa có mục "Người quen". Bổ sung NavItem:

<NavItem

label="Người quen"

active={activeNav === 'known-faces'}

onClick={() => onSelectNav('known-faces')}

icon={&lt;KnownFacesIcon /&gt;}

/>

Chỉ ADMIN thấy thao tác thêm/xóa. Việc có ẩn toàn bộ NavItem với role khác hay cho phép read-only phải khớp chính sách trong OpenAPI.

DashboardView render KnownFacesView khi activeNav === 'known-faces'.

**9.2. Cấu trúc**

apps/web/src/components/known-faces/

KnownFacesView.tsx

KnownFaceList.tsx

KnownFaceCard.tsx

AddKnownFaceDialog.tsx

FaceImagePicker.tsx

FaceSelectionOverlay.tsx

DeleteKnownFaceDialog.tsx

RegistrationProgress.tsx

known-faces-\*.module.css

index.ts

apps/web/src/hooks/

useKnownFaces.ts

useKnownFaceRegistration.ts

apps/web/src/lib/

known-faces-client.ts

**9.3. Danh sách**

Vì không lưu ảnh gốc, card không được giả vờ có ảnh chân dung.

Hiển thị:

- Avatar chữ cái từ tên.
- Tên.
- Quan hệ.
- Provider.
- Số ảnh nguồn đã dùng.
- Model version nếu cần debug.
- Ngày đăng ký.
- Trạng thái sẵn sàng nhận diện.
- Nút xóa cho ADMIN.

Empty state:

Chưa có người quen nào.

Thêm thành viên để hệ thống nhận diện và giảm cảnh báo không cần thiết.

**9.4. Form thêm người quen**

Các bước:

1\. Nhập thông tin.

2\. Chọn 1–5 ảnh.

3\. Kiểm tra ảnh.

4\. Chọn khuôn mặt nếu cần.

5\. Xác nhận đăng ký.

6\. Hiển thị kết quả.

Mỗi ảnh hiển thị:

- Preview local.
- Tên file.
- Trạng thái:
  - Chưa xử lý.
  - Đang phân tích.
  - Hợp lệ.
  - Không tìm thấy mặt.
  - Cần chọn mặt.
  - Đã chọn mặt.
- Nút bỏ ảnh.

Khi có nhiều face:

- Overlay bounding boxes có số thứ tự.
- Người dùng click box hoặc nút tương ứng.
- Box được chọn có icon/check và label rõ ràng.
- Không chỉ dùng màu để thể hiện lựa chọn.

**9.5. Quyền riêng tư trên UI**

Hiển thị ghi chú cạnh uploader:

Ảnh chỉ được dùng để tạo dữ liệu nhận diện trong lúc đăng ký.

Hệ thống không lưu ảnh gốc dài hạn.

Sau khi request hoàn tất hoặc bị hủy:

- Xóa File khỏi state.
- Revoke object URLs.
- Reset input.
- Không lưu preview vào localStorage, IndexedDB hoặc cache ứng dụng.

Không dùng service worker để cache request upload.

**10\. Bảo mật và riêng tư**

- Upload chỉ qua HTTPS ngoài môi trường local.
- Không gửi ảnh trực tiếp từ frontend sang AI service.
- AI service chỉ nhận request có internal token.
- Không log multipart body.
- Không log base64 embedding.
- Không trả embedding trong API public.
- Không lưu file tạm nếu có thể xử lý streaming/in-memory.
- Nếu thư viện bắt buộc dùng file tạm:
  - Tạo trong thư mục riêng.
  - Tên ngẫu nhiên.
  - Quyền truy cập hạn chế.
  - Xóa trong finally.
  - Có cleanup job cho file còn lại sau crash.
- Thêm timeout cho AI inference.
- Giới hạn đồng thời để tránh upload ảnh làm cạn RAM.
- Rate limit endpoint đăng ký.
- Audit thao tác xóa và các lỗi quản trị quan trọng.
- Không đưa ảnh thật vào fixture hoặc Git.

**11\. Kiểm thử**

**AI service**

- Ảnh không có mặt.
- Ảnh có một mặt.
- Ảnh có nhiều mặt.
- Selection hợp lệ/không hợp lệ.
- Ảnh hỏng.
- EXIF rotation.
- Bounding box chuẩn hóa.
- Embedding dimension/model version.
- Không tạo file ảnh dài hạn.
- Collection sync atomic.

Dùng ảnh test có giấy phép hoặc ảnh tổng hợp, không dùng ảnh thành viên thật.

**Orchestrator**

- Upload 0, 1, 5 và 6 ảnh.
- MIME giả nhưng magic bytes sai.
- File quá lớn.
- Một trong nhiều ảnh không có mặt.
- Nhiều ảnh cùng cần chọn face.
- Trùng tên.
- Embedding khác dimension/model.
- Ảnh được chọn có vẻ không cùng người.
- DB lỗi không để lại record một phần.
- Response không chứa embedding.
- Non-ADMIN nhận 403.
- AI service timeout.
- Collection sync retry sau restart.

**Xóa**

- Xóa local embedding thật khỏi DB.
- Audit được ghi.
- Audit không chứa embedding.
- Record không còn trong collection AI.
- Xóa ID không tồn tại trả 404.
- User khác không xóa được record ngoài phạm vi.
- Event cũ không chặn xóa.
- Rekognition delete thất bại không báo xóa thành công.

**Frontend**

- NavItem mở đúng trang.
- Chọn 1–5 ảnh.
- Preview local.
- Hiển thị rõ lỗi không có mặt.
- Chọn mặt trong ảnh nhiều người.
- Giữ form khi request lỗi có thể sửa.
- Xác nhận xóa.
- Sau thành công danh sách cập nhật không cần reload.
- Object URL được revoke.
- Responsive 360px.
- Điều hướng bằng bàn phím và screen reader label.

**E2E acceptance**

**Kịch bản 1 — Đăng ký thành công**

Given ADMIN ở trang Người quen

When nhập tên và upload 1–5 ảnh hợp lệ

Then known_faces có đúng một record

And embedding/provider ID tồn tại

And ảnh gốc không tồn tại trong storage

And người đó xuất hiện trong danh sách

And AI collection nhận record mới

**Kịch bản 2 — Không có khuôn mặt**

Given ảnh không có khuôn mặt

When đăng ký

Then hiển thị lỗi rõ ràng

And không tạo known_faces

And không giữ ảnh tạm

**Kịch bản 3 — Nhiều khuôn mặt**

Given ảnh có nhiều khuôn mặt

When xử lý lần đầu

Then hiển thị các bounding box

When ADMIN chọn đúng khuôn mặt và gửi lại

Then embedding của lựa chọn đó được lưu

**Kịch bản 4 — Xóa**

Given một người quen đã tồn tại

When ADMIN xác nhận xóa

Then record và embedding bị DELETE thật

And collection nhận diện không còn người đó

And audit log có KNOWN_FACE_DELETED

And audit log không chứa dữ liệu sinh trắc học

**12\. Trình tự thực hiện**

1. Hoàn thiện quyết định model/provider cho môi trường local.
2. Cập nhật hai OpenAPI, đặc biệt faceSelections.
3. Generate contracts.
4. Triển khai face router và embedding service.
5. Triển khai collection sync.
6. Triển khai KnownFacesModule.
7. Triển khai transaction tạo/xóa và audit.
8. Bổ sung NavItem và KnownFacesView.
9. Triển khai multi-face selection.
10. Kiểm thử privacy và cleanup.
11. Kiểm thử E2E đăng ký/xóa.
12. Cập nhật tài liệu vận hành.

**13\. Definition of Done**

- Sidebar có mục "Người quen" và mở đúng màn hình.
- ADMIN upload được 1–5 ảnh.
- Một request tạo đúng một người quen.
- Ảnh không có mặt không tạo record.
- Ảnh nhiều mặt yêu cầu chọn và dùng đúng face đã chọn.
- Nhiều ảnh được kiểm tra là cùng một người.
- Chỉ embedding hoặc provider Face ID được lưu.
- Không lưu ảnh gốc dài hạn.
- Public API không trả embedding.
- Người quen mới được nạp vào collection nhận diện.
- Xóa là hard delete.
- Rekognition Face ID cũng bị xóa nếu dùng provider này.
- Audit log ghi KNOWN_FACE_DELETED.
- Audit log không chứa dữ liệu sinh trắc học.
- Role không phải ADMIN không thể thêm/xóa.
- Contract, generated types, tests và tài liệu được cập nhật.
- pnpm check:all chạy thành công.
