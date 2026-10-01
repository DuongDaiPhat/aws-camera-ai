# Ke Hoach & Ket Qua Kiem Thu US-11: Event AI Labels

**Ma User Story:** US-11<br />
**Nhanh:** `feat/US-11-event-ai-labels`<br />
**Pham vi:** nhan ket qua AI tu M1/M4, hop nhat projection vao event, cap nhat UI, va ban giao dung sang US-13 escalation.

---

## 1. Muc Tieu Kiem Thu

1. **Nhan ket qua AI tu producer that:**
   - M1_FACE tu AI service phan loai `KNOWN`, `UNKNOWN`, `UNDETERMINED`.
   - M4_ZONE tu Frigate/zone producer phan loai `RESTRICTED_ZONE`.
   - Khong dung mock callback de nghiem thu luong chinh.
2. **Luu projection vao PostgreSQL:**
   - `events.ai_label`, `events.confidence`, `events.person_status`, `events.matched_known_face_id`, `events.ai_processed_at`, `events.aggregate_version`.
   - `events.ai_results` giu du ket qua tung module va metadata nguon.
3. **Hop nhat ket qua da module:**
   - M1 khong nhan dien duoc mat khong duoc bien thanh loi ky thuat.
   - M1 `UNDETERMINED`/`KNOWN` khong duoc che mat canh bao doc lap tu M4.
   - M4 `RESTRICTED_ZONE` du dieu kien phai nang event theo rule US-13.
4. **Idempotency va thu tu xu ly:**
   - Replay cung payload khong tao ket qua trung.
   - Cung `resultId` nhung payload khac phai bi tu choi.
   - Revision cu phai bi danh dau `STALE_REVISION` va khong ghi de projection moi.
5. **Hien thi Dashboard:**
   - Chi tiet su kien hien dung loai su kien, do tin cay AI, nhan dien nguoi, nguoi quen khop, mo hinh, thoi diem AI xu ly.
   - Trang thai hien tai phan anh ket qua escalation sau khi US-11 ban giao sang US-13.

---

## 2. Ma Tran Kiem Thu Tu Dong

| Khu vuc / Module                                | Lenh / File test                                                                                                                         | Ket qua                                |
| :---------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------- |
| AI service face matching                        | `node tools/scripts/py.mjs pytest`                                                                                                       | 31 pass; coverage 94.34%               |
| Worker + validator + aggregator + zone producer | `face-recognition.worker.spec.ts`, `ai-result.validator.spec.ts`, `ai-result.aggregator.spec.ts`, `zone-result-producer.service.spec.ts` | 38 pass                                |
| PostgreSQL integration                          | `apps/orchestrator/test/ai-results-db.integration.spec.ts`                                                                               | 23 pass                                |
| Orchestrator typecheck                          | `pnpm --filter @cam/orchestrator typecheck`                                                                                              | Pass                                   |
| Contracts                                       | `pnpm --filter @cam/contracts build`                                                                                                     | Pass                                   |
| API lint                                        | `pnpm api:lint`                                                                                                                          | Pass; con 3 warning co san ngoai US-11 |

Lenh chay nhanh:

```powershell
pnpm --filter @cam/contracts build
pnpm test:ai
pnpm --filter @cam/orchestrator exec jest --runInBand --runTestsByPath test/face-recognition.worker.spec.ts test/ai-result.validator.spec.ts test/ai-result.aggregator.spec.ts test/zone-result-producer.service.spec.ts
pnpm --filter @cam/orchestrator exec jest --runInBand --runTestsByPath test/ai-results-db.integration.spec.ts --testRegex '.*\.integration\.spec\.ts$'
pnpm --filter @cam/orchestrator typecheck
```

---

## 3. Chuan Bi Moi Truong E2E

1. Dam bao `.env` co cau hinh toi thieu:

```env
FACE_PROVIDER=local
FACE_MATCH_THRESHOLD=0.60
INTERNAL_SERVICE_TOKEN=dev-internal-token-change-me-at-least-32
FACE_MODEL_VERSION=yunet-2023mar-sface-2021dec
FACE_DETECTOR_PATH=models/face_detection_yunet_2023mar.onnx
FACE_EMBEDDER_PATH=models/face_recognition_sface_2021dec.onnx
```

2. Khoi dong dich vu:

```powershell
docker compose --profile cv up -d
docker compose restart ai-service orchestrator web
docker compose ps
curl.exe http://localhost:3001/api/v1/health
```

3. Mo Dashboard:

```text
http://localhost:3000
```

4. Dam bao camera dang bat detection va Frigate da dong bo zone.

---

## 4. Kich Ban Kiem Thu E2E

### Kich ban 1: M1 nhan dien nguoi quen `KNOWN`

1. Dang ky mot nguoi quen hop le o man hinh **Nguoi quen**.
2. Doi collection sync xong.
3. Dung truoc camera voi mat ro.
4. Mo su kien moi nhat tren Dashboard.

Ket qua mong doi:

- **Nhan dien nguoi:** `Nguoi quen`.
- **Nguoi quen khop:** hien dung ten da dang ky.
- **Do tin cay AI:** lon hon `FACE_MATCH_THRESHOLD`.
- **Trang thai hien tai:** `Chi ghi nhan` / `LOGGED_ONLY`.
- Khong tao notification vi day la nguoi quen.

Bang chung da kiem:

| Truong                       | Gia tri                                |
| :--------------------------- | :------------------------------------- |
| `track_id`                   | `1790668598.324929-2wyw54`             |
| `event_id`                   | `054b4fa5-e076-478c-9c6d-3f2f694911b6` |
| `person_status` / `ai_label` | `KNOWN` / `KNOWN`                      |
| `matched_known_face`         | `Nhan`                                 |
| `confidence`                 | `0.735382080078125`                    |
| `status` / `priority`        | `LOGGED_ONLY` / `P3`                   |
| Notification                 | `0`                                    |

### Kich ban 2: M1 nhan dien nguoi la `UNKNOWN`

1. Cho nguoi chua dang ky vao khung hinh.
2. Doi event moi duoc tao va AI xu ly.
3. Mo chi tiet su kien tren Dashboard.

Ket qua mong doi:

- **Nhan dien nguoi:** `Nguoi la`.
- **Nguoi quen khop:** `Khong`.
- Confidence bang `1 - similarity`.
- Event duoc US-13 danh gia theo rule `UNKNOWN_PERSON`.

Bang chung da kiem:

| Truong                       | Gia tri                                                 |
| :--------------------------- | :------------------------------------------------------ |
| `track_id`                   | `1790665902.323126-xtawab`                              |
| `event_id`                   | `df9c89ea-a7fd-4e42-ae1a-1d4a9bc6f20a`                  |
| `person_status` / `ai_label` | `UNKNOWN` / `UNKNOWN`                                   |
| `similarity`                 | `0.36421969532966614`                                   |
| `confidence`                 | `0.6357803046703339`                                    |
| `status` / `priority`        | `ESCALATED` / `P2`                                      |
| Outbox                       | `event.updated` va `evaluate-escalation` da `PROCESSED` |

### Kich ban 3: M1 khong du chat luong `UNDETERMINED`

1. Tao event co nguoi nhung mat bi lech, mat bi cat, hoac khong thay ro mat.
2. Cho AI service xu ly anh crop that.
3. Mo chi tiet su kien.

Ket qua mong doi:

- `NO_FACE_DETECTED` hoac `MULTIPLE_FACES` khong bi tinh la loi ky thuat.
- `person_status = UNDETERMINED`, confidence null.
- Event khong tao canh bao neu khong co module nguy co khac.

Bang chung da kiem:

| Truong                       | Gia tri                                |
| :--------------------------- | :------------------------------------- |
| `track_id`                   | `1790666098.987664-ou4ue5`             |
| `event_id`                   | `666713c5-0404-48b8-aa84-479ff94faf16` |
| `person_status` / `ai_label` | `UNDETERMINED` / `UNDETERMINED`        |
| `qualityReason`              | `NO_FACE_DETECTED`                     |
| `confidence`                 | `NULL`                                 |
| `status` / `priority`        | `LOGGED_ONLY` / `P3`                   |
| Notification                 | `0`                                    |

### Kich ban 4: M1 + M4 cung event

1. Bat camera co cau hinh zone.
2. Dat diem day giua bounding box nguoi nam trong zone cam.
3. Tao event moi co ca ket qua M1 va M4.
4. Mo chi tiet su kien va doi chieu DB.

Ket qua mong doi:

- M1 co the `UNDETERMINED` nhung khong chan M4.
- M4 `RESTRICTED_ZONE` phai la ket qua dai dien neu co muc uu tien cao hon.
- Event chuyen P1 theo rule US-13.
- `ai_results` van giu du ca M1 va M4.

Bang chung da kiem:

| Truong              | Gia tri                                                 |
| :------------------ | :------------------------------------------------------ |
| `track_id`          | `1790668023.49604-41vzms`                               |
| `event_id`          | `f4c30904-44a5-4ab5-94fe-5456dd90db55`                  |
| M1                  | `UNDETERMINED`, `NO_FACE_DETECTED`, confidence `NULL`   |
| M4                  | `RESTRICTED_ZONE`, confidence `0.7957610487937927`      |
| Projection dai dien | `RESTRICTED_ZONE` / `P1`                                |
| `aggregate_version` | `8`                                                     |
| Outbox              | `evaluate-escalation` va `event.updated` da `PROCESSED` |

---

## 5. Lenh Doi Chieu PostgreSQL

Lay cac event moi nhat:

```powershell
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT id, track_id, event_type, status, priority, person_status, ai_label, confidence, matched_known_face_id, ai_model_version, ai_processed_at, aggregate_version FROM events ORDER BY created_at DESC LIMIT 10;"
```

Kiem tra mot track cu the:

```powershell
$trackId = "1790668023.49604-41vzms"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT id, track_id, event_type, status, priority, person_status, ai_label, confidence, ai_model_version, ai_processed_at, aggregate_version FROM events WHERE track_id = '$trackId';"
```

Kiem tra cac module trong `ai_results`:

```powershell
$trackId = "1790668023.49604-41vzms"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT a.module, a.label, a.status, a.confidence, a.error->>'code' AS error_code, a.metadata->>'qualityReason' AS quality_reason, a.metadata->>'thresholdUsed' AS threshold_used, a.metadata->>'zoneSlug' AS zone_slug FROM events e CROSS JOIN LATERAL jsonb_to_recordset(e.ai_results) AS a(module text, label text, status text, confidence numeric, error jsonb, metadata jsonb) WHERE e.track_id = '$trackId';"
```

Kiem tra outbox:

```powershell
$eventId = "f4c30904-44a5-4ab5-94fe-5456dd90db55"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT message_type, status, attempt_count, aggregate_version, last_error FROM outbox_messages WHERE event_id = '$eventId' ORDER BY created_at;"
```

Kiem tra lich su trang thai:

```powershell
$eventId = "f4c30904-44a5-4ab5-94fe-5456dd90db55"
docker compose exec -T postgres psql -U camerai -d camerai -c "SELECT from_status, to_status, reason, actor_type, created_at FROM event_status_history WHERE event_id = '$eventId' ORDER BY created_at;"
```

---

## 6. Ket Luan Kiem Thu

US-11 da co bang chung E2E that cho cac luong cot loi:

- M1 `KNOWN` cap nhat dung nguoi quen va khong tao canh bao.
- M1 `UNKNOWN` cap nhat dung nhan nguoi la va kich hoat danh gia escalation.
- M1 `UNDETERMINED` khong bi xem la loi ky thuat va khong tao canh bao sai.
- M1 + M4 tren cung event van hop nhat dung; M4 `RESTRICTED_ZONE` co uu tien cao hon va duoc chuyen sang US-13.
- UI hien thi dung cac truong AI chinh va trang thai sau escalation.

Co the dung tai lieu nay lam bang chung test US-11 truoc khi review/merge nhanh, voi dieu kien cac test tu dong o muc 2 van pass tren may nguoi review.
