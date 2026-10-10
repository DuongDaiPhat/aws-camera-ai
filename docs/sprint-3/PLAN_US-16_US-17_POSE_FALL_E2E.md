# Plan E2E US-16 / US-17 — Phát hiện và xác nhận té ngã bằng Pose (M2a)

> Sprint 3 · Một người phụ trách E2E (E theo backlog) · Một AI Agent duy nhất.
> Ngày lập: 09/10/2026 · Baseline khảo sát: commit `865dc6e`.
> US-16: 5 SP; US-17: 3 SP theo backlog hiện có. Không tự suy ra số issue GitHub.
> Đây là kế hoạch triển khai, chưa phải xác nhận tính năng đã chạy hoặc hai spec đã được merge/chốt trong repository.

## 1. Mục tiêu, phạm vi và tài liệu bắt buộc

Triển khai trọn luồng: Frigate cung cấp chuỗi ảnh có người → MediaPipe trích xuất 33 landmark → theo dõi candidate theo người/camera → xác nhận bất động liên tục trên 15 giây → lưu `FALL_DETECTED`, priority `P1` → escalation/Telegram hiện có → dashboard/SSE và xác nhận của người dùng.

Người phụ trách làm toàn bộ contract, dependency, dữ liệu frame, inference, backend, UI, test và tài liệu bằng cùng một AI Agent. Không chia FE/BE/AI cho nhiều người hoặc chạy subagent. Reviewer kiểm tra và nghiệm thu theo quy trình Git; reviewer không phải người triển khai thứ hai.

Tài liệu phải đọc lại trước khi sửa code:

- [CODING_CONVENTION.md](../conventions/CODING_CONVENTION.md).
- [GIT_WORKFLOW.md](../conventions/GIT_WORKFLOW.md).
- [API_GUIDE.md](../api/API_GUIDE.md).
- [Backlog và FR](../Roadmap_Backlog_UserStory_FR_CameraAI.md), US-16/US-17, FR-DET-M2-01 đến FR-DET-M2-05.
- [OpenAPI orchestrator](../../api/openapi.yaml), [OpenAPI AI service](../../api/openapi-ai-service.yaml).
- [PR template](../../.github/pull_request_template.md), [CODEOWNERS](../../.github/CODEOWNERS).

Chỉ triển khai M2a. Không thêm M2b, M3, wellness, nhà cung cấp AI mới, UI chỉnh ngưỡng mới hoặc cơ chế gọi cấp cứu mới. Tái sử dụng cấu hình escalation và kênh thông báo đang có. Người nằm sẵn khi khởi động mà chưa quan sát được chuyển động hạ thấp không được suy đoán là vừa ngã.

### Acceptance criteria giữ nguyên

| ID     | Given / When                                                                            | Then                                                                                              |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AC16-1 | Chuỗi frame Frigate chứa `person`; MediaPipe Pose trả 33 landmark                       | Tính tỷ lệ height/width bounding box, góc trục thân với phương ngang và độ cao trọng tâm đại diện |
| AC16-2 | Góc trục thân `< 30°` và trọng tâm hạ thấp đột ngột so với 10 frame trước               | Tạo candidate FALL và bắt đầu theo dõi thời gian                                                  |
| AC16-3 | Không trích xuất được pose, bị che khuất hoặc ra khỏi ảnh                               | Giữ candidate tối đa 5 giây rồi hủy; không tạo cảnh báo từ dữ liệu thiếu                          |
| AC17-1 | Candidate có tư thế bất thường liên tục `> 15 giây` và chuyển động landmark dưới ngưỡng | Tạo đúng một sự kiện `FALL_DETECTED`, priority `P1`, đi qua luồng cảnh báo hiện có                |
| AC17-2 | Người đứng dậy trong 15 giây                                                            | Hủy candidate, chỉ log nội bộ M2a, không tạo cảnh báo té ngã                                      |
| AC17-3 | Người nằm trên giường/sofa thuộc `REST_AREA` đã đánh dấu                                | Không tạo cảnh báo té ngã                                                                         |

Quy tắc biên: đúng 15,000 giây chưa xác nhận; phải lớn hơn 15. Đúng 30° không đáp ứng điều kiện `< 30°`. Tại thời điểm hết 5 giây thiếu pose, hủy candidate. Priority `P1` là mức sự kiện, khác với persona P1 là người giám sát.

## 2. Hiện trạng và các quyết định kiến trúc

### 2.1. Thành phần dùng lại

| Thành phần       | Hiện trạng đã khảo sát                                                      | Quyết định                                                                 |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| AI API           | `POST /pose/fall`, `evaluateFall`, `FallResponse` đã có trong spec          | Hiện thực endpoint này; không thêm `/fall/detect` trùng chức năng          |
| AI runtime       | `app/main.py` mới include health/face; `config.py` có ngưỡng 15 giây và 30° | Thêm router/service M2a riêng, không sửa thuật toán M1                     |
| Nhãn và priority | `FALL_DETECTED`, `M2A_FALL`, P1 đã có; migration seed có rule FALL          | Không thêm enum hoặc sửa migration lịch sử                                 |
| Nhận kết quả AI  | `AiResultsService`, receipts, aggregator, outbox, internal token đã có      | Dùng lại để lưu kết quả, phát SSE và gọi escalation                        |
| Vùng nghỉ        | Zone đã có `REST_AREA`, polygon và trạng thái bật/tắt                       | Dùng dữ liệu vùng hiện có; không tạo hệ quản lý zone thứ hai               |
| Frame telemetry  | Bridge Frigate 0.18 phát camera/track/box/timestamp, không phát ảnh         | Bổ sung đường ảnh dành riêng M2a, giữ nguyên đường metadata và live player |
| Ảnh M1           | `FrigateMediaAdapter.getCroppedSnapshot()` lấy snapshot của event           | Không dùng ảnh này làm chuỗi thời gian M2a: ảnh event có thể lặp/cũ        |
| Backend queue    | Redis/BullMQ đã có                                                          | Không thêm broker/hàng đợi/framework mới; M2a có worker và giới hạn riêng  |
| UI               | Event list/detail, AI labels, SSE, confirmation đã có                       | Hiển thị FALL và bằng chứng tối thiểu trong UI hiện có                     |

### 2.2. Chốt trách nhiệm

- AI service giữ history, candidate và pose tracker trong RAM, không ghi DB, không gửi Telegram.
- Orchestrator xác định camera/track/vùng nghỉ, gọi inference, kiểm tra response, tạo incident và chuyển kết quả vào luồng AI/escalation.
- PostgreSQL giữ incident đã xác nhận, dedup và công việc gửi kết quả cần retry. Không lưu mọi frame/keypoint vào DB.
- S3/MinIO và luồng media hiện có giữ ảnh bằng chứng/clip theo chính sách hiện tại. Ảnh xử lý tạm không tự trở thành dữ liệu lưu dài hạn.
- Chạy một process/replica AI service có M2a trong phạm vi sprint này; tuần tự theo mỗi `(cameraSlug, sourceSessionId, trackId)`. Không tăng Uvicorn workers hoặc nhân replica khi state còn ở RAM.
- Restart AI service xóa history/candidate chưa xác nhận, yêu cầu quan sát đủ history mới. Không cộng thời gian trước restart. Incident đã lưu và delivery pending tiếp tục qua DB/outbox.

### 2.3. Sự kiện FALL riêng để bảo toàn tính năng cũ

**Chốt tạo incident FALL riêng khi xác nhận**, có liên kết track/camera và tham chiếu event nguồn trong metadata nếu có. Không nâng trực tiếp event M1/M4 cùng track thành FALL.

Lý do: aggregator hiện giữ `RESTRICTED_ZONE` khi đồng mức P1, còn outbox bỏ qua đánh giá event đã `NOTIFIED`, `ESCALATED`, `RESOLVED` hoặc `CLOSED`. Nếu tái sử dụng event đó, té ngã xảy ra sau cảnh báo người lạ/vùng cấm có thể bị mất. Incident riêng giữ nguyên vòng đời cũ và vẫn đi qua cùng engine.

- Dedup incident: `m2a-fall:{cameraId}:{sourceSessionId}:{trackId}:{episodeId}`; unique trong DB.
- `episodeId` do AI service tạo ổn định từ identity track và timestamp bắt đầu candidate, dùng UUIDv5 của thư viện chuẩn Python với namespace cố định ghi trong contract. Retry giữ nguyên episode, payload và resultId.
- Một episode chỉ có một incident và một lần khởi tạo thông báo, dù nhận lại CONFIRMED, frame trùng hoặc job retry.
- Khi vẫn nằm, latch CONFIRMED; chỉ re-arm sau khi quan sát tư thế đứng hợp lệ rồi có lần hạ thấp mới. Track đổi ID không nối history cũ bằng suy đoán vị trí.
- `detectedAt` của incident FALL là `confirmedAt`, không phải thời điểm track xuất hiện hoặc bắt đầu candidate. Lưu `candidateStartedAt` riêng trong metadata. Nhờ đó deadline phản hồi không bị tiêu hao bởi thời gian chờ xác nhận té ngã.
- Candidate/cancel/missing không tạo event FALL, không gửi label `FALL_DETECTED` hoặc success rỗng vào `AiResultsService`. Event PERSON/M1/M4 độc lập vẫn có thể tồn tại theo luồng cũ.

## 3. Gate trước triển khai: chốt framework, thư viện và phiên bản

**Phải merge PR dependency và PR contract trước khi viết logic nghiệp vụ M2a.** Một owner E2E tổng hợp thay đổi ở các file dùng chung; những người làm M3/API khác bắt đầu từ commit đã chốt. Chỉ có plan không thể đảm bảo hết xung đột Git: phải thực hiện cơ chế sở hữu và merge tuần tự bên dưới.

### 3.1. Bộ công nghệ chốt

| Lớp                     | Lựa chọn                                                                                     | Chính sách phiên bản                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Node/pnpm               | Node 22 theo `.nvmrc` và CI; `pnpm@9.12.0`                                                   | Pin patch Node/image digest trong biên bản gate; pnpm lấy từ `packageManager`, không khai phiên bản thứ hai                   |
| Backend                 | NestJS 10.4.22, BullMQ 6.3.9, MQTT 5.16.0                                                    | Phiên bản resolve hiện có trong `pnpm-lock.yaml`; không upgrade để làm M2a                                                    |
| Frontend                | Next.js 15.5.24, React/React DOM 18.3.1                                                      | Dùng lockfile hiện có; không thêm thư viện UI/state management                                                                |
| Contracts/test TS       | openapi-typescript 7.13.0, Jest 29.7.0, Vitest 2.1.9                                         | Dùng lockfile; không dùng công cụ `@latest`                                                                                   |
| Python                  | CPython 3.11, Linux x86_64 Docker và Windows x64 dev                                         | Chốt cùng patch trong gate, pin base image digest; không dùng venv Python 3.14 để nghiệm thu                                  |
| Web AI                  | FastAPI, Pydantic v2, pydantic-settings, Uvicorn, Pillow hiện có                             | Resolve baseline Python 3.11 rồi khóa toàn bộ dependency graph trước triển khai; không coi các khai báo `>=` hiện tại là lock |
| Pose                    | `mediapipe==0.10.32`, MediaPipe Tasks `PoseLandmarker`                                       | Không dùng legacy `mp.solutions.pose`; không tự đổi sang bản mới nhất                                                         |
| Tính toán               | `numpy==1.26.4`                                                                              | Pin để ổn định ABI với OpenCV 4.10; kiểm thử lại M1 khi thay graph                                                            |
| OpenCV trong AI service | **Chỉ `opencv-contrib-python==4.10.0.84`**                                                   | Thay `opencv-python-headless` trong môi trường AI service; không cài đồng thời các flavor `cv2`                               |
| Inference model         | Pose Landmarker Lite `.task` CPU                                                             | Pin URL artifact, tên file, SHA-256, license và modelVersion trước logic; không tải lại ngầm lúc startup                      |
| Infra                   | Frigate 0.18.0 hiện có; PostgreSQL 16, Redis 7 hiện có                                       | Không nâng image chung; chốt digest cho image chạy nghiệm thu                                                                 |
| HTTP/geometry           | `fetch`, `FormData`, `AbortController` có sẵn; geometry helper hiện có hoặc thuật toán thuần | Không thêm Axios, Shapely, tracker ngoài hoặc runtime mới                                                                     |

MediaPipe 0.10.32 khai báo dependency `opencv-contrib-python`; phiên bản này có wheel cho Linux x86_64 và Windows x64. Vì vậy lựa chọn một flavor contrib tránh cài nhiều distribution cùng ghi đè `cv2`. Đây là quyết định tích hợp cần qua smoke test trong gate, chưa phải tuyên bố tương thích đã được thử tại máy này. Nguồn: [metadata MediaPipe 0.10.32](https://pypi.org/pypi/mediapipe/0.10.32/json) và [quy tắc chọn một gói OpenCV](https://pypi.org/project/opencv-python-headless/).

### 3.2. Công việc PR dependency

1. Ghi manifest dependency chung tại `docs/sprint-3/DEPENDENCY_BASELINE.md`: package, exact version, mục đích, owner, target OS/Python, image digest, nguồn model và checksum. Manifest này được tạo lúc thực thi gate, không bịa checksum/phiên bản đã thử.
2. `pyproject.toml` là nguồn khai báo Python. Thay các khai báo OpenCV của base/extra M1/M2a bằng cùng flavor/version; extra M2a pin MediaPipe. Không để `m2a = ["mediapipe>=..."]` tiếp tục resolve khác giữa máy.
3. Sinh lock đầy đủ có hash cho runtime và dev trên Python 3.11. Chốt dùng `pip-tools==7.4.1` làm công cụ khóa dependency; công cụ này chỉ ở môi trường tạo lock, không thêm vào runtime. Runtime lock phải resolve extra `m2a`; dev lock resolve `dev,m2a` với constraint từ runtime lock để dependency runtime giống nhau. Commit `requirements-runtime.lock` và `requirements-dev.lock`, bao gồm dependency bắc cầu, marker và hashes; có kiểm chứng cả Linux/Windows. Nếu graph khác theo OS, tạo lock riêng theo OS và ghi rõ cách chọn, không giả định một freeze máy Windows dùng được cho Linux. Pin cả pip/setuptools/toolchain tạo lock trong manifest sau smoke test, không để toolchain tự nâng giữa các máy.
4. `requirements.txt` chuyển thành entrypoint trỏ tới runtime lock, không duy trì bộ version viết tay thứ hai. Docker cài runtime lock với `--require-hashes`; dev cài dev lock rồi editable project bằng `--no-deps` **chỉ sau khi graph đã được cài đầy đủ từ lock**. Không dùng `--no-deps` để lách dependency MediaPipe/OpenCV.
5. Sửa cùng PR: Dockerfile, `.github/workflows/ci.yml`, `tools/scripts/py.mjs` và hướng dẫn setup để tất cả dùng lock mới. Script tạo venv phải chọn đúng Python 3.11; kiểm tra version của venv đã tồn tại và báo rõ sai phiên bản.
6. Dùng môi trường sạch để tránh flavor OpenCV cũ còn trong venv. Không uninstall/update thư viện global của người dùng. CI kiểm tra chỉ một distribution OpenCV, `pip check`, import `cv2`, `mediapipe`, inference một ảnh mẫu và M1 YuNet/SFace hoạt động.
7. Image AI giữ các thư viện hệ thống OpenCV cần; xác minh thực tế trên slim image. Model chốt artifact version 1: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`; tải ở bước chuẩn bị artifact, xác minh SHA-256 và ghi manifest. Không dùng URL `/latest/` hoặc download khi request đầu tiên đến. Không cài thêm package Python bên trong container Frigate: dùng runtime Frigate đã pin cho bridge.
8. Giữ JS graph bằng `pnpm install --frozen-lockfile`. Không chạy update toàn workspace. Nếu cần thêm E2E browser framework chưa có, phải chốt version/lock ở PR dependency riêng trước khi cài; plan này chọn replay harness + trình duyệt nghiệm thu để không kéo thêm Playwright chỉ cho sprint.
9. D/M3 muốn dùng Ultralytics phải kiểm tra dependency OpenCV của nó trước khi thêm vào môi trường chung. Không chấp nhận cài `opencv-python` chồng lên contrib. Nếu resolver bắt buộc flavor khác, xử lý trong PR dependency phối hợp và chọn runtime cách ly cho M3; không tự sửa bộ M2a đã chốt ở nhánh tính năng.

**Exit gate dependency:** manifest có exact version đầy đủ và commit SHA; clean install Docker/Linux và Windows x64 đạt; `pip check` đạt; M1 smoke/regression đạt; checksum model đúng; CI dùng lock. Nếu chưa đạt, chỉ làm spike có thể bỏ trong sandbox, chưa viết logic/domain theo môi trường chưa chốt.

## 4. Gate contract: chốt hai OpenAPI và tránh xung đột giữa người làm

### 4.1. Ranh giới sở hữu theo namespace

| File/phần                                            | Owner viết trong story này                                                    | Phần dành cho story khác                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `api/openapi-ai-service.yaml`                        | `/pose/fall`, `evaluateFall`, `FallResponse`, các schema mới có prefix `Fall` | D/M3: `/fire/detect`, `Fire*`; M1: `/face/*`, `Face*`, `Match*`, `Embed*`             |
| `api/openapi.yaml`                                   | Mô tả/example M2A trong callback hiện có và metadata FALL                     | M3/wellness và endpoint nghiệp vụ khác; không đổi enum/event schemas chung đơn phương |
| `packages/contracts/src/generated/*`                 | Sinh lại một lần từ cả hai spec sau PR contract                               | Không chỉnh bằng tay hoặc tự giải conflict kiểu generated                             |
| Schema chung: errors, bbox, security, health         | Thay đổi tối thiểu qua PR contract chung                                      | Owner file A/B phối hợp mọi contributor; không sửa đồng thời tùy ý                    |
| Dependency, lock, Compose, config/main/module wiring | Owner E2E tổng hợp thay đổi M2a theo PR nhỏ                                   | Phối hợp owner khác trước khi họ sửa cùng vùng; không format/refactor toàn file       |

Namespace giảm va chạm logic nhưng không đảm bảo một file YAML không conflict. Quy trình bắt buộc:

1. Trước khi sửa, ghi reservation trong `docs/sprint-3/API_CHANGE_REGISTER.md`: story, owner, file, path/schema/operationId, base SHA, PR và trạng thái. Người làm API mới phải đăng ký phần khác; các phần chung có một người tích hợp theo thứ tự.
2. Owner M2a chuẩn bị **một PR contract riêng chứa cả hai spec** và generated types. Người làm M3 chỉ sửa vùng của mình trên baseline mới, không copy toàn bộ spec từ nhánh cũ.
3. Review A và B theo Git workflow; merge contract trước PR implementation. Ghi SHA của commit merge vào register. Trạng thái ban đầu là `PROPOSED`, chỉ đổi `FROZEN` sau merge và kiểm tra đạt.
4. Sau merge, mọi contributor fetch/rebase trước tạo API/PR mới. Không đổi path, required field, đơn vị hoặc ý nghĩa field đã frozen trong PR implementation.
5. Nếu cần sửa contract, mở change request/PR contract mới, cập nhật register và cả caller/callee; không tự sửa spec cho khớp code ở cuối sprint.
6. Khi conflict spec: so diff theo operation/schema và phối hợp owner; không chọn toàn bộ ours/theirs. Sau resolve, regenerate cả hai file type từ spec cuối và chạy kiểm tra lại.
7. Register là quy ước phối hợp của nhóm, không phải lock kỹ thuật tự động. Để enforcement, PR template/check bắt buộc chỉ ra reservation và frozen SHA; reviewer từ chối thay đổi ngoài vùng đăng ký.

Không thay global `info.version`, security scheme, schema bbox hoặc enum chung nếu không cần. Request/response mới là additive. Không đổi format response của face/fire hoặc bắt frontend gửi request inference trực tiếp.

### 4.2. Hợp đồng `POST /pose/fall` chốt cho triển khai

Giữ multipart, `operationId: evaluateFall`, các required field hiện tại: `image`, `trackId`, `cameraSlug`, `frameTimestamp`. Giữ optional `inRestArea=false` để caller cũ còn dùng được. Request từ orchestrator dùng **ảnh đầy đủ khung hình, không xoay/letterbox**, timestamp của chính ảnh đó, token nội bộ và các field bổ sung dưới đây.

| Field bổ sung       | Kiểu/ý nghĩa                                                                            | Tương thích                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `frameId`           | string, duy nhất trong source session; định danh ảnh để chống replay                    | Optional trong spec; producer M2a mới luôn gửi                                          |
| `sourceSessionId`   | string, generation sau restart nguồn; thuộc khóa tracker                                | Optional, mặc định `legacy` cho caller cũ                                               |
| `personBoundingBox` | JSON string của bbox chuẩn hóa `x,y,width,height` trên ảnh đầy đủ, dùng chọn người/crop | Optional; nếu thiếu chỉ xử lý ảnh có một pose xác định được, đa người mơ hồ trả missing |
| `zoneConfigVersion` | integer không âm, snapshot version vùng tại thời điểm frame                             | Optional; producer mới gửi                                                              |

Validate giới hạn ảnh, JPEG/PNG decode, kích thước, UUID/string length, JSON bbox với `x+width<=1`, `y+height<=1`, tọa độ hữu hạn; không tin content-type mà bỏ kiểm tra ảnh. Invalid input trả 422, sai token 401, quá giới hạn ảnh 413. Lỗi inference vận hành trả 200 với `error != null`; decode/model/timeout không được tạo FALL.

Giữ các state public `MONITORING`, `CANDIDATE`, `CONFIRMED`, `CANCELLED`. Không thêm public state `MISSING` hay state event để mô tả tracker. Thiếu pose thể hiện bằng `poseAvailable=false` và `reason`; candidate có thể đang được giữ trong CANDIDATE nhưng timer xác nhận bằng 0.

`FallResponse` giữ các field hiện có, thêm field optional để tương thích. Implementation luôn trả đầy đủ các field cần cho producer mới:

| Field                                                                            | Quy ước                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `trackId`, `state`, `modelVersion`, `processedAt`                                | Giữ required như spec hiện tại; processedAt UTC thời điểm xử lý                                        |
| `frameId`, `cameraSlug`, `sourceSessionId`, `observedAt`                         | Echo identity; observedAt bằng frameTimestamp UTC                                                      |
| `poseAvailable`, `reason`, `isReplay`                                            | boolean/string; lý do như NO_POSE, LOW_VISIBILITY, REST_AREA, RECOVERED, MISSING_TIMEOUT, OUT_OF_ORDER |
| `episodeId`, `candidateStartedAt`, `confirmedAt`                                 | nullable; chỉ CONFIRMED có confirmedAt; identity ổn định khi retry                                     |
| `torsoAngleDeg`, `aspectRatio`, `centerHeight`, `centerDropRatio`, `motionScore` | number hoặc null khi thiếu dữ liệu; đơn vị/định nghĩa tại mục 6                                        |
| `immobileSeconds`, `thresholdSeconds`, `missingPoseSeconds`                      | giây; `immobileSeconds` là thời gian bất động liên tục được quan sát                                   |
| `keypointsDetected`                                                              | 0..33 landmark đạt quality gate; có đủ output 33 không đồng nghĩa cả 33 dùng được                      |
| `boundingBox`                                                                    | bbox người trên ảnh đầy đủ; nới cho null khi không xác định được, không đổi bbox schema dùng chung     |
| `confidence`, `confidencePolicyVersion`                                          | score bằng chứng theo policy chốt tại mục 8; không phải xác suất té ngã                                |
| `error`                                                                          | null hoặc lỗi kỹ thuật; thiếu pose là dữ liệu quan sát chưa đủ, dùng reason, không coi là nhãn FALL    |

Chỉ `CONFIRMED && poseAvailable && error==null && !inRestArea` mới đủ điều kiện đề xuất incident. Producer kiểm tra cả identity, độ tươi, thời gian, metadata và zone, không chỉ một string state. `CONFIRMED` lấy từ cache/replay phải có bằng chứng xác nhận hợp lệ đã quan sát trước đó, không được sinh mới bằng clock.

Dùng danh sách mã lỗi `FallInferenceError` riêng cho M2a nếu cần mở rộng; không đổi enum InferenceError face/fire chung chỉ để thêm NO_POSE. Khai báo đầy đủ 401/413/422, nullability, example MONITORING/CANDIDATE/missing/CONFIRMED/CANCELLED trong spec trước code.

### 4.3. Hợp đồng kết quả orchestrator

Tái sử dụng `POST /internal/events/{eventId}/ai-result` hoặc gọi cùng `AiResultsService.submit()` từ worker; không tạo callback thứ hai. Giữ `schemaVersion=1`, `module=M2A_FALL`, nhãn `FALL_DETECTED`, `results` đúng một item cho confirmed, `error=null`.

Giữ nhánh `OtherAiResultSubmission`/`OtherAiResultItem` hiện có để không đổi shape M3/M5. M2a thêm schema **tài liệu** `FallResultMetadata`, mô tả và example cho metadata trong spec; chưa thay generic `metadata` thành required shape mới cho tất cả module, chưa thêm nhánh oneOf chồng lấn generic. Producer mới validate metadata chặt trước submit. Nếu sau này tách union typed phải làm PR versioning riêng.

Metadata FALL chốt: `cameraId`, `trackId`, `sourceSessionId`, `episodeId`, `frameId`, `candidateStartedAt`, `confirmedAt`, `immobileSeconds`, `thresholdSeconds`, `torsoAngleDeg`, `aspectRatio`, `centerHeight`, `centerDropRatio`, `motionScore`, `inRestArea=false`, `zoneConfigVersion`, `confidencePolicyVersion`. Không gửi ảnh/base64, token, RTSP URL hay 33 vectors vào metadata.

- `observationId = fall:{sourceSessionId}:{trackId}:{episodeId}`, `revision=1` cho lần xác nhận bất biến.
- `resultId` UUID tạo một lần và lưu cùng payload pending trong DB. Retry không tạo ID mới hoặc processedAt mới.
- Bbox callback chuẩn hóa trên ảnh đầy đủ; không phải bbox của crop.
- Giữ 202/ACCEPTED, DUPLICATE, STALE, 400/401/404/409 của endpoint hiện tại.
- Nếu candidate hủy hoặc thiếu pose, không gửi callback `SUCCESS` với results rỗng vì validator hiện từ chối; chỉ log/metrics M2a.

**Exit gate contract:** cả hai spec lint đạt, generated types build/typecheck đạt, example map được sang DTO/Pydantic, PR đã được A+B review và merge, register có frozen SHA. Người làm API khác có bảng namespace và protocol đổi schema chung trước khi triển khai.

## 5. Chuỗi frame thật từ Frigate và nhận diện đúng người

### 5.1. Chốt nguồn ảnh

Mở rộng bridge Frigate 0.18 bằng đường M2a có feature flag riêng. Đọc đúng frame shared memory theo `frame_name`/`frame_time` trong message `detection/video`; **copy ảnh khi frame còn hợp lệ**, rồi mới xử lý/crop/encode. Không lấy `latest.jpg` hoặc event snapshot rồi gán timestamp metadata khác.

Trước PR contract, làm spike ngắn trên đúng tag Frigate 0.18.0 để xác minh frame layout YUV, shape, lifecycle shared memory, quyền truy cập và chuyển màu bằng API runtime Frigate. Bridge chỉ đóng handle do mình mở, không unlink/bỏ frame do Frigate sở hữu. Nếu spike không lấy được ảnh đúng timestamp, chưa được đánh dấu AC16-1/E2E đạt; đổi thiết kế nguồn ảnh phải cập nhật contract/data-flow trước logic.

Tách code vào module publisher M2a, không nhúng encode/network chậm vào vòng metadata đang phục vụ live overlay. Một queue bounded giữ tối đa hai frame/camera, drop ảnh cũ khi quá tải; consumer inference xử lý riêng. Giữ nguyên topic `frigate/camerai/frames`, format và độ trễ live player MediaMTX.

### 5.2. Topic riêng và payload tạm

- Topic mới: `frigate/camerai/pose/frames`, cấu hình `MQTT_TOPIC_POSE_FRAMES`; QoS 0, retain false để không replay ảnh cũ sau reconnect.
- Binary envelope v1: 4 byte unsigned big-endian là độ dài header JSON UTF-8 → header → JPEG bytes. Header có `schemaVersion=1`, `sourceSessionId`, `frameId`, `cameraSlug`, `frameTimestamp`, `frameWidth`, `frameHeight`, danh sách person `{trackId, boundingBox, observedAt}` chuẩn hóa. Không base64 ảnh trong topic metadata cũ.
- Một ảnh đầy đủ cho mỗi camera/sample; orchestrator gọi endpoint theo từng track phù hợp. Không dùng `current_zones` của track khác.
- Sample tối đa 5 fps/camera; phải lấy được ít nhất mức này trên cấu hình detector nghiệm thu. Nếu detector chậm hơn, đo và ghi thực tế; không làm giả frame để đạt số lượng.
- Giới hạn tổng payload 1 MiB, header 32 KiB, tối đa 8 person/frame; validate trước decode. Chốt policy drop với metric khi vượt giới hạn; không im lặng bỏ người trong vận hành mà vẫn tuyên bố camera được phủ đủ.
- Ảnh JPEG dùng quality cấu hình và giữ đúng aspect ratio. Nếu resize, header có kích thước ảnh sau resize và bbox chuẩn hóa theo ảnh đó; không thay đổi hệ tọa độ giữa các frame trong một history.
- Freshness mặc định tối đa 1 giây; timestamp tương lai quá 0,5 giây bị bỏ. ID/timestamp trùng hoặc đảo thứ tự không thêm history/timer.
- Không ghi ảnh tạm vào log/DB. Giải phóng buffers sau xử lý/TTL; topic nội bộ có MQTT credential/ACL như môi trường hiện tại.

Orchestrator ánh xạ cameraSlug sang camera đang bật và owner scope trước gọi AI. Worker không chờ download media của event cũ; luồng MQTT metadata/event vẫn độc lập. Queue theo track có một request đang chạy và tối đa một frame mới chờ; track khác có thể xử lý qua pool bounded. Khi thiếu kết quả quá lâu, hủy interval bất động thay vì cộng bù bằng thời gian chờ queue.

### 5.3. Pose và multi-person

Trong AI service, crop ROI có padding 10% từ `personBoundingBox` để MediaPipe Tasks IMAGE mode chạy đồng bộ, `num_poses=1`; state temporal do FallTracker quản lý. Transform landmark từ crop về ảnh đầy đủ trước mọi phép tính. Không normalize mỗi frame theo crop rồi so tọa độ crop: bbox thay đổi sẽ tạo chuyển động/hạ thấp giả.

Kiểm tra pose thuộc track bằng extent landmark và bbox: tối thiểu overlap IoU cấu hình 0,3, đủ visibility vai/hông, ROI không bị cắt mất landmark trọng yếu. Với ROI overlap nhiều người, pose assignment mơ hồ hoặc crop bị cắt, trả thiếu pose và áp dụng grace; không dùng pose người lân cận. Khi không có bbox từ caller legacy, chỉ chấp nhận một người xác định được, không tùy ý chọn người đầu tiên.

## 6. Chốt đặc trưng hình học và các ngưỡng ban đầu

Các giá trị ngoài 15 giây, 5 giây, 30° và history 10 frame là **baseline kỹ thuật để bắt đầu calibration**, không phải kết quả tối ưu đã đo. Tất cả đọc từ Settings/ConfigService và ghi `.env.example`, được chốt lại cùng phiên bản policy trước nghiệm thu.

### 6.1. Hệ tọa độ và công thức

- Landmark vai: 11/12; hông: 23/24. `S` là trung điểm hai vai, `H` là trung điểm hai hông.
- Đổi tọa độ chuẩn hóa sang pixel của ảnh đầy đủ trước tính góc/khoảng cách: `x_px=x*W`, `y_px=y*H_img`. Không tính góc trực tiếp trên x/y chuẩn hóa khi ảnh không vuông.
- Trục thân `v=S-H`; `torsoAngleDeg=atan2(abs(v_y), abs(v_x))*180/pi`, trong `[0,90]`. Trục gần bằng 0 hoặc điểm không hữu hạn → pose không đủ.
- `C=(S+H)/2` là trọng tâm đại diện phần thân trong ảnh 2D, không phải trọng tâm vật lý hoặc độ cao mét. `centerHeight=1-C_y/H_img`; y ảnh tăng hướng xuống nên ngã làm centerHeight giảm.
- `aspectRatio=person_bbox_height_px/person_bbox_width_px`, bbox degenerate bị từ chối. Tính và lưu để phân tích; trong v1 không thêm điều kiện aspectRatio bắt buộc ngoài AC góc+hạ thấp.
- Ring buffer chứa 10 pose hợp lệ **trước frame hiện tại** của đúng track. Baseline `C_prev` là median trọng tâm và `scale_prev` là median chiều cao bbox của 10 frame này; baseline không chứa frame đang xét.
- `centerDropRatio=(C_y_now-median(C_y_prev10))/scale_prev`. Candidate khi `angle<30` và `centerDropRatio>=FALL_CENTER_DROP_RATIO`. Khi thiếu đủ 10 pose hoặc history quá cũ, chỉ MONITORING, không đoán một cú ngã.
- Chuyển động: median Euclidean pixel displacement của landmark đủ quality ở cả hai frame, chia cho **scale_prev cố định lúc tạo candidate**. Dùng vai/hông/khuỷu/gối/cổ chân, tối thiểu 6 cặp và bắt buộc đủ vai/hông. Không loại mất global translation bằng cách align lại pose.
- Với interval `dt`, `motionScore=median_displacement/scale_prev/dt` có đơn vị chiều cao người/giây. Việc chia dt tránh cùng chuyển động nhưng FPS khác bị đánh giá khác nhau. Không so hai frame có gap quá ngưỡng.
- Continuation abnormal: góc vẫn `<30°` và trọng tâm vẫn thấp hơn baseline đã đóng băng khi tạo candidate theo ngưỡng hạ thấp. Không yêu cầu mỗi frame tiếp theo phải tiếp tục rơi so với 10 frame mới nhất.

### 6.2. Bảng cấu hình

| Biến                                    | Baseline            | Ý nghĩa                                                        |
| --------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `M2A_ENABLED`                           | false               | Kill switch backend/inference; bật trong môi trường nghiệm thu |
| `FRIGATE_POSE_FRAMES_ENABLED`           | false               | Bật publisher ảnh M2a độc lập với metadata cũ                  |
| `POSE_MODEL_PATH`, `POSE_MODEL_VERSION` | từ manifest đã chốt | Artifact bất biến, có checksum                                 |
| `POSE_MIN_VISIBILITY`                   | 0,60                | Quality gate landmark trọng yếu                                |
| `POSE_MIN_ASSOCIATION_IOU`              | 0,30                | Kiểm tra pose thuộc bbox track                                 |
| `POSE_ROI_PADDING_RATIO`                | 0,10                | Padding crop; clamp trong ảnh                                  |
| `FALL_HISTORY_FRAME_COUNT`              | 10                  | Số frame history cho drop                                      |
| `FALL_HISTORY_MAX_SECONDS`              | 3,0                 | History không được kéo dài vô hạn khi FPS thấp                 |
| `FALL_TORSO_ANGLE_THRESHOLD_DEG`        | 30                  | Điều kiện nghiêm ngặt `<`                                      |
| `FALL_CENTER_DROP_RATIO`                | 0,20                | Drop tối thiểu tính theo chiều cao baseline                    |
| `FALL_IMMOBILITY_SECONDS`               | 15                  | Điều kiện nghiêm ngặt `>`                                      |
| `FALL_MOTION_SPEED_THRESHOLD`           | 0,05                | Bất động khi motionScore `<` ngưỡng                            |
| `FALL_MAX_VALID_FRAME_GAP_SECONDS`      | 0,60                | Gap lớn hơn làm mất continuity                                 |
| `FALL_MISSING_POSE_GRACE_SECONDS`       | 5                   | Grace giữ identity candidate, không giữ timer bất động         |
| `FALL_RECOVERY_ANGLE_DEG`               | 60                  | Tư thế dựng thân trở lại; đứng quan sát hợp lệ hủy candidate   |
| `FALL_CANDIDATE_MAX_SECONDS`            | 60                  | TTL candidate chưa xác nhận, tránh giữ vô hạn                  |
| `POSE_TRACK_TTL_SECONDS`                | 60                  | Dọn track không còn quan sát; không thay grace 5 giây          |
| `POSE_SAMPLE_FPS`                       | 5                   | Sample publisher                                               |
| `POSE_MAX_CONCURRENT_REQUESTS`          | 2                   | Semaphore inference riêng, không chiếm quota M1                |
| `POSE_MAX_TRACKS`                       | 128                 | Giới hạn memory/history, eviction có metrics                   |
| `POSE_MAX_IMAGE_BYTES`                  | 1048576             | Đồng bộ giới hạn transport/API                                 |
| `POSE_MAX_IMAGE_PIXELS`                 | 2073600             | Giới hạn decode, baseline tối đa 1920×1080                     |
| `POSE_REQUEST_TIMEOUT_MS`               | 2000                | Timeout HTTP; lỗi/gap làm mất continuity                       |
| `POSE_TRACK_SWEEP_INTERVAL_MS`          | 250                 | Cleanup grace/TTL ngay cả khi hết frame                        |

Validate ranges và quan hệ threshold lúc startup. Ngưỡng detector/pose và rule escalation là hai bộ cấu hình khác nhau; không dùng `tWaitSeconds` làm 15 giây xác nhận. Config đổi trong runtime cần tạo tracker mới/reset candidate, không nối hai khoảng bằng chứng dùng ngưỡng khác.

## 7. State machine và thời gian bất động

| State                      | Điều kiện quan sát mới                                                       | Hành động                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| MONITORING                 | Đủ 10 history; angle/drop đạt; ngoài vùng nghỉ                               | Tạo episode, đóng băng baseline, vào CANDIDATE; chưa có cảnh báo                |
| CANDIDATE                  | Pose abnormal, motion dưới ngưỡng, dt hợp lệ                                 | Bắt đầu/tiếp tục interval bất động liên tục bằng frameTimestamp                 |
| CANDIDATE                  | Interval đủ `>15s`, pose hiện tại hợp lệ, vùng nghỉ false                    | Vào CONFIRMED, trả bằng chứng và confirmedAt; orchestrator tạo incident một lần |
| CANDIDATE                  | Đứng dậy: angle `>=60°` ở pose hợp lệ                                        | CANCELLED, reason RECOVERED; chỉ log M2a                                        |
| CANDIDATE                  | Có chuyển động trên ngưỡng hoặc tư thế không còn abnormal nhưng chưa đứng rõ | Reset immobileSeconds về 0; không cộng dồn interval rời rạc                     |
| CANDIDATE                  | Thiếu pose/ảnh/assignment, gap quá ngưỡng                                    | Giữ identity candidate tối đa 5s; reset interval bất động ngay; không xác nhận  |
| CANDIDATE                  | Pose trở lại trước grace hết                                                 | Chỉ bắt đầu interval mới nếu abnormal; không phục hồi số giây interval cũ       |
| CANDIDATE                  | Thiếu dữ liệu đủ 5s hoặc hết candidate TTL                                   | CANCELLED, lý do cụ thể; clear history/baseline không còn hợp lệ                |
| Bất kỳ state chưa xác nhận | Nằm trong REST_AREA                                                          | Hủy/suppress candidate và reset interval; không gửi nhãn FALL                   |
| CONFIRMED                  | Vẫn nằm/không hồi phục                                                       | Giữ latch; replay response cùng episode được dedup; không tạo incident tiếp     |
| CONFIRMED                  | Đứng lại hợp lệ                                                              | Re-arm MONITORING, thu history mới; không rút lại incident đã lưu               |
| CANCELLED                  | Frame hợp lệ mới                                                             | MONITORING, thu history mới; không khôi phục candidate đã hủy                   |

`candidateStartedAt` và `immobileSinceAt` là hai mốc khác nhau: lúc rơi người còn chuyển động thì thời gian bất động chưa bắt đầu. Interval bắt đầu từ frame đầu có tư thế abnormal và cặp landmark chứng minh chuyển động dưới ngưỡng; frame chưa có cặp trước không chứng minh bất động.

Phát hiện xác nhận chỉ xảy ra khi nhận frame hợp lệ mới. Cleanup timer dùng monotonic clock cho thời gian không nhận quan sát và TTL; không tự chuyển CONFIRMED từ timer. Frame capture timestamp dùng để đo interval hình học; kiểm tra freshness và thứ tự trước khi dùng. Clock lùi, sourceSession đổi, resize ảnh hoặc camera đổi cấu hình tọa độ đều reset history.

Missing gồm không có person trong sample mới, pose dưới visibility, ảnh lỗi/timeout và camera không phát frame. Sweeper theo dõi lastValidPoseReceivedAt cả khi không có request mới. Data replay không cập nhật mốc last-valid hoặc kéo dài grace. Khóa per-track đảm bảo concurrent request không cùng mutate history; duplicate frame trả cache nếu có, out-of-order trả không đủ dữ liệu, không đảo state.

## 8. REST_AREA, confidence và ghi nhận incident

### 8.1. Vùng nghỉ

Chốt tính occupancy bằng polygon **trong DB** của camera, loại REST_AREA đang bật. Dùng điểm trung tâm bbox của người làm anchor v1, điểm trên biên tính là trong vùng. Ghi rõ rule này vào API guide/test; vùng giường/sofa cần được vẽ bao phủ tâm người ở tư thế nằm. Không dùng bottom-center của Frigate hoặc entered_zones lịch sử làm nguồn duy nhất vì điều kiện chân trên giường có thể khác tâm phần thân.

- Geometry dùng bbox của chính frame, polygon chuẩn hóa cùng ảnh và version cấu hình đã đọc; không lấy zone đầu tiên trong danh sách.
- Nếu đồng thời REST_AREA và RESTRICTED thì M2a bị suppress; M4 vẫn theo quy tắc M4 hiện tại.
- Vào vùng nghỉ khi đang candidate: hủy ngay. Rời vùng nghỉ: thu history mới, không dùng thời gian nằm trong vùng nghỉ.
- Orchestrator tính `inRestArea`, không lấy từ browser; AI service không được CONFIRMED khi true.
- Trước ghi incident, đọc lại trạng thái camera và version zone hiện tại trong cùng transaction tạo incident; khóa row/version cấu hình camera theo cơ chế mà CRUD zone cũng dùng để tránh thay vùng giữa bước kiểm tra và commit. Nếu version đổi, re-evaluate geometry với frame xác nhận; nếu không xác định được hoặc cấu hình unavailable thì chưa ghi FALL và yêu cầu bằng chứng mới.
- DB/zone lookup lỗi: M2a fail closed, ghi metrics/log và giữ/hủy theo missing grace; không coi lỗi là ngoài vùng nghỉ. Không ảnh hưởng M1/M4.
- Đổi/xóa/tắt zone phải invalidate cache ngay. Không lấy chính sách lịch của RESTRICTED áp sang vùng nghỉ; REST_AREA đang bật áp dụng cả ngày trong phạm vi US-17.

### 8.2. Score và escalation

MediaPipe Pose không phải classifier té ngã đã hiệu chuẩn. Chốt policy `fall-rule-evidence-v1`: `confidence=1.0` là **đủ toàn bộ bằng chứng rule** khi CONFIRMED; state khác không gửi nhãn/score FALL vào callback. Score này không tuyên bố xác suất 100%, không dùng top_score của Frigate hoặc visibility làm xác suất ngã. Lưu policyVersion để tách khỏi modelVersion và đo precision/recall thực tế.

Orchestrator dùng rule FALL hiện có, priority P1; không sửa rule M1/M4/M3. Rule mặc định FALL có `tLow=0.55`, `tHigh=0.75`, nên confirmed rule evidence đi qua NOTIFIED theo policy hiện tại. Người quản trị tắt rule thì không gửi thông báo; incident vẫn có bằng chứng và trạng thái phản ánh chính sách. Không sửa global escalation để ép tất cả nhãn được thông báo.

Chốt `detectedAt=confirmedAt` cho incident FALL, test deadline theo mốc này và giữ highWaitSeconds/rule version snapshot hiện có. Tạo notification, retry, escalation và xác nhận IM_OK/NEED_HELP qua US-13/US-14/US-15; không gọi Telegram trực tiếp trong pose worker. Giao diện nên diễn đạt score là mức đáp ứng tiêu chí khi policy này được dùng, tránh hiển thị “xác suất té ngã 100%”.

### 8.3. Persistence và retry

Migration mới bổ sung bảng `fall_incidents` với unique identity episode, `event_id`, confirm timestamps, payload/resultId bất biến, delivery status/lease/attempts và timestamps. Chọn số migration tiếp theo sau rebase; repo hiện có số trùng 0007/0010, không sửa lịch sử để làm sạch. Cập nhật ERD.

Transaction xác nhận gồm tạo event FALL và bản ghi incident/pending result; không tạo event rồi để mất công việc submit khi process crash. Worker claim pending bằng lease/`SKIP LOCKED`, gọi `AiResultsService.submit()`, đánh dấu applied khi receipt ACCEPTED/DUPLICATE. Crash sau submit trước mark sẽ retry cùng payload, receipt xử lý dedup.

DB transaction và outbox có thể dùng repository mới/port transaction hẹp; không sao chép toàn bộ aggregator, receipts hoặc notification logic. Để `AiResultsService` tạo outbox escalation/SSE như cũ. Không dispatch alert trước commit incident/result; retry không được đổi confirmedAt, resultId hay payload hash.

Nếu AI restart trước khi orchestrator nhận bằng chứng xác nhận, không phục hồi suy luận bằng cách tự cộng clock; cần bằng chứng mới. Đây là giới hạn state RAM phải ghi trong runbook. Incident đã persist không mất khi restart orchestrator/AI. S3 lỗi không được xóa incident hoặc làm gửi cảnh báo trùng; media có trạng thái lỗi/retry theo luồng hiện có.

## 9. Các bước triển khai theo một người và một Agent

| Bước | Công việc                                                                             | Đầu ra / điều kiện chuyển bước                                                          |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0    | Kiểm tra working tree/AGENTS, đọc convention, ghi baseline test cũ, spike frame+model | Báo cáo baseline; ảnh thật khớp timestamp/track; vấn đề sẵn có tách riêng               |
| 1    | PR dependency theo mục 3                                                              | Manifest/lock/model checksum; clean install và M1 regression đạt; PR merge              |
| 2    | PR contract theo mục 4 và topic envelope                                              | Hai spec, generated types, API register/examples; A+B review; frozen SHA                |
| 3    | Bridge publisher M2a và ingest worker, feature flag off                               | Frame thật, kiểm tra identity/freshness/queue; metadata/live và M1/M4 không đổi hành vi |
| 4    | Pose service, geometry, history, state machine, missing sweep                         | Unit/contract test AC16/AC17 và biên thời gian đạt; chưa tự gửi thông báo               |
| 5    | REST_AREA + incident transaction + pending submit + media/escalation                  | Exactly-once theo episode, restart/retry đạt; notification pipeline cũ dùng được        |
| 6    | Hiển thị FALL/bằng chứng qua UI hiện có                                               | SSE/list/detail/filter/P1 và confirmation hoạt động; loading/error/empty/mobile đạt     |
| 7    | Replay video thật, kiểm thử hồi quy, metrics, tài liệu và release                     | Nghiệm thu E2E, CI xanh, checklist DoD và hướng dẫn rollback hoàn chỉnh                 |

Làm tuần tự trên cùng Agent; không giao M1/M3/UI cho Agent khác. Có thể chia nhiều PR nhỏ của cùng owner để nhánh sống dưới 3 ngày và main luôn chạy được. Các PR giữa chừng giữ feature flag off, không hiển thị chức năng chưa hoàn tất như đã sẵn sàng.

### File dự kiến

- AI: `app/routers/pose.py`, `app/models/pose.py`, `app/services/pose_estimator.py`, `pose_geometry.py`, `fall_tracker.py`, `fall_tracker_registry.py`, tests tương ứng.
- AI wiring: `app/main.py`, `app/config.py`, manifest/locks, Dockerfile; lazy load model M2a khi flag bật, shutdown giải phóng landmarker.
- Backend mới: `apps/orchestrator/src/fall-detection/` với module, inference port/HTTP adapter, frame decoder, worker/coordinator, rest-area evaluator, incident repository/service và delivery worker.
- Backend chạm tối thiểu: ingest subscribe topic mới, app.module/config, exports của ports/repositories/media khi thật sự cần; không đưa inference vào MQTT callback hoặc controller.
- Infra: module publisher ảnh M2a cạnh `infra/frigate/frame-metadata/bridge.py`, tests và mount cần thiết; `docker-compose.yml`, `.env.example`.
- DB: một migration mới cho incident/delivery, `docs/database/ERD.md`.
- UI: `EventCard`, `EventDetailModal`, filter/mapping và phần evidence; API data nhập từ contracts, không viết tay DTO mới.
- Docs sprint 3: dependency baseline, API change register, testing guide, runbook, evaluation metrics; cập nhật docs index để người khác tìm được tài liệu.

Tên file cuối cùng theo trách nhiệm thực tế, không bắt buộc tạo file rỗng chỉ để khớp danh sách. Shared wiring có một owner tích hợp, patch nhỏ; không sửa formatter/layout toàn dự án.

## 10. Quy tắc code và Git thực thi

### Code

- Controller/router mỏng; service xử lý nghiệp vụ, repository SQL; outbound interface/adapter cho inference và storage.
- TypeScript không `any`, không cast để lách lỗi, không non-null assertion trong logic; class-validator cho input NestJS. Python public functions đủ type hint, Pydantic request/response, alias camelCase đúng OpenAPI.
- Threshold/config có tên và đơn vị; TS dùng ConfigService, Python dùng get_settings(); mọi biến mới thêm `.env.example` và Compose/config validation cùng PR.
- Không blocking MediaPipe trong async event loop: dùng worker thread bounded/semaphore, landmarker instance không chia sẻ đồng thời trái tính thread safety. Giữ face endpoint và health responsive khi M2a quá tải/lỗi model.
- Log milestone/state transition bằng English và correlationId/camera/track/episode; UI tiếng Việt; comment giải thích lý do và FR. Không info log mỗi frame, không ảnh/vector/token/RTSP credential.
- Không bắt bare exception/nuốt lỗi; technical error khác missing observation. Failures M2a không sửa status/priority/deadline của event cũ.
- Migration append-only, SQL parameterized, projection cột rõ ràng. Core coverage tối thiểu 60%; ưu tiên state/threshold/dedup/zone/retry.
- Tài liệu plan này viết tiếng Việt để bàn giao theo yêu cầu; tên code, docstring/comment trong code và commit message theo convention English.

### Git

- Trước thao tác, giữ nguyên thay đổi người dùng ngoài phạm vi; không `git restore .`, `git clean`, reset DB hoặc stage toàn bộ repo.
- Theo format trong GIT_WORKFLOW: ví dụ `feat/US-16-pose-fall`, `feat/US-17-confirm-fall`, `chore/sprint3-ai-dependencies`, `docs/sprint3-fall-plan`. Không tự đổi naming convention của repo.
- Không push trực tiếp main; rebase main hằng ngày, nhánh dưới 3 ngày; PR nhỏ, tách contract/dependency trước implementation.
- Commit English, scope hợp lệ, ví dụ `feat(ai): add pose fall candidate tracking`, `feat(orchestrator): persist confirmed fall incidents`, `test(ai): cover fall timing and missing pose`, `docs(docs): add fall detection runbook`.
- Không `--no-verify`; không force push main. Nhánh của mình sau rebase chỉ dùng force-with-lease khi cần và được phép theo quy trình repo.
- PR điền đúng template, US-16/US-17, sprint/story points từ backlog, issue thật khi có; ảnh UI desktop/mobile và bằng chứng chạy thực tế.
- Tối thiểu một người khác approve; thay đổi `api/` cần cả A và B. CODEOWNERS hiện có username placeholder: chọn tài khoản thật trong PR, không coi placeholder là đã có review.
- Không tự merge PR của mình; reviewer merge squash sau CI/DoD. Một người triển khai E2E không bỏ yêu cầu review độc lập.
- LF theo `.editorconfig`; không sửa global Git setting của người dùng chỉ để làm story.

## 11. Ma trận kiểm thử bắt buộc

### 11.1. Unit và contract

| Nhóm      | Trường hợp                                                                 | Kết quả                                                                |
| --------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Geometry  | Output 33 landmark nhưng vai/hông visibility thấp                          | poseAvailable=false, không tạo candidate/FALL                          |
| Geometry  | Ảnh 16:9, crop/resize/bbox thay đổi                                        | Góc/tọa độ theo ảnh đầy đủ đúng, không tạo drop giả                    |
| Geometry  | Box width=0, NaN/Infinity, landmark ngoài ROI, nhiều người overlap         | Reject/thiếu pose có lý do, không dùng người khác                      |
| History   | 9 frame trước; đủ 10; frame hiện tại không được tính vào baseline          | Chỉ đủ 10 history mới xét drop                                         |
| Threshold | Angle 29,999°/30°; drop dưới/bằng 0,20                                     | Đúng strict/inclusive đã chốt                                          |
| Timer     | 14,999s / 15,000s / 15,001s có quan sát hợp lệ                             | Hai trường hợp đầu chưa confirm; trường hợp cuối confirm               |
| Motion    | Motion dưới/bằng/trên threshold; FPS/dt khác nhau                          | Bằng hoặc trên không bất động; dt chuẩn hóa đúng                       |
| Motion    | Bất động 8s, chuyển động, bất động 8s                                      | Không cộng thành 16s                                                   |
| Recovery  | Đứng trước ngưỡng; đứng khi đã có khoảng abnormal chưa đủ                  | Hủy, chỉ log M2a; không nhãn FALL                                      |
| Missing   | Mất pose khi đã bất động 14s; chờ 2s                                       | Không confirm bằng dữ liệu thiếu                                       |
| Missing   | Pose trở lại ở 4,9s; đúng 5s; không còn request nào                        | Trước grace: interval mới; đúng grace/không request: sweep hủy         |
| Identity  | Hai camera cùng trackId; hai track cùng camera; track/session đổi          | History độc lập; không nối thời gian/pose                              |
| Ordering  | Duplicate, out-of-order, concurrent requests, clock lùi                    | Không cộng frame/time, không đua state                                 |
| REST      | Trong polygon, biên, ngoài, zone tắt/xóa/version đổi, lookup lỗi           | Suppress/re-evaluate/fail closed đúng quy tắc                          |
| REST      | Candidate vào vùng nghỉ; ra vùng nghỉ; REST+RESTRICTED                     | M2a không cảnh báo trong vùng, M4 giữ hành vi cũ                       |
| Lifecycle | TTL, quá nhiều track, restart model/service                                | Memory bounded, metric rõ; history reset, không confirm thiếu evidence |
| HTTP      | Token sai, bbox JSON lỗi, payload lớn, image decode lỗi, model unavailable | 401/422/413/200+error đúng contract                                    |
| Contract  | Request/response/example từ hai spec, mapping AI→callback                  | CamelCase/null/units đúng; regenerate không có diff còn sót            |

Test thời gian dùng fake clock/frameTimestamp, không sleep 15 giây cho mọi unit test. Fake estimator kiểm tra state machine; ít nhất một integration test dùng model thật để xác minh landmark/transform. Test mock không thay nghiệm thu model/video thật.

### 11.2. Integration và hồi quy

| Nhóm          | Kịch bản                                                                          | Kết quả                                                              |
| ------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Pipeline      | Binary frame thật → worker → /pose/fall → confirmed → incident/AI receipts/outbox | FALL P1 đúng camera/track, chỉ một episode                           |
| Persistence   | Crash trước commit, sau commit, sau submit trước mark, retry job                  | Không orphan alert/job, không incident/notification trùng            |
| Delivery      | Outbox/Telegram lỗi, retry, restart orchestrator                                  | Không mất incident pending; deadline/confirmation cũ vẫn hoạt động   |
| Existing risk | Track đã có M1/M4 NOTIFIED hoặc terminal rồi mới ngã                              | Có incident FALL riêng; M1/M4 không bị đổi state/deadline            |
| Media         | Lưu snapshot/clip lỗi hoặc ảnh event cũ                                           | Không dùng làm chứng cứ interval; incident ghi nhận lỗi media đúng   |
| Frames        | Overload/drop/out-of-order/broker reconnect                                       | Gap reset timer, live overlay không bị chặn, không replay ảnh retain |
| Isolation     | M2a disabled/model thiếu/CPU đầy                                                  | Face, health, auth, zones, event/MQTT cũ vẫn dùng được               |
| Database      | Migration trên DB sạch và DB có dữ liệu                                           | Dữ liệu cũ giữ nguyên, unique/claim/retry hoạt động                  |
| SSE/UI        | FALL mới, filter, detail, notification, IM_OK/NEED_HELP                           | Cập nhật không cần F5, P1 có chữ/icon, trạng thái lỗi rõ             |

Hồi quy tối thiểu: US-01/02 MQTT + dedup/media; US-03/04 auth; US-06 list/filter/SSE; US-09/10 face register/match/collection; US-11 multi-label/receipt ordering; US-12 CRUD zone/config sync/M4; US-13 escalation/recovery/first confirmation; US-14 Telegram retries/callback; US-15 rule config/highWait. Chạy test suite đã có và smoke luồng thật; không chỉ test M2a mới.

### 11.3. E2E video thật

Tạo bộ clip có ground truth timestamp/track và checksum; phát qua MediaMTX → Frigate như camera thật. Nghiệm thu bằng clip mô phỏng hoặc diễn viên an toàn, không yêu cầu người nhà tự ngã nguy hiểm.

1. Đứng/đi → ngã ngoài REST_AREA → nằm bất động trên 15s: trước ngưỡng không alert; sau frame hợp lệ vượt ngưỡng có một FALL P1, ảnh đúng người, SSE/Telegram/confirmation hoạt động.
2. Cúi nhặt đồ hoặc nằm xuống rồi đứng lại dưới 15s: candidate nếu có bị hủy, không notification FALL.
3. Nằm trên giường/sofa trong REST_AREA trên 20s: không FALL; có thể có event khác độc lập theo rule cũ.
4. Candidate bị che khuất ở giây 14: không xác nhận trong thời gian mù, hủy sau 5s; pose trở lại trước grace phải đếm interval mới.
5. Hai người: một đi lại, một ngã; không tráo track hoặc suppress người ngoài vùng do người trong vùng nghỉ.
6. Restart/duplicate/overload và bật/tắt flag: không alarm từ thời gian thiếu, incident đã lưu tiếp tục delivery, M1/M4 và live camera vẫn hoạt động.

Đo event-level precision/recall, false alarms theo giờ clip âm tính, số TP/FP/FN, độ trễ từ immobileSince đến confirmed/notification, FPS thực tế, p95 inference/queue, CPU/RAM. Tách tập calibration và nghiệm thu; không tuning trên tập nghiệm thu rồi báo là độc lập. Ghi cả hạn chế camera view, occlusion và REST anchor. Không bịa số đo hoặc ngưỡng precision/recall cam kết khi chưa có dữ liệu/US-22 yêu cầu cụ thể.

Ngân sách hiệu năng ban đầu: xử lý duy trì 5 sample/s trên camera nghiệm thu, queue age p95 ≤1s và không vượt gap liên tục. Nếu không đạt, giảm model/resize theo thiết kế đã chốt hoặc báo cấu hình giới hạn; không cộng frame bị rớt để che hiệu năng. Chốt số camera/người được hỗ trợ bằng số đo trước release.

## 12. Lệnh kiểm tra và bằng chứng phải bàn giao

Chạy tại repository root; setup AI theo lock đã merge ở gate dependency, không chạy installer tự chọn latest.

```powershell
pnpm install --frozen-lockfile
pnpm setup:ai
pnpm api:lint
pnpm contracts:generate
pnpm --filter @cam/contracts build
pnpm --filter @cam/orchestrator test
pnpm --filter @cam/orchestrator test:integration
pnpm --filter @cam/web test
pnpm test:tools
pnpm check:ai
node tools/scripts/py.mjs mypy app
pnpm check:all
docker compose config --quiet
docker compose build ai-service orchestrator web
docker compose --profile cv up -d
docker compose ps
```

Mypy là check bổ sung: `check:all` hiện chưa gọi mypy. Integration DB cần môi trường test riêng. Bridge test hiện có chạy qua `python -m unittest discover -s infra/frigate/frame-metadata -p test_bridge.py`; thêm test publisher và đưa vào CI theo cùng pattern. Thêm CI job model thực trên runtime lock/model checksum vì CI Python hiện tại chỉ cài dev base không chứng minh extra M2a chạy được.

Sau generate, kiểm tra diff generated tương ứng đúng spec và không còn diff sau generate lần hai. Không sửa API schema lúc chạy smoke cho khớp response một cách âm thầm. Docker up/health chỉ chứng minh startup; vẫn cần E2E clip thật. Không chạy `db:reset` hoặc xóa volume dữ liệu đang dùng.

Bàn giao trong `docs/sprint-3/TEST_US-16_US-17_POSE_FALL.md` và `RUNBOOK_M2A_FALL.md`:

- Dependency/model manifest, lock/install logs, frozen contract SHA và API register.
- Test matrix với pass/fail, timestamp và cách replay; ảnh desktop/mobile, log trace đã che dữ liệu nhạy cảm.
- Metrics ground truth/precision/recall và cấu hình camera/threshold thực tế đã dùng.
- Hướng dẫn đánh dấu vùng nghỉ, bật/tắt M2a, nhận biết camera/model degraded, reset candidate khi restart và kiểm tra pending delivery.
- Hạn chế còn lại, lỗi baseline có từ trước và môi trường/check chưa chạy được; không đánh dấu pass khi thiếu bằng chứng.

## 13. Release, rollback và Definition of Done

Bật M2a trong môi trường test trước, kiểm chứng AC/hồi quy/CPU rồi mới bật ở camera đã nghiệm thu. `M2A_ENABLED=false` dừng admission/inference/incident mới và reset candidate; `FRIGATE_POSE_FRAMES_ENABLED=false` dừng ảnh M2a. Incident/notification/deadline đã persist tiếp tục xử lý theo engine hiện có, không bị hủy ngầm khi tắt detector.

Rollback code bằng image/commit trước; schema mới additive giữ để không mất incident đã lưu. Rollback dependency bằng bộ image/lock đã kiểm chứng của release trước, không `pip install` sửa live container. Nếu phát hiện M1/M4/auth/live bị hỏng, giữ M2a off và sửa hồi quy trước release.

- [ ] Một người và một AI Agent hoàn thành toàn chuỗi E2E, không bàn giao riêng FE/BE/AI chưa tích hợp.
- [ ] PR dependency merge trước logic; runtime/dev/CI/Docker dùng lock, chỉ một OpenCV distribution, model checksum được chốt.
- [ ] Cả hai OpenAPI có reservation/namespace/frozen SHA, merge contract trước code; generated types khớp và người làm API khác có quy trình extension rõ ràng.
- [ ] Đủ 33 output landmark/quality gate, geometry trên ảnh đầy đủ, history 10 frame và điều kiện `<30°`/drop đúng.
- [ ] `>15s` bất động liên tục mới confirm; thiếu pose không tính thời gian, sweep hủy sau tối đa 5s.
- [ ] Đứng lại/cúi/REST_AREA không tạo cảnh báo FALL; đa người/camera không tráo history.
- [ ] FALL P1 tạo đúng một incident/episode với detectedAt=confirmedAt; retry/crash không nhân bản.
- [ ] Event M1/M4 đã alert/terminal không chặn FALL riêng; trạng thái/deadline/confirmation cũ giữ đúng hành vi.
- [ ] Dashboard/SSE/media/Telegram/IM_OK/NEED_HELP đi qua luồng cũ, có bằng chứng E2E thật.
- [ ] Code/Git/PR theo convention; core coverage ≥60%, CI và checks phù hợp đạt, reviewer độc lập nghiệm thu.
- [ ] Metrics/runbook/rollback/config/docs đầy đủ; giới hạn state RAM và cấu hình hỗ trợ được ghi rõ.

## 14. Prompt bàn giao cho AI Agent triển khai

> Triển khai US-16/US-17 theo file plan này trên cùng một AI Agent. Bắt đầu bằng đọc AGENTS nếu có, CODING_CONVENTION.md và GIT_WORKFLOW.md, giữ nguyên thay đổi ngoài phạm vi, ghi baseline hồi quy và xác minh nguồn ảnh Frigate đúng timestamp. Thực hiện gate dependency/model và gate contract cho cả api/openapi.yaml lẫn api/openapi-ai-service.yaml trước viết logic M2a. Một owner làm toàn bộ frame pipeline, Pose/FallTracker, REST_AREA, incident/pending delivery, API/SSE/UI, test thật và tài liệu; không spawn subagent. Giữ feature flag off cho phần chưa hoàn chỉnh. Không suy luận alarm từ missing pose hoặc ảnh snapshot lặp, không cộng thời gian mù, không thay đổi vòng đời M1/M4. Theo dõi checklist bằng chứng và chỉ đánh dấu hoàn thành khi AC/hồi quy/E2E thực tế đạt. Khi cần thay quyết định frozen, tạo PR contract/dependency phối hợp trước; không tự đổi version/schema ở nhánh implementation. Không push main hoặc tự merge PR; làm kết quả reviewable để reviewer hợp lệ nghiệm thu theo Git workflow.

## 15. Nguồn kỹ thuật đã đối chiếu

- [MediaPipe Tasks Pose Landmarker Python](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python): API IMAGE/VIDEO, landmarks và cấu hình model.
- [Metadata wheel/dependency MediaPipe 0.10.32](https://pypi.org/pypi/mediapipe/0.10.32/json): exact release được chọn cho gate.
- [OpenCV Python package selection](https://pypi.org/project/opencv-python-headless/): các flavor dùng chung namespace cv2, chọn một distribution.
- [Runtime image utilities Frigate tag v0.18.0](https://raw.githubusercontent.com/blakeblackshear/frigate/v0.18.0/frigate/util/image.py): nguồn đối chiếu spike frame shared memory; phải kiểm chứng cùng code publisher/camera runtime, không chỉ dựa vào API nội bộ theo trí nhớ.

Các nguồn hỗ trợ lựa chọn kỹ thuật; không thay thế smoke test trên môi trường đã khóa hoặc bằng chứng nghiệm thu thực tế.

## 16. Bàn giao contract và migration

Hai OpenAPI đã được cập nhật theo plan, cùng generated contracts và migration [0013_fall_incidents.sql](../../db/migrations/0013_fall_incidents.sql). [API_CHANGE_REGISTER.md](API_CHANGE_REGISTER.md) reserve operation/schema/migration và local spec hash; [DEPENDENCY_BASELINE.md](DEPENDENCY_BASELINE.md) chốt graph JS, inputs Python và một người tích hợp dependency. Đây là contract/DDL chuẩn bị, chưa implement detector/runtime hoặc apply database. Review/merge, clean install Python/model, PostgreSQL upgrade/concurrency và E2E vẫn là gate bắt buộc.
