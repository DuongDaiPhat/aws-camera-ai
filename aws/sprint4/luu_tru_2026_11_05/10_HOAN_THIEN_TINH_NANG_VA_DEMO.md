# Hoàn thiện tính năng để demo đồ án

> BẢN CŨ ĐƯỢC LƯU NGÀY 05/11/2026. Không dùng làm hướng dẫn hiện hành. Mở file theo vai trò A/B/C ở thư mục cha.

**G0 đã chốt contract v1 ngày 05/11/2026:** dùng [hợp đồng chung](00_HOP_DONG_G0.md) và [schema/fixtures](../contracts/README.md) làm nguồn thống nhất cho type/field/API/config/owner. Account, quyền, resource IDs và release thực tế vẫn cần xác minh; không ghi G0 access hoặc E2E PASS chỉ vì contract đã chốt.

## 1. Cam kết đầu ra của bộ hướng dẫn

Mục tiêu là **hoàn thành tính năng trong CameraAI và demo được trên bản triển khai chung**. Bài Console giúp hiểu dịch vụ; sau bài đó, người phụ trách tiếp tục viết code, tích hợp và kiểm thử đến khi người dùng thao tác được trên ứng dụng. Không bàn giao riêng ARN, screenshot hoặc handler echo rồi coi nhiệm vụ đã xong.

Tài liệu này là phần triển khai bắt buộc đi cùng 02–04. Đọc hướng dẫn Console ở 08, thực hiện các gói việc bên dưới, rồi ghép theo 09 và nghiệm thu theo 05. Các đường dẫn ghi **cần tạo** là đầu ra của thành viên, chưa phải code chạy sẵn. `NEEDS_IMPLEMENTATION` là công việc đang mở của người đó, không phải điểm kết thúc bài.

Giữ kiến trúc đã chốt: ứng dụng/DB trên một EC2 cho lab, camera và model ở edge, S3 private, SQS/Lambda cho face và sender, Step Functions Standard cho deadline. Không yêu cầu HA hoặc quy mô production để demo đồ án. Các yêu cầu nghiệp vụ và kiểm thử trong 05 vẫn giữ nguyên; kênh SMS/call hay model chưa chạy phải ghi rõ, không tự đổi thành hoàn thành bằng mock.

## 2. Một tính năng được coi là xong khi nào?

Mỗi hàng dưới đây phải có đủ: code ở commit chung; migration/config/template nếu cần; test đúng/sai/chạy lại; chạy qua ứng dụng trên HTTPS; người khác chạy lại được bằng hướng dẫn; bằng chứng expected/actual.

| Gói                 | Owner / review | Đầu ra người dùng thấy                                        | Điều kiện hoàn thành                                                        |
| ------------------- | -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| F1 Đăng nhập        | A / B          | Đăng nhập Cognito, thấy đúng camera/incident của mình, logout | AUTH-01..03 và refresh/logout đạt trên HTTPS                                |
| F2 Ảnh và nhận diện | B / A,C        | Ảnh incident mở có quyền; known/unknown/no-face hiển thị đúng | FACE-01..02, DATA-01..02; job/result/receipt truy vết được                  |
| F3 Deadline         | B / A,C        | Xác nhận ngăn escalation; không xác nhận thì tự escalation    | FLOW-01..02; restart, stale và race không nhân intent                       |
| F4 Thông báo        | A+B / C        | Incident thật tạo thông báo, kết quả được lưu trong ứng dụng  | SEND trong 05; ít nhất một kênh thật đã xác nhận nhận được để trình diễn    |
| F5 Bản triển khai   | C / A,B        | Máy thứ hai mở HTTPS, xem sự kiện/media và xác nhận được      | Auth, DB, storage, queue, edge chạy; restart/restore/rollback có bằng chứng |
| F6 Demo tích hợp    | Cả ba          | Video/model → incident → face → thông báo → ack/deadline      | Các ca §8 chạy trên cùng release, không sửa DB thủ công giữa các bước       |

Các mã test chi tiết dùng bảng 05; bảng này không thay thế hoặc rút bớt bảng nghiệm thu đó. Nếu đồ án bắt buộc SMS/call thì phải chạy đúng kênh ấy. Email thật chỉ đáp ứng phần demo email, dry-run chỉ đáp ứng kiểm thử sender. Model chưa có bằng chứng thì F6 còn chờ; có thể trình diễn riêng cloud fixture với nhãn đúng phạm vi.

## 3. F1 — A hoàn thành đăng nhập trong ứng dụng

1. Kiểm tra code auth của nhánh tích hợp trước. Baseline đang có `apps/orchestrator/src/auth/`; README nhắc một nhánh auth khác, nên không giả định checkout này đã hỗ trợ Cognito. Review rồi tích hợp code sẵn có trước khi viết lại.
2. Hoàn thiện backend auth provider trong module auth, config schema và `.env.example`: kiểm tra access token theo issuer/client/token use, ánh xạ issuer/sub về application user ID; giữ role và camera ownership hiện có. Token sai phải bị từ chối, không fallback qua provider local.
3. Hoàn thiện frontend login/callback/refresh/logout trong `apps/web/`; công bố cấu hình public cần cho browser, giữ token/secret theo thiết kế auth đã review. Cập nhật contract trong `api/openapi.yaml` khi thêm endpoint; generate lại contracts khi schema thay đổi.
4. Thêm migration hoặc tool provision có thể chạy lại cho hai user thử; tài liệu hóa lệnh thật của PR. Không cấp admin theo email trùng và không sửa DB bằng tay để vượt bước đăng nhập.
5. Chạy AUTH trong 05 với hai user. Sau khi C có domain, sửa callback/sign-out đúng origin, build lại web nếu cần và chạy lại trên máy thứ hai.
6. Bàn giao commit, cách provision, các tên config/file đọc config, cách chạy và bằng chứng. Người B làm lại login và ca truy cập chéo user trước khi ký F1.

## 4. F2 — B hoàn thành đường ảnh và face

### 4.1. Contract trước, producer sau

1. Đọc `apps/orchestrator/src/face-recognition/face-recognition.worker.ts`, `src/ai-results/`, `src/known-faces/` và `src/storage/` trong orchestrator. Xác định chỗ tạo job hiện tại, chỗ nhận result, mapping known face và quyền media. Không thay toàn bộ service nghiệp vụ bằng Lambda.
2. Đưa schema job/result version 1 và fixtures vào repo cùng PR contract. Chốt stable job/result IDs, event/owner/camera/observation IDs, revision, S3 bucket/key và loại kết quả. Notification outcome có schema riêng. Field UUID phải dùng UUID hợp lệ theo DTO ứng dụng.
3. Tạo migration kế tiếp theo thứ tự migration của nhánh chung nếu thiếu dữ liệu outbox/receipt/mapping. Kiểm tra constraint hiện có trước khi tái sử dụng bảng; không chỉ thêm message type nếu constraint đang từ chối nó.
4. Tạo dispatcher SQS trong orchestrator (**cần tạo**): nhận công việc bền vững sau transaction, retry cùng ID, ghi trạng thái dispatch. Upload S3 thành công trước khi publish; ghi và xử lý lỗi upload/dispatch để retry được. Test rollback và restart không mất job đã chấp nhận.
5. Thêm lựa chọn transport vào config được validate, Compose và `.env.example`; cloud chỉ bật SQS cho tập incident demo. Worker BullMQ hiện có phải có điều kiện tắt cho cùng công việc; giữ Redis cho các tính năng còn sử dụng.

### 4.2. Worker và kết quả quay về ứng dụng

1. Tạo `services/aws-workers/face/` cùng manifest/build/test (**cần tạo**). Worker validate message, kiểm tra phạm vi owner/object, chọn collection đúng owner, gọi nhận diện, map FaceId về known face của ứng dụng và gửi result vào Results Queue. Phân biệt unknown, no-face và lỗi kỹ thuật; không biến lỗi thành nhận diện thành công.
2. Hoàn thiện enrollment/delete trong `src/known-faces/`: đăng ký từ luồng ứng dụng, lưu mapping provider, retry đồng bộ và xóa đúng owner. Chỉ search một collection có sẵn từ Console chưa hoàn thành tính năng quản lý khuôn mặt.
3. Tạo Results consumer long-poll trong orchestrator (**cần tạo**). Validate envelope, route face result về service AI result hiện có; commit receipt và nghiệp vụ rồi mới xóa message. Nhánh notification outcome dùng service riêng ở F4. Có shutdown, retry và log ID để điều tra lỗi.
4. C nối worker, queue và quyền trong template F5. Điền tên config thực và nơi đọc vào 09 §2, không để queue URL chỉ nằm trong ghi chép cá nhân.
5. Chạy R3: known/unknown/no-face/ảnh lỗi, owner sai, duplicate, stale và crash sau commit trước delete. A kiểm tra kết quả trên UI và quyền mở ảnh. Nếu UI/API chưa biểu diễn được kết quả, B sửa mapping và phối hợp A bổ sung hiển thị trước khi đóng F2.

## 5. F3 — B hoàn thành deadline thật

1. Đọc `src/escalation/escalation-deadline-worker.service.ts`, repository và engine. Tách operation xử lý một deadline dùng chung thay vì viết thêm một đường cập nhật trạng thái độc lập trong Lambda.
2. Thêm command nội bộ có auth vào controller/service và OpenAPI (**cần tạo**). PR phải ghi method/path thật, body gồm event ID, deadline/version và ID ổn định; response phân biệt applied/no-op/lỗi có thể retry. Không đưa endpoint đề xuất vào cấu hình như thể đã có implementation.
3. Trong transaction, khóa/kiểm tra trạng thái, version và thời hạn đã lưu. Ack/resolved/stale là no-op; due hợp lệ sinh đúng một escalation cùng intent/outbox. Ghi lịch sử bằng service/repository hiện có; kiểm thử race giữa ack và command.
4. Khi tạo deadline, ghi workflow-start outbox cùng nghiệp vụ. Dispatcher start workflow bằng tên ổn định, lưu execution ARN và reconcile lần gọi không rõ kết quả; cùng business deadline không tạo hiệu ứng mới khi retry.
5. Tạo `services/aws-workers/deadline/` và định nghĩa workflow dưới `infra/aws/` (**cần tạo**). Wait theo deadline UTC đã lưu, gọi command HTTPS có auth; ghi rõ Retry/Catch và cách phục hồi khi API ngừng hoạt động.
6. Thêm config chọn deadline owner. Worker quét local hiện tự khởi động; phải sửa điều kiện khởi động khi chọn cloud. Reconciler nếu giữ phải dùng chung operation idempotent.
7. Chạy R4 trên app: ack trước hạn, không ack, ack cạnh tranh, command lặp/stale và API gián đoạn rồi khôi phục. Dùng thời gian ngắn trong cấu hình lab và ghi giá trị vào evidence; không đổi đồng hồ máy để demo.

## 6. F4 — A và B hoàn thành thông báo thật

1. B đọc `src/notifications/` và luồng intent của escalation. Hoàn thiện intent/outbox transaction, claim và outcome service/API cùng schema/migration (**cần tạo phần chưa có**). Claim trả recipient được backend cho phép; sender không tin recipient do message tự khai báo.
2. Claim kiểm tra incident/version, trạng thái đã gửi, lease, cap/cooldown và allowlist. B test hai sender claim cùng notification; chỉ một claim hợp lệ. Hết lease sau một lần gửi không rõ kết quả phải đi qua policy đối soát, không tự gửi lại vô hạn.
3. A tạo `services/aws-workers/sender/` cùng manifest/build/test (**cần tạo**): validate job → claim HTTPS → send/no-op/dry-run → publish outcome. Retry giữ ID; lưu provider ID và reason. B nối nhánh outcome trong Results consumer và lưu ledger/receipt trước DeleteMessage.
4. Bổ sung API/UI hoặc cách đọc trạng thái được bảo vệ cho notification: phân biệt pending, dry-run, provider accepted, failed và uncertain theo contract đã chốt. Provider accepted chưa đồng nghĩa người nhận đã nhận thư/cuộc gọi; evidence ghi riêng hai việc.
5. C nối Notification Queue, sender, Results Queue và quyền. A chạy dry-run có claim và DB outcome, rồi duplicate/resolved/cap/error/crash-window bằng mock có nhãn. Không bật gửi thật cho bài tiêm lỗi.
6. Sau đó tạo incident mới từ ứng dụng để gửi SNS email tới địa chỉ thử đã confirm. Lưu notification ID, MessageId và xác nhận nhận thư. Publish thủ công trên Console chỉ là bước kiểm tra kênh trước đó.
7. Thực hiện SMS/call theo A5 khi thuộc yêu cầu đồ án và đủ điều kiện. Mỗi kênh có trạng thái riêng; thiếu quyền là blocker cần giải quyết, không ghi toàn tính năng đã xong. A và B cùng ký F4 vì sender chạy mà ledger chưa cập nhật vẫn là chưa hoàn thành.

## 7. F5 — C bàn giao bản chạy chung

1. Tạo `infra/aws/` chứa template, workflow và hướng dẫn build/deploy/delete của repo (**cần tạo**). Khai báo bucket private, queues/DLQ, workers, workflow, roles, log/alarms và Outputs theo 04/09; A/B review cấu hình nghiệp vụ. Tài nguyên Console học riêng không thay thế template ghép.
2. Tạo `infra/deploy/` chứa Compose cloud, proxy HTTPS, env mẫu không secret, migration runner, deploy/smoke/backup/restore/rollback và manifest release (**cần tạo**). Mỗi script phải có lệnh chạy và điều kiện đầu vào trong README của thư mục; ghi digest/commit và cấu hình provider/transport/deadline owner của bản demo.
3. Nối config tới đúng container/process; thử credential chain thực trong app, không chỉ AWS CLI trên máy cá nhân. DB/Redis private, dữ liệu có volume và backup. Nối edge theo C7 để cloud lấy được media và nhận sự kiện thật.
4. Deploy commit tích hợp đã qua kiểm thử, chạy migration runner trước khi nhận traffic theo quy trình release. Chạy lại F1–F4 trên HTTPS bằng máy thứ hai. Health 200 không thay cho login/upload/result/notification smoke.
5. Chạy restart, alarm thực nhận, restore vào DB thử riêng và rollback app theo R7. Hoàn thiện CD theo C10/kế hoạch Sprint; không cần dựng thêm một hệ thống HA cho bài lab. Phần release chưa thực hiện phải giữ trạng thái mở trong 05.
6. Bàn giao một hướng dẫn để thành viên khác khởi động lại đúng bản demo và xác nhận smoke, kèm inventory, giờ giữ tài nguyên và cách dọn. Không phụ thuộc một terminal cá nhân đang mở mà không ghi lại cách chạy.

## 8. F6 — Diễn tập demo đồ án trên cùng release

### Chuẩn bị một lần trước buổi demo

- Ghi commit/digest, URL HTTPS, người điều khiển demo, người theo dõi logs và người theo dõi AWS.
- Tạo hai user, camera và known face bằng đường ứng dụng; dùng ảnh/video có quyền sử dụng. Ghi model artifact và báo cáo đánh giá theo G4.
- Kiểm tra email/kênh thật, queue không còn lỗi chưa hiểu, edge đang kết nối, thời gian deadline lab và giới hạn gửi.
- Chạy các ca dưới đây một lượt; lưu kết quả và video dự phòng cùng release. Video dự phòng phải được giới thiệu là bản ghi, không giả thành hệ thống đang chạy.

| Ca  | Thao tác trình diễn                                                     | Kết quả phải quan sát                                                               |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D1  | User A login, mở camera/incident; thử user B không có quyền             | A thấy đúng dữ liệu, B bị chặn cả API/media                                         |
| D2  | Chạy video/model thuộc scope, tạo incident, mở ảnh và kết quả face      | Cùng event ID đi qua app → S3 → Lambda → Results → DB/UI; model thật có trace riêng |
| D3  | Tạo incident cần thông báo, kiểm tra kênh nhận, xác nhận trước deadline | Outcome lưu trong app; deadline kết thúc không escalation                           |
| D4  | Tạo incident mới và không xác nhận                                      | Workflow đến hạn, một escalation/intent hợp lệ; sender có outcome theo policy       |
| D5  | Chạy lại một result/command bằng runner có kiểm soát của PR             | Không nhân kết quả/escalation/thông báo; trạng thái vẫn đúng                        |
| D6  | Mở evidence recovery/rollback đã diễn tập                               | Đúng release, expected/actual và cách phục hồi có thể làm lại                       |

D2 dùng fixture chỉ chứng minh cloud integration, phải nói rõ và chưa đóng E2E model. Với fall/fire/face, chỉ tuyên bố những loại sự kiện đã chạy và đo; không suy rộng một video thành mọi loại model đều đạt.

Mỗi ca ghi ID, thời gian, expected/actual, vị trí bằng chứng và reviewer theo 06. Trước buổi bảo vệ, thành viên khác phải chạy lại D1–D4 từ hướng dẫn mà không nhờ tác giả sửa code giữa chừng. Nếu thất bại, mở lại F tương ứng và chạy lại ca bị ảnh hưởng sau khi sửa.

## 9. Nhịp làm việc và kiểm tra trước bàn giao

1. Cả ba làm G0. A bắt đầu F1 và adapter sender bằng mock; B làm contract/producer/result; C làm template và HTTPS song song.
2. Khi contract claim/outcome ổn định, A+B nối F4; khi HTTPS có, B nối F3. Các điểm phụ thuộc phải có người nhận và ngày hẹn, không đợi đến ngày demo mới ghép.
3. Mỗi PR cập nhật OpenAPI/contracts nếu đổi giao tiếp, config schema, `.env.example`, Compose/template liên quan và hướng dẫn chạy. Ghi lệnh build/test của worker mới trong manifest của chính worker đó.
4. Với thay đổi orchestrator, chạy các lệnh hiện có dưới đây và bộ test liên quan. Test tích hợp cần DB/migrations đúng môi trường thử; không reset DB dev chung để chạy test.

   ```powershell
   pnpm --filter @cam/orchestrator typecheck
   pnpm --filter @cam/orchestrator test -- --runInBand
   pnpm --filter @cam/orchestrator build
   pnpm api:lint
   pnpm check:secrets
   ```

5. Với web/worker/template, bổ sung build và kiểm tra đúng phần đã sửa; trong bàn giao ghi lệnh thực và kết quả, không ghi PASS cho lệnh chưa chạy. Người review thực hiện ít nhất một ca chức năng từ bản chung.
6. Chỉ đóng gói việc khi F tương ứng đạt. Chỉ ghi Sprint 4 hoàn thành khi bảng 05, F1–F6 và bàn giao 06 có bằng chứng đạt cho phạm vi đồ án đã chốt. Một danh sách blocker trung thực hữu ích để sửa tiếp, nhưng không thay thế tính năng hoàn chỉnh.
