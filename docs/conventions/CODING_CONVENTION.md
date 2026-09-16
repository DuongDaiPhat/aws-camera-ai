# Quy ước viết code

> **Task 0.9** · Người phụ trách: **B** (Scrum Master) · Sprint 0
> Quy ước nào máy kiểm tra được thì đã cấu hình trong ESLint / Prettier / Ruff.
> Tài liệu này giải thích những thứ máy **không** kiểm tra được.

## Mục lục

- [1. Nguyên tắc chung](#1-nguyên-tắc-chung)
- [2. Đặt tên](#2-đặt-tên)
- [3. TypeScript / NestJS](#3-typescript--nestjs)
- [4. TypeScript / Next.js](#4-typescript--nextjs)
- [5. Python / FastAPI](#5-python--fastapi)
- [6. SQL](#6-sql)
- [7. Xử lý lỗi và log](#7-xử-lý-lỗi-và-log)
- [8. Cấu hình và secret](#8-cấu-hình-và-secret)
- [9. Viết test](#9-viết-test)
- [10. Viết comment](#10-viết-comment)
- [11. Công cụ tự động](#11-công-cụ-tự-động)

---

## 1. Nguyên tắc chung

### NT-1 · Người đọc quan trọng hơn người viết

Code được đọc nhiều hơn viết rất nhiều. Trong nhóm 5 người review chéo, mỗi dòng code sẽ
được ít nhất 2 người đọc. Viết sao cho người thứ hai hiểu ngay, kể cả khi phải dài hơn vài dòng.

### NT-2 · Rõ ràng hơn ngắn gọn

```typescript
// ❌ Ngắn nhưng phải dừng lại nghĩ
const e = evts.filter((x) => x.s === 'N' && x.d < now);

// ✅ Dài hơn nhưng đọc một lần là hiểu
const suKienQuaHan = events.filter(
  (event) => event.status === 'NOTIFIED' && event.escalationDeadlineAt < now,
);
```

### NT-3 · Không có số ma thuật

Mọi ngưỡng, timeout, giới hạn đều phải có tên và đọc được từ cấu hình.

```typescript
// ❌ 15 là gì? Ai đổi được nó?
if (immobileSeconds > 15) { ... }

// ✅
if (immobileSeconds > this.config.fallImmobilitySeconds) { ... }
```

Đây không phải chuyện thẩm mỹ: Sprint 4 sẽ phải chỉnh ngưỡng để giảm FAR (US-29).
Hard-code nghĩa là lúc đó phải sửa code, build lại, deploy lại — giữa tuần cuối.

### NT-4 · Thất bại phải ồn ào, đừng im lặng

```typescript
// ❌ Lỗi biến mất, không ai biết gì
try {
  await this.telegram.send(msg);
} catch (e) {}

// ✅ Ghi nhận được, và escalation vẫn tiếp tục (FR-NOT-05)
try {
  await this.telegram.send(msg);
} catch (error) {
  this.logger.error(
    { correlationId, eventId, channel: 'TELEGRAM', err: error },
    'Gửi Telegram thất bại',
  );
  await this.notificationRepo.markFailed(notificationId, error);
  // KHÔNG throw lại — đếm giờ escalation phải tiếp tục
}
```

### NT-5 · Một hàm làm một việc

Quá 60 dòng thì ESLint cảnh báo. Quá 100 dòng thì gần như chắc chắn hàm đó đang làm 3 việc.

---

## 2. Đặt tên

### Ngôn ngữ

| Đối tượng                     | Ngôn ngữ                 | Ví dụ                                       |
| ----------------------------- | ------------------------ | ------------------------------------------- |
| Tên biến, hàm, class          | **Tiếng Anh**            | `escalationDeadline`, `findPendingEvents()` |
| Comment giải thích            | **Tiếng Việt**           | `// Chỉ lần xác nhận đầu tiên có hiệu lực`  |
| Thông điệp lỗi cho người dùng | **Tiếng Việt**           | `"Không phát hiện được khuôn mặt"`          |
| Log nội bộ                    | **Tiếng Việt hoặc Anh**  | Miễn nhất quán trong một service            |
| Commit message                | **Tiếng Việt**           | `feat(orchestrator): thêm khôi phục timer`  |
| Tên bảng, cột SQL             | **Tiếng Anh**            | `events`, `detected_at`                     |
| Tên ràng buộc SQL             | **Tiếng Việt không dấu** | `known_faces_so_anh_hop_le`                 |

Lý do đặt tên ràng buộc SQL bằng tiếng Việt: khi vi phạm, Postgres in thẳng tên ràng buộc
ra màn hình. `escalation_rules_t_low_khong_lon_hon_t_high` là thông điệp lỗi luôn.

### Quy tắc viết hoa

| Loại                   | Quy tắc                     | Ví dụ                              |
| ---------------------- | --------------------------- | ---------------------------------- |
| Biến, hàm (TS)         | `camelCase`                 | `detectedAt`, `buildDedupKey()`    |
| Class, interface, type | `PascalCase`                | `EscalationEngine`, `EventSummary` |
| Interface cổng ra      | `PascalCase` có tiền tố `I` | `IStorageService`, `IFaceService`  |
| Hằng số                | `SCREAMING_SNAKE_CASE`      | `DEFAULT_PAGE_SIZE`                |
| Biến, hàm (Python)     | `snake_case`                | `match_face()`, `torso_angle_deg`  |
| Class (Python)         | `PascalCase`                | `FallTracker`                      |
| File TS                | `kebab-case.<loại>.ts`      | `escalation.service.ts`            |
| File Python            | `snake_case.py`             | `fall_tracker.py`                  |
| File React             | `PascalCase.tsx`            | `EventCard.tsx`                    |
| Bảng SQL               | `snake_case` số nhiều       | `events`, `known_faces`            |
| Cột SQL                | `snake_case` số ít          | `event_type`, `is_false_alarm`     |

### Quy ước theo ngữ nghĩa

| Tiền tố / hậu tố             | Dùng cho                                  | Ví dụ                                |
| ---------------------------- | ----------------------------------------- | ------------------------------------ |
| `is`, `has`, `should`, `can` | Boolean                                   | `isFalseAlarm`, `hasSnapshot`        |
| `*At`                        | Mốc thời gian                             | `detectedAt`, `escalationDeadlineAt` |
| `*Seconds`, `*Ms`            | Khoảng thời gian — **luôn ghi rõ đơn vị** | `tWaitSeconds`, `timeoutMs`          |
| `*Count`                     | Số lượng                                  | `attemptCount`, `sourceImageCount`   |
| `get*`                       | Lấy dữ liệu, ném lỗi nếu không có         | `getEvent(id)`                       |
| `find*`                      | Lấy dữ liệu, trả `null` nếu không có      | `findEventByTrackId(id)`             |
| `list*`                      | Trả về mảng                               | `listZonesByCamera(id)`              |

> **Đơn vị thời gian luôn nằm trong tên.** `timeout = 5` là 5 giây hay 5 mili giây?
> `timeoutMs = 5000` thì không ai hỏi.

---

## 3. TypeScript / NestJS

### Cấu trúc thư mục theo tính năng

```
apps/orchestrator/src/
├── main.ts
├── app.module.ts
├── common/                      # dùng chung toàn app
│   ├── decorators/
│   ├── filters/                 # bộ lọc exception toàn cục
│   ├── guards/                  # RolesGuard, JwtAuthGuard
│   ├── interceptors/            # logging, correlation-id
│   └── interfaces/              # IStorageService, IFaceService...
├── config/
├── events/                      # mỗi tính năng một thư mục
│   ├── events.module.ts
│   ├── events.controller.ts
│   ├── events.service.ts
│   ├── events.repository.ts
│   ├── dto/
│   │   ├── list-events.dto.ts
│   │   └── confirm-event.dto.ts
│   └── entities/
├── escalation/
├── notifications/
├── ingestion/                   # MQTT consumer
├── storage/                     # adapter MinIO / S3
└── health/
```

### Quy tắc phụ thuộc

```
Controller  →  Service  →  Repository  →  Database
                  ↓
              Interface  ←  Adapter
```

- Controller **chỉ** làm: nhận request, gọi service, trả response. Không có `if` nghiệp vụ.
- Service chứa toàn bộ logic nghiệp vụ. Không import `Request`/`Response` của Express.
- Repository chỉ truy cập DB và chuyển đổi `snake_case` ↔ `camelCase`.
- Service **không được** import class adapter cụ thể.

```typescript
// ❌ Khóa cứng vào S3, không test được nếu thiếu credential AWS
import { S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class EventService {
  private s3 = new S3Client({ region: 'ap-southeast-1' });
}

// ✅ Đổi provider bằng biến môi trường, mock được khi test
@Injectable()
export class EventService {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: IStorageService) {}
}
```

### DTO và validation

Mọi dữ liệu vào đều qua DTO có `class-validator`. Không bao giờ dùng `any`.

```typescript
export class ConfirmEventDto {
  @ApiProperty({ enum: CONFIRMATION_RESPONSES })
  @IsIn(CONFIRMATION_RESPONSES)
  response!: ConfirmationResponse;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

`ValidationPipe` đã bật `whitelist` và `forbidNonWhitelisted` trong `main.ts`: trường lạ
không lọt vào được, và người gửi nhận lỗi rõ ràng thay vì bị âm thầm bỏ qua.

### Cấm dùng

| Cấm                                  | Dùng thay thế                                         |
| ------------------------------------ | ----------------------------------------------------- |
| `any`                                | Kiểu cụ thể, hoặc `unknown` rồi thu hẹp               |
| `console.log`                        | `Logger` của Nest                                     |
| `@ts-ignore`                         | `@ts-expect-error` kèm comment giải thích             |
| `!` (non-null assertion) trong logic | Kiểm tra tường minh (`!` trong khai báo DTO thì được) |
| `process.env.X` rải rác              | `ConfigService`                                       |
| `as` để ép kiểu cho qua chuyện       | Sửa kiểu cho đúng                                     |

### Bất đồng bộ

```typescript
// ❌ Tuần tự không cần thiết — 3 lần chờ liên tiếp
const camera = await this.cameraRepo.find(id);
const zones = await this.zoneRepo.findByCamera(id);
const rules = await this.ruleRepo.findAll();

// ✅ Song song khi không phụ thuộc nhau
const [camera, zones, rules] = await Promise.all([
  this.cameraRepo.find(id),
  this.zoneRepo.findByCamera(id),
  this.ruleRepo.findAll(),
]);
```

Luôn `await` hoặc xử lý promise tường minh. Promise bị bỏ rơi làm lỗi biến mất không dấu vết.

---

## 4. TypeScript / Next.js

### Cấu trúc

```
apps/web/src/
├── app/                      # App Router
│   ├── layout.tsx
│   ├── page.tsx              # danh sách sự kiện (US-06)
│   ├── events/[id]/page.tsx  # chi tiết (US-21)
│   ├── known-faces/page.tsx  # người quen (US-09)
│   └── settings/page.tsx     # ngưỡng cảnh báo (US-15)
├── components/
│   ├── ui/                   # nút, thẻ, badge — không biết gì về nghiệp vụ
│   └── events/               # EventCard, EventFilter — biết nghiệp vụ
├── hooks/
├── lib/
│   ├── api-client.ts
│   └── format.ts
└── types/
```

### Quy tắc

- **Server Component mặc định.** Chỉ thêm `'use client'` khi thực sự cần state, effect,
  hoặc event handler.
- **Không viết tay kiểu dữ liệu API.** Import từ `@cam/contracts`.
- **Không gọi `fetch` trực tiếp trong component.** Dùng `apiFetch` trong `lib/api-client.ts`
  — nơi duy nhất xử lý token, refresh và bọc lỗi.
- **Mọi trạng thái đều phải hiển thị được:** loading, empty, error. US-06 nói rõ
  "trạng thái rỗng thân thiện, không phải bảng trắng".

```tsx
if (isLoading) return <EventListSkeleton />;
if (error) return <ErrorState error={error} onRetry={refetch} />;
if (events.length === 0) return <EmptyState message="Chưa có sự kiện nào." />;
return <EventList events={events} />;
```

### Giao diện

- Tiếng Việt toàn bộ, có dấu đầy đủ.
- Thời gian hiển thị tương đối ("3 phút trước") — tuyệt đối khi hover.
- Responsive từ 360px (NFR-10). Test bằng DevTools ở chế độ iPhone SE.
- Màu theo mức ưu tiên phải nhất quán: P0 đỏ, P1 cam, P2 vàng, P3 xám.
- Không dùng màu **một mình** để truyền đạt thông tin — luôn kèm chữ hoặc biểu tượng.

---

## 5. Python / FastAPI

### Cấu trúc

```
services/ai-service/app/
├── main.py
├── config.py                 # Settings (pydantic-settings)
├── routers/
│   ├── health.py
│   ├── face.py               # M1 — D phụ trách
│   ├── pose.py               # M2a — E phụ trách
│   └── fire.py               # M3 — D phụ trách
├── models/                   # schema Pydantic
├── services/                 # logic suy luận
│   ├── face_matcher.py
│   ├── fall_tracker.py
│   └── fire_detector.py
└── utils/
```

> **Chia file theo module là có chủ ý:** D và E sửa file khác nhau nên hầu như không
> gặp xung đột merge.

### Quy tắc

- **Type hint bắt buộc** ở mọi hàm public. `mypy` bật `disallow_untyped_defs`.
- **Pydantic cho mọi request/response.** Không trả `dict` trần.
- **Không đọc `os.environ` rải rác.** Dùng `get_settings()`.
- **Lỗi suy luận trả `200` kèm `error != null`**, không trả `500` — để orchestrator vẫn ghi
  được sự kiện với `status = AI_FAILED` (US-10).

```python
@router.post("/face/match", response_model=MatchResponse)
async def match_face(image: UploadFile, event_id: UUID) -> MatchResponse:
    """So khớp khuôn mặt với danh sách người quen (US-10)."""
    settings = get_settings()

    try:
        embedding = extract_embedding(await image.read())
    except NoFaceDetectedError:
        # FR-DET-M1-04: không trích xuất được thì KHÔNG báo động
        return MatchResponse(
            person_status="UNDETERMINED",
            model_version=MODEL_VERSION,
            processed_at=datetime.now(timezone.utc),
            error=InferenceError(code="NO_FACE_DETECTED", message="Không thấy khuôn mặt"),
        )
    ...
```

### Cấm dùng

| Cấm                                      | Dùng thay thế                   |
| ---------------------------------------- | ------------------------------- |
| `print()`                                | `logging`                       |
| `except:` trần                           | `except <LoạiLỗiCụThể>:`        |
| Mutable default argument (`def f(x=[])`) | `def f(x: list \| None = None)` |
| Import `*`                               | Import tường minh               |
| Đường dẫn model hard-code                | Biến môi trường                 |

---

## 6. SQL

### Định dạng

```sql
-- Từ khóa VIẾT HOA, tên bảng/cột viết thường
SELECT e.id,
       e.event_type,
       c.name AS camera_name
FROM events e
LEFT JOIN cameras c ON c.id = e.camera_id
WHERE e.status = 'NOTIFIED'
  AND e.detected_at >= now() - interval '1 hour'
ORDER BY e.detected_at DESC
LIMIT 20;
```

### Quy tắc

- **Luôn dùng tham số hóa.** Không bao giờ nối chuỗi vào SQL.

  ```typescript
  // ❌ SQL injection
  `SELECT * FROM events WHERE camera_id = '${cameraId}'`;

  // ✅
  ('SELECT * FROM events WHERE camera_id = $1', [cameraId]);
  ```

- **`SELECT` liệt kê cột**, không `SELECT *` trong code production (query khám phá thì được).
- **Mọi `SELECT` trả danh sách phải có `LIMIT`.**
- Migration mới, không sửa migration cũ — xem [ERD.md § 7](../database/ERD.md#7-quy-trình-thay-đổi-schema).

---

## 7. Xử lý lỗi và log

### Log có cấu trúc, luôn kèm `correlationId`

```typescript
// ❌ Không tra được, không biết sự kiện nào
this.logger.log('Gửi thất bại');

// ✅
this.logger.error(
  {
    correlationId: event.correlationId,
    eventId: event.id,
    channel: 'TELEGRAM',
    attempt: 3,
    err: error,
  },
  'Gửi Telegram thất bại sau 3 lần thử',
);
```

Không có `correlationId` thì khi hệ thống chạy, câu hỏi "tại sao cảnh báo lúc 14:20 không tới"
sẽ không có cách nào trả lời (FR-LOG-02).

### Mức log

| Mức          | Dùng khi                     | Ví dụ                                 |
| ------------ | ---------------------------- | ------------------------------------- |
| `error`      | Cần người xem ngay           | Không kết nối được DB                 |
| `warn`       | Bất thường nhưng đã tự xử lý | Rekognition lỗi, đã fallback về local |
| `log`/`info` | Mốc nghiệp vụ quan trọng     | Sự kiện chuyển sang ESCALATED         |
| `debug`      | Chi tiết khi gỡ lỗi          | Payload MQTT thô                      |

Không log ở mức `info` trong vòng lặp chạy mỗi frame — 5 fps × 3 camera = 15 dòng/giây,
log sẽ ngập và che mất thứ quan trọng.

### Tuyệt đối không log

- Mật khẩu, token, API key (NFR-09)
- `rtsp_url` đầy đủ (có credential camera)
- Face embedding
- Ảnh dạng base64

### Exception filter toàn cục

Mọi lỗi lọt ra ngoài đều bị bắt bởi một filter duy nhất, biến thành định dạng `ErrorResponse`
chuẩn kèm `traceId`. Controller không tự bắt lỗi rồi tự tạo response lỗi riêng.

---

## 8. Cấu hình và secret

### Quy tắc

1. **Mọi cấu hình đọc từ biến môi trường.** Không có `config.json` chứa giá trị theo môi trường.
2. **`.env` không bao giờ được commit.** Chỉ commit `.env.example` với giá trị giả.
3. **Mỗi biến mới phải được thêm vào `.env.example`** trong cùng PR.
4. **Không có giá trị mặc định cho secret.** Thiếu `JWT_SECRET` thì app phải **từ chối khởi động**,
   không được lặng lẽ dùng `"secret"`.

```typescript
// ✅ Sai cấu hình thì biết ngay lúc khởi động, không phải lúc demo
const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
```

### Trước khi commit

```bash
git diff --staged | grep -iE '(password|secret|token|api[_-]?key).*=.*[a-z0-9]{12,}'
```

Nếu có kết quả — dừng lại và kiểm tra. NFR-09 yêu cầu **0 lần** secret lọt vào repo.

---

## 9. Viết test

### Kim tự tháp

```
        /\        E2E (Playwright) — 3 kịch bản, chỉ Sprint 3-4
       /  \
      /----\      Integration — MQTT → DB → Storage, mỗi sprint
     /      \
    /--------\    Unit — logic nghiệp vụ, MỖI PR
```

### Bắt buộc phải có unit test

- Escalation state machine (US-13) — **quan trọng nhất trong toàn hệ thống**
- Tính `dedup_key`
- Logic so sánh ngưỡng
- Logic xác nhận té ngã
- Quy đổi tọa độ polygon chuẩn hóa ↔ pixel
- Hàm tính thời gian retry

### Không cần test

- Getter/setter thuần
- Controller chỉ gọi thẳng service
- Code sinh tự động

### Tên test viết bằng tiếng Việt, mô tả hành vi

```typescript
describe('EscalationEngine', () => {
  it('chuyển sang LOGGED_ONLY khi confidence dưới T_low', () => {});
  it('bỏ qua LOGGED_ONLY với sự kiện cháy bất kể confidence', () => {});
  it('chỉ chấp nhận lần xác nhận đầu tiên, lần sau trả ALREADY_CONFIRMED', () => {});
  it('khôi phục hẹn giờ từ DB sau khi restart', () => {});
});
```

### Mẫu AAA

```typescript
it('chuyển sang ESCALATED khi hết T_wait mà không có phản hồi', async () => {
  // Arrange
  const event = taoSuKienMau({
    status: 'NOTIFIED',
    escalationDeadlineAt: subSeconds(new Date(), 1),
  });

  // Act
  await engine.kiemTraQuaHan();

  // Assert
  expect(await repo.find(event.id)).toMatchObject({ status: 'ESCALATED' });
  expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ escalationLevel: 1 }));
});
```

### Coverage

Mục tiêu **≥ 60%** cho business logic (NFR-07). Đây là ngưỡng CI sẽ chặn nếu tụt xuống dưới.

Nhưng con số không phải mục đích: 100% coverage với toàn test vô nghĩa còn tệ hơn 50%
với test đúng chỗ. Ưu tiên phủ **state machine** và **logic ngưỡng** trước.

---

## 10. Viết comment

### Comment giải thích **tại sao**, không phải **cái gì**

```typescript
// ❌ Lặp lại đúng những gì code đã nói
// Tăng attemptCount lên 1
notification.attemptCount += 1;

// ✅ Giải thích quyết định thiết kế
// Ghi deadline xuống DB thay vì dùng setTimeout: service restart lúc 2 giờ sáng
// sẽ làm mất toàn bộ cảnh báo đang chờ (FR-ESC-07, NFR-05).
event.escalationDeadlineAt = addSeconds(new Date(), rule.tWaitSeconds);
```

### Comment tham chiếu yêu cầu

Khi code hiện thực một yêu cầu cụ thể, ghi mã vào — người sau đọc sẽ biết tra ở đâu:

```typescript
// FR-DET-M1-04: UNDETERMINED (quay lưng, quá tối) KHÔNG sinh cảnh báo,
// nếu không hệ thống sẽ spam mỗi lần người nhà quay lưng vào camera.
if (result.personStatus === 'UNDETERMINED') {
  return { status: 'LOGGED_ONLY' };
}
```

### TODO phải có chủ và có hạn

```typescript
// ❌ Sẽ nằm đó đến ngày bảo vệ
// TODO: xử lý sau

// ✅
// TODO(B, Sprint 3): thay quét tuần tự bằng index pgvector khi known_faces > 100.
// Hiện tại ~20 bản ghi nên O(n) là đủ nhanh.
```

---

## 11. Công cụ tự động

### Cài một lần

```bash
pnpm install          # cài dependency JS + husky hook
pnpm setup:ai         # tạo venv + cài dependency Python
```

### Chạy trước khi mở PR

```bash
pnpm check:all        # chạy hết: Prettier, ESLint, TS, test, OpenAPI, ruff, pytest
```

Hoặc từng phần:

```bash
pnpm format           # Prettier tự sửa
pnpm lint             # ESLint
pnpm typecheck        # TypeScript
pnpm test             # Jest + Vitest
pnpm api:lint         # OpenAPI

pnpm lint:ai:fix      # ruff check --fix
pnpm format:ai        # ruff format
pnpm test:ai          # pytest
```

> `ruff` và `pytest` chỉ nằm trong venv, không có trên PATH. Các script `pnpm *:ai`
> tự tìm Python trong venv nên chạy được ở mọi shell mà không cần activate —
> xem [DEV_ONBOARDING.md](../DEV_ONBOARDING.md#kiểm-tra-tất-cả-chạy-được).

### Git hook tự động

| Hook         | Làm gì                                          |
| ------------ | ----------------------------------------------- |
| `pre-commit` | `lint-staged`: format + lint file đang commit   |
| `commit-msg` | `commitlint`: kiểm tra định dạng commit message |

Hook hỏng hoặc chậm thì báo với C để sửa. **Không dùng `--no-verify` để đi vòng** —
hook tồn tại để CI không đỏ vì những lỗi nhặt được trong 2 giây.

### Cấu hình ở đâu

| Công cụ              | File                                                                             |
| -------------------- | -------------------------------------------------------------------------------- |
| ESLint               | [`packages/eslint-config/node.mjs`](../../packages/eslint-config/node.mjs)       |
| Prettier             | [`.prettierrc.json`](../../.prettierrc.json)                                     |
| Ruff + mypy + pytest | [`services/ai-service/pyproject.toml`](../../services/ai-service/pyproject.toml) |
| commitlint           | [`commitlint.config.cjs`](../../commitlint.config.cjs)                           |
| EditorConfig         | [`.editorconfig`](../../.editorconfig)                                           |

### Gợi ý cho VS Code

Cài: **ESLint**, **Prettier**, **Ruff**, **EditorConfig**, **Docker**, **Mermaid Preview**.

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.codeActionsOnSave": { "source.fixAll.ruff": "explicit" }
  },
  "files.eol": "\n"
}
```

> **Windows:** đặt `files.eol` là `\n`. Xem thêm phần xử lý CRLF trong
> [GIT_WORKFLOW.md](GIT_WORKFLOW.md).

---

## Xem tiếp

- [Quy trình Git và mẫu PR](GIT_WORKFLOW.md)
- [Kiến trúc C4](../architecture/C4_ARCHITECTURE.md)
- [Hợp đồng API](../api/API_GUIDE.md)
