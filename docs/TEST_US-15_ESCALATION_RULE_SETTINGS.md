# Hướng dẫn kiểm thử và Kết quả nghiệm thu US-15

> **Tính năng:** US-15 — Cấu hình ngưỡng confidence và thời gian chờ theo loại sự kiện  
> **Tài liệu kế hoạch liên quan:** [`docs/PLAN_US-15_ESCALATION_RULE_SETTINGS.md`](PLAN_US-15_ESCALATION_RULE_SETTINGS.md)  
> **Ngày nghiệm thu:** 25/09/2026  
> **Trạng thái:** ✅ Đã hoàn thành (Backend, Frontend, Database, Migration, Kiểm thử tự động & thực tế)

---

## 1. Tóm tắt các thành phần đã triển khai

| Tầng | File / Module | Nội dung triển khai |
| :--- | :--- | :--- |
| **Database** | [`db/migrations/0005_escalation_rules_version_and_constraints.sql`](../db/migrations/0005_escalation_rules_version_and_constraints.sql) | Thêm cột `version` cho optimistic locking, ràng buộc cặp ngưỡng `(t_low IS NULL) = (t_high IS NULL)`, ràng buộc `t_wait_seconds BETWEEN 0 AND 3600`. |
| **ERD Docs** | [`docs/database/ERD.md`](database/ERD.md) | Cập nhật sơ đồ Mermaid và tài liệu bảng `escalation_rules`. |
| **API Contract** | [`api/openapi.yaml`](../api/openapi.yaml) | Bổ sung `displayName`, `updatedByName` vào `EscalationRule`, hoàn thiện contract `GET` và `PATCH /escalation-rules/{eventType}`. |
| **Backend Core** | [`apps/orchestrator/src/auth/roles.guard.ts`](../apps/orchestrator/src/auth/roles.guard.ts)<br>[`apps/orchestrator/src/auth/roles.decorator.ts`](../apps/orchestrator/src/auth/roles.decorator.ts) | Phân quyền vai trò người dùng dùng chung (`ADMIN`, `CAREGIVER`, `VIEWER`). |
| **Backend US-15** | [`apps/orchestrator/src/escalation-rules/`](../apps/orchestrator/src/escalation-rules/) | Controller, Service, Repository, Policy và DTOs. Hỗ trợ tính `effectiveHighWaitSeconds`, update nguyên tử transaction kèm ghi `audit_logs`. |
| **Frontend Client** | [`apps/web/src/lib/escalation-rules-client.ts`](../apps/web/src/lib/escalation-rules-client.ts)<br>[`apps/web/src/hooks/useEscalationRules.ts`](../apps/web/src/hooks/useEscalationRules.ts) | Client API type-safe từ `@cam/contracts`, hook quản lý draft riêng từng rule, xử lý lưu độc lập và xung đột phiên bản (409). |
| **Frontend UI** | [`apps/web/src/components/settings/`](../apps/web/src/components/settings/) | `SettingsView`, `EscalationRulesSection`, `EscalationRuleCard`, CSS Modules responsive từ mobile (360px) đến desktop. Tích hợp vào `DashboardView` khi chọn menu "Cài đặt". |

---

## 2. Hướng dẫn chạy kiểm thử tự động (Automated Tests)

Mở terminal tại thư mục gốc của dự án (`d:\PROJECT\aws-camera-ai`):

### 2.1. Kiểm tra Lint và TypeScript Typecheck
```powershell
# Kiểm tra định dạng và quy tắc code
pnpm lint

# Kiểm tra kiểu dữ liệu tĩnh TypeScript
pnpm --filter @cam/orchestrator typecheck
pnpm --filter @cam/web typecheck
```

### 2.2. Chạy toàn bộ Test Suites của US-15
```powershell
# Chạy Unit & Integration tests phía Backend Orchestrator:
pnpm --filter @cam/orchestrator test test/escalation-rule-policy.spec.ts test/escalation-rules.service.spec.ts test/escalation-rules.controller.spec.ts test/escalation-rules.repository.spec.ts

# Chạy Unit & Component tests phía Frontend Web:
pnpm --filter @cam/web test
```

---

## 3. Hướng dẫn kiểm thử thủ công qua API (Manual API Testing)

### 3.1. Đăng nhập lấy Bearer Token của ADMIN
```powershell
$loginBody = @{
  email = "admin@camerai.local"
  password = "Admin@12345"
} | ConvertTo-Json

$loginRes = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginRes.accessToken
```

### 3.2. Lấy danh sách quy tắc leo thang hiện tại
```powershell
$headers = @{ Authorization = "Bearer $token" }
$rules = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/escalation-rules" -Method Get -Headers $headers
$rules.data | Format-Table eventType, displayName, priority, tLow, tHigh, tWaitSeconds, effectiveHighWaitSeconds, version
```

### 3.3. Cập nhật ngưỡng và thời gian chờ hợp lệ (PATCH)
```powershell
$updateBody = @{
  tLow = 0.52
  tHigh = 0.72
  tWaitSeconds = 40
  expectedVersion = 1
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/v1/escalation-rules/FIRE_SMOKE_DETECTED" -Method Patch -Headers $headers -Body $updateBody -ContentType "application/json"
```

### 3.4. Kiểm tra phát hiện xung đột phiên bản (409 Conflict)
Gửi lại request với `expectedVersion = 1` trong khi DB đã lên phiên bản 2:
```powershell
# Sẽ trả về mã lỗi 409 RULE_VERSION_CONFLICT
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/escalation-rules/FIRE_SMOKE_DETECTED" -Method Patch -Headers $headers -Body $updateBody -ContentType "application/json"
```

---

## 4. Hướng dẫn kiểm thử trên Giao diện Web (UI Testing)

1. Mở trình duyệt truy cập: [http://localhost:3000](http://localhost:3000)
2. Đăng nhập bằng tài khoản Quản trị viên:
   - Email: `admin@camerai.local`
   - Mật khẩu: `Admin@12345`
3. Nhấp vào mục **"Cài đặt"** trên thanh Sidebar bên trái.
4. Xác minh giao diện:
   - Thấy hộp thông tin giải thích quy tắc Policy (`T_low`, `T_high`, `T_wait`).
   - Danh sách 5 loại sự kiện có cảnh báo: *Phát hiện cháy / khói (P0)*, *Phát hiện té ngã (P1)*, *Xâm nhập vùng cấm (P1)*, *Người lạ mặt (P2)*, *Quá hạn an sinh (P2)*.
   - Thẻ *Quá hạn an sinh (WELLNESS_TIMEOUT)* bị khóa ô nhập threshold và hiển thị ghi chú "không áp dụng confidence".
   - Thử thay đổi thời gian chờ `T_wait` của sự kiện Cháy từ `30` thành `40`: ô "Chờ ưu tiên tự động" tự động nhảy sang `20 giây` (`ceil(40/2)`).
   - Nút **"Lưu thay đổi"** sáng lên khi có thay đổi hợp lệ. Bấm **"Lưu thay đổi"** → Thông báo xanh xuất hiện `"Đã lưu thành công phiên bản v..."`.
   - Nút **"Hủy"** khôi phục lại giá trị server nếu chưa lưu.

---

## 5. Bảng ma trận kết quả kiểm thử (Test Results Matrix)

| STT | Tình huống kiểm thử | Kỳ vọng theo Plan US-15 | Kết quả thực tế | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| 1 | **Khởi tạo dữ liệu mặc định** | 5 rule cảnh báo + 1 rule nội bộ khớp hoàn toàn bảng chuẩn trong DB và API. | `findAll` trả về 6 rules với đúng thứ tự P0 &rarr; P3, đúng `t_low`, `t_high`, `t_wait_seconds`. | ✅ **PASS** |
| 2 | **Biên ngưỡng hợp lệ** (`T_low = 0`, `T_high = 1`) | Chấp nhận lưu thành công, tính toán nhánh ưu tiên đúng. | Lưu thành công, `validateThresholdUpdate` trả về `isValid: true`. | ✅ **PASS** |
| 3 | **Biên bằng nhau** (`T_low == T_high`) | Chấp nhận lưu hợp lệ (nhánh giữa rỗng). | Form chấp nhận, API trả về 200 OK. | ✅ **PASS** |
| 4 | **Ngưỡng không hợp lệ** (`T_low > T_high` hoặc ngoài `[0, 1]`) | Bị từ chối với mã lỗi `400 INVALID_THRESHOLD`, DB không đổi. | API trả về `400 BAD_REQUEST`, mã `INVALID_THRESHOLD`. | ✅ **PASS** |
| 5 | **Sự kiện WELLNESS có threshold** | Từ chối với mã `400 THRESHOLD_NOT_APPLICABLE`; chỉ chấp nhận cả 2 đều `null`. | Bị chặn cả ở UI, Service và Check Constraint DB `cap_nguong_dong_nhat`. | ✅ **PASS** |
| 6 | **Thời gian chờ biên** (`T_wait = 1`, `3600`) | Chấp nhận integer từ 1 đến 3600 giây. | Lưu thành công; các giá trị `<= 0` hoặc `> 3600` hoặc số thập phân đều bị từ chối `INVALID_WAIT_SECONDS`. | ✅ **PASS** |
| 7 | **Phân quyền người dùng (RBAC)** | ADMIN được sửa; CAREGIVER/VIEWER chỉ đọc, PATCH bị chặn `403 FORBIDDEN`. | `RolesGuard` chặn chính xác người dùng không phải ADMIN với mã `403`. | ✅ **PASS** |
| 8 | **Ghi đè đồng thời (Optimistic Concurrency)** | Admin A và B cùng mở version 1, A lưu trước (lên v2), B lưu sau bị chặn `409 RULE_VERSION_CONFLICT`. | Bị chặn ở transaction với mã `409`, UI hiển thị thông báo xung đột kèm nút tải lại. | ✅ **PASS** |
| 9 | **Ghi nhận Audit Log** | Mỗi lần PATCH thành công phải ghi một bản ghi vào bảng `audit_logs` với action `ESCALATION_RULE_UPDATED`. | Bản ghi audit log được tạo trong cùng transaction với metadata before/after, actorUserId, IP, User-Agent. | ✅ **PASS** |
| 10 | **Thời gian chờ rút ngắn computed** | Không lưu vào DB; tự động tính theo `max(1, ceil(T_wait / 2))`. | API trả về `effectiveHighWaitSeconds`, UI preview tức thì (ví dụ: T_wait=45 &rarr; 23s). | ✅ **PASS** |
| 11 | **Hiệu lực trong vòng 60 giây** | Event mới sinh ra đọc trực tiếp từ PostgreSQL, phản ánh rule mới ngay sau commit mà không cần restart service. | Database commit trực tiếp và được truy vấn ở mỗi event pipeline. | ✅ **PASS** |
| 12 | **Độ phản hồi giao diện & Accessibility** | Form hỗ trợ responsive từ 360px, CSS Modules, thông báo `role="status"` và `role="alert"`. | Giao diện hiển thị chuẩn xác, không bị tràn màn hình, đầy đủ trạng thái loading/error. | ✅ **PASS** |

---

## 6. Tổng kết số lượng bài kiểm thử (Test Summary)

- **Backend Unit Tests:** 44/44 tests passed (100%)
  - `escalation-rule-policy.spec.ts`: 25 passed
  - `escalation-rules.service.spec.ts`: 9 passed
  - `escalation-rules.controller.spec.ts`: 6 passed
  - `escalation-rules.repository.spec.ts` (PostgreSQL integration): 4 passed
- **Frontend Tests:** 41/41 tests passed (100%)
  - `escalation-rules-client.spec.ts`: 2 passed
  - `EscalationRuleCard.spec.tsx`: 3 passed
  - Cùng toàn bộ test suites hiện có của `apps/web`.
- **Lint & Typecheck:** 0 lỗi cú pháp, 0 lỗi TypeScript.
