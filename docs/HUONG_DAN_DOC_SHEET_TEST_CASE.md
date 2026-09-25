# Hướng dẫn đọc và điền sheet test case

File này giúp thành viên trong team hiểu bảng test case chung.
Mục tiêu là mọi người đọc cùng một ý nghĩa cột và điền cùng format.

## Luồng làm việc

1. Thành viên code xong hoặc có plan cần tạo test case.
2. Đưa plan và file prompt `HUONG_DAN_DUNG_AI_TAO_TEST_CASE.md` cho AI.
3. AI đọc plan, đối chiếu code trên nhánh hiện tại và tạo bảng test case.
4. Team copy bảng test case sang Google Sheet chung.
5. Tester thực thi case và cập nhật `Testing Result`.

## Ý nghĩa các cột

- `No.`: mã test case duy nhất, ví dụ `US-11-TC-001`.
- `Plan/AC`: nguồn yêu cầu mà case đang kiểm tra.
- `Main Category`: nhóm chức năng lớn.
- `Sub Category`: hành vi con trong nhóm chức năng.
- `Component`: thành phần dự án bị kiểm tra.
- `Type`: loại kiểm thử chính của case.
- `Priority`: độ ưu tiên kiểm thử theo rủi ro.
- `Pre-Conditions`: điều kiện cần có trước khi test.
- `Test Data`: dữ liệu dùng để test.
- `Test Descriptions`: mô tả ngắn case cần xác minh.
- `Steps`: các bước tester thực hiện.
- `Expected Result`: kết quả đúng cần quan sát.
- `Implementation Status`: trạng thái code tại thời điểm tạo case.
- `Execution`: đề xuất chạy thủ công hay tự động.
- `Testing Result`: kết quả sau khi tester thực thi.
- `Remarks`: ghi chú, bằng chứng code/test, hoặc điểm cần xác nhận.

## Giá trị thống nhất

`Component` chỉ dùng một trong các giá trị:

- `Web`
- `Orchestrator`
- `AI Service`
- `Edge/MQTT`
- `Database`
- `Storage`
- `External Integration`
- `End-to-end`

`Type` chỉ dùng một trong các giá trị:

- `Function`
- `UI`
- `Validation`
- `Security`
- `Integration`
- `Reliability`
- `Performance`

`Priority` chỉ dùng:

- `P0`: luồng cốt lõi, bảo mật, an toàn, dữ liệu, tích hợp quan trọng.
- `P1`: hành vi quan trọng nhưng không chặn toàn bộ chức năng.
- `P2`: trường hợp phụ, hiển thị, biến thể ít rủi ro.

`Implementation Status` chỉ dùng:

- `Đã triển khai`: đã thấy bằng chứng code/contract/test cho hành vi chính.
- `Một phần`: đã có một phần nhưng còn thiếu tích hợp hoặc chi tiết.
- `Chưa tìm thấy`: đã tìm trong phạm vi liên quan nhưng chưa thấy code.
- `Chưa xác minh`: chưa đủ quyền hoặc nguồn để kết luận.

`Execution` chỉ dùng:

- `Manual`: tester cần thao tác/quan sát và đánh giá.
- `Automation`: nên kiểm tra bằng script hoặc assertion lặp lại được.

`Testing Result` khi mới tạo case luôn là:

- `Not Run`

Sau khi test thật, tester cập nhật thành:

- `Passed`
- `Failed`
- `Blocked`
- `N/A`

## Manual và Automation

Manual phù hợp với:

- UI cần quan sát bằng mắt;
- hình ảnh, video, modal, thông báo;
- luồng người dùng cần đánh giá trải nghiệm;
- tình huống chưa có môi trường automation ổn định.

Automation phù hợp với:

- API request/response;
- validator và service logic;
- database transaction, migration, idempotency;
- contract/schema;
- logic có đầu vào và kết quả rõ ràng.

Nếu chọn `Automation` nhưng chưa có script, ghi `Chưa có script`
trong `Remarks`.

## Cách đọc Implementation Status

Cột này không phải kết quả test.

Ví dụ:

- `Đã triển khai` + `Not Run` nghĩa là code đã có, nhưng tester chưa chạy case.
- `Một phần` + `Not Run` nghĩa là case vẫn cần có để theo dõi phần còn thiếu.
- `Chưa tìm thấy` + `Not Run` nghĩa là đây là kỳ vọng theo plan,
  hiện chưa thấy code trong phạm vi đã kiểm tra.

Khi tester chạy thật mới cập nhật `Testing Result`.

## Quy tắc khi cập nhật sheet

- Không sửa tên cột.
- Không thêm cột riêng cho từng người.
- Không đổi giá trị enum sang viết tắt tùy tiện.
- Không xóa case chỉ vì chức năng chưa triển khai.
- Nếu case sai do plan đổi, ghi lý do vào `Remarks` trước khi sửa.
- Nếu bug xảy ra, cập nhật `Testing Result = Failed` và ghi rõ link/log/ảnh.
- Nếu bị chặn bởi môi trường, dùng `Blocked` và ghi nguyên nhân.

## Cách giải thích với thầy hoặc reviewer

Bảng này gồm hai lớp thông tin:

- Lớp thiết kế test case: case nào cần kiểm tra và kỳ vọng đúng là gì.
- Lớp theo dõi thực thi: case đã chạy chưa, kết quả ra sao, có bị chặn không.

Việc tách `Implementation Status` và `Testing Result` giúp tránh nhầm lẫn:

- code có hay chưa là trạng thái triển khai;
- test pass hay fail là kết quả sau khi tester chạy.

Nhờ vậy team có thể tạo test case từ sớm theo plan, nhưng vẫn đối chiếu
được code thật trên nhánh hiện tại và cập nhật sheet một cách thống nhất.
