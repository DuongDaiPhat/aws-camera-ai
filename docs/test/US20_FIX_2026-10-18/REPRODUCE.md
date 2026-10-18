# Chạy lại kiểm thử US-20

## Revision và môi trường

Nhánh sửa `fix/US-20-wellness-check`; production fix commit `ba13844`; test timeout bổ sung nằm cùng commit bàn giao báo cáo. Snapshot ghép thử hai feature `e36eee7`, có thêm fixture chờ đúng ACK log MQTT. Main không đổi. Các kết quả và SHA-256 ở [manifest.json](manifest.json).

Windows, Node22.20.0, pnpm9.12.0 đúng lockfile, Python3.11.13 cho bridge; PostgreSQL16-alpine, Docker Desktop. Cài dependencies từ lockfile, không dùng `.env` thật. Phiên này dùng runtime pnpm đã cache tại `D:/hoc tap/project 1/aws-camera-ai/artifacts/qa-tooling/node_modules/pnpm/bin/pnpm.cjs` vì pnpm global bị kẹt khi tự chuyển phiên bản. Có thể gọi `node <đường-dẫn-đó> ...` thay lệnh pnpm bên dưới.

## Unit, module, Web và chất lượng

Tại root worktree:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @cam/contracts build
pnpm -r typecheck
pnpm -r lint
pnpm -r build
pnpm api:lint
pnpm --filter @cam/contracts generate
git diff --exit-code -- packages/contracts/src/generated pnpm-lock.yaml
node node_modules/prettier/bin/prettier.cjs --check '**/*.{ts,tsx,js,json,md,yaml,yml}'
node --test 'tools/scripts/test/*.test.mjs'
```

Jest dùng cache trong workspace để tránh EPERM rename của sandbox Windows:

```powershell
Push-Location apps/orchestrator
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory=../../artifacts/jest-us20
Pop-Location
Push-Location apps/web
node node_modules/vitest/vitest.mjs run
Pop-Location
python -m unittest discover -s infra/frigate/frame-metadata
python -m ruff check infra/frigate/frame-metadata/bridge.py infra/frigate/frame-metadata/test_bridge.py
python -m ruff format --check infra/frigate/frame-metadata/bridge.py infra/frigate/frame-metadata/test_bridge.py
```

Nhánh sửa đạt365 Orchestrator/196 Web/109 tools/7 bridge. Snapshot ghép thử đạt395 Orchestrator/196 Web. Không cộng các số giữa hai nhánh hoặc giữa các cấp kiểm thử.

## Integration US20 độc lập

Docker phải đang chạy. Nếu không đặt `US20_TEST_DATABASE_URL`, suite tự tạo PostgreSQL16 Testcontainer mới, apply toàn bộ migrations và dọn container khi kết thúc:

```powershell
Remove-Item Env:US20_TEST_DATABASE_URL -ErrorAction SilentlyContinue
Push-Location apps/orchestrator
node node_modules/jest/bin/jest.js --runInBand --testRegex '.*\.integration\.spec\.ts$' --runTestsByPath test/wellness-db.integration.spec.ts --cacheDirectory=../../artifacts/jest-us20
Pop-Location
```

25 ca dùng repository/scheduler/source adapter/notification worker/Telegram callback production, Nest HTTP guards/validation và local HTTP provider với dummy token. Để dùng lại container QA, chỉ đặt URL loopback có tên DB `qa_us20`; suite từ chối URL khác và **TRUNCATE fixture trong DB này** trước mỗi case. Không trỏ tới dữ liệu thật. Không chạy browser harness và integration suite đồng thời trên cùng DB.

```powershell
$env:US20_TEST_DATABASE_URL='postgresql://qa:qa-disposable-only@127.0.0.1:55433/qa_us20'
```

## Toàn bộ integration và snapshot ghép thử

Các suite M1/Telegram/MQTT/escalation/camera tự tạo container. Suite US15 cũ đọc `POSTGRES_*`, cần DB QA riêng đã migrate và một user ADMIN fixture. Phiên này dùng `qa_us20_rules` trên cùng container QA, tách khỏi `qa_us20` vì US20 dọn fixture users. Dùng mật khẩu/tài khoản thử nghiệm, không đọc cấu hình production.

```powershell
$env:POSTGRES_HOST='127.0.0.1'
$env:POSTGRES_PORT='55433'
$env:POSTGRES_DB='qa_us20_rules'
$env:POSTGRES_USER='qa'
$env:POSTGRES_PASSWORD='qa-disposable-only'
Push-Location apps/orchestrator
node node_modules/jest/bin/jest.js --runInBand --testRegex '.*\.integration\.spec\.ts$' --cacheDirectory=../../artifacts/jest-us20
Pop-Location
```

Fixture ADMIN là `qa-admin@local.test`, password_hash test không dùng đăng nhập. DB rules phải có migrations và seed escalation rules từ migration0002. Với DB mới, dùng runner thông thường và thêm fixture ADMIN bằng công cụ DB; không reset database sẵn có. Snapshot `e36eee7` chạy87/87 ca. Phiên đầu sau gián đoạn gặp container dừng và fixture MQTT chờ chuỗi log cũ; log lỗi được giữ trong evidence, kết quả sau sửa fixture và khởi động DB là kết quả cuối.

## Migration upgrade/replay

Tạo **DB mới hoàn toàn** tên `qa_us20_upgrade` trong container QA riêng. Script từ chối DB đã có bảng; không drop/reset schema:

```powershell
$env:US20_MIGRATION_DATABASE_URL='postgresql://qa:qa-disposable-only@127.0.0.1:55433/qa_us20_upgrade'
node docs/test/US20_FIX_2026-10-18/migration-gate.mjs
```

Script apply baseline đến0015, seed lịch legacy, chạy runner thêm0016, so sánh lịch không đổi, rồi chạy lại runner và đối chiếu18 migration records. Fresh schema còn được kiểm tra trong các Testcontainers integration.

## Browser acceptance

Tại worktree sửa, migrate DB disposable `qa_us20` trước, sau đó:

```powershell
$env:US20_TEST_DATABASE_URL='postgresql://qa:qa-disposable-only@127.0.0.1:55433/qa_us20'
Push-Location apps/orchestrator
node -r ts-node/register test/us20-browser-harness.ts
```

Terminal khác tại `apps/web`:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL='http://127.0.0.1:55434/api/v1'
node node_modules/next/dist/bin/next dev -p 55436
```

Mở `http://localhost:55436/login`. Tài khoản disposable `resident@us20.local` và `caregiver@us20.local`, mật khẩu cùng là `Us20-QA-local-only!`. Harness dùng AuthModule/WellnessModule và PG thật; provider Telegram chỉ loopback55435; endpoints điều hướng camera/face/event là read-only fixtures.

1. Resident vào Kiểm tra sức khỏe: thấy check đã gửi và hạn phản hồi; bấm Tôi ổn, quan sát RESOLVED và nút biến mất. NEED_HELP có interaction/API tests riêng.
2. Đăng xuất, đăng nhập caregiver; tạo lịch18:00 cho Mẹ QA, sửa tên, tắt/bật/xóa; lịch sử check vẫn còn và không có nút xác nhận thay resident.
3. Xem ảnh `resident-im-ok.png` và `caregiver-schedules.png`. UI trước dispatch/terminal, retry command, lỗi và empty state được kiểm thử bằng React interactions.

SSE refresh/scope được kiểm tra riêng qua production EventsService/repository; browser harness dùng polling để tải trạng thái. Không dùng harness này để kết luận toàn pipeline camera hoặc Telegram staging. Khi xong, dừng đúng các tiến trình/container QA vừa tạo; không dùng `docker compose down -v` hoặc prune dữ liệu khác.

## Sửa quy ước Git và kiểm thử thủ công

Tên nhánh hiện tại đã sửa theo GIT_WORKFLOW.md. Các SHA trong evidence là snapshot đã chạy test trước khi sửa message commit; nội dung commit giữ nguyên. Xem [bảng SHA cũ → mới](GIT_NAMING_CORRECTION.json) và [hướng dẫn manual US20 gồm Telegram thật](MANUAL_US20_TELEGRAM.md).
