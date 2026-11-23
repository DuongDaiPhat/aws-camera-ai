# Face branch verification — 23/11/2026

Phạm vi: nhánh `feat/face-track-once-optimization`, Face Track Once với quality
gate R50, prototype bank và guard chống lây nhãn. Đợt này bổ sung Unit,
Integration model thật, Postman/Newman và k6; chạy regression backend, frontend,
AI, PostgreSQL/MQTT, Lambda và frame bridge.

## Kết quả thực thi

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

Source/test commit: 7afc1ddf5995f60a71609acb202535f0b001bae1. Lượt pnpm check:all cuối có exit code 0: typecheck, lint (còn warnings), OpenAPI lint, format, backend 660/660, web 368/368 và AI 158/158 đều đạt. Các commit tiếp theo chỉ bổ sung tài liệu/bằng chứng và Postman environment template.
