# Dữ liệu mẫu và schema G0 v1

Nguồn quyết định: [hợp đồng G0](../00_HOP_DONG_G0.md). Owner B quản lý schema, A/C review các phần liên quan. `queue-v1.schema.json` dùng JSON Schema Draft 2020-12, gồm bốn message queue; `$defs.deadlineCommand` và `$defs.notificationClaim` dành cho request API, không phải message của Results Queue.

`fixture-manifest.json` ghi kết quả mong đợi cho 12 mẫu. Đuôi `.valid.json` nghĩa đúng cấu trúc; `.invalid.json` nghĩa phải bị validator từ chối. Đây không phải dữ liệu đã provision trên AWS/DB. Các UUID, bucket, collection, timestamp là giả lập cố định. Mỗi file là ca độc lập trên baseline sạch, không publish tuần tự tất cả file với cùng resultId: cùng ID khác nội dung phải conflict.

## Cách dùng khi triển khai

1. Dùng schema này tạo validator cho producer/worker/consumer trong PR contract. B đồng bộ OpenAPI/generated contracts và DTO/service mới; không chỉ commit schema rồi đánh dấu runtime đã hỗ trợ.
2. Seed user/camera/known face/event bằng luồng app hợp lệ trong DB test riêng. Runner cần ánh xạ UUID mẫu → UUID thật, bucket/key/collection thật, session và timestamp phù hợp. Sau ánh xạ, lưu payload của mỗi ca để retry nguyên nội dung; không ghi token/ảnh vào fixture repo.
3. Chạy mẫu hợp lệ qua schema **và** validator/service nghiệp vụ của ứng dụng. Schema kiểm tra cấu trúc/format/score range; DB kiểm tra owner, quan hệ job/result, version, mapping và lease. Field giống nhau giữa envelope/payload, score policy và bounding box cũng phải kiểm tra trong runtime, JSON Schema này không chứng minh chúng đúng.
4. Từ `face-result-known.valid.json`, test duplicate bằng cách replay nguyên body 10 lần. Test conflict bằng cùng resultId nhưng đổi body. Test stale bằng revision mới với ID mới trước revision cũ. Không dùng các mẫu known/unknown độc lập như các lần retry của cùng result.
5. Test invalid-owner bằng UUID hợp lệ của user khác đã seed: schema vẫn pass nhưng nghiệp vụ phải reject/quarantine. Test rollback/crash/race trong test tích hợp của PR; các fixture cấu trúc không thay thế những test này.
6. Các timestamp tháng 11/2026 là ví dụ offline. Runtime runner phải tạo deadline mới và clock hợp lệ của môi trường thử, không copy deadline đã quá hạn lên workflow đang demo.

## Kiểm tra schema và fixture offline

Nếu môi trường Python đã có `jsonschema`, chạy tại root repo:

```powershell
python aws/sprint4/contracts/validate_fixtures.py
```

Script kiểm tra schema hợp lệ, format UUID/date-time và kết quả expected của từng fixture. Không gọi AWS hoặc thay đổi DB. Nếu thiếu thư viện, cài `jsonschema` trong môi trường Python riêng của người học hoặc dùng validator Draft 2020-12 tương đương. Đây là kiểm tra hợp đồng tài liệu, không phải kết quả test worker/app.
