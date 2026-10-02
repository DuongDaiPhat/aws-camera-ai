# Coding Conventions

> **Task 0.9** · Owner: **B** (Scrum Master) · Sprint 0  
> Conventions verifiable by automated tools are configured in ESLint / Prettier / Ruff.  
> This document explains the architectural principles, standards, and rules that tools **cannot** automatically verify.

## Table of Contents

- [1. General Principles](#1-general-principles)
- [2. Naming Conventions](#2-naming-conventions)
- [3. TypeScript / NestJS](#3-typescript--nestjs)
- [4. TypeScript / Next.js](#4-typescript--nextjs)
- [5. Python / FastAPI](#5-python--fastapi)
- [6. SQL](#6-sql)
- [7. Error Handling & Logging](#7-error-handling--logging)
- [8. Configuration & Secrets](#8-configuration--secrets)
- [9. Testing Guidelines](#9-testing-guidelines)
- [10. Commenting Guidelines](#10-commenting-guidelines)
- [11. Automated Tooling](#11-automated-tooling)

---

## 1. General Principles

### GP-1 · Readers Are More Important Than Writers

Code is read far more often than it is written. In a 5-member team with cross-reviews, every line of code will be read by at least two people. Write code so that the reader understands it immediately, even if it requires a few extra lines.

### GP-2 · Clarity Over Brevity

```typescript
// ❌ Short but forces the reader to pause and decipher
const e = evts.filter((x) => x.s === 'N' && x.d < now);

// ✅ Longer but immediately understandable in one pass
const overdueEvents = events.filter(
  (event) => event.status === 'NOTIFIED' && event.escalationDeadlineAt < now,
);
```

### GP-3 · No Magic Numbers

All thresholds, timeouts, and limits must be explicitly named and read from configuration.

```typescript
// ❌ What is 15? Who can change it?
if (immobileSeconds > 15) { ... }

// ✅ Self-explanatory and configurable
if (immobileSeconds > this.config.fallImmobilitySeconds) { ... }
```

This is not just aesthetics: Sprint 4 requires threshold tuning to minimize the False Alarm Rate (FAR) (US-29). Hardcoding values means modifying code, rebuilding, and redeploying in the final crunch week.

### GP-4 · Fail Loudly, Never Fail Silently

```typescript
// ❌ Error vanishes, nobody knows what happened
try {
  await this.telegram.send(msg);
} catch (e) {}

// ✅ Recorded for auditing, while escalation continues uninterrupted (FR-NOT-05)
try {
  await this.telegram.send(msg);
} catch (error) {
  this.logger.error(
    { correlationId, eventId, channel: 'TELEGRAM', err: error },
    'Failed to send Telegram notification',
  );
  await this.notificationRepo.markFailed(notificationId, error);
  // Do NOT rethrow — escalation countdown must continue
}
```

### GP-5 · Single Responsibility per Function

Functions exceeding 60 lines trigger an ESLint warning. Functions exceeding 100 lines almost certainly violate the Single Responsibility Principle.

---

## 2. Naming Conventions

### Language Guidelines

| Target                          | Language                      | Example                                             |
| :------------------------------ | :---------------------------- | :-------------------------------------------------- |
| Variable, function, class names | **English**                   | `escalationDeadline`, `findPendingEvents()`         |
| Code comments & documentation   | **English**                   | `// Only the first confirmation is authoritative`   |
| User-facing UI messages         | **Vietnamese** (or localized) | `"Không phát hiện được khuôn mặt"`                  |
| Internal logs & error messages  | **English**                   | `"Failed to send Telegram notification"`            |
| Commit messages                 | **English**                   | `feat(orchestrator): add timer recovery on restart` |
| SQL table & column names        | **English**                   | `events`, `detected_at`                             |
| SQL constraints & indexes       | **English**                   | `uq_confirmations_authoritative_per_phase`          |

### Casing Rules

| Type                        | Convention                   | Example                            |
| :-------------------------- | :--------------------------- | :--------------------------------- |
| Variable, function (TS)     | `camelCase`                  | `detectedAt`, `buildDedupKey()`    |
| Class, interface, type      | `PascalCase`                 | `EscalationEngine`, `EventSummary` |
| Outbound Port Interface     | `PascalCase` with `I` prefix | `IStorageService`, `IFaceService`  |
| Constant                    | `SCREAMING_SNAKE_CASE`       | `DEFAULT_PAGE_SIZE`                |
| Variable, function (Python) | `snake_case`                 | `match_face()`, `torso_angle_deg`  |
| Class (Python)              | `PascalCase`                 | `FallTracker`                      |
| TS filename                 | `kebab-case.<type>.ts`       | `escalation.service.ts`            |
| Python filename             | `snake_case.py`              | `fall_tracker.py`                  |
| React component filename    | `PascalCase.tsx`             | `EventCard.tsx`                    |
| SQL table                   | `snake_case` plural          | `events`, `known_faces`            |
| SQL column                  | `snake_case` singular        | `event_type`, `is_false_alarm`     |

### Semantic Naming Rules

| Prefix / Suffix              | Purpose                                  | Example                              |
| :--------------------------- | :--------------------------------------- | :----------------------------------- |
| `is`, `has`, `should`, `can` | Boolean                                  | `isFalseAlarm`, `hasSnapshot`        |
| `*At`                        | Timestamp                                | `detectedAt`, `escalationDeadlineAt` |
| `*Seconds`, `*Ms`            | Time duration — **always include units** | `tWaitSeconds`, `timeoutMs`          |
| `*Count`                     | Quantity / Counter                       | `attemptCount`, `sourceImageCount`   |
| `get*`                       | Retrieve data, throws if absent          | `getEvent(id)`                       |
| `find*`                      | Retrieve data, returns `null` if absent  | `findEventByTrackId(id)`             |
| `list*`                      | Return array / collection                | `listZonesByCamera(id)`              |

> **Always include the time unit in the variable name.** Does `timeout = 5` mean 5 seconds or 5 milliseconds?  
> `timeoutMs = 5000` is completely unambiguous.

---

## 3. TypeScript / NestJS

### Feature-Based Directory Structure

```
apps/orchestrator/src/
├── main.ts
├── app.module.ts
├── common/                      # Shared across the entire app
│   ├── decorators/
│   ├── filters/                 # Global exception filters
│   ├── guards/                  # RolesGuard, JwtAuthGuard
│   ├── interceptors/            # Logging, correlation-id
│   └── interfaces/              # IStorageService, IFaceService...
├── config/
├── events/                      # Feature module directory
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
├── storage/                     # MinIO / S3 adapter
└── health/
```

### Dependency Rules

```
Controller  →  Service  →  Repository  →  Database
                  ↓
              Interface  ←  Adapter
```

- **Controller**: Only receives requests, calls services, and returns responses. Zero business `if` statements.
- **Service**: Encapsulates all domain and business logic. Never import Express `Request`/`Response`.
- **Repository**: Only interacts with the database and converts between `snake_case` and `camelCase`.
- **Service must NOT import concrete adapter classes**:

```typescript
// ❌ Hardcoded to AWS S3; fails tests when AWS credentials are absent
import { S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class EventService {
  private s3 = new S3Client({ region: 'ap-southeast-1' });
}

// ✅ Switch providers via environment variables; easily mockable in tests
@Injectable()
export class EventService {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: IStorageService) {}
}
```

### DTOs and Validation

All inbound payloads must pass through a DTO validated with `class-validator`. Never use `any`.

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

`ValidationPipe` has `whitelist: true` and `forbidNonWhitelisted: true` enabled in `main.ts`: extraneous properties are rejected with an explicit error rather than silently ignored.

### Prohibited Practices

| Prohibited                           | Required Alternative                                            |
| :----------------------------------- | :-------------------------------------------------------------- |
| `any`                                | Concrete type, or `unknown` narrowed down                       |
| `console.log`                        | NestJS `Logger`                                                 |
| `@ts-ignore`                         | `@ts-expect-error` with an explanatory comment                  |
| `!` (non-null assertion) in logic    | Explicit null checking (`!` is only allowed in DTO definitions) |
| Scattered `process.env.X`            | `ConfigService`                                                 |
| `as` type assertion to bypass errors | Fix the underlying type properly                                |

### Asynchronous Operations

```typescript
// ❌ Unnecessary sequential calls — 3 consecutive roundtrips
const camera = await this.cameraRepo.find(id);
const zones = await this.zoneRepo.findByCamera(id);
const rules = await this.ruleRepo.findAll();

// ✅ Parallel execution when operations are independent
const [camera, zones, rules] = await Promise.all([
  this.cameraRepo.find(id),
  this.zoneRepo.findByCamera(id),
  this.ruleRepo.findAll(),
]);
```

Always `await` or explicitly handle promises. Dangling promises cause unhandled rejections and vanish without trace.

---

## 4. TypeScript / Next.js

### Structure

```
apps/web/src/
├── app/                      # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx              # Event list (US-06)
│   ├── events/[id]/page.tsx  # Event detail (US-21)
│   ├── known-faces/page.tsx  # Known faces management (US-09)
│   └── settings/page.tsx     # Escalation rule settings (US-15)
├── components/
│   ├── ui/                   # Buttons, cards, badges — purely visual
│   └── events/               # EventCard, EventFilter — domain-aware
├── hooks/
├── lib/
│   ├── api-client.ts
│   └── format.ts
└── types/
```

### Rules

- **Server Components by default.** Only add `'use client'` when state, effects, or event handlers are required.
- **Do not handwrite API types.** Always import generated types from `@cam/contracts`.
- **Do not invoke `fetch` directly in components.** Use `apiFetch` in `lib/api-client.ts` — the single source of truth for auth tokens, token refresh, and error wrapping.
- **All component states must be rendered:** loading, empty, and error states. US-06 requires "a friendly empty state, never a blank white page".

```tsx
if (isLoading) return <EventListSkeleton />;
if (error) return <ErrorState error={error} onRetry={refetch} />;
if (events.length === 0) return <EmptyState message="No events recorded yet." />;
return <EventList events={events} />;
```

### UI & UX

- Relative timestamps by default ("3 minutes ago") — show absolute timestamp on hover.
- Responsive starting at 360px width (NFR-10). Test with DevTools in iPhone SE mode.
- Consistent color coding by event priority: P0 Red, P1 Orange, P2 Yellow, P3 Gray.
- **Never rely on color alone** to convey information — always pair with text or an icon.

---

## 5. Python / FastAPI

### Structure

```
services/ai-service/app/
├── main.py
├── config.py                 # Settings (pydantic-settings)
├── routers/
│   ├── health.py
│   ├── face.py               # M1 — Face recognition (D)
│   ├── pose.py               # M2a — Pose & Fall detection (E)
│   └── fire.py               # M3 — Fire & Smoke detection (D)
├── models/                   # Pydantic schemas
├── services/                 # Inference engines
│   ├── face_matcher.py
│   ├── fall_tracker.py
│   └── fire_detector.py
└── utils/
```

> **Separation by module is deliberate:** Engineers D and E work on distinct files, virtually eliminating Git merge conflicts.

### Rules

- **Type hints are mandatory** on all public functions. `mypy` has `disallow_untyped_defs` enabled.
- **Pydantic models for all requests/responses.** Never return raw dictionaries.
- **No scattered `os.environ`.** Use `get_settings()`.
- **Inference failures return HTTP `200` with `error != null`**, never `500` — enabling Orchestrator to persist events with `status = AI_FAILED` (US-10).

```python
@router.post("/face/match", response_model=MatchResponse)
async def match_face(image: UploadFile, event_id: UUID) -> MatchResponse:
    """Match detected face against known face collection (US-10)."""
    settings = get_settings()

    try:
        embedding = extract_embedding(await image.read())
    except NoFaceDetectedError:
        # FR-DET-M1-04: If no face can be extracted, DO NOT trigger an alarm
        return MatchResponse(
            person_status="UNDETERMINED",
            model_version=MODEL_VERSION,
            processed_at=datetime.now(timezone.utc),
            error=InferenceError(code="NO_FACE_DETECTED", message="No face detected in crop"),
        )
    ...
```

### Prohibited Practices

| Prohibited                               | Required Alternative                               |
| :--------------------------------------- | :------------------------------------------------- |
| `print()`                                | Standard `logging`                                 |
| Bare `except:`                           | Catch specific exceptions: `except SpecificError:` |
| Mutable default argument (`def f(x=[])`) | `def f(x: list \| None = None)`                    |
| Wildcard import (`from x import *`)      | Explicit imports                                   |
| Hardcoded model file paths               | Read from environment variables / settings         |

---

## 6. SQL

### Formatting

```sql
-- UPPERCASE SQL keywords, lowercase table/column identifiers
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

### Rules

- **Always use parameterized queries.** Never concatenate strings into SQL queries.

  ```typescript
  // ❌ Vulnerable to SQL injection
  `SELECT * FROM events WHERE camera_id = '${cameraId}'`;

  // ✅ Secure parameterized query
  ('SELECT * FROM events WHERE camera_id = $1', [cameraId]);
  ```

- **Explicit column projection in `SELECT`**: Never use `SELECT *` in production code.
- **Every paginated query must include a `LIMIT` clause.**
- **Append new migrations; never edit historical migrations** (see [ERD.md § 7](../database/ERD.md#7-quy-trình-thay-đổi-schema)).

---

## 7. Error Handling & Logging

### Structured Logging with `correlationId`

```typescript
// ❌ Not traceable; cannot identify which event triggered the log
this.logger.log('Failed to send');

// ✅ Fully structured and searchable across log aggregators
this.logger.error(
  {
    correlationId: event.correlationId,
    eventId: event.id,
    channel: 'TELEGRAM',
    attempt: 3,
    err: error,
  },
  'Failed to send Telegram notification after 3 attempts',
);
```

Without `correlationId`, diagnosing "why an alert at 14:20 was not delivered" in production is impossible (FR-LOG-02).

### Log Levels

| Level          | When to Use                        | Example                                     |
| :------------- | :--------------------------------- | :------------------------------------------ |
| `error`        | Requires immediate human attention | Database connection failure                 |
| `warn`         | Abnormal state handled by fallback | Rekognition error, fell back to local model |
| `log` / `info` | Key business milestones            | Event transitioned to `ESCALATED`           |
| `debug`        | Detailed troubleshooting info      | Raw MQTT message payload                    |

Never log at `info` level inside per-frame processing loops — 5 fps × 3 cameras = 15 log lines/sec, which floods logs and conceals critical events.

### Strictly Prohibited in Logs

- Passwords, JWT secrets, auth tokens, API keys (NFR-09)
- Full `rtsp_url` strings containing camera credentials
- Raw face embedding vectors
- Base64-encoded image payloads

### Global Exception Filter

All unhandled exceptions are intercepted by a single global filter that maps them to a canonical `ErrorResponse` schema with a `traceId`. Controllers must not catch unexpected errors to format custom responses.

---

## 8. Configuration & Secrets

### Rules

1. **All configurations are read from environment variables.** No hardcoded configuration files.
2. **Never commit `.env`.** Only commit `.env.example` with sanitized placeholder values.
3. **Every new environment variable must be documented in `.env.example`** within the same PR.
4. **No fallback default values for secrets.** Missing `JWT_SECRET` must cause the app to **fail fast and refuse to start**, rather than silently using `"secret"`.

```typescript
// ✅ Misconfiguration is caught immediately upon startup, not during the demo
const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
```

### Pre-Commit Leak Check

```bash
git diff --staged | grep -iE '(password|secret|token|api[_-]?key).*=.*[a-z0-9]{12,}'
```

If matches appear, abort immediately. NFR-09 requires **0 leaked secrets** in the repository history.

---

## 9. Testing Guidelines

### Testing Pyramid

```
        /\        E2E (Playwright) — 3 golden scenarios (Sprint 3-4)
       /  \
      /----\      Integration — MQTT → DB → Storage (Every Sprint)
     /      \
    /--------\    Unit — Domain & Business logic (EVERY PR)
```

### Mandatory Unit Test Coverage

- Escalation state machine (US-13) — **the most critical engine in the system**
- `dedup_key` calculation algorithms
- Threshold comparison and boundary policies
- Fall immobility verification logic
- Normalized coordinate polygon ↔ pixel translation
- Exponential backoff and retry calculation functions

### Tests Not Required

- Trivial getters / setters
- Passthrough controllers that merely forward calls to services
- Automatically generated contract code

### Test Naming: Clear Behavioral Specification

```typescript
describe('EscalationEngine', () => {
  it('transitions to LOGGED_ONLY when confidence is below T_low', () => {});
  it('bypasses LOGGED_ONLY for FIRE_SMOKE events regardless of confidence', () => {});
  it('only accepts the first authoritative confirmation, subsequent return ALREADY_CONFIRMED', () => {});
  it('recovers pending deadlines from database upon restart', () => {});
});
```

### AAA Pattern (Arrange - Act - Assert)

```typescript
it('transitions to ESCALATED when T_wait expires without response', async () => {
  // Arrange
  const event = createMockEvent({
    status: 'NOTIFIED',
    escalationDeadlineAt: subSeconds(new Date(), 1),
  });

  // Act
  await engine.checkOverdueDeadlines();

  // Assert
  expect(await repo.find(event.id)).toMatchObject({ status: 'ESCALATED' });
  expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ escalationLevel: 1 }));
});
```

### Code Coverage

Target is **≥ 60%** for core business logic (NFR-07). CI will fail if coverage drops below this baseline.  
Prioritize testing the **state machine transitions** and **threshold evaluations**.

---

## 10. Commenting Guidelines

### Explain the "Why", Not the "What"

```typescript
// ❌ Redundant: merely restates what the code already says
// Increment attemptCount by 1
notification.attemptCount += 1;

// ✅ Explains the architectural design decision
// Persist deadline directly in PostgreSQL instead of relying on in-memory setTimeout:
// a service restart at 2 AM would otherwise drop all pending alerts (FR-ESC-07, NFR-05).
event.escalationDeadlineAt = addSeconds(new Date(), rule.tWaitSeconds);
```

### Reference Requirements

When implementing specific functional requirements, include the requirement code:

```typescript
// FR-DET-M1-04: UNDETERMINED (subject turned away or underexposed) does NOT trigger an alarm;
// otherwise, family members turning their backs to the camera would spam notifications.
if (result.personStatus === 'UNDETERMINED') {
  return { status: 'LOGGED_ONLY' };
}
```

### TODOs Must Have an Owner and Milestone

```typescript
// ❌ Abandoned indefinitely
// TODO: fix later

// ✅ Actionable with clear scope and rationale
// TODO(B, Sprint 3): Replace sequential scan with pgvector index when known_faces exceeds 100.
// Currently ~20 records, so O(n) scan is sub-millisecond.
```

---

## 11. Automated Tooling

### Initial Setup

```bash
pnpm install          # Install JS dependencies + Husky hooks
pnpm setup:ai         # Create virtualenv + install Python dependencies
```

### Pre-PR Quality Check

```bash
pnpm check:all        # Runs everything: Prettier, ESLint, TS, tests, OpenAPI, Ruff, Pytest
```

Or run targeted checks:

```bash
pnpm format           # Auto-format with Prettier
pnpm lint             # ESLint
pnpm typecheck        # TypeScript
pnpm test             # Jest + Vitest
pnpm api:lint         # OpenAPI spec linting

pnpm lint:ai:fix      # Ruff check --fix
pnpm format:ai        # Ruff format
pnpm test:ai          # Pytest
```

### Git Hooks

| Hook         | Action                                                  |
| :----------- | :------------------------------------------------------ |
| `pre-commit` | Runs `lint-staged`: format + lint staged files          |
| `commit-msg` | Runs `commitlint`: enforces Conventional Commits format |

Never bypass hooks with `--no-verify`. Hooks exist to prevent CI failures from trivial formatting mistakes.

### Tooling Configuration Map

| Tool                 | Configuration File                                                               |
| :------------------- | :------------------------------------------------------------------------------- |
| ESLint               | [`packages/eslint-config/node.mjs`](../../packages/eslint-config/node.mjs)       |
| Prettier             | [`.prettierrc.json`](../../.prettierrc.json)                                     |
| Ruff + mypy + pytest | [`services/ai-service/pyproject.toml`](../../services/ai-service/pyproject.toml) |
| commitlint           | [`commitlint.config.cjs`](../../commitlint.config.cjs)                           |
| EditorConfig         | [`.editorconfig`](../../.editorconfig)                                           |

---

## Further Reading

- [Git Workflow and PR Guidelines](GIT_WORKFLOW.md)
- [C4 Architecture](../architecture/C4_ARCHITECTURE.md)
- [API Contract Guide](../api/API_GUIDE.md)
