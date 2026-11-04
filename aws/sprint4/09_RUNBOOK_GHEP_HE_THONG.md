# Runbook ghép CameraAI: từ ba bài riêng tới một hệ thống

Dùng cùng [phân công A/B/C](README.md), [thao tác Console](08_THUC_HANH_CONSOLE.md) và [tiêu chí nghiệm thu](05_GHEP_HE_THONG.md). A phụ trách auth/sender, B phụ trách dữ liệu/nghiệp vụ, C phụ trách hạ tầng/deploy. Tại mỗi chặng, người thực hiện đọc expected output cho người kiểm tra chéo trước khi chạy.

## 1. Phạm vi và điều kiện bắt đầu

Đối chiếu code ở commit docs `a6afe27` ngày 04/11/2026 và các file được liên kết bên dưới. Đây là runbook thực hiện tích hợp, không phải báo cáo hệ thống đã chạy E2E. Nhóm phải ghi commit code thực tế vào bàn giao; không deploy nhánh docs.

| Có thể dùng làm nền                                      | Còn phải triển khai/review trên nhánh code                        |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| S3 adapter, health API, AI result service/controller/DTO | Generic AWS job outbox và Results SQS consumer                    |
| BullMQ face worker và mapper kết quả local               | Face Lambda sản phẩm, mapping owner/collection/known face         |
| Deadline worker local và notification records            | Deadline command HTTPS, workflow dispatcher, sender claim/outcome |
| Code auth bổ sung ở `lab-test`                           | Review/merge và test auth trên commit tích hợp                    |
| SAM echo trong Lab 04 và các handler lab                 | `infra/aws`, `services/aws-workers`, `infra/deploy` tích hợp      |

**Quy tắc dừng:** một chặng yêu cầu file/API chưa có thì ghi `NEEDS_IMPLEMENTATION`, owner và PR cần hoàn thành. Không tạo URL giả, không thêm một biến env rồi coi tính năng đã bật. Sau khi PR merge, ghi commit và tiếp tục ngay chặng đó. Không bỏ qua các chặng này để báo toàn sprint PASS.

### Phiên ghép đầu tiên — cả ba cùng làm

1. Mở [mẫu bàn giao](06_MAU_BAN_GIAO.md). Ghi account, Region, commit code, domain dev và người deploy duy nhất là C.
2. A công bố pool/client/domain và hai user test; B công bố schema v1, IDs của user/camera/event mẫu; C công bố tên stack dev. Chưa có giá trị thì ghi blocker, không tự đoán.
3. Chốt một môi trường **dev** để ghép. Giữ queue lab riêng; message `lab.received` hoặc `lab.face.result` không đưa vào Results consumer sản phẩm.
4. Mỗi người dùng checkout code của mình, tạo nhánh feat/ci theo [Git workflow](../../docs/conventions/GIT_WORKFLOW.md). Mỗi ngày đồng bộ qua PR; chỉ C deploy stack chung.
5. Chạy các kiểm tra đọc trạng thái trên PowerShell tại thư mục gốc repo:

   ```powershell
   git branch --show-current
   git rev-parse HEAD
   aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
   docker compose version
   pnpm --version
   ```

6. Đối chiếu Account/Arn riêng, không đưa credential vào evidence. Nếu chưa có profile, quay lại chuẩn bị chung. Chọn duy nhất một auth provider và một transport face cho bản deploy; tên transport/flag phải do PR code định nghĩa.

## 2. Bảng nối cấu hình: lấy gì, đưa vào đâu?

Không sao chép `.env` của người khác. C giữ cấu hình môi trường trong secret store theo [CD guide](../CD_INTEGRATION_GUIDE.md), chỉ bàn giao tên tham chiếu. Khi sửa môi trường container, recreate/redeploy service để nạp lại.

| Giá trị cần bàn giao                     | Lấy từ đâu                             | Nơi nhận và điều cần kiểm tra                                                            |
| ---------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AWS_REGION`                             | Region thống nhất                      | Backend/worker: `ap-southeast-1`                                                         |
| `STORAGE_PROVIDER`                       | Quyết định deploy                      | Backend: `s3`; StorageModule chọn adapter theo biến này                                  |
| `S3_BUCKET`                              | S3 → bucket dev → Name                 | Backend S3 adapter đọc đúng tên này; không nhập ARN                                      |
| `STORAGE_BUCKET`                         | Cấu hình storage chung/legacy          | Kiểm tra nơi còn dùng; chỉ đặt biến này chưa đủ cho S3 adapter hiện tại                  |
| `AUTH_PROVIDER`                          | Quyết định A/B/C                       | Backend đã có code chuyển provider: `jwt` hoặc `cognito`                                 |
| `COGNITO_USER_POOL_ID`                   | Pool Overview                          | Backend verifier; không thay bằng client ID                                              |
| `COGNITO_CLIENT_ID`                      | App client information                 | Public client của browser/verifier                                                       |
| `COGNITO_DOMAIN`                         | Cognito domain                         | Code auth mới: origin HTTPS, không có đường dẫn authorize                                |
| `WEB_ORIGIN`                             | Domain do C triển khai                 | Backend CORS; browser origin HTTPS đúng port/scheme                                      |
| API base URL của web                     | Cấu hình frontend của commit deploy    | C/A kiểm tra build và proxy; không để localhost trong bundle cloud                       |
| `INTERNAL_SERVICE_TOKEN`                 | Secret store, giá trị ít nhất 32 ký tự | API AI result hiện tại dùng `X-Internal-Token`; không dùng access token Cognito thay thế |
| Face jobs/results/notification queue URL | Stack Outputs hoặc SQS Details         | Producer/consumer/worker config theo schema PR; SDK dùng URL                             |
| Queue ARN                                | Stack Outputs hoặc SQS Details         | IAM policy và event source mapping; không dùng URL thay ARN                              |
| Collection ID + owner mapping            | B tạo và lưu mapping                   | Face/enrollment adapter; collection lab không tự trở thành collection sản phẩm           |
| Deadline Lambda ARN/workflow ARN         | Stack Outputs                          | ASL InvokeFunction/dispatcher StartExecution tương ứng                                   |
| Service API base URL và command auth     | OpenAPI + HTTPS của C                  | Deadline/sender gọi từ Lambda được; không phải localhost máy A/B                         |
| Topic incident/ops ARN                   | SNS Details                            | Sender dùng incident; CloudWatch dùng ops                                                |
| DB/Redis/private edge URLs               | C quản lý môi trường                   | Chỉ hostname reachable từ service gọi; Docker DNS không đi xuyên hai máy                 |

Các queue/workflow/claim config trong bảng **chưa có tên env thống nhất ở baseline**. B/C phải đưa chúng vào config schema của PR, thêm `.env.example` không chứa secret và điền bảng thật dưới đây trước G1b:

| Thành phần cần nối         | Tên biến/config thực trong PR | File đọc biến | Nguồn giá trị             | Đã nhận khi khởi động? |
| -------------------------- | ----------------------------- | ------------- | ------------------------- | ---------------------- |
| Face dispatcher → jobs     | B/C điền                      | B/C điền      | Jobs URL                  | Chưa                   |
| Face Lambda → results      | B/C điền                      | B/C điền      | Results URL               | Chưa                   |
| Result consumer            | B/C điền                      | B/C điền      | Results URL               | Chưa                   |
| Workflow dispatcher        | B/C điền                      | B/C điền      | Workflow ARN              | Chưa                   |
| Deadline command URL/auth  | B/C điền                      | B/C điền      | API contract + secret ref | Chưa                   |
| Sender queue/claim/outcome | A/B/C điền                    | A/B/C điền    | Queue/API/secret refs     | Chưa                   |

**Lưu ý credentials từ code hiện tại:** [S3StorageService](../../apps/orchestrator/src/storage/s3-storage.service.ts) tự tạo credentials khi có cả AWS_ACCESS_KEY_ID và AWS_SECRET_ACCESS_KEY; nhánh đó chưa truyền session token. Vì vậy không đưa cặp key tạm thiếu token vào env. Trên EC2 dùng instance role, bỏ cặp key tĩnh; test SDK ngay trong container. CLI trên laptop có profile SSO không có nghĩa container tự truy cập được profile đó. B/C phải review credential chain khi hỗ trợ chạy local bằng credentials tạm.

### Xác nhận container nhận cấu hình mà không in secret

Trên checkout tích hợp local, sau khi đã cấu hình `.env` theo nhánh code:

```powershell
docker compose up -d --build orchestrator web
docker compose ps
docker compose exec -T orchestrator node -e 'for(const k of ["AWS_REGION","STORAGE_PROVIDER","S3_BUCKET","AUTH_PROVIDER","COGNITO_USER_POOL_ID","COGNITO_CLIENT_ID","COGNITO_DOMAIN","INTERNAL_SERVICE_TOKEN"]){console.log(k+"="+(process.env[k]?.trim()?"SET":"MISSING_OR_EMPTY"))}'
```

Đây chỉ là kiểm tra biến có giá trị. A/B/C vẫn phải đối chiếu giá trị đúng ở nguồn cấu hình được bảo vệ. Không in toàn bộ env hoặc `docker compose config` vào log chung. Với cloud, dùng tên file Compose đã được PR cung cấp; không dùng nguyên Compose dev vì nó publish DB/Redis và chạy development target.

## 3. Chặng R0 — làm ứng dụng local ổn định trước

**Owner B/C, A kiểm tra browser.**

1. Review/đưa code auth từ `lab-test` vào nhánh tích hợp nếu cần Cognito. Kiểm tra có `auth.config.ts`, `cognito-token.service.ts`, frontend runtime config và endpoint `/auth/config` như [AUTH_PROVIDERS](../../docs/architecture/AUTH_PROVIDERS.md). File hướng dẫn tồn tại không chứng minh code auth đã merge.
2. Khởi động dependency của bản local theo hướng dẫn repo; giữ nguyên DB đang dùng. Trước migration có backup; không chạy `db:reset` hoặc xóa volume để sửa lỗi startup.
3. Nếu có migration mới, B review danh sách và chạy `pnpm db:migrate` ở checkout local với DATABASE_URL trỏ đúng DB. Trên cloud dùng migration runner của release; không mặc định script local có mặt trong image production.
4. Chạy `docker compose up -d --build orchestrator web`, xem `docker compose ps`, rồi:

   ```powershell
   Invoke-RestMethod 'http://localhost:3001/api/v1/health'
   docker compose logs --since 10m --tail 100 orchestrator
   ```

5. Health expected: `status=ok`, `service=orchestrator`, có timestamp/uptime. [HealthService](../../apps/orchestrator/src/health/health.service.ts) hiện chỉ trả trạng thái ứng dụng; không probe DB/SQS/S3. Không coi health 200 là tất cả dependencies hoạt động.
6. A đăng nhập bằng provider được chọn, mở camera của chính user. Ghi commit và kết quả baseline trước khi chuyển S3/SQS.

**Dừng nếu:** startup thiếu LOGIN_MAX_ATTEMPTS, config Cognito rỗng hoặc migration lỗi. Đối chiếu code auth và env thực trong container; `.env` chỉ đúng trên host chưa đủ. Lưu lỗi đã che thông tin nhạy cảm vào bàn giao.

## 4. Chặng R1 — C deploy stack dev, A/B nhận Outputs

**Có thể làm song song R0/auth.** Chỉ dùng Lab 04 để kiểm tra SAM echo riêng; stack echo không thay stack tích hợp.

1. C tạo/review template `infra/aws/template.yaml` trên PR code. Nội dung tối thiểu: S3 private/lifecycle theo policy nhóm; face jobs/results/notification queues và DLQ; face/deadline/sender handlers; Standard workflow; roles giới hạn ARN; logs/retention. A/B review timeout, message contract và quyền.
2. Template xuất Outputs rõ nghĩa: bucket name, từng queue URL và ARN, worker names, deadline ARN, workflow ARN. Đây là yêu cầu Outputs cho PR; không tự đoán output key trong stack đã có.
3. Xác nhận file và handler paths có thật trước khi chạy. PowerShell, tại root của checkout code:

   ```powershell
   if (-not (Test-Path 'infra/aws/template.yaml')) {
     throw 'Chua co template tich hop. Hoan thanh PR ha tang truoc.'
   }
   sam validate --lint --template-file infra/aws/template.yaml --profile camerai-lab --region ap-southeast-1
   sam build --template-file infra/aws/template.yaml
   sam deploy --guided --template-file .aws-sam/build/template.yaml --stack-name camerai-s4-dev --profile camerai-lab --region ap-southeast-1 --capabilities CAPABILITY_IAM
   ```

4. Trong Guided, bật review change set trước thực thi. Kiểm tra đúng stack dev, resource mới/sửa và IAM; không tiếp tục nếu change set thay/xóa tài nguyên ngoài phạm vi.
5. CloudFormation → Stacks → `camerai-s4-dev` → Events. Đợi trạng thái kết thúc thành công; nếu rollback, đọc resource failure đầu tiên rồi sửa template.
6. Lấy Outputs bằng lệnh đọc:

   ```powershell
   aws cloudformation describe-stacks --stack-name camerai-s4-dev --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' --profile camerai-lab --region ap-southeast-1
   ```

7. Điền bảng cấu hình ở §2. A/B kiểm tra resource cùng account/Region; đảm bảo queue lab và dev khác nhau. Từ đây mọi sửa lâu dài quay về template.

**Qua R1:** stack deploy thành công, Outputs có reviewer, config của từng service được nối đúng. Chưa bật consumer vào incident thật khi contract còn chưa hoàn thành.

## 5. Chặng R2 — ghép Cognito với web/backend

**Owner A, B review ownership.** Có thể chạy song song R1 và chuẩn bị R3.

1. A làm A1–A3 với code auth đã merge. Map `(issuer, sub)` tới user DB hiện có, giữ application user ID/role/camera ownership; dùng migration/tool có trong PR auth, không tự ghép admin theo email.
2. Giữ một khai báo mỗi biến AUTH_PROVIDER/COGNITO trong `.env`; recreate orchestrator sau khi sửa. Local dùng:

   ```powershell
   docker compose up -d --no-deps --force-recreate orchestrator
   Invoke-RestMethod 'http://localhost:3001/api/v1/auth/config'
   ```

3. Expected trên code auth mới: provider `cognito`; nếu endpoint 404 thì kiểm tra commit, không tiếp tục sửa Console callback để chữa API thiếu.
4. Đăng nhập từ web; Network của browser: callback đúng origin, API dùng access token, API của user map trả đúng dữ liệu. Không đưa token vào ảnh chụp.
5. Test lần lượt: thiếu token 401; user có token nhưng chưa provision 403; user không được cấp quyền bị chặn camera/media; refresh/logout theo A3.
6. Sau khi C có HTTPS, thêm callback `https://<domain>/auth/callback` và sign-out `https://<domain>` cho đúng client. Cập nhật WEB_ORIGIN/API base URL rồi build/redeploy web nếu cấu hình nằm trong bundle. Test lại bằng browser máy thứ hai.

**Qua R2:** không chỉ login Cognito thành công mà API/ownership/media đã đúng ở local và cloud. Không chạy hai provider fallback khi token sai.

## 6. Chặng R3 — S3 → job → face → Results → DB

### R3.1. B hoàn thành PR transport trước khi bật

1. Đọc [face worker local](../../apps/orchestrator/src/face-recognition/face-recognition.worker.ts), [AI result DTO](../../apps/orchestrator/src/ai-results/dto/submit-ai-result.dto.ts) và [controller](../../apps/orchestrator/src/ai-results/ai-results.controller.ts). Worker hiện dùng `@Processor('face-recognition')` của BullMQ; FACE_PROVIDER=rekognition không tự chuyển job sang SQS Lambda.
2. Chốt schema v1 của job/result với A/C. resultId/eventId phải là UUID theo DTO hiện tại. Envelope queue phải phân biệt face result với notification outcome; không đưa raw `lab.face.result` vào DTO.
3. PR producer: upload S3 thành công trước publish; lưu durable outbox trong transaction thích hợp; dispatcher retry cùng stable job ID. DB rollback không được để mất công việc đã được nghiệp vụ chấp nhận.
4. PR Face Lambda: kiểm tra owner và object key, chọn đúng collection, map FaceId về known face của app, normalize no-face/technical failure, gửi result vào Results. Retry/partial failure phải khớp event source mapping; không dùng handler lab chỉ trả KNOWN/UNKNOWN cho production.
5. PR Results consumer: long-poll, validate schema/owner/revision, gọi service nghiệp vụ, commit receipt/result trước DeleteMessage. Nếu cùng process NestJS, dùng service trực tiếp; nếu tách worker, dùng API nội bộ được bảo vệ. Không ghi thẳng SQL bỏ qua service invariants.
6. PR có kiểm thử duplicate/stale/crash sau commit trước delete/invalid owner, config schema và một cách chạy fixture được tài liệu hóa. Chỉ merge khi người khác review.

### R3.2. Chạy lần đầu với một ảnh fixture

1. C/A tắt sender thật; B chọn user/camera test thuộc user đó. Tạo event bằng đường producer chính của ứng dụng, ghi event UUID từ UI/API. Không tự insert event bằng SQL.
2. C tạm giữ Results consumer dừng theo cơ chế PR cung cấp, để kiểm tra config mà không tranh message; không poll queue job trong Console khi Lambda đang consume.
3. Chuyển backend storage sang s3, đặt S3_BUCKET đúng bucket dev, credentials đúng instance role. Recreate/redeploy backend. Từ ứng dụng tạo/upload một crop lab đã được đồng ý.
4. S3 → bucket dev → Objects: tìm đúng key được ứng dụng ghi. Mở qua media API bằng user sở hữu; user khác phải bị chặn. Không bật public bucket để chữa signed URL lỗi.
5. B bật duy nhất dispatcher SQS cho fixture đã chọn, ghi outbox ID/jobId/eventId/key. Tắt producer BullMQ cho cùng loại công việc theo PR; không tắt toàn bộ Redis nếu còn chức năng khác dùng.
6. Lambda → function dev → logs: tìm jobId. C kiểm tra mapping đúng queue ARN, Enabled, timeout/visibility và quyền role. Phải có dấu vết search và publish result; return value Lambda không tự vào Results Queue.
7. B bật Results consumer. Quan sát log cùng resultId và kết quả incident qua API/UI; receipt phải có disposition đúng. Sau xử lý, queue backlog giảm; backlog giảm riêng lẻ chưa chứng minh DB commit.
8. Nếu cần đọc queue thủ công để debug, dừng application consumer trước, ghi message tạm ẩn do polling; không xóa message đang cần chẩn đoán.

API hiện có: `POST /api/v1/internal/events/{eventId}/ai-result`, header **X-Internal-Token**, expected HTTP **202** với disposition ACCEPTED/DUPLICATE/STALE. Guard đọc **INTERNAL_SERVICE_TOKEN**, không phải AI_INTERNAL_TOKEN. Dùng Swagger local `/api/docs` để đối chiếu DTO của commit đang chạy. Không mở Swagger cloud công khai chỉ để thử nội bộ.

### R3.3. Replay có kiểm soát

1. Giữ nguyên body và resultId của fixture đã xử lý. Dùng fixture runner/consumer test của PR gửi lại 10 lần trên dữ liệu lab; expected một hiệu ứng nghiệp vụ, lần sau DUPLICATE theo contract.
2. Gửi revision mới rồi revision cũ của cùng observation; expected STALE cho dữ liệu cũ và không ghi đè bản mới.
3. Dùng test hook ở môi trường test để dừng consumer sau DB commit nhưng trước delete. Restart: cùng message được xử lý an toàn. Không thêm crash hook bật mặc định ở dev chung.
4. Gửi invalid owner/schema: expected reject/quarantine/DLQ có reason. Không delete im lặng; không retry vô hạn lỗi terminal.
5. Lặp known/unknown/no-face/ảnh lỗi. B/A đối chiếu ý nghĩa hiển thị; Rekognition similarity không tự trở thành confidence cùng thang đo với model local.

**Qua R3:** có bằng chứng xuyên jobId → Lambda request → resultId → receipt → incident và các bài replay đạt. Không dùng ảnh thật để thay fixture trước khi chặng này qua.

## 7. Chặng R4 — deadline: API trước, workflow sau

**Owner B/C.** Sender vẫn dry-run. Deadline Lambda lab chỉ log command, chưa chuyển incident thật.

1. B tạo/review command trong OpenAPI và service: method/path, auth, event UUID, expected version/deadline, response cho applied/no-op/retryable error. Không có endpoint deadline xác nhận trong baseline, nên nhóm phải ghi endpoint thật vào bàn giao trước khi cấu hình Lambda.
2. Test service transaction: lock/check state, version và deadline bằng thời gian đáng tin cậy; resolved/stale → no-op; due → một ESCALATED và một intent/outbox. Review race với thao tác ack.
3. B tạo workflow-start outbox/dispatcher: timestamp UTC và deadlineVersion được lưu bền vững; tên execution ổn định; lưu execution ARN. Timeout/retry StartExecution không tạo thêm deadline nghiệp vụ.
4. C cấu hình Standard workflow theo [Lab 06](../labs/06_STEP_FUNCTIONS.md), đổi bài đợi tương đối sang deadline UTC đã lưu theo B9. Deadline Lambda gọi command qua HTTPS có service auth, Retry/Catch/reconcile theo phân loại lỗi.
5. Test API command từ môi trường Lambda bằng dữ liệu lab, trước khi bật workflow dispatcher. HTTPS lỗi/certificate/auth sai phải sửa ở tầng đó, không bỏ guard.
6. Ngừng deadline worker local cho cùng tập incident theo cơ chế PR; nếu giữ reconciler, nó phải đi qua cùng operation có idempotency. Ghi worker nào đang sở hữu deadline vào release.
7. Tạo incident test, tới NOTIFIED, ghi deadline/version/execution ARN. Mở Step Functions execution để theo dõi.
8. Ca 1: ack trước deadline; workflow tới command và nhận no-op, không tạo call intent. Ca 2: không ack; đúng hạn tạo một escalation/intent. Ca 3: ack cạnh tranh command; kết quả tuân theo transaction/policy đã review, không sinh hai quyết định.
9. Ca 4: API tạm không reachable; workflow retry/fail đúng policy, sau khôi phục reconciler phát hiện công việc còn pending. Execution xanh không được che việc command chưa commit.

**Qua R4:** có bằng chứng DB/API cùng execution history; stale/duplicate/restart an toàn. Nếu chỉ thấy Wait → log → Succeeded thì mới LAB_PASS.

## 8. Chặng R5 — intent → sender → outcome, bắt đầu dry-run

**Owner A/B, C cấu hình role.**

1. B công bố claim/outcome contract và code đã merge: stable notification ID, owner, incident state/version, recipient policy, lease/expiry, cap/cooldown, auth và response no-op. Chưa có contract thì A test adapter bằng mock có nhãn, không nối gửi thật.
2. A triển khai sender parse/validate job → claim HTTPS → quyết định send/no-op/dry-run → publish outcome về Results; B thêm consumer nhánh notification outcome. Không đưa outcome vào AI result DTO.
3. C gắn notification queue → đúng sender Lambda, batch 1; role consume queue, SendMessage Results, quyền provider chỉ resource cần dùng. Queue lab logger không dùng cho sender sản phẩm.
4. A bật dry-run theo config đã được PR định nghĩa; xác nhận log/outcome `providerCalled=false`. Dry-run vẫn phải đi qua claim và ghi kết quả bền vững của app.
5. Tạo incident không ack của R4. Theo dõi notification ID từ intent/outbox tới SQS, claim, sender outcome, result receipt và UI. Nếu sender chỉ log rồi trả success nhưng app chưa lưu outcome, chặng chưa qua.
6. Gửi duplicate/expired lease/resolved incident/cap exceeded; expected gửi theo policy, no-op có reason. B/A thử crash window sau provider nhận trước khi outcome được lưu bằng mock; trạng thái uncertain phải đối soát được.
7. Sau review dry-run, dùng incident topic SNS và một email allowlist đã confirm. A bật provider cho đúng phạm vi test, tạo một notification mới, ghi MessageId và xác nhận email đến. Không resend cùng notification uncertain để thử vận may.
8. SMS/call chỉ chạy khi điều kiện tài khoản đã đạt. Ghi từng kênh REAL_PASS hoặc BLOCKED_ACCOUNT; email nhận được không thay thế bằng chứng SMS/call. Với Connect lưu ContactId và kiểm tra người nhận nghe được riêng biệt.

**Qua R5:** notification có ledger/outcome trong DB, dry-run và replay đạt; kênh thật đạt theo phạm vi được nghiệm thu. SNS thủ công pass chỉ chứng minh kênh, không chứng minh sender integration.

## 9. Chặng R6 — triển khai cloud và nối edge/model thật

**C làm deploy, A kiểm browser, B kiểm dữ liệu.** Làm C3–C7 song song các PR nghiệp vụ; chỉ bật đường event thật sau R3–R5.

1. C chuẩn bị file cloud trong `infra/deploy/` qua PR: production images theo digest, proxy, volumes, private DB/Redis, migration runner, env/secrets, health/readiness và rollback. Dùng mẫu [CD guide](../CD_INTEGRATION_GUIDE.md), điền tên file/lệnh thực tế vào release manifest. Chưa có các file này thì chưa có lệnh deploy cloud chung có thể chạy an toàn.
2. Trên server, kiểm tra role/SSM/Docker, đủ disk, backup và artifact hiện tại. Dùng lệnh `docker compose ... config --quiet` với đúng file/env của release để validate mà không in secret; chạy migration runner đã review trước khi nhận traffic.
3. Deploy digest đã qua test, kiểm tra containers và proxy certificate. PowerShell trên máy thứ hai, nhập domain thật:

   ```powershell
   $cameraAiOrigin = (Read-Host 'Nhap origin HTTPS dev, vi du https://app.example.com').TrimEnd('/')
   Invoke-RestMethod "$cameraAiOrigin/api/v1/health"
   ```

4. A chạy lại R2 trên HTTPS; kiểm tra API base URL trong Network không phải localhost, proxy giữ `/api/v1`, SSE và media cần auth. Health hiện tại không đo dependencies; thử ít nhất một thao tác đọc DB/upload/queue qua app.
5. C thiết lập VPN/private route và ACL theo C7; B thử backend lấy crop/clip từ edge. Không dùng tên service Docker trên edge làm địa chỉ từ EC2 nếu không có cơ chế DNS/routing tương ứng.
6. Chốt một producer event: luồng Frigate/MQTT hoặc API/model adapter đã review. Replay một video lab; ghi camera ID, source session, track/episode và event UUID. Không đồng thời bật hai producer cho cùng incident.
7. Đối chiếu model artifact/checksum/runtime/preprocessing/evaluation và owner. Thay fixture bằng model thật, giữ cùng contract/result semantics; replay cùng video known/unknown/fall/fire theo scope.
8. Người sở hữu mở incident; người khác bị chặn; test ack/no-ack, escalation và email/số nhận allowlist. Đo mốc thời gian theo từng chặng, không dùng workflow duration làm latency phát hiện model.
9. Test live media từ mạng khác riêng: API HTTPS pass không chứng minh WebRTC/ICE/TURN hoạt động.

**Qua R6:** video/model thật → incident → face/result → deadline/ack → sender/outcome có trace và số đo. Nếu thiếu model report, giữ cloud fixture pass và ghi BLOCKED_AI cho E2E thật.

## 10. Chặng R7 — vận hành, CD và đóng sprint

1. C tạo ops topic riêng, alarm theo C8/C9. B/A kích một lỗi lab có kiểm soát; xác nhận metric đúng dimension, ALARM và email thực nhận. Không lấy ảnh màn hình cấu hình alarm làm bằng chứng alarm test.
2. Ngắt heartbeat lab, khôi phục; expected báo mất kết nối rồi phục hồi, không sinh kết quả AI giả.
3. B/C backup và restore vào DB test riêng, so dữ liệu và thử API. Ghi thời điểm/checksum/restore evidence; không chạy restore đè DB dev đang có người thử.
4. Restart service/server trong phiên test thống nhất: DB/volumes tồn tại, consumer/outbox/workflow reconcile; không mất công việc đã được chấp nhận.
5. C làm staging CD theo CD guide. Cùng release digest đã kiểm chứng được promote; chạy smoke gồm auth, storage, queue/result và dry-run. Không đổi provider giữa staging và production chỉ để qua healthcheck.
6. Thử rollback về digest trước, xác nhận migration tương thích và smoke lại. Không db:reset hoặc rollback DB tự động vì app startup lỗi.
7. Cả ba điền [bảng test đầy đủ](05_GHEP_HE_THONG.md#4-bộ-kiểm-thử-trước-demo). Reviewer xác nhận evidence, blockers và acceptance criteria bắt buộc; phần giảm scope phải được người phụ trách chấp thuận.
8. Kiểm kê tài nguyên giữ/dọn và người trả phí. Không xóa queue/workflow còn pending chưa được xử lý/bàn giao. Không xóa resource chung chỉ vì tên có chữ lab.

## 11. Chẩn đoán theo chặng bị đứt

| Triệu chứng                                 | Kiểm tra theo thứ tự                                                           | Không tiếp tục khi                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Có file env nhưng backend báo thiếu Cognito | Commit auth → biến trùng/rỗng → Compose env/override → recreate → /auth/config | Chưa xác định provider thật                                  |
| S3 log xuất hiện nhưng app vẫn ghi MinIO    | STORAGE_PROVIDER → consumer của STORAGE_SERVICE → object key thật              | Chỉ dựa log khởi tạo; StorageModule hiện tạo cả hai adapters |
| CLI gọi S3 được, container lỗi              | Credential chain container → key tĩnh ghi đè role → instance profile/IMDS      | Đang định nhúng key vào image                                |
| DB có outbox nhưng job không tới Lambda     | Dispatcher/routing → queue URL/account/Region → SendMessage → mapping/role/DLQ | Chưa biết job đã publish hay chưa                            |
| Lambda success nhưng DB không đổi           | SendMessage Results → contract → consumer/receipt → service transaction        | Chỉ nhìn return value Lambda                                 |
| Result bị reject 400/401/404/409            | DTO/schema → internal token → event UUID tồn tại → resultId/payload conflict   | Đang định đổi UUID mỗi lần retry để né conflict              |
| Wait xong không escalation                  | Đúng workflow → HTTPS/auth → command/version/state → transaction/reconcile     | Chỉ có Lambda echo lab                                       |
| Sender log success nhưng chưa nhận email    | Claim/dry-run → provider ID → topic/subscription confirmed → outcome/receipt   | Chưa phân biệt submission với delivery                       |
| Có hai escalation/notification              | Hai producer/deadline owners → stable IDs → locks/ledger → crash window        | Đang định purge queue để che duplicate                       |
| Web cloud gọi localhost                     | URL lúc build → release bundle → proxy/CORS/callback                           | Đang định mở DB/API private ports ra Internet                |

## 12. Phiếu kết thúc mỗi chặng

Copy một phiếu cho R0–R7 vào evidence được bảo vệ; không commit secrets, ảnh mặt, token hoặc signed URL.

```text
Chặng / commit code / release digest / ngày giờ UTC:
Owner / reviewer:
Environment / account alias / Region:
Resource names / stack / cấu hình tham chiếu:
Fixture hoặc video test / expected:
EventId / jobId / resultId / executionArn / notificationId / providerId:
Actual / nơi xem receipt và trạng thái nghiệp vụ:
Replay / negative / recovery đã chạy:
PASS / NEEDS_FIX / NEEDS_IMPLEMENTATION / BLOCKED_ACCOUNT / BLOCKED_AI:
PR hoặc việc còn thiếu / người xử lý / chặng phụ thuộc:
Tài nguyên tạm đã dọn hoặc người nhận bàn giao:
```

Hoàn thành một chặng chỉ mở đường cho chặng kế tiếp. Sprint 4 hoàn tất khi các acceptance criteria bắt buộc của AWS-01..10 và E2E/operations/release đã có bằng chứng đạt, không phải khi tất cả resource xuất hiện trên Console.
