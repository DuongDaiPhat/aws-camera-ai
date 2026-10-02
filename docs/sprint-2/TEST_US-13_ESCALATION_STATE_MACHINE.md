# Kế Hoạch & Kết Quả Kiểm Thử US-13: Escalation State Machine Theo Loại Sự Kiện

**Mã User Story:** US-13<br />
**Nhánh:** `feat/US-13-escalation-state-machine`<br />
**Yêu cầu kỹ thuật:** FR-ESC-01, FR-ESC-02, FR-ESC-03, FR-ESC-04, FR-ESC-05, FR-ESC-06, FR-ESC-07, FR-ESC-08, FR-ESC-09, FR-EVT-05, FR-DSH-06

---

## 1. Mục Tiêu Kiểm Thử

1. **Đánh giá quy tắc leo thang thuần túy (`evaluateEscalationPolicy`):**
   - Xác định vùng xám (T_low <= confidence < T_high) -> chuyển trạng thái `NOTIFIED` và tính toán `escalationDeadlineAt`.
   - Vùng tin cậy cao (confidence >= T_high) -> chuyển trực tiếp `ESCALATED`.
   - Vùng tin cậy thấp (confidence < T_low) -> chuyển `LOGGED_ONLY` hoặc `DETECTED`.
   - Sự kiện đặc biệt: `FIRE_SMOKE_DETECTED` (bỏ qua `LOGGED_ONLY` nếu `skip_logged_only = TRUE`), `WELLNESS_TIMEOUT` (ngưỡng null, chuyển thẳng `NOTIFIED` hoặc `ESCALATED`).
   - Xử lý đa nhãn (multi-label) chọn ứng viên có độ ưu tiên cao nhất hoặc tự động gộp nhãn.
2. **Kiểm soát tính hợp lệ chuyển trạng thái (`isValidStatusTransition`):**
   - Không cho phép đảo ngược hoặc hạ cấp trạng thái không hợp lệ.
   - Các trạng thái kết thúc (`RESOLVED`, `CLOSED`) là bất biến.
3. **Cơ chế xác nhận 2 giai đoạn (2-Phase Confirmation) & Idempotency:**
   - **Giai đoạn INITIAL:** Xác nhận `IM_OK` (-> `RESOLVED`) hoặc `NEED_HELP` (-> `ESCALATED`).
   - **Giai đoạn EMERGENCY:** Đóng sự kiện khẩn cấp `ACKNOWLEDGED` (-> `CLOSED`).
   - Chỉ cho phép đúng 1 xác nhận có hiệu lực (`is_authoritative = TRUE`) cho mỗi giai đoạn trên mỗi sự kiện (partial unique index `uq_confirmations_authoritative_per_phase`).
   - Các lần bấm sau ghi nhận audit `is_authoritative = FALSE` và trả mã lỗi HTTP `409 Conflict` kèm thông tin xác nhận trước đó.
4. **Cơ chế phục hồi sau khởi động lại (`EscalationDeadlineWorkerService`):**
   - Định kỳ quét các sự kiện quá hạn `escalation_deadline_at` bằng câu lệnh `SELECT ... FOR UPDATE SKIP LOCKED`.
   - Tự động chuyển `ESCALATED` và ghi nhận lịch sử trạng thái `TIMEOUT`.
5. **Giao diện Dashboard Web (`apps/web`):**
   - Hiển thị nút bấm tương tác tương ứng theo trạng thái hiện tại (`NOTIFIED` -> Tôi ổn / Cần giúp đỡ; `ESCALATED` -> Đóng sự kiện).
   - Cho phép nhập ghi chú phản hồi.
   - Xử lý thông báo xung đột trạng thái (409) mượt mà không crash UI.

---

## 2. Ma Trận Kiểm Thử Tự Động (Automated Test Matrix)

| Khu Vực / Module           | File Test                                                           | Số Test        | Trạng Thái    | Mô Tả                                                                                                                                         |
| :------------------------- | :------------------------------------------------------------------ | :------------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **Escalation Policy**      | `apps/orchestrator/test/escalation-policy.spec.ts`                  | 10             | PASS          | Logic đánh giá ngưỡng T_low, T_high, T_wait_seconds, skip_logged_only, null thresholds, multi-label                                           |
| **Escalation Engine**      | `apps/orchestrator/test/escalation-engine.service.spec.ts`          | 11             | PASS          | Giao dịch PostgreSQL row locking (`FOR UPDATE`), 2-phase confirmation (`INITIAL`, `EMERGENCY`), outbox intents, idempotency 409 audit logging |
| **Deadline Worker**        | `apps/orchestrator/test/escalation-deadline-worker.service.spec.ts` | 3              | PASS          | Quét định kỳ timeout, phục hồi sự kiện trễ deadline sau server restart, concurrency guard                                                     |
| **Events Service**         | `apps/orchestrator/test/events.service.spec.ts`                     | 17             | PASS          | Phân trang, chi tiết kèm snapshot/history, `confirmEvent`, `closeEvent`, phát SSE `event.updated`                                             |
| **Events Controller**      | `apps/orchestrator/test/events.controller.spec.ts`                  | 4              | PASS          | REST API endpoints `POST /events/:id/confirm`, `POST /events/:id/close` kèm phân quyền RBAC                                                   |
| **Frontend Client**        | `apps/web/src/lib/events-client.spec.ts`                            | 13             | PASS          | Gọi API `confirmEvent`, `closeEvent`, xử lý SSE realtime                                                                                      |
| **Frontend UI/Components** | `apps/web` test suite tổng hợp                                      | 43             | PASS          | Modal chi tiết sự kiện, phân trang, bộ lọc sự kiện                                                                                            |
| **Tổng Cộng**              | **Toàn bộ monorepo**                                                | **183+ tests** | **100% PASS** | Tất cả pass, 0 lỗi TypeScript, 0 lỗi ESLint                                                                                                   |

---

## 3. Lệnh Xác Thực

```bash
# 1. Kiểm tra build contracts
pnpm --filter @cam/contracts build

# 2. Kiểm tra typecheck toàn dự án
pnpm typecheck

# 3. Kiểm tra linting toàn dự án
pnpm lint

# 4. Chạy unit tests backend
pnpm --filter orchestrator run test -i --forceExit

# 5. Chạy unit tests frontend
pnpm --filter @cam/web test
```

---

## 4. Kết Quả

- Migration cơ sở dữ liệu `0008_escalation_state_machine.sql` đã áp dụng thành công.
- OpenAPI specification và contracts `@cam/contracts` đồng bộ đầy đủ các schema `ConfirmationPhase`, `CloseEventRequest`, `Confirmation`, và `EventDetail`.
- Giao diện người dùng và backend xử lý luồng xác nhận 2 giai đoạn mượt mà, chống race condition và bảo toàn lịch sử kiểm toán.
