# Chạy lại bộ kiểm thử

Các file trong `regression/` là bản sao test đã chạy trên feature/candidate, không phải production fixes. Đọc `evidence/manifest.json` để lấy command, working directory, revision và exit code chính xác từng lượt. Log `.txt` chứa toàn output; Jest results `.json` chứa tên/status từng assertion.

## Chuẩn bị

1. Tạo checkout/worktree riêng từ hai feature heads đã ghi trong TEST_PLAN. Ghép candidate và giữ cả module import/register tại AppModule. Không ghép vào main khi vẫn còn lỗi.
2. Dùng Node22, pnpm9.12.0 và frozen lock; build `@cam/contracts`. Dùng Python3.11.13 cùng runtime lock và model manifest; set POSE_MODEL_PATH tới model lite đã kiểm checksum.
3. Copy `regression/qa-*.spec.ts` vào `apps/orchestrator/test/`, `regression/test_qa_pose.py` vào `services/ai-service/tests/`. Các import `../src/...` cố ý tương đối với vị trí đích này; không chạy Jest trực tiếp từ thư mục tài liệu.
4. Với integration/HTTP, chỉ tạo PostgreSQL16 disposable **riêng**, database `qa_runtime`, user `qa`, password kiểm thử `qa-disposable-only`, host127.0.0.1:55432. Apply 17 migrations bằng runner repository với DATABASE_URL trỏ đúng DB đó. Test có kiểm tra tên DB/server16, không dùng database thật. Fixture JWT/password trong test là dữ liệu tổng hợp, không dùng cho ứng dụng thật.

## Các suite

Tại repository candidate, sau khi copy tests:

```powershell
pnpm --filter @cam/contracts build
pnpm --filter @cam/orchestrator exec jest test/qa-fall.spec.ts --runInBand --no-cache
pnpm --filter @cam/orchestrator exec jest test/qa-wellness.spec.ts --runInBand --no-cache
pnpm --filter @cam/orchestrator exec jest --testRegex 'qa-db.integration.spec.ts$' --runInBand --no-cache
pnpm --filter @cam/orchestrator exec jest test/qa-system.spec.ts --runInBand --no-cache
```

Tại `services/ai-service`, dùng executable Python đúng môi trường:

```powershell
python -m pytest tests/test_qa_pose.py -o addopts= -v
python -m pytest --ignore=tests/test_qa_pose.py --basetemp=<thu-muc-tam-QA-rieng>
```

Thay `<thu-muc-tam-QA-rieng>` bằng đường dẫn riêng đã tạo parent, không dùng thư mục dữ liệu thật; pytest có thể dọn basetemp của nó. Khi chạy suite cũ tách biệt, bỏ các QA files bằng basename cụ thể, ví dụ `--testPathIgnorePatterns='qa-fall.spec.ts|qa-wellness.spec.ts|qa-system.spec.ts'`. Không dùng `qa-` trần vì toàn bộ đường dẫn worktree cũng chứa `qa-` và sẽ lọc hết tests.

`ai_http_smoke.py` chạy từ working directory `services/ai-service`, dùng server127.0.0.1:58001 và tự dừng server. Set POSE_MODEL_PATH bằng model đã pin. Đây chỉ là smoke ảnh trống, không đo chất lượng phát hiện ngã.

## Môi trường và attempt bị loại

Những lượt đầu gặp cache Jest sandbox, pytest temp permissions/parent chưa có, fixture thiếu login method, camera slug chứa dấu gạch và URL HTTP thiếu prefix api/v1. Đã sửa **test harness/môi trường** và chạy lại; không ghi các lỗi chuẩn bị này thành defect sản phẩm. Các label đủ điều kiện được liệt kê duy nhất trong manifest. Không dùng exit code của wrapper để kết luận; đọc trường `exit_code` của command con trong metadata.

Sau kiểm thử, chỉ thu hồi container/process disposable do mình tạo. Giữ source/test/report để reviewer kiểm tra; không reset DB hoặc xóa volume đang dùng.
