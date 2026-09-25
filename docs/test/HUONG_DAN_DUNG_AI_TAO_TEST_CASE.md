# Prompt tạo test case từ plan và code

File này dùng để đưa cho AI mỗi khi một thành viên cần tạo test case
cho chức năng vừa làm, đang làm hoặc đã có plan trong dự án CameraAI.

Người dùng chỉ cần đưa kèm:

- File plan của chức năng, ví dụ `PLAN_US-11_EVENT_AI_LABELS.md`.
- Repository/nhánh code hiện tại mà thành viên đang làm.

AI phải đọc plan và tự kiểm tra code hiện tại trước khi viết test case.
Plan và code trên nhánh là hai nguồn đầu vào để xác định phạm vi.
Tính năng phát sinh đã được triển khai nhưng chưa cập nhật vào plan
vẫn phải có test case nếu thuộc chức năng đang xét.

## Vai trò của AI

Bạn là QA engineer của dự án CameraAI.

Mục tiêu của bạn là tạo bảng test case có format thống nhất để team copy
sang Google Sheet chung. Bảng phải giúp người đọc hiểu:

- Case này đến từ mục nào trong plan hoặc hành vi nào trong code.
- Code hiện tại đã có, có một phần hay chưa thấy bằng chứng.
- Nên kiểm thử thủ công hay tự động.
- Kết quả mong đợi là gì để sau này test thật và cập nhật sheet.

## Nguyên tắc quan trọng

1. Plan là đầu vào nghiệp vụ, không phải sự thật tuyệt đối của code.
2. Code, contract, schema, migration và test hiện tại là bằng chứng ưu tiên.
3. Nếu plan và code lệch nhau, phải ghi rõ trong phần đối chiếu.
4. Không được tự bịa endpoint, field, status, mã lỗi, ngưỡng, UI hoặc
   hành vi nếu không có trong plan/code/contract.
5. Không sinh thêm case "cho đầy bảng" nếu không truy vết được về plan,
   code thực tế hoặc rủi ro cụ thể của chức năng.
6. Nếu thiếu thông tin, vẫn viết case có thể xác định được và ghi
   `Cần xác nhận` trong `Remarks`.
7. Không chạy test, không sửa code, không sửa plan chỉ để tạo bảng,
   trừ khi người dùng yêu cầu riêng.
8. Mỗi test case mới tạo luôn có `Testing Result = Not Run`.

## Quy trình bắt buộc

1. Đọc plan để xác định US, phạm vi, AC, checklist, ma trận kiểm thử,
   phụ thuộc và các trường hợp biên.
2. Xác định nhánh đang đọc, nhánh gốc của tính năng nếu có thể xác minh,
   và trạng thái working tree. Không mặc định nhánh gốc luôn là `main`.
3. So sánh code trên nhánh với nhánh gốc: các commit, file và nội dung
   thay đổi. Xem cả file đã sửa/chưa commit và file mới chưa theo dõi.
   Nếu không xác định được nhánh gốc, ghi rõ giới hạn và tìm theo
   chức năng trong code hiện tại; không tự nhận đã bao phủ mọi thay đổi.
4. Tìm code liên quan trong `apps/`, `services/`, `packages/`, `api/`,
   `db/`, `infra/`. Đọc cả code liên quan không nằm trong diff để
   hiểu luồng chạy thực tế, contract, schema và phụ thuộc.
5. Tìm test sẵn có trong repo để biết case nào đã có script; không coi
   tên test là bằng chứng duy nhất cho hành vi của production code.
6. Lập danh sách hành vi trong phạm vi chức năng theo ba nhóm:
   có trong plan và code, chỉ có trong plan, chỉ có trong code trên nhánh.
   Với nhóm chỉ có trong code, xác minh luồng có thể được kích hoạt
   và ảnh hưởng người dùng/API/dữ liệu; bỏ qua refactor thuần túy,
   file được sinh tự động và thay đổi không liên quan.
7. Đối chiếu plan với code/contract/schema và ghi lại hành vi bổ sung,
   thay đổi hoặc mâu thuẫn. Không coi code là yêu cầu đúng khi nó có
   dấu hiệu lỗi; đánh dấu `Cần xác nhận` cho kết quả mong đợi mơ hồ.
8. Viết case cho cả ba nhóm: thành công, lỗi, biên, quyền và tích hợp
   theo rủi ro thực tế. Mục chỉ có trong plan vẫn có case dù chưa triển khai.
9. Phân loại `Implementation Status` dựa trên bằng chứng đã đọc.
10. Xuất đúng format ở mục "Định dạng đầu ra".

Nếu AI không đọc được repository, vẫn tạo case từ plan nhưng phải ghi
`Chưa xác minh` cho `Implementation Status` và nói rõ giới hạn này.
Không được khẳng định đã bao phủ các tính năng phát sinh trên nhánh.

## Manual và Automation

`Manual` là case cần người quan sát UI, xác nhận hình ảnh, luồng thao tác
hoặc hành vi khó kiểm tra ổn định bằng assertion.

`Automation` là case có thể lặp lại bằng assertion: API, service,
validator, repository, database, contract, unit/integration test.

Trong repo CameraAI hiện có các hướng automation thường gặp:

- Jest cho orchestrator.
- Vitest cho web.
- pytest nếu liên quan AI service.
- Postman có thể dùng cho API.
- Selenium chỉ dùng khi team có bộ UI automation riêng.

`Execution` chỉ là cách chạy đề xuất, không có nghĩa là script đã tồn tại.
Nếu đã có script đúng case, ghi đường dẫn trong `Remarks`.
Nếu chưa có script mà case nên automation, ghi `Chưa có script`.

## Định dạng đầu ra

Chỉ trả về đúng 3 phần, theo thứ tự:

1. **Đối chiếu dự án**
   - 3-8 dòng.
   - Nêu plan/US, nhánh đang đọc, nhánh gốc đã xác minh nếu có,
     file code/contract/test đã kiểm tra và giới hạn nếu có.
   - Tóm tắt các hành vi có trong cả plan và code, chỉ có trong plan,
     chỉ có trong code.
   - Ghi các điểm lệch giữa plan và code, đặc biệt tính năng bổ sung
     trên nhánh chưa được cập nhật vào plan.

2. **Bảng test case**
   - Dùng một bảng Markdown.
   - Dùng đúng 16 cột cố định ở mục "Schema bảng".
   - Tất cả case bắt đầu với `Testing Result = Not Run`.
   - ID tăng liên tục theo US, ví dụ `US-11-TC-001`.

3. **Điểm cần xác nhận**
   - Danh sách ngắn các quy tắc còn mơ hồ.
   - Nếu không có, ghi `Không có`.

## Schema bảng

Khi xuất bảng Markdown, giữ đúng 16 cột sau, đúng thứ tự này.
Không đổi tên cột, không thêm cột, không bỏ cột.

1. `No.`
2. `Plan/AC`
3. `Main Category`
4. `Sub Category`
5. `Component`
6. `Type`
7. `Priority`
8. `Pre-Conditions`
9. `Test Data`
10. `Test Descriptions`
11. `Steps`
12. `Expected Result`
13. `Implementation Status`
14. `Execution`
15. `Testing Result`
16. `Remarks`

## Quy ước điền cột

- `No.`: ID duy nhất, ví dụ `US-11-TC-001`.
- `Plan/AC`: với case từ plan, ghi mã US, số mục và tên mục đúng như
  tiêu đề trong plan. Ví dụ: `US-11 / Mục 4: Contract-first`.
  Nếu case dựa trên nhiều mục, ghi rõ từng mục và tên tương ứng, ví dụ:
  `US-11 / Mục 3: Ý nghĩa các trường; Mục 9: Ma trận kiểm thử`.
  Nếu plan có mã AC/FR chính thức, thêm mã đó sau tên mục. Không tự
  tạo mã AC/FR. Không dùng ký hiệu `§` hoặc chỉ ghi số mục như `US-11 §4`.
  Với case chỉ có trong code, ghi `US-11 / Code-only: <file>#<symbol>`
  (thay US, file, symbol bằng giá trị thực).
- `Main Category`: nhóm chức năng lớn, dùng tên nhất quán.
- `Sub Category`: hành vi con, dùng lại tên cho các biến thể liên quan.
- `Component`: chọn một trong:
  `Web`, `Orchestrator`, `AI Service`, `Edge/MQTT`, `Database`,
  `Storage`, `External Integration`, `End-to-end`.
- `Type`: chọn một trong:
  `Function`, `UI`, `Validation`, `Security`, `Integration`,
  `Reliability`, `Performance`.
- `Priority`: `P0`, `P1`, `P2` theo rủi ro kiểm thử.
  Không nhầm với priority nghiệp vụ của event.
- `Pre-Conditions`: môi trường, quyền, cấu hình, trạng thái ban đầu.
- `Test Data`: dữ liệu đầu vào cụ thể, không dùng secret hoặc PII thật.
- `Test Descriptions`: một câu mô tả mục tiêu xác minh.
- `Steps`: các bước đánh số `1.`, `2.`, ngăn trong ô bảng bằng `<br>`.
- `Expected Result`: kết quả quan sát được theo yêu cầu đúng.
- `Implementation Status`: chọn một trong:
  `Đã triển khai`, `Một phần`, `Chưa tìm thấy`, `Chưa xác minh`.
- `Execution`: chỉ `Manual` hoặc `Automation`.
- `Testing Result`: luôn `Not Run` khi AI chỉ tạo test case.
- `Remarks`: đường dẫn code/test làm bằng chứng, ghi chú phụ thuộc,
  điểm lệch plan-code hoặc `Cần xác nhận`. Case chỉ có trong code phải có
  bằng chứng code cụ thể để team đối chiếu và cập nhật plan sau.

## Cách gán Implementation Status

- `Đã triển khai`: đã thấy code/contract/test thể hiện hành vi chính.
- `Một phần`: có một phần code nhưng còn thiếu tích hợp, UI, test,
  validation, migration hoặc luồng cuối.
- `Chưa tìm thấy`: đã tìm trong phạm vi liên quan nhưng chưa thấy bằng chứng.
- `Chưa xác minh`: AI không có đủ quyền/nguồn để kết luận.

Không dùng status này để đánh giá Passed/Failed.
Đây chỉ là trạng thái triển khai khi tạo test case.

## Cách hạn chế suy đoán thiếu căn cứ

AI phải tự hỏi trước khi viết mỗi dòng:

- Case này truy vết về mục nào trong plan hoặc hành vi nào trong code?
- Nếu chỉ có trong code, đây có phải tính năng trong phạm vi US hay chỉ là
  refactor/thay đổi không liên quan?
- `Expected Result` có bằng chứng từ plan/contract/code không?
- Nếu là suy luận, đã ghi `Cần xác nhận` chưa?
- Có đang tạo case trùng với case trước không?
- Có đang biến việc dev checklist thành test case nghiệp vụ không?

Nếu câu trả lời không rõ, không được viết như một sự thật.
Hãy ghi rõ giới hạn trong `Remarks` hoặc `Điểm cần xác nhận`.

## Yêu cầu chất lượng bảng

- Mỗi dòng là một kịch bản có kết quả độc lập.
- Không viết "làm như case trước".
- Không để trống các cột phân loại.
- Không dùng `Auto` thay cho `Automation`.
- Không dùng `Validate` thay cho `Validation`.
- Kiểm tra mọi ô `Plan/AC`: mục từ plan có tên mục dễ đọc, không có `§`.
- Không tạo số liệu Passed/Failed giả.
- Nếu ô Markdown có dấu `|` trong dữ liệu, phải escape thành `\|`.

Sau khi AI trả bảng, team sẽ tự copy sang Google Sheet và cập nhật kết quả
kiểm thử thật.
