# Face branch verification — 23/11/2026

Phạm vi: nhánh `feat/face-track-once-optimization`, Face Track Once với quality
gate R50, prototype bank và guard chống lây nhãn. Đợt này bổ sung Unit,
Integration model thật, Postman/Newman và k6; chạy regression backend, frontend,
AI, PostgreSQL/MQTT, Lambda và frame bridge.

## Kết quả thực thi trước khi đồng bộ main

| Nhóm                          | Kết quả                                                                            | Bằng chứng                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Backend regression + coverage | Full coverage snapshot 658/658; required checks cuối 660/660; nhóm face cuối 48/48 | [backend](evidence/backend-retest.txt), [face](evidence/face-final.txt)                              |
| AI regression                 | 158/158                                                                            | [pytest](evidence/ai-final.txt), [JUnit](evidence/ai-final.xml)                                      |
| Frontend regression           | 368/368                                                                            | [Vitest](evidence/web.txt)                                                                           |
| PostgreSQL/MQTT integration   | 98 pass, 6 skip thuộc hai suite Fire ngoài phạm vi                                 | [retest](evidence/integration-retest.txt), [JSON](evidence/integration-retest-results.json)          |
| Real-model integration        | 2/2, không mock detector/recognizer                                                | [pytest](evidence/real-model-integration.txt), [JUnit](evidence/real-model-integration.xml)          |
| Lambda face                   | 19/19                                                                              | [unittest](evidence/lambda-pass.txt)                                                                 |
| Frame bridge                  | 20/20                                                                              | [pytest](evidence/bridge.txt)                                                                        |
| Tooling                       | 116 pass, 1 skip theo runner                                                       | [Node test](evidence/tools.txt)                                                                      |
| Postman/Newman                | 10 request, 26 assertion pass                                                      | [log](evidence/newman-final.txt), [JUnit](evidence/newman.xml)                                       |
| k6                            | Đạt toàn bộ threshold khai báo trước chạy                                          | [summary](evidence/k6-summary.json), [log](evidence/k6.txt), [raw JSON Lines](evidence/k6-raw.jsonl) |
| Build backend                 | Pass                                                                               | [build](evidence/backend-build.txt)                                                                  |

Không cộng số test face vào số backend để tránh đếm trùng. Kết quả toàn bộ
required checks theo Git workflow được lưu riêng ở
[required-checks-final.txt](evidence/required-checks-final.txt).

## Coverage thực đo

| Phạm vi                                                         | Metric   | Đã phủ / tổng | Tỷ lệ  |
| --------------------------------------------------------------- | -------- | ------------- | ------ |
| Backend toàn bộ `src/**/*.ts`, trừ main/module theo Jest config | Lines    | 5891 / 8640   | 68.18% |
| Toàn module `src/face-recognition/*.ts`, trừ module wiring      | Lines    | 835 / 912     | 91.55% |
| Cùng module face                                                | Branches | 543 / 741     | 73.27% |
| AI `app`, không loại file để nâng số                            | Lines    | 1878 / 2035   | 92.29% |

Nguồn: [face coverage](evidence/face-coverage/coverage-summary.json),
[AI coverage](evidence/ai-final-coverage.json),
[backend LCOV](evidence/backend-lcov.info).
Backend coverage toàn bộ là snapshot của full regression trước hai test cache bổ
sung; không gán số này cho một full coverage run mới. Toàn repository chưa đạt
90%; không đồng nhất line coverage với branch coverage hoặc chất lượng model.
Các dòng/nhánh chưa phủ được giữ trong LCOV/HTML report.

## API và integration model thật

Collection Postman có thể import trực tiếp, chạy bằng Newman CLI. Kiểm tra:
401 và body UNAUTHORIZED cho 4 endpoint thiếu token; 422 khi thiếu image;
R50 READY/passed, vector 512D hữu hạn có norm gần 1; opt-out không trả embedding;
SFace 128D tương thích; BVA threshold -0.01 và 1.01 bị từ chối đúng field.

Hai integration test dùng lifespan FastAPI, detector YuNet và recognizer thật:
ảnh có mặt trả R50 512D/SFace 128D; ảnh trắng bị từ chối NO_FACE_DETECTED,
không có embedding. Server HTTP QA chỉ bind loopback 18082, provider local,
R50 kiểm tra SHA-256, không dùng AWS/DB sản phẩm.

Mã và lệnh tái lập: [tools/testing/face](../../../tools/testing/face/README.md).

## Hiệu năng k6

Ngưỡng QA local khai báo trong script trước chạy: 2 arrivals/s trong 60 giây,
2 VU dự cấp (tối đa 4), p95 <2000 ms, HTTP error =0, 100% assessment có
embedding R50 hợp lệ, dropped iteration =0, tối thiểu 120 request.
Đây là ngưỡng kiểm thử local do tác vụ thiết lập, chưa phải SLA staging được duyệt.

- 121 scenario iteration hoàn tất, không gián đoạn; thêm 1 warm-up request.
- 122 HTTP request tổng cộng, throughput toàn lượt 2.0159 requests/s.
- HTTP p95 **235.13 ms**, mean **182.14 ms**, max **360.42 ms**.
- HTTP error **0/122**, assertion thành công **121/121**, dropped iteration **0**.
- Máy Windows 10.0.26300, AMD Ryzen 5 5500U, 12 logical CPU,
  RAM 16,469,520,384 byte; R50 ONNX CPU, 2 intra-op thread, 1 inter-op thread.
- Dataset: một crop QA thật của TC02-no-glasses-final, model
  `yunet-2023mar-w600k-r50`. Warm-up ngoài scenario; summary HTTP gồm warm-up.

Đây là tải HTTP assess trên một ảnh lặp lại; chưa chứng minh công suất nhiều
camera, nhận diện nhiều người, soak test hoặc latency camera → cảnh báo AWS.
Không đổi threshold sau khi nhìn số đo.

## Fail, điều tra và retest

Giữ [lượt integration ban đầu](evidence/integration-direct.txt): 6 fail,
92 pass, 6 skip. Retest: 98 pass, 6 skip. Không sửa sản phẩm để làm xanh test.

1. Fixture Viewer được tạo sau migration 0021 chưa có camera grant nhưng test
   đòi đọc camera. Bổ sung grant cho đúng camera của fixture; giữ kiểm tra cô lập hộ.
2. SSE đã chuyển sang kiểm tra quyền bất đồng bộ qua PostgreSQL. Test phải chờ
   kết quả, có deadline 3 giây; vẫn kiểm tra người ngoài hộ không nhận sự kiện.
3. MQTT test chờ chuỗi log subscribe cũ. Sửa marker theo log hiện tại; vẫn giữ
   assertion message tới DB trong thời hạn và không ghi trùng.
4. Fixture actor Telegram thứ hai chưa thuộc hộ có event. Gán household đúng;
   giữ assertion chỉ một quyết định authoritative và replay không thêm audit.
5. Newman ban đầu fail SFace: server QA dùng provider Rekognition (endpoint embed
   chủ động không chạy local). Sửa riêng target QA sang local và đường dẫn model
   tuyệt đối để kiểm tra hợp đồng SFace; không thay cấu hình sản phẩm.

Các lỗi công cụ khác gồm pnpm launcher tải version qua mạng, dependency root
thiếu, quyền sandbox đọc dependency/Docker và thiếu boto3/rpds cho Windows.
Khôi phục bằng pnpm 9.12.0 offline, dùng virtualenv QA và dependencies Windows;
không tính các lỗi môi trường là defect sản phẩm. Hook commit không bị bỏ qua.

## Giới hạn bàn giao

- Hai Fire integration suite cần database/video stack riêng được skip, không Pass.
- Tooling có 1 skip theo runner, xem lý do trong log.
- Không replay AWS/video E2E mới trong đợt này. Bằng chứng Test 6 và reacceptance
  trước đó vẫn được giữ riêng, không đổi ngày chạy hay giả gắn thành lượt mới.
- Hai stress case mặt <80 px và việc thiếu E2E 720p vẫn là giới hạn đã công bố.
- Không push/merge/deploy trong yêu cầu commit local này.

Source/test commit: 7afc1ddf5995f60a71609acb202535f0b001bae1. Lượt pnpm check:all cuối có exit code 0: typecheck, lint (còn warnings), OpenAPI lint, format, backend 660/660, web 368/368 và AI 158/158 đều đạt. Các commit ngay sau lượt này bổ sung tài liệu/bằng chứng và Postman environment template. Xem mục sau rebase để biết phiên bản bàn giao mới nhất.

## Xác nhận sau rebase — phiên bản bàn giao

Đã fetch và rebase lên `origin/main` tại `600a7c9` theo GIT_WORKFLOW. Giữ nhánh
dự phòng `codex/face-before-main-rebase`. Source/test cuối:
`b8fee64cd30aaa7bde730d0f13f15db89a52eb9c`.

| Kiểm tra sau rebase           | Kết quả                          | Bằng chứng                                                                                                  |
| ----------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm check:all`              | Exit **0**                       | [log cuối](evidence/post-rebase-verified-checks.txt)                                                        |
| Backend Jest                  | **771/771**, 94 suite            | Cùng log required checks                                                                                    |
| Frontend Vitest               | **373/373**, 82 file             | Cùng log required checks                                                                                    |
| AI pytest                     | **158/158**, coverage **92.29%** | Cùng log required checks                                                                                    |
| DB/MQTT integration           | **150 pass**, 6 Fire test skip   | [log cuối](evidence/post-rebase-integration-final.txt), [JSON](evidence/post-rebase-integration-final.json) |
| Cloud queue/coordinator smoke | **38/38**                        | [log](evidence/post-rebase-smoke.txt)                                                                       |
| Cloud queue extended          | **39/39**                        | [retest](evidence/post-rebase-cloud-extended.txt)                                                           |
| Backend build, Compose config | Exit **0**                       | [build](evidence/post-rebase-build.txt)                                                                     |

Mã AI, module face-recognition và các script API/k6 không đổi so với nhánh dự
phòng trước rebase. [Manifest sau rebase](evidence/post-rebase-source-manifest.json)
ghi hash source và xác nhận phạm vi này không đổi. Kết quả Newman/k6 ở phần trên
được giữ đúng ngày chạy và phạm vi; không giả thành một lượt replay mới sau rebase.

Các vấn đề được phát hiện và sửa khi tích hợp main:

- Cloud Queue phải giữ cả giao dịch notification mới của main và callback Face
  sau commit. Cập nhật dependency trong fixture để kiểm tra cả hai luồng.
- Test mới từ main chưa kỳ vọng `collection_face_count` mà Face pipeline bổ sung.
  Assertion đã kiểm tra rõ giá trị **1**, giữ nguyên envelope, cached result và mappings.
- Hai integration test cũ đếm tổng notification là 1. Main nay chủ động tạo
  **SNS_EMAIL và TELEGRAM**; assertion mới kiểm tra chính xác danh sách hai kênh,
  tiếp tục bảo đảm replay không sinh bản ghi trùng.
- Một lượt NotificationBell timeout 5 giây khi nhiều worker cùng chạy với Docker.
  Giới hạn Jest/Vitest tối đa **2 worker** mỗi runner; không tăng timeout, không
  bỏ assertion. Lượt kiểm tra tổng sau điều chỉnh đạt toàn bộ 373 test frontend.

Giữ nguyên [required checks fail sau rebase](evidence/post-rebase-required-checks.txt),
[lượt timeout frontend](evidence/post-rebase-final-checks.txt) và
[integration trước retest](evidence/post-rebase-integration.txt) để truy vết.
Các lượt dừng ở format do JSON report mới sinh cũng được giữ trong evidence;
đây là lỗi định dạng artifact, không phải lỗi nghiệp vụ.

Google Sheets đã được điền theo rubric, giữ công thức và lịch sử các run.
Native API read-back xác minh khóa Run + Case và các trường bắt buộc. Đã render
bản export để xem tổng quan/coverage/performance; nội dung và công thức native
được kiểm chứng trực tiếp qua connector. Không dùng kết quả export thay cho
việc xác nhận phép tính trên Google Sheets.

### Coverage trên đúng source sau rebase

Full Jest coverage run: **771/771 pass**, exit 0. Toàn backend có **6039/8929 lines (67.63%)** và **3052/5318 branches (57.39%)**. Riêng module face-recognition có **835/912 lines (91.56%)**, **543/741 branches (73.28%)**; phần trăm này được làm tròn từ tử/mẫu số (Jest text truncates thành 91.55% và 73.27%). AI giữ **1878/2035 lines (92.29%)**, được xác nhận lại bằng pytest sau rebase.

Nguồn: [coverage summary](evidence/post-rebase-backend-coverage/coverage-summary.json), [metric theo phạm vi](evidence/post-rebase-coverage-metrics.json), [log full coverage](evidence/post-rebase-backend-coverage.txt). **Toàn backend chưa đạt 90%**; không dùng số module Face để thay cho toàn hệ thống.

Run đang chọn trên sheet là `RUN-20261123-FACE-POSTREBASE-VERIFIED`; API/k6 nằm
ở `RUN-20261123-FACE-BRANCH-FINAL`. Không tự mang kết quả cũ sang run mới.
[Snapshot read-back cuối](evidence/post-rebase-sheet-verification.json) xác nhận
không có khóa trùng hoặc thiếu trường minh chứng. Các ảnh từ bản export:
[tổng quan](evidence/sheet-overview-export.png),
[coverage](evidence/sheet-coverage-export.png),
[hiệu năng](evidence/sheet-performance-export.png).
Tab kết quả đã dùng đến hàng 300; cần mở rộng table/công thức khi thêm kết quả mới.
