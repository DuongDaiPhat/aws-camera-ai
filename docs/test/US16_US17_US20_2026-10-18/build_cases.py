"""Build the fixed 16-column design and execution tables from traceable scenarios."""
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
HEADERS = ['No.', 'Plan/AC', 'Main Category', 'Sub Category', 'Component', 'Type', 'Priority', 'Pre-Conditions', 'Test Data', 'Test Descriptions', 'Steps', 'Expected Result', 'Implementation Status', 'Execution', 'Testing Result', 'Remarks']
CASES = []


def add(us, section, level, component, kind, data, description, expected, evidence, status='Đã triển khai', priority='P0', manual=False):
    number = 1 + sum(row[0].startswith(us + '-') for row in CASES)
    CASES.append([f'{us}-TC-{number:03}', f'{us} / {section}', 'Pose / Fall' if us != 'US-20' else 'Wellness check', level, component, kind, priority,
                  'Checkout commit được ghi trong TEST_PLAN; fixture tổng hợp; dependencies của cấp kiểm thử sẵn sàng', data, description,
                  f'1. Chuẩn bị {data}<br>2. Chạy kịch bản/assertion tại {evidence}<br>3. Đối chiếu kết quả và lưu output', expected,
                  status, 'Manual' if manual else 'Automation', 'Not Run', f'Cấp: {level}. {evidence}'])


add('US-16', 'Mục 6: Chốt đặc trưng hình học và các ngưỡng ban đầu; AC16-1', 'Unit Test', 'AI Service', 'Function', '33 landmarks, ảnh không vuông, vai/hông visibility thấp', 'Tính geometry theo pixel và từ chối quality thấp', 'Góc/tâm/aspect ratio đúng; quality thấp không sinh candidate', 'services/ai-service/tests/test_pose_geometry.py')
add('US-16', 'Mục 7: State machine và thời gian bất động; AC16-2', 'Unit Test', 'AI Service', 'Function', '9 rồi 10 pose history; angle 29.999/30; drop 0.199/0.20', 'Chỉ tạo candidate khi đủ history và đúng ngưỡng', '10 frame trước hiện tại; angle <30; drop >=0.20', 'services/ai-service/tests/test_fall_tracker.py; regression/test_qa_pose.py')
add('US-16', 'Mục 7: State machine và thời gian bất động; AC16-3', 'Unit Test', 'AI Service', 'Reliability', 'Candidate; pose mất 4.999/5 giây', 'Giữ identity dưới grace và hủy đúng 5 giây', 'Không confirm khi thiếu pose; hủy tại grace 5s', 'services/ai-service/tests/test_fall_tracker.py; regression/test_qa_pose.py')
add('US-16', 'Mục 7: State machine và thời gian bất động', 'Unit Test', 'AI Service', 'Reliability', 'Duplicate timestamp/frameId, session mới, gap >0.6s', 'Bảo toàn history và continuity theo identity', 'Replay không cộng thời gian; session riêng; gap reset interval', 'regression/test_qa_pose.py')
add('US-16', 'Mục 4: Gate contract: chốt hai OpenAPI và tránh xung đột giữa người làm', 'Module Test', 'AI Service', 'Security', 'Token sai/thiếu, timestamp/bbox lỗi, JPEG lỗi', 'Router từ chối request không hợp lệ', '401/422 hoặc 200+error theo contract', 'services/ai-service/tests/test_pose_router.py')
add('US-16', 'Mục 5: Chuỗi frame thật từ Frigate và nhận diện đúng người', 'Module Test', 'Edge/MQTT', 'Validation', 'Envelope v1; >1MiB; >32KiB header; >8 persons; version 2; bbox âm', 'Validate binary envelope trước inference', 'Dữ liệu hợp lệ được nhận; payload sai bị bỏ', 'apps/orchestrator/src/fall-detection/envelope/pose-frame-envelope.spec.ts; regression/qa-fall.spec.ts')
add('US-16', 'Mục 5: Chuỗi frame thật từ Frigate và nhận diện đúng người', 'Module Test', 'Orchestrator', 'Reliability', 'Frame age 1.1s; frame tương lai 0.6s; M2A_ENABLED=false', 'Chặn frame quá cũ/tương lai và kill switch', 'Frame >1s hoặc tương lai >0.5s bị bỏ; flag false không gọi AI', 'regression/qa-fall.spec.ts')
add('US-16', 'Mục 4: Gate contract: chốt hai OpenAPI và tránh xung đột giữa người làm', 'Module Test', 'Orchestrator', 'Validation', 'AI trả CONFIRMED sai track, thiếu episode/timestamp', 'Không tạo incident từ response sai identity hoặc thiếu evidence', 'Không persist/submit malformed response', 'regression/qa-fall.spec.ts')
add('US-16', 'Mục 11: Ma trận kiểm thử bắt buộc', 'Integration Test', 'AI Service', 'Integration', 'Model lite đã pin; ảnh tổng hợp không có người', 'Load model thật và inference CPU', 'Runtime load thành công; ảnh không người không tạo pose/FALL; không suy quality từ smoke', 'services/ai-service/scripts/dependency_smoke.py; regression/test_qa_pose.py')
add('US-16', 'Mục 5: Chuỗi frame thật từ Frigate và nhận diện đúng người', 'Integration Test', 'Edge/MQTT', 'Integration', 'Frigate metadata và stationary person fixture', 'Bridge vẫn giữ metadata/track khi thêm pose publisher', 'Bridge fixtures qua; không lẫn topic metadata và ảnh', 'infra/frigate/frame-metadata/test_bridge.py')
add('US-16', 'Mục 11: Ma trận kiểm thử bắt buộc', 'System Test', 'End-to-end', 'Integration', 'Local runtime; MQTT envelope; AI health', 'Khởi động runtime và chứng minh đường nhận frame tới inference', 'DI/HTTP hoạt động và không có startup error; đường MQTT thật có evidence', 'regression/qa-system.spec.ts; evidence/', status='Một phần')
add('US-16', 'Mục 11: Ma trận kiểm thử bắt buộc; AC16-1; AC16-2; AC16-3', 'Acceptance Test', 'End-to-end', 'Function', 'Video có ground truth track/timestamp, che khuất và nhiều người', 'Nghiệm thu pose/candidate/missing trên camera/video', 'Đúng người và history; không alert trong missing; có số đo chất lượng/latency', 'Chưa có script video ground-truth; cần môi trường MediaMTX/Frigate và bộ clip đã gán nhãn', status='Một phần', manual=True)
add('US-16', 'Code-only: services/ai-service/app/services/fall_tracker.py#_step_monitoring_state', 'Unit Test', 'AI Service', 'Function', 'Nằm sẵn khi startup, không có lowering transition', 'Kiểm tra persistent-prone fallback không suy đoán cú ngã trái phạm vi plan', 'Không candidate/FALL nếu chưa quan sát hạ thấp, theo Mục 1: Mục tiêu, phạm vi và tài liệu bắt buộc', 'regression/test_qa_pose.py; code-only persistent-prone fallback chưa có trong plan')

add('US-17', 'Mục 7: State machine và thời gian bất động; AC17-1', 'Unit Test', 'AI Service', 'Function', 'Bất động 14.999/15/15.001s với frame hợp lệ', 'Xác nhận chỉ sau hơn 15 giây liên tục', '15s chưa confirmed; 15.001s confirmed; episode ổn định', 'regression/test_qa_pose.py')
add('US-17', 'Mục 7: State machine và thời gian bất động; AC17-2', 'Unit Test', 'AI Service', 'Function', 'Candidate rồi đứng dậy; vẫn nằm sau confirm', 'Hủy khi đứng dậy và latch một episode', 'RECOVERED không FALL; không episode mới khi còn nằm', 'services/ai-service/tests/test_fall_tracker.py; regression/test_qa_pose.py')
add('US-17', 'Mục 8: REST_AREA, confidence và ghi nhận incident; AC17-3', 'Unit Test', 'Orchestrator', 'Function', 'Polygon trong/ngoài/biên, zone disabled/non-rest', 'Suppress đúng vùng nghỉ hiện có', 'Chỉ REST_AREA đang bật chứa anchor mới suppress', 'apps/orchestrator/src/fall-detection/evaluator/rest-area.evaluator.spec.ts')
add('US-17', 'Mục 8: REST_AREA, confidence và ghi nhận incident; AC17-3', 'Module Test', 'Orchestrator', 'Reliability', 'ZonesRepository báo DB unavailable khi AI CONFIRMED', 'Lookup lỗi không được coi là ngoài REST_AREA', 'Không tạo FALL khi không xác minh được vùng nghỉ', 'regression/qa-fall.spec.ts')
add('US-17', 'Mục 2: Hiện trạng và các quyết định kiến trúc; AC17-1', 'Module Test', 'Orchestrator', 'Function', 'CONFIRMED hợp lệ; CANCELLED; trong REST_AREA', 'Coordinator chỉ phát P1 từ confirm hợp lệ', 'Tạo incident riêng; CANCELLED/REST không submit', 'apps/orchestrator/src/fall-detection/coordinator/fall-incident.coordinator.spec.ts')
add('US-17', 'Mục 8: REST_AREA, confidence và ghi nhận incident', 'Integration Test', 'Database', 'Integration', 'Postgres16; CONFIRMED với event source AI_SERVICE', 'Persist incident/event bằng production repository', 'Transaction commit event FALL P1 và incident PENDING; schema tương thích', 'regression/qa-db.integration.spec.ts')
add('US-17', 'Mục 8: REST_AREA, confidence và ghi nhận incident', 'Integration Test', 'Orchestrator', 'Reliability', 'Submit AI lỗi lần đầu; nhận lại cùng episode', 'Retry pending incident tới khi được áp dụng', 'Retry giữ resultId/payload, áp dụng đúng một lần; không bỏ pending', 'regression/qa-fall.spec.ts', status='Một phần')
add('US-17', 'Mục 11: Ma trận kiểm thử bắt buộc', 'Integration Test', 'Storage', 'Integration', 'JPEG buffer; storage/database double', 'Lưu bằng chứng snapshot và replay idempotent', 'Upload JPEG/link event_media một lần; URL giữ policy hiện có', 'apps/orchestrator/test/media.service.spec.ts; lưu ý dependency double, chưa xác minh MinIO thật')
add('US-17', 'Mục 11: Ma trận kiểm thử bắt buộc', 'Integration Test', 'Database', 'Reliability', 'DB disposable fresh/seeded upgrade/replay', 'Migration 0013-0015 giữ dữ liệu và constraints', 'Fresh/upgrade/replay và invariants đạt', 'tools/scripts/sprint3-db-gate.mjs')
add('US-17', 'Mục 11: Ma trận kiểm thử bắt buộc; AC17-1', 'System Test', 'End-to-end', 'Integration', 'Fall frame → DB → receipts/outbox → P1/SSE', 'Tạo và thông báo đúng một FALL qua runtime', 'Incident, AI labels, notification và SSE đúng event', 'regression/qa-system.spec.ts; phụ thuộc production repository/DB')
add('US-17', 'Mục 11: Ma trận kiểm thử bắt buộc; AC17-1; AC17-2; AC17-3', 'Acceptance Test', 'End-to-end', 'UI', 'Video fall/recovery/REST, dashboard và Telegram test account', 'Nghiệm thu FALL, bằng chứng và IM_OK/NEED_HELP', 'Một FALL ngoài REST sau >15s; không FALL recovery/REST; nhận/xác nhận thực tế', 'Chưa có script live UI/Telegram; không gửi tin nhắn thật trong đợt QA', status='Một phần', manual=True)

add('US-20', 'Mục 7: Scheduler bền vững, timezone và lịch trễ', 'Unit Test', 'Orchestrator', 'Function', '09:00/18:00 Asia/Ho_Chi_Minh, ISO weekday', 'Tính UTC đúng giờ địa phương', '09:00 tương ứng 02:00Z; 18:00 tương ứng 11:00Z', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 7: Scheduler bền vững, timezone và lịch trễ', 'Unit Test', 'Orchestrator', 'Function', 'America/New_York gap 2026-03-08 02:30, fold 2026-11-01 01:30', 'Tính occurrence DST theo quy tắc Postgres16 trong plan', 'Gap=07:30Z; fold=06:30Z; một occurrence/ngày', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 7: Scheduler bền vững, timezone và lịch trễ', 'Unit Test', 'Orchestrator', 'Reliability', 'Lịch enable 10:00, checkAt 09:00 cùng ngày', 'Không materialize occurrence trước activation', 'Không tạo run quá khứ trước enable', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Module Test', 'Orchestrator', 'Reliability', 'M5_ENABLED=false; tick scheduler', 'Kill switch tắt admission mới', 'Không materialize/claim mới; pending delivery/deadline vẫn xử lý', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 5: Chốt cả hai OpenAPI trước code', 'Unit Test', 'Orchestrator', 'Security', 'VIEWER tạo lịch; caregiver khác hộ; resident khác', 'Giới hạn actor cho CRUD/xác nhận', '403 cho actor sai; resident đúng mới confirm', 'apps/orchestrator/test/wellness.service.spec.ts')
add('US-20', 'Mục 5: Chốt cả hai OpenAPI trước code', 'Module Test', 'Orchestrator', 'Validation', 'lookback 0/25; grace 59/3601; timezone không tồn tại; UUID v4', 'DTO giữ ranges và validation contract', 'Giá trị ngoài range/timezone lỗi bị từ chối HTTP 400', 'regression/qa-system.spec.ts')
add('US-20', 'Mục 5: Chốt cả hai OpenAPI trước code', 'Module Test', 'Orchestrator', 'Integration', 'JWT thiếu; internal token sai/đúng; schedules endpoint', 'Guard và response HTTP tuân contract', '401/403 đúng guard; request hợp lệ đúng response shape/status', 'regression/qa-system.spec.ts')
add('US-20', 'Mục 6: Nguồn M1 và phép xét hoạt động', 'Unit Test', 'Orchestrator', 'Security', 'PATCH residentUserId/cameraIds sang hộ khác', 'Revalidate scope khi sửa lịch', '400/403/404; không ghi schedule cross-household', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 6: Nguồn M1 và phép xét hoạt động', 'Module Test', 'Orchestrator', 'Security', 'MOTION thiếu identityEvent/knownFace/camera; DEPARTURE thiếu evidence', 'Không nhận observation thiếu provenance hợp lệ', 'Reject; không cập nhật HOME/AWAY', 'regression/qa-system.spec.ts; regression/qa-wellness.spec.ts')
add('US-20', 'Mục 6: Nguồn M1 và phép xét hoạt động', 'Unit Test', 'Orchestrator', 'Reliability', 'Observation ID giống, payload reordered keys hoặc thay nội dung', 'Idempotency canonical payload', 'Đảo thứ tự khóa vẫn DUPLICATE; khác nội dung 409', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 6: Nguồn M1 và phép xét hoạt động', 'Integration Test', 'Database', 'Integration', 'Postgres16 thật; create schedule; ledger window biên start/end', 'Repository CRUD, activity window và presence chạy đúng schema', 'CRUD/observation/query hoạt động; chỉ đúng owner/resident/camera và closed window', 'regression/qa-db.integration.spec.ts')
add('US-20', 'Mục 7: Scheduler bền vững, timezone và lịch trễ', 'Integration Test', 'Database', 'Reliability', 'Pending run; claim/lease; fake time', 'Claim/evaluate chạy SQL thật và không mất run', 'Claim đổi status/lease hợp lệ; decision atomically commit', 'regression/qa-db.integration.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Integration Test', 'Database', 'Integration', 'Không activity/presence; no camera; leased run', 'Tạo P2 event và resident intent nguyên tử', 'Một camera-less WELLNESS_TIMEOUT/P2/SCHEDULER và một intent đúng resident', 'regression/qa-db.integration.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Module Test', 'Orchestrator', 'Reliability', 'Notification mới PENDING, chưa dispatch', 'Chỉ bắt đầu 300s sau lần delivery thành công đầu', 'requestSentAt/deadline còn null trước dispatch; không giả dashboard delivery', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Unit Test', 'Orchestrator', 'Function', 'Resident IM_OK tại 299.999/300/300.001s', 'Xử lý boundary phản hồi đúng 300 giây logic', 'Trước hạn RESOLVED; bằng/sau hạn ESCALATED; không kéo dài deadline', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Unit Test', 'Orchestrator', 'Reliability', 'Event CLOSED/RESOLVED/ESCALATED; command mới', 'Không hồi sinh terminal event và không ghi đè authoritative confirmation', 'Không đổi state terminal hoặc tạo confirmation authoritative mới', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Unit Test', 'Orchestrator', 'Reliability', 'commandId giống, response giống, note đổi', 'Idempotency confirmation xét toàn payload', 'Identical replay trả kết quả cũ; changed note trả 409', 'regression/qa-wellness.spec.ts')
add('US-20', 'Mục 8: State machine, transaction và notification', 'Integration Test', 'Database', 'Integration', 'Resident IM_OK/NEED_HELP qua repository/transaction thật', 'Persist confirmation và history bằng schema thật', 'IM_OK resolve; NEED_HELP escalate; đúng enum/columns và recipient', 'regression/qa-db.integration.spec.ts')
add('US-20', 'Mục 6: Nguồn M1 và phép xét hoạt động', 'System Test', 'End-to-end', 'Integration', 'M1 KNOWN+motion/directional track metadata', 'Nguồn M1 tự đưa evidence tới wellness', 'Adapter thật chứng minh association/TTL/direction, không chỉ JSON tự khai', 'Chưa có script; tìm wiring M1 → wellness trên candidate', status='Chưa tìm thấy')
add('US-20', 'Mục 8: State machine, transaction và notification', 'System Test', 'End-to-end', 'Integration', 'Scheduler → DB → resident Telegram/dashboard → callback', 'Wellness gửi yêu cầu và xử lý quá hạn thực tế', 'Resident nhận trước; timeout caregiver đúng hộ; VIEWER callback hợp lệ', 'regression/qa-system.spec.ts; phụ thuộc DB runtime và delivery adapter', status='Một phần')
add('US-20', 'Mục 1: User story và kết quả bắt buộc', 'Acceptance Test', 'End-to-end', 'Function', 'Hai lịch 09:00/18:00, X=6h, grace=300s', 'Nghiệm thu đúng giờ, no activity, IM_OK và timeout', 'P2 một lần; deadline từ SENT; đúng 300s; before/at/after boundary đúng', 'Các unit/DB/system tương ứng; E2E bị chặn nếu một prerequisite hỏng', status='Một phần')
add('US-20', 'Mục 1: User story và kết quả bắt buộc', 'Acceptance Test', 'End-to-end', 'Function', 'M1 departure/arrival, người lạ, face-only, camera offline', 'Nghiệm thu skip-away bằng evidence đúng người', 'Chỉ AWAY explicit còn hạn/as-of mới skip; unknown/offline không suy AWAY', 'Chưa có script feed adapter E2E; cần nguồn M1 direction đã xác minh', status='Chưa tìm thấy')
add('US-20', 'Mục 3: Phạm vi E2E của một owner', 'Acceptance Test', 'Web', 'UI', 'Caregiver/resident tài khoản fixture', 'Có UI quản lý lịch và resident thấy/xác nhận check của mình', 'Caregiver CRUD/history; resident IM_OK/NEED_HELP đúng quyền; SSE refresh', 'Chưa có script UI; diff nhánh chỉ đổi apps/web/src/types/index.ts', status='Chưa tìm thấy', manual=True)
add('US-20', 'Mục 11: Kiểm thử chức năng và hồi quy', 'System Test', 'End-to-end', 'Reliability', 'Hai nhánh ghép candidate, test cũ/auth/AI/escalation/media/web', 'Hồi quy toàn bộ và chất lượng source ghép', 'Tests cũ/typecheck/lint/API/format đạt; không thay đổi main khi có lỗi', 'evidence/manifest.json; candidate quality checks')


def render(path, executed=False):
    results_path = HERE / 'case_results.json'
    results = json.loads(results_path.read_text(encoding='utf-8')) if executed and results_path.exists() else {}
    rows = []
    for source in CASES:
        row = source.copy()
        if row[0] in results:
            entry = results[row[0]]
            row[14] = entry['result']
            row[15] += ' | ' + entry['evidence']
        rows.append(row)
    def esc(value):
        return str(value).replace('|', r'\|').replace('\n', '<br>')
    text = '# Đối chiếu dự án\n\n'
    text += '- US-16/17: PLAN_US-16_US-17_POSE_FALL_E2E.md, nhánh 549f9c0; US-20: PLAN_US-20_WELLNESS_CHECK_E2E.md, nhánh 872a895.\n'
    text += '- Hai merge-base đã xác minh: main 0f5c948; working tree gốc docs/testing có diff ngoài phạm vi được giữ nguyên; QA trong worktree riêng.\n'
    text += '- Đã đối chiếu geometry/tracker/router/bridge/coordinator/incident, wellness DTO/controller/service/scheduler/repository, migrations và hai OpenAPI cùng tests sẵn có.\n'
    text += '- Cả plan và code: pose candidate/confirm/rest, wellness CRUD/ledger/run/confirm. Chỉ plan: source M1 direction adapter, wellness UI hoàn chỉnh, durable fall retry, live E2E/metrics.\n'
    text += '- Code bổ sung trong phạm vi: ảnh bằng chứng storeBufferSnapshot, fallback pose estimator và UUID validation; đã đưa vào case phù hợp.\n'
    text += '- Sai lệch cần kiểm chứng: timezone UTC approximation, giả định dispatch thành công, schema/SQL và lookup REST lỗi. Test double không chứng minh DB/live transport đạt.\n'
    text += '\n# Bảng test case\n\n'
    text += '| ' + ' | '.join(HEADERS) + ' |\n| ' + ' | '.join(['---'] * 16) + ' |\n'
    text += ''.join('| ' + ' | '.join(map(esc, row)) + ' |\n' for row in rows)
    text += '\n# Điểm cần xác nhận\n\n- Clip ground-truth và staging Telegram/UI chưa có bằng chứng nghiệm thu; không dùng ảnh smoke để kết luận chất lượng model.\n- Những khác biệt giữa task guide và plan E2E được xét theo contract/AC đã freeze; xem DEFECTS.md để biết vi phạm đã tái hiện.\n'
    path.write_text(text, encoding='utf-8')
    return Counter(row[14] for row in rows)


if __name__ == '__main__':
    render(HERE / 'TEST_CASES_DESIGN.md')
    print(dict(render(HERE / 'TEST_CASES_EXECUTED.md', executed=True)))
