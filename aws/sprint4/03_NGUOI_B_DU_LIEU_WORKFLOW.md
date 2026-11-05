# Người B — Làm lưu ảnh, nhận diện, hẹn giờ và dữ liệu thông báo

Bạn chỉ cần làm theo file này. Nhiệm vụ của bạn là làm cho kết quả xử lý thật sự quay về ứng dụng: có ảnh để xem, có kết quả nhận diện, xác nhận thì dừng nâng mức cảnh báo, không xác nhận thì xử lý đúng hạn. Bạn cũng làm phần backend cho A gửi thông báo.

Tài liệu này tập trung hoàn thiện tính năng trên môi trường dev dùng chung để demo đồ án, không có bài tạo tài nguyên riêng để học dịch vụ. Các bảng dữ liệu và chương trình mới dưới đây là phần cần lập trình; tạo tài nguyên AWS xong chưa có nghĩa tính năng đã xong. Từ E2E trong tài liệu cũ chỉ có nghĩa là thử trọn đường từ thao tác đầu vào đến kết quả người dùng nhìn thấy.

**Đi tới phần đang làm (vẫn trong file này):** [Thứ tự làm và những chỗ cần chờ](#1-thứ-tự-làm-và-những-chỗ-cần-chờ) · [Chuẩn bị và thống nhất dữ liệu](#2-chuẩn-bị-và-thống-nhất-dữ-liệu) · [Làm kho ảnh riêng tư](#3-làm-kho-ảnh-riêng-tư) · [Hoàn thiện đường gửi việc và nhận kết quả](#4-hoàn-thiện-đường-gửi-việc-và-nhận-kết-quả) · [Hoàn thiện nhận diện khuôn mặt](#5-hoàn-thiện-nhận-diện-khuôn-mặt) · [Làm hẹn giờ xử lý khi người dùng không xác nhận](#6-làm-hẹn-giờ-xử-lý-khi-người-dùng-không-xác-nhận) · [Làm backend để A gửi thông báo](#7-làm-backend-để-a-gửi-thông-báo) · [Điền cấu hình và ghép trên bản cloud](#8-điền-cấu-hình-và-ghép-trên-bản-cloud) · [Kiểm tra đầy đủ trước demo](#9-kiểm-tra-đầy-đủ-trước-demo) · [Bàn giao và chẩn đoán](#10-bàn-giao-và-chẩn-đoán)

## 1. Thứ tự làm và những chỗ cần chờ

| Thứ tự | Bạn hoàn thiện                                   | Phụ thuộc                                                       |
| ------ | ------------------------------------------------ | --------------------------------------------------------------- |
| 1      | Quy tắc dữ liệu, ảnh thử, liên kết user cho A    | Có thể làm ngay với DB thử                                      |
| 2      | Viết lưu ảnh, gửi job, nhận kết quả và nhận diện | Làm code/test ngay; đợi C cấp bucket/queue/role để nối AWS thật |
| 3      | Gửi việc từ app, nhận kết quả và chống lặp       | Đợi C đưa tài nguyên dùng chung để ghép cloud                   |
| 4      | API hẹn giờ và API xin quyền gửi thông báo       | Viết và kiểm thử local ngay                                     |
| 5      | Hẹn giờ trên AWS và sender của A                 | Đợi C có HTTPS; đợi A có sender để thử nhận thư                 |
| 6      | Video/model thật và demo                         | Đợi đường kết nối edge của C và bản model được kiểm chứng       |

**Đưa API claim/outcome cho A sớm**, không chờ hoàn thành mọi ca nhận diện mới bàn giao. C chuẩn bị máy chủ và HTTPS song song với bạn.

## 2. Chuẩn bị và thống nhất dữ liệu

1. Nhóm dùng **một tài khoản AWS do C quản lý, bên trong có ba IAM User A/B/C**. Bạn dùng IAM User B và bộ access key riêng; C cấp quyền cần cho nhiệm vụ. Region là `ap-southeast-1`, profile CLI là `camerai-lab`. Không chia sẻ root, access key hay `.env`.
2. PowerShell tại thư mục gốc repo:

   ```powershell
   aws --version
   aws configure --profile camerai-lab
   aws sts get-caller-identity --profile camerai-lab --region ap-southeast-1
   git rev-parse HEAD
   docker compose version
   pnpm --version
   ```

   Khi được hỏi, nhập **Access Key ID và Secret Access Key của chính IAM User mình**, Region `ap-southeast-1`, output `json`. Nếu đã có profile này, chỉ cấu hình lại khi cần thay key. Không nhập key vào lệnh để tránh lưu trong lịch sử terminal.

   Ba người kiểm tra kết quả STS: `Account` phải giống nhau, `Arn` phải khác nhau và đúng tên IAM User của từng người. Tên profile `camerai-lab` giống nhau trên ba máy vẫn được; nó chỉ là tên cấu hình local, không phải tài khoản hay key dùng chung. Gửi C Account/Arn để đối chiếu, không gửi key.

   `aws configure` chỉ khai báo danh tính cho CLI, **không cấp quyền**. C cấp quyền cho IAM User trước. Không dùng `aws configure sso` hoặc `aws sso login` trong cách làm hiện tại của nhóm. Nguồn tra cứu: [AWS cấu hình CLI bằng IAM User](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-user.html).

3. Chọn commit code chung, viết trên nhánh riêng và gộp qua PR có người khác kiểm tra. Giữ DB hiện có; backup trước migration. Không dùng `db:reset` hay xóa volume để sửa lỗi.
4. Bạn quản lý thay đổi `api/`, mã hợp đồng dùng chung và migration. A/C gửi thay đổi liên quan cho bạn kiểm tra để không xung đột.
5. Chuẩn bị hai user/camera thử không có quyền quản trị toàn hệ thống. **Đợi A đưa pool ID, issuer và hai Cognito sub để liên kết đúng user ứng dụng.** Không ghép người dùng theo email tự động.
6. Nếu thiếu cột issuer, thêm migration phù hợp nhánh hiện tại; code auth cũ từng có migration `0017_cognito_issuer.sql` nhưng phải kiểm tra file thật trước. Giữ nguyên users.id/role/ownership. Sau khi xác minh đúng ID, có thể cập nhật trong DB thử:

   ```sql
   UPDATE users
   SET cognito_sub = '<sub-da-xac-minh>',
       cognito_issuer = 'https://cognito-idp.ap-southeast-1.amazonaws.com/<pool-id>'
   WHERE id = '<application-user-id>' AND cognito_sub IS NULL;
   ```

   Phải đúng một dòng; đã có liên kết thì kiểm tra riêng, không ghi đè ngầm.

**Đưa kết quả cho A:** hai application user IDs đã liên kết, camera thuộc từng user, migration/PR và cách kiểm tra. A dùng để hoàn thiện đăng nhập và thử truy cập chéo.

### Những quy tắc dữ liệu phải giữ nguyên

- `eventId`, `cameraId`, `ownerScopeId`, `jobId`, `resultId`, `notificationId`, `commandId`, `attemptId`, `outcomeId` dùng UUID. ownerScopeId của camera là users.id sở hữu camera, không phải Cognito sub. Wellness không có camera tiếp tục dùng đường xử lý riêng đang có.
- `observationId` của face là `track:<trackId>:face`, tối đa 200 ký tự. Ghi sourceSessionId để phân biệt các phiên nguồn video. revision, collectionVersion và deadlineVersion là số nguyên từ 1.
- Mốc thời gian dùng UTC ISO-8601 kết thúc bằng `Z`. Mã công việc tạo một lần và lưu trong DB; thử lại giữ nguyên ID và nội dung, kể cả processedAt của kết quả đã tạo. Không đổi ID để né lỗi trùng.
- Một hàng đợi kết quả dùng chung, **chỉ một chương trình nhận kết quả** phân loại theo type. Không để hai chương trình face/thông báo tranh nhau lấy cùng queue.
- Backend kiểm tra chủ sở hữu và quan hệ event/camera/job theo DB. Message ghi owner đúng định dạng chưa có nghĩa người gửi có quyền.

**Khi ghép hệ thống:** A/B/C dùng key khác nhau vẫn làm việc với cùng tài nguyên nếu đúng tài khoản, Region và được cấp quyền. Bàn giao tên bucket, queue URL/ARN, API và cấu hình; không bàn giao key cá nhân. Backend trên EC2 dùng role của EC2; Lambda dùng execution role riêng. C cấu hình các role này, nên bản cloud không phụ thuộc key laptop của ai. Việc cấu hình CLI trên laptop cũng không tự truyền quyền vào Docker local; nếu cần chạy SDK trong container local, phải cấu hình riêng mà không đưa key vào image/Git.

## 3. Làm kho ảnh riêng tư

### 3.1. Gửi yêu cầu hạ tầng cho C

**Đưa yêu cầu cho C:** bucket dev private, chặn public access, mã hóa, prefix object theo mẫu bên dưới, thời gian giữ ảnh theo quy định đồ án, quyền EC2 upload/read và Face Lambda đọc ảnh. Nếu cần lưu kết quả worker bền vững để retry, ghi rõ nơi lưu/prefix và quyền cần thêm trong PR; không để worker có quyền rộng ngoài dữ liệu cần dùng.

Không tạo bucket lab riêng, không upload ảnh bằng Console để thay cho chức năng upload của app. Chuẩn bị ảnh được đồng ý sử dụng để kiểm thử qua luồng ứng dụng: người quen, người lạ, không có mặt và ảnh lỗi. Ảnh không đưa vào Git. Bạn có thể viết storage adapter, kiểm tra quyền API và test lỗi trước khi C cấp tài nguyên.

### 3.2. Nối vào ứng dụng

**Đợi C đưa tên bucket dùng chung và quyền EC2/Lambda.** Trong lúc chờ, làm phần gọi storage và kiểm tra quyền trên máy cá nhân.

1. Đọc `apps/orchestrator/src/storage/` và API media hiện có. Khi bật cloud, đặt `STORAGE_PROVIDER=s3`, `S3_BUCKET=<ten-bucket-dev>`. STORAGE_BUCKET là biến cũ, một mình nó chưa đủ cho S3 adapter.
2. Ảnh được backend ghi bằng đường dẫn:

   ```text
   owners/<ownerUuid>/cameras/<cameraUuid>/events/<eventUuid>/face/<jobUuid>.jpg
   ```

3. API xem ảnh kiểm tra quyền camera trước khi cấp URL có hạn. Không tin object key từ client. Thử user khác phải bị chặn cả metadata và ảnh.
4. Upload xong mới phát việc nhận diện. Nếu upload hoặc ghi DB lỗi, phải giữ được trạng thái để thử lại/dọn ảnh thừa; không chấp nhận công việc rồi làm mất ảnh đầu vào.
5. Trên EC2 dùng instance role. CLI laptop truy cập S3 được không chứng minh container đã có quyền; thử upload từ app thật. S3 adapter cũ có nhánh credentials thủ công chưa truyền session token, không nhét cặp khóa tạm thiếu token vào env.

## 4. Hoàn thiện đường gửi việc và nhận kết quả

1. Xác định điểm đang tạo face job trong `apps/orchestrator/src/face-recognition/` và chỗ nhận AI result trong `src/ai-results/`. Bổ sung bộ gửi job SQS và **một** consumer Results phân loại face/thông báo. Chi tiết message và cách apply ở §5.
2. Thêm migration cho công việc cần gửi, dữ liệu kết quả đã xử lý, mapping và nhật ký còn thiếu. Kiểm tra constraint bảng hiện có trước khi tái dùng; số migration theo nhánh tích hợp, không tự ghi đè file người khác.
3. Thêm config validator/reader, `.env.example` và truyền biến qua Compose. Local dùng BullMQ khi được chọn; cloud dùng SQS. Chặn việc cả hai cùng tạo/xử lý một face job. Không có config cloud thì báo thiếu cấu hình, không tự chuyển về local.
4. **Đưa yêu cầu cho C:** face jobs, notification jobs, Results và DLQ riêng; worker paths/runtime/handler/build/test/timeout; quyền cần cho từng luồng. C tạo và gắn trigger theo chương trình đã hoàn thiện, không nối handler chỉ in log.
5. **Đợi C đưa queue URL/ARN, role và Lambda đã deploy code của bạn.** Bật từng luồng trong bản dev, tạo sự kiện bằng ứng dụng, theo dõi jobId → log Lambda → resultId → receipt DB → màn hình. Lambda return thành công chưa đủ nếu kết quả chưa vào DB.
6. Kiểm thử lỗi từ luồng ứng dụng trong phiên dev đã hẹn: chương trình thử lại đúng ID; việc lỗi nhiều lần tới DLQ; sau sửa có thể chạy lại đúng việc mà không nhân kết quả. Ghi nguyên nhân trước khi chạy lại, không Purge queue để che lỗi.
7. Khi cần đọc Results trên Console để chẩn đoán, dừng consumer trước. Poll làm việc tạm ẩn; Delete xóa việc thật. Không để công cụ kiểm tra tranh lấy job của Lambda đang chạy.

**Đưa kết quả cho A:** type/job/outcome, cách tạo notification từ app, cách tìm trạng thái trong DB/API và ca lỗi đã kiểm tra. A dùng để nối sender, không phải tạo queue khác.

## 5. Hoàn thiện nhận diện khuôn mặt

### 5.1. Nhận hạ tầng và chuẩn bị phần nhận diện

**Đợi C đưa bucket, quyền Rekognition theo phạm vi owner, face queue và Lambda có code của bạn để chạy AWS thật.** Không cần tạo collection hay index/search tay để học lại dịch vụ.

Bạn viết phần tạo collection theo owner như một chức năng backend có kiểm soát: tên `camerai-s4-dev-owner-<ownerUuid>`, lưu registry trong DB, thao tác được phép bởi role C cấp. C quản lý quyền và quy tắc đặt tên; backend B quản lý dữ liệu khuôn mặt phát sinh khi người dùng đăng ký/xóa. Đây là dữ liệu của tính năng, không phải một bộ hạ tầng lab riêng.

Công việc trước khi ghép: viết adapter IndexFaces/SearchFacesByImage/DeleteFaces, chuẩn hóa kết quả theo §5.3, test bằng nhà cung cấp giả có nhãn rõ. Sau đó chạy cùng các ca qua app với AWS thật; chỉ kết quả đó mới dùng nghiệm thu tích hợp.

### 5.2. Đăng ký/xóa từ ứng dụng

1. Đọc `apps/orchestrator/src/known-faces/` và `face-recognition/face-recognition.worker.ts`. Worker hiện dùng BullMQ; đổi FACE_PROVIDER không tự chuyển sang SQS.
2. Mỗi chủ camera có collection `camerai-s4-dev-owner-<ownerUuid>`. Lưu bảng owner → collection/version và FaceId → knownFaceId trong DB. Không dùng REKOGNITION_COLLECTION_ID chung làm nguồn phân quyền.
3. Nối thao tác đăng ký người quen trên app với IndexFaces; lưu mapping, tăng collectionVersion khi tập khuôn mặt đổi, ghi trạng thái lỗi để đồng bộ lại. Không nhập embedding của model local thẳng vào Rekognition.
4. Nối thao tác xóa đúng owner với xóa vector/mapping; dọn ảnh theo quy định giữ ảnh. Không xóa dữ liệu người khác. FaceId không có mapping hợp lệ phải báo lỗi, không tự gán người quen.
5. Thử đăng ký → tìm thấy → xóa → không còn nhận nhầm thành người đã xóa. Dùng crop một người; ảnh nhiều mặt không đủ cơ sở kết luận danh tính của cả sự kiện.

### 5.3. Tạo job từ app và xử lý kết quả

Bạn cần bổ sung: bộ gửi việc từ DB ra SQS, `services/aws-workers/face/`, và bộ nhận Results trong orchestrator. Kèm migration/config/test và cách build từng worker.

Để không mất việc khi ứng dụng tắt giữa chừng, ghi việc cần gửi vào DB cùng giao dịch cập nhật sự kiện. Bản ghi này thường gọi là outbox. Chương trình riêng đọc nó để gửi SQS; lỗi thì gửi lại cùng ID. Kết quả nhận về có bản ghi đã xử lý, thường gọi là receipt, để chống lặp.

Mọi message có `schemaVersion=1`, `type`, `messageId` là UUID, `correlationId=eventId`, `occurredAt` UTC và `payload`.

| type                 | messageId      | Nội dung payload                                                                                                                              |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| face.job             | jobId          | jobId,eventId,cameraId,ownerScopeId,trackId,sourceSessionId,observationId,revision,collectionVersion,collectionId,image:{bucket,key},resultId |
| face.result          | resultId       | jobId,ownerScopeId,cameraId,body                                                                                                              |
| notification.job     | notificationId | notificationId,eventId,ownerScopeId,expectedEventVersion,channel                                                                              |
| notification.outcome | outcomeId      | outcomeId,notificationId,eventId,ownerScopeId,attemptId,status,providerCalled,providerId,reason                                               |

`channel` là SNS_EMAIL/SNS_SMS/CONNECT_CALL. Job thông báo không chứa số/email/nội dung riêng; backend trả những thông tin ấy khi A xin quyền gửi.

1. Tạo jobId và resultId một lần trong DB trước khi phát việc. Face Lambda kiểm tra bucket/key/collection/owner, gọi Rekognition, dùng đúng resultId đó. Kết quả hoàn chỉnh cần lưu bền vững để thử gửi lại nguyên nội dung; không đổi processedAt mỗi lần phát lại.
2. `face.result.payload.body` phải đúng `SubmitAiResultDto` hiện có: schemaVersion=1,resultId,requestId (nếu có),eventId,observationId,revision,module=M1_FACE,modelVersion,processedAt,collectionVersion,results,error; personStatus/matchedKnownFaceId theo bảng dưới. Không đưa cả envelope vào DTO.
3. Bộ nhận Results kiểm tra schema/owner/job/version, rồi gọi `AiResultsService.submit(body.eventId, body)`. Nếu khác tiến trình, dùng `POST /api/v1/internal/events/{eventId}/ai-result`, header X-Internal-Token từ INTERNAL_SERVICE_TOKEN; kết quả 202 với ACCEPTED/DUPLICATE/STALE.
4. **Lưu xong DB mới xóa SQS message.** Chết sau commit nhưng trước delete thì lần chạy lại phải nhận ra đã xử lý. Cùng ID khác nội dung trả conflict; dữ liệu revision cũ không ghi đè mới. Lỗi không sửa được lưu lý do vào vùng lỗi/DLQ; lỗi tạm thử lại có giới hạn.
5. Nếu xử lý từng phần trong một lô, cả code và cấu hình Lambda phải hỗ trợ ReportBatchItemFailures. Đừng chỉ return thành công mà quên gửi kết quả về Results Queue.

| Trường hợp                                   | body kết quả face                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Có mapping và similarity đạt ngưỡng          | personStatus=KNOWN, matchedKnownFaceId là UUID trong app, một item label=KNOWN, confidence=similarity  |
| Có similarity tốt nhất nhưng dưới ngưỡng     | UNKNOWN, matchedKnownFaceId=null, một item UNKNOWN, confidence=1-similarity                            |
| Collection rỗng được xác nhận                | UNKNOWN, confidence=1, similarity=null, confidencePolicyVersion=empty-collection-v1                    |
| Không mặt/nhiều mặt/không xác định được điểm | UNDETERMINED, matchedKnownFaceId=null, confidence=null, similarity=null, error=null; ghi qualityReason |
| Lỗi kỹ thuật cuối cùng                       | Bỏ personStatus, matchedKnownFaceId=null, results=[], error:{code,message}                             |

Điểm dùng thang 0..1; ngưỡng kiểm thử ban đầu `REKOGNITION_MATCH_THRESHOLD=0.90`, không đổi FACE_MATCH_THRESHOLD local sang thang 0..100. Với known/unknown có điểm, policy=`rekognition-normalized-v1`. Mỗi item có module=M1_FACE, label trùng personStatus, boundingBox=null hoặc chuẩn hóa 0..1; metadata có similarity, confidencePolicyVersion, provider=rekognition, sourceSessionId, collectionVersion, fellBackToLocal=false. Không tự chuyển qua model local khi AWS lỗi.

File `aws/sprint4/contracts/queue-v1.schema.json` và các JSON trong `contracts/fixtures/` là dữ liệu máy đọc đã có, có thể dùng trực tiếp trong test; không cần đọc thêm một hướng dẫn khác. UUID/timestamp/bucket trong mẫu là giả lập, phải ánh xạ sang dữ liệu thử thật. Mỗi mẫu kết quả là ca độc lập, không phát tất cả với cùng resultId lên cùng một DB. Schema chưa kiểm tra được quyền/quan hệ DB hoặc quy tắc điểm; service vẫn phải làm các kiểm tra đó.

**Đưa kết quả cho C:** code face, cách build, handler/runtime/timeout, queue mapping, bucket/prefix/collection và quyền cần dùng. **Đưa kết quả cho A:** cách tạo sự kiện thử, nơi xem ảnh/kết quả và các ca known/unknown/no-face để A kiểm UI.

## 6. Làm hẹn giờ xử lý khi người dùng không xác nhận

Hệ thống lưu hạn xử lý trong DB. Step Functions chỉ giúp chờ tới hạn; backend vẫn quyết định có được nâng mức cảnh báo hay không.

### 6.1. Viết API và nghiệp vụ trước

1. Đọc `src/escalation/` trong orchestrator. Tách một hàm xử lý deadline dùng chung, không viết một nhánh SQL riêng cho Lambda.
2. Thêm `POST /api/v1/internal/events/{eventId}/deadline`, header `X-Internal-Token` từ INTERNAL_SERVICE_TOKEN, body:

   ```json
   {
     "schemaVersion": 1,
     "commandId": "<UUID>",
     "eventId": "<UUID>",
     "deadlineVersion": 1,
     "expectedDeadlineAt": "<UTC-ket-thuc-Z>"
   }
   ```

3. Trong một giao dịch DB: khóa sự kiện → kiểm tra command đã làm chưa → trạng thái/phiên bản hạn/mốc hạn → cập nhật trạng thái, lịch sử, yêu cầu gửi và bản ghi command. Dùng giờ DB. eventId body phải khớp URL.
4. Tạo deadlineVersion riêng; thay đổi khác của sự kiện không có nghĩa deadline mới. Ack đã lưu trước khi command lấy lock thì không nâng mức. Command đã lưu trước ack thì giữ lịch sử, sender kiểm tra lại trạng thái trước gửi.

   | API trả                                    | Ý nghĩa                                                                    |
   | ------------------------------------------ | -------------------------------------------------------------------------- |
   | 200, disposition=APPLIED, reason=ESCALATED | Đã nâng mức một lần                                                        |
   | 200, disposition=NO_OP                     | Không cần đổi; reason ACKNOWLEDGED/RESOLVED/STALE_DEADLINE/ALREADY_APPLIED |
   | 409, code=NOT_DUE, retryAt                 | Chưa đến hạn, cần hẹn lại; không kết thúc việc vĩnh viễn                   |
   | 409, code=COMMAND_CONFLICT                 | Cùng commandId nhưng nội dung khác                                         |
   | 400/401/404                                | Sai dữ liệu/token/không có sự kiện                                         |
   | 429/timeout/5xx                            | Có thể thử lại có giới hạn                                                 |

   Response 200 gồm commandId,disposition,reason,aggregateVersion. Command lặp cùng nội dung trả quyết định đã lưu, không tạo thêm yêu cầu gửi.

5. Khi ghi deadline vào DB, ghi luôn việc cần tạo workflow. Tên lần chạy `deadline-<commandId>`, input giữ nguyên body trên, lưu execution ARN để tìm lại. Timeout khi StartExecution không được tạo business deadline mới.
6. Sửa worker quét deadline local để không chạy cùng đường cloud cho cùng sự kiện. Bộ quét phục hồi nếu giữ lại phải gọi cùng hàm nghiệp vụ chống lặp.

### 6.2. Viết Lambda và nối workflow

1. Tạo `services/aws-workers/deadline/`: gọi API trên qua HTTPS, có timeout, map response thành lỗi có thể thử lại hoặc lỗi cuối cùng. Không sleep để đợi hạn trong Lambda.
2. Đưa cho C input mẫu, handler, quyền và định nghĩa workflow dưới `infra/aws/`. Dùng Standard, JSONPath, Wait có `TimestampPath: "$.expectedDeadlineAt"`, sau đó gọi Lambda. C cấu hình quyền gọi đúng function.
3. NOT_DUE phải được đợi rồi thử lại; timeout/429/5xx thử lại có giới hạn; sai dữ liệu/auth thì báo lỗi và giữ việc để kiểm tra. Có cách tìm lại workflow lỗi và deadline DB chưa xử lý sau khi app phục hồi.
4. **Đưa định nghĩa workflow cho C** để C ghép vào template dùng chung và triển khai. Bạn dùng execution ARN để mở lịch sử lần chạy, đối chiếu input/output với trạng thái trong DB; không tạo workflow riêng bằng Console.

**Đợi C hoàn thiện HTTPS và đưa INTERNAL_API_BASE_URL cùng secret ref để Lambda gọi API thật.** Trong lúc chờ, chạy test transaction/ack/race ở local. Sau đó tạo incident mới trong app, quan sát execution, kiểm tra DB và màn hình. Workflow xanh mà DB chưa đổi chưa phải đã xong. Nguồn: [AWS Wait state](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html).

**Đưa kết quả cho A:** cách tạo sự kiện có hạn chờ, cách xác nhận, hạn đã cấu hình thực tế và notificationId sinh ra khi hết hạn. A dùng để thử sender. **Đưa cho C:** API/path/auth, input workflow và cách phát hiện việc còn tồn sau khởi động lại.

## 7. Làm backend để A gửi thông báo

### 7.1. Tạo yêu cầu gửi và API xin quyền

1. Khi nghiệp vụ quyết định cần gửi, ghi notification và việc phát ra SQS cùng transaction. Chỉ một chương trình gửi các kênh cloud; không để worker local gửi cùng notification.
2. Tạo `POST /api/v1/internal/notifications/{notificationId}/claim`, cùng X-Internal-Token. Body `{schemaVersion:1,claimId:UUID,eventId:UUID,expectedEventVersion:int}`. Chốt `claimId=notificationId`; A dùng lại mã này khi thử lại, backend lưu quyết định bền vững theo mã đó.
3. Backend kiểm tra owner từ DB, event/version/state, người nhận được phép, giới hạn gửi, thời gian giữa hai lần và quyền giữ lượt gửi. Mặc định lab: tối đa 5 lần/ngày/người nhận/kênh; chờ 60 giây giữa hai lần; lease 120 giây. Kiểm tra/giữ lượt trong transaction để hai sender không cùng lấy quyền.
4. Response 200 CLAIMED có notificationId,disposition=CLAIMED,attemptId,leaseUntil,mode=DRY_RUN|REAL,delivery:{channel,recipientRef,topicArn?,destination?,message,subject?}. Cấu hình SENDER_DRY_RUN ở backend quyết định mode. Sender được giảm REAL thành DRY_RUN, không được làm ngược.
5. Response 200 NO_OP có notificationId,disposition=NO_OP,reason=ALREADY_SENT/RESOLVED/STALE_VERSION/EXPIRED/CAP_EXCEEDED/CANCELLED. Ghi lý do vào DB; sender không tạo attempt mới. Đang bị giữ lượt hoặc còn cooldown trả 409 BUSY và retryAt để chờ, không bỏ công việc.
6. Một claim REAL đã cấp quyền mà chưa biết kết quả không được cấp quyền gửi lại. Claim lặp giữ cùng attempt; khi chưa rõ đã gửi hay chưa thì ghi UNCERTAIN và đối soát. Hết lease không tự cho phép một lượt gửi thật mới.
7. Email topic chỉ chứa người được phép nhận dữ liệu thử đó. Không tin địa chỉ người nhận từ queue. Thông tin người nhận chỉ trả cho service đã xác thực, không log nguyên response.

### 7.2. Nhận kết quả và hiển thị

1. Nhánh notification.outcome trong Results consumer gọi service riêng, không đưa vào AI result DTO.
2. Payload theo bảng §5.3. Chỉ chấp nhận attempt/owner/notification đã tồn tại và đúng quan hệ; lưu receipt theo outcomeId và ràng buộc kết quả của attempt. Cùng ID khác nội dung là conflict, không cập nhật đè.
3. Lưu nhật ký gửi riêng; không insert status mới thẳng vào enum cũ của notifications:

   | Kết quả sender    | Cách lưu/trình bày                                                         |
   | ----------------- | -------------------------------------------------------------------------- |
   | DRY_RUN           | Chạy thử, không gọi nhà cung cấp; mapping notifications=SKIPPED với reason |
   | PROVIDER_ACCEPTED | Có providerId; mapping SENT, chưa có nghĩa người dùng đã nhận/xác nhận     |
   | FAILED            | Có lý do rõ; mapping FAILED                                                |
   | UNCERTAIN         | Giữ pending nhưng chặn tự gửi lại bằng nhật ký; cần đối soát               |

4. Commit xong nhật ký và receipt mới DeleteMessage. Nếu cần API vì khác process, thêm `POST /api/v1/internal/notifications/{notificationId}/outcome`, body=payload outcome, cùng auth; trả 202 với outcomeId và ACCEPTED/DUPLICATE, conflict 409.
5. Thêm API/hiển thị có quyền để A thấy được đang chờ, chạy thử, AWS đã nhận, lỗi hoặc chưa rõ. Không tự ghi CONFIRMED chỉ vì AWS trả MessageId/ContactId.
6. Test tình huống nhà cung cấp nhận nhưng chưa lưu kết quả bằng mock: chỉ thử publish lại kết quả đã giữ được, không gửi tin thật lại. Mất kết quả phải đối soát, không reset notification để thử vận may.

**Đưa kết quả cho A:** PR backend, API claim/outcome, ví dụ request/response, job/outcome, cách tạo notification thử và các lý do không gửi. **Đợi A hoàn thiện sender để chạy việc thật → email thật → trạng thái trong app.** Bạn vẫn làm test bằng sender giả trong lúc chờ.

## 8. Điền cấu hình và ghép trên bản cloud

**Đợi C đưa bucket, queue URLs, workflow ARN, HTTPS và bản code đã triển khai.** Điền giá trị thật, không chép placeholder. Các biến mới cần có code đọc/kiểm tra và Compose truyền vào; để trống chưa bật tính năng được.

| Biến                                                          | Bản cloud                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| AWS_REGION                                                    | ap-southeast-1                                              |
| STORAGE_PROVIDER / S3_BUCKET                                  | s3 / tên bucket dev                                         |
| FACE_PROVIDER / FACE_JOB_TRANSPORT                            | rekognition / sqs                                           |
| FACE_JOBS_QUEUE_URL                                           | FaceJobsQueueUrl                                            |
| APPLICATION_RESULTS_QUEUE_URL                                 | ApplicationResultsQueueUrl                                  |
| APPLICATION_RESULTS_CONSUMER_ENABLED                          | true                                                        |
| REKOGNITION_MATCH_THRESHOLD                                   | 0.90 cho lượt kiểm thử ban đầu                              |
| DEADLINE_DRIVER / DEADLINE_STATE_MACHINE_ARN                  | stepfunctions / ARN workflow                                |
| INTERNAL_API_BASE_URL                                         | HTTPS origin + /api/v1, không có slash cuối                 |
| INTERNAL_SERVICE_TOKEN                                        | Secret chung với API/Lambda, ít nhất 32 ký tự               |
| NOTIFICATION_DRIVER / NOTIFICATION_JOBS_QUEUE_URL             | sqs / NotificationJobsQueueUrl                              |
| SENDER_DRY_RUN                                                | true trước, chỉ false sau kiểm tra gửi thử đạt              |
| SNS_TOPIC_ARN / CONNECT_INSTANCE_ID / CONNECT_CONTACT_FLOW_ID | C cấp, A xác minh người nhận/kênh; dùng đúng kênh được phép |

Giữ FACE_MATCH_THRESHOLD local riêng. Biến cũ AWS_SQS_JOBS_QUEUE_URL không tự thay thế FACE_JOBS_QUEUE_URL. Không tự bật fallback local khi thiếu biến cloud; báo thiếu cấu hình ngay lúc khởi động.

Kiểm tra trước khi đưa mã cho C:

```powershell
pnpm contracts:generate
pnpm api:lint
pnpm --filter @cam/orchestrator typecheck
pnpm --filter @cam/orchestrator test -- --runInBand
pnpm --filter @cam/orchestrator build
```

Chạy contracts:generate khi có sửa API. Với test tích hợp, dùng DB test riêng có migration đúng phiên bản. Worker mới phải có lệnh build/test trong manifest và hướng dẫn ngay tại phần bàn giao; không dùng một lệnh giả chưa có trong repo.

## 9. Kiểm tra đầy đủ trước demo

| Thử trên ứng dụng/bản thử có kiểm soát              | Kết quả cần thấy                                             |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Người quen/người lạ/không mặt/ảnh hỏng              | Đúng bảng §5; lỗi không trở thành KNOWN                      |
| User/collection khác chủ                            | Không đọc ảnh hoặc nhận diện nhầm sang người khác            |
| Cùng resultId và payload 10 lần                     | Một hiệu ứng nghiệp vụ                                       |
| Cùng resultId, đổi nội dung                         | Conflict, không ghi đè                                       |
| Revision mới trước, cũ tới sau                      | Bản cũ bị bỏ qua, không ghi đè mới                           |
| Tắt consumer sau DB commit trước delete rồi bật lại | Nhận lại an toàn, không mất/nhân kết quả                     |
| Ack trước hạn                                       | Không nâng mức, không tạo yêu cầu gửi nâng mức               |
| Không ack                                           | Hết hạn tạo đúng một quyết định nâng mức và intent           |
| Ack chạy gần như đồng thời command                  | Quyết định theo transaction, không sinh hai quyết định       |
| Command lặp/cũ/chưa đến hạn                         | Trả đã làm/không cần làm/hẹn lại đúng ý nghĩa                |
| API tạm ngừng rồi khôi phục                         | Workflow/việc còn chờ được tìm lại, không báo thành công giả |
| Sender trùng/hết lease/cap/cooldown                 | Không gửi vượt quy tắc; phối hợp A kiểm tra                  |
| AWS nhận tin nhưng mất outcome                      | Ghi chưa rõ, không tự gửi lại thật                           |

Sau khi các ca dữ liệu mẫu đạt, **đợi C nối edge và người giữ model cung cấp model/báo cáo**. Kiểm tra tên file, phiên bản, checksum, cách tiền xử lý, thư viện và kết quả đo trên thiết bị thật. Dùng một đường sự kiện từ Frigate/MQTT, không bật hai producer cho cùng video.

Chạy video đã biết kết quả: sự kiện trong app → ảnh trên S3 → job → Lambda → result → DB/UI → thông báo → xác nhận hoặc hết hạn. Ghi eventId/jobId/resultId/executionArn/notificationId và mốc thời gian. Đo thời gian xử lý cloud riêng với độ chính xác model. Chưa có model/report thì nói rõ mới thử dữ liệu mẫu, chưa ghi model thật đã đạt.

## 10. Bàn giao và chẩn đoán

| Lỗi nhìn thấy                      | Kiểm tra                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Có env nhưng vẫn ghi MinIO         | STORAGE_PROVIDER → S3_BUCKET → code thực chọn adapter → container nhận biến |
| Outbox có nhưng Lambda không chạy  | Bộ gửi DB → queue URL → quyền SendMessage → trigger/role/Region             |
| Lambda báo xong nhưng DB không đổi | Có SendMessage Results chưa → schema → consumer → receipt/service           |
| Mất ảnh/AccessDenied               | Key đúng bucket/prefix/owner → role trong container → quyền/KMS             |
| Wait hết nhưng không nâng mức      | API/auth → deadlineVersion → giờ DB → trạng thái và command receipt         |
| Có hai lần nâng mức                | Hai nơi đang xử lý hạn cùng lúc → commandId giữ cố định → khóa/giao dịch DB |

Ghi ngay trong ghi chép nhóm:

```text
Phần của B / ngày / người làm / người kiểm tra:
Commit/PR, migration đã chạy và cách chạy lại:
User/camera IDs thử, collection/version (không ghi ảnh hoặc token):
Worker face/deadline: runtime, handler, build/test, timeout:
Bucket/queue/workflow đã nhận từ C:
API claim/outcome/deadline đã đưa cho A/C:
Bản cloud/URL, video hoặc dữ liệu mẫu:
Ca đã thử / mong đợi / thực tế / nơi lưu bằng chứng:
EventId / jobId / resultId / executionArn / notificationId mẫu:
Đang chờ ai / cần kết quả gì:
```

Bạn xong khi người khác làm lại được lưu ảnh → nhận diện → kết quả trong app, và hai nhánh xác nhận/không xác nhận → deadline → yêu cầu gửi đúng. Phần thông báo phải cùng A thấy thư thật và nhật ký trong app. C cùng bạn thử restart/restore vào DB test riêng; không restore đè DB demo. Ghi trạng thái **Đã chạy đạt / Cần sửa / Đang chờ A hoặc C / Bị chặn quyền AWS**, kèm phạm vi thật đã thử.
