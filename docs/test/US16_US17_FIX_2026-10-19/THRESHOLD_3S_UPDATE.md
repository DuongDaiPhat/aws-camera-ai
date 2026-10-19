# US16/17 — đổi ngưỡng bất động sang 3 giây

Ngày 19/10/2026, theo yêu cầu người dùng, trên nhánh `fix/US-16-US-17-pose-fall`.

## Hành vi mới

Default `FALL_IMMOBILITY_SECONDS=3`. Giữ quy tắc nghiêm ngặt `>` của plan: **2,999s và 3,000s chưa CONFIRMED; 3,001s mới có thể CONFIRMED**, khi pose, continuity, motion và REST_AREA đều hợp lệ. Mất pose không cộng thời gian; grace mất pose vẫn 5 giây. Hai khoảng bất động 2s bị ngắt bởi chuyển động không được cộng thành 4s.

Đã đồng bộ Settings AI, FallResponse, fallback ConfigService/response validator, `.env.example`, cấu hình local `.env` và Compose cho cả AI/orchestrator. Plan US16/17, hai OpenAPI và generated contracts đều dùng default 3 giây. Ngưỡng escalation/deadline, login lock và các góc hình học không thay đổi. Không thay evidence hoặc pending submissions đã lưu bằng ngưỡng cũ.

## Kiểm chứng

| Hạng mục                                                            | Kết quả mới                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI + model thật, gồm biên 2.999/3/3.001 và reset interval           | 71 Passed; coverage 87.85% — [log](evidence/ai-tests-3s.txt)                                                                                                                                                                                         |
| Orchestrator pose/fall, bao gồm confirmation 3.2s và reject đúng 3s | 48 Passed — [log](evidence/fall-jest-3s.txt)                                                                                                                                                                                                         |
| TypeScript                                                          | Passed — [log](evidence/typecheck-3s.txt)                                                                                                                                                                                                            |
| OpenAPI                                                             | Valid, 5 warnings có sẵn — [log](evidence/api-lint-3s.txt)                                                                                                                                                                                           |
| Contracts generate/build                                            | Passed                                                                                                                                                                                                                                               |
| Ruff                                                                | Passed — [log](evidence/ruff-3s.txt)                                                                                                                                                                                                                 |
| Compose/whitespace                                                  | `docker compose config --quiet`, `git diff --check` Passed                                                                                                                                                                                           |
| PostgreSQL/MQTT/MinIO integration                                   | **Blocked bởi môi trường**: Docker Desktop Linux engine không chạy; lỗi setup `Could not find a working container runtime strategy`. [Log lượt thử](evidence/runtime-integration-3s.txt). Fixture hiện dùng 3.2s; phải chạy lại khi Docker sẵn sàng. |

Lượt 4/4 integration và ma trận 20 Passed/4 Blocked trong [báo cáo trước](REPORT.md) thuộc baseline 15 giây. Không dùng chúng để khẳng định integration hoặc acceptance 3 giây đã đạt. UI/Telegram/camera E2E chưa được nghiệm thu lại.

## Video

Replay đủ 103 clip với threshold 3 giây: 4/72 clip fall có CONFIRMED, 33/72 có candidate; 0/31 clip non_fall có CONFIRMED. Có 39 clip fall còn hơn 3 giây sau fallEndFrame. Đây là kết quả mô tả trên nhãn clip, không phải event-level accuracy hoặc nghiệm thu hệ thống; chất lượng model vẫn còn hạn chế.

Đã bổ sung threshold vào output evaluator và chuyển phép kiểm đủ tail sang ngưỡng đọc từ Settings. Kết quả mới được lưu riêng trong [dataset-evaluation-3s.json](evidence/dataset-evaluation-3s.json), không ghi đè evidence 15 giây. Số liệu này là replay offline bằng model thật, giữ thời gian gốc và dùng bbox annotation; chưa chứng minh association của Frigate hoặc delivery E2E.

Nếu tiến trình AI/orchestrator đang chạy, cần khởi động lại để đọc cấu hình mới và reset candidate/history; không ghép khoảng bất động từ hai phiên cấu hình khác nhau. Chưa khởi động hoặc triển khai runtime trong lượt thay đổi này.
