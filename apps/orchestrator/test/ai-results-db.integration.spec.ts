import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import {
  AiResultIdempotencyConflictError,
  AiResultsRepository,
} from '../src/ai-results/ai-results.repository';
import type {
  AiResultProjectionItem,
  ValidatedAiResultSubmission,
} from '../src/ai-results/ai-result.types';
import { DatabaseService } from '../src/database/database.service';
import { EventsRepository } from '../src/events/events.repository';

const POSTGRES_PORT = 5432;
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

interface FixtureIds {
  eventId: string;
  cameraId: string;
  zoneId: string;
}

interface AggregateRow {
  event_type: string;
  status: string;
  priority: string;
  confidence: string | null;
  detection_confidence: string;
  ai_label: string | null;
  ai_results: AiResultProjectionItem[];
  aggregate_version: string;
}

async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDirectory = resolve(__dirname, '../../../db/migrations');
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  for (const migrationFile of migrationFiles) {
    await pool.query(await readFile(resolve(migrationsDirectory, migrationFile), 'utf8'));
  }
}

async function seedFixture(pool: Pool): Promise<FixtureIds> {
  const ownerId = randomUUID();
  const deviceId = randomUUID();
  const cameraId = randomUUID();
  const zoneId = randomUUID();
  const eventId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, 'ADMIN');`,
    [ownerId, 'us11@example.test', 'test-password-hash', 'US-11 Owner'],
  );
  await pool.query(
    `INSERT INTO devices (id, owner_user_id, name, status)
     VALUES ($1, $2, $3, 'ONLINE');`,
    [deviceId, ownerId, 'US-11 Gateway'],
  );
  await pool.query(
    `INSERT INTO cameras (id, device_id, name, slug, rtsp_url)
     VALUES ($1, $2, $3, $4, $5);`,
    [cameraId, deviceId, 'Phòng khách', 'cam_us11', 'rtsp://mediamtx:8554/cam_us11'],
  );
  await pool.query(
    `INSERT INTO zones (
       id, camera_id, name, slug, zone_type, polygon, min_dwell_seconds
     ) VALUES ($1, $2, $3, $4, 'RESTRICTED', $5, 2);`,
    [
      zoneId,
      cameraId,
      'Bếp',
      'restricted_kitchen',
      JSON.stringify([
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
      ]),
    ],
  );
  await pool.query(
    `INSERT INTO events (
       id, camera_id, zone_id, event_type, status, priority, source,
       track_id, dedup_key, confidence, detection_confidence, detected_at
     ) VALUES ($1, $2, $3, 'PERSON_DETECTED', 'DETECTED', 'P3', 'FRIGATE',
               $4, $5, NULL, 0.900, now());`,
    [eventId, cameraId, zoneId, 'track-us11', 'frigate:cam_us11:track-us11'],
  );
  return { eventId, cameraId, zoneId };
}

function hash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function item(
  submission: Pick<
    ValidatedAiResultSubmission,
    'resultId' | 'observationId' | 'revision' | 'module' | 'modelVersion' | 'processedAt'
  >,
  label: string,
  confidence: number,
  metadata: Record<string, unknown>,
): AiResultProjectionItem {
  return {
    ...submission,
    label,
    confidence,
    status: 'SUCCESS',
    error: null,
    boundingBox: null,
    metadata,
  };
}

function faceSubmission(eventId: string, revision = 1): ValidatedAiResultSubmission {
  const identity = {
    resultId: randomUUID(),
    observationId: 'face-observation',
    revision,
    module: 'M1_FACE' as const,
    modelVersion: 'face-v1',
    processedAt: `2026-09-23T10:00:0${revision}.000Z`,
  };
  return {
    schemaVersion: 1,
    ...identity,
    requestId: randomUUID(),
    eventId,
    personStatus: 'UNKNOWN',
    matchedKnownFaceId: null,
    results: [item(identity, 'UNKNOWN', 0.85, { similarity: 0.15 })],
    error: null,
  };
}

function zoneSubmission(ids: FixtureIds): ValidatedAiResultSubmission {
  const identity = {
    resultId: randomUUID(),
    observationId: 'zone-observation',
    revision: 1,
    module: 'M4_ZONE' as const,
    modelVersion: 'frigate-zone-v1',
    processedAt: '2026-09-23T10:00:02.000Z',
  };
  return {
    schemaVersion: 1,
    ...identity,
    requestId: null,
    eventId: ids.eventId,
    personStatus: null,
    matchedKnownFaceId: null,
    results: [
      item(identity, 'RESTRICTED_ZONE', 0.7, {
        zoneId: ids.zoneId,
        cameraId: ids.cameraId,
        trackId: 'track-us11',
      }),
    ],
    error: null,
  };
}

describe('US-11 - AI result đến PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let repository: AiResultsRepository;
  let eventsRepository: EventsRepository;
  let ids: FixtureIds;

  jest.setTimeout(CONTAINER_STARTUP_TIMEOUT_MS);

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'camerai_test',
        POSTGRES_USER: 'camerai_test',
        POSTGRES_PASSWORD: 'camerai_test_password',
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(POSTGRES_PORT),
      database: 'camerai_test',
      user: 'camerai_test',
      password: 'camerai_test_password',
      max: 5,
    });
    await runMigrations(pool);
    repository = new AiResultsRepository(new DatabaseService(pool));
    eventsRepository = new EventsRepository(pool);
  });

  beforeEach(async () => {
    await pool.query(
      'DELETE FROM events; DELETE FROM zones; DELETE FROM cameras; DELETE FROM devices; DELETE FROM users;',
    );
    ids = await seedFixture(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('serialize M1 và M4 đồng thời, giữ đủ nhãn và score đúng nguồn', async () => {
    const face = faceSubmission(ids.eventId);
    const zone = zoneSubmission(ids);

    await Promise.all([
      repository.applyResult(face, hash({ resultId: face.resultId }), {
        resultId: face.resultId,
      }),
      repository.applyResult(zone, hash({ resultId: zone.resultId }), {
        resultId: zone.resultId,
      }),
    ]);

    const result = await pool.query<AggregateRow>(
      `SELECT event_type,
              status,
              priority,
              confidence,
              detection_confidence,
              ai_label,
              ai_results,
              aggregate_version
       FROM events
       WHERE id = $1;`,
      [ids.eventId],
    );
    const event = result.rows[0];
    expect(event).toMatchObject({
      event_type: 'RESTRICTED_ZONE',
      status: 'DETECTED',
      priority: 'P1',
      ai_label: 'RESTRICTED_ZONE',
    });
    expect(Number(event?.confidence)).toBe(0.7);
    expect(Number(event?.detection_confidence)).toBe(0.9);
    expect(event?.ai_results.map((entry) => entry.label)).toEqual(['UNKNOWN', 'RESTRICTED_ZONE']);
    expect(Number(event?.aggregate_version)).toBe(2);

    const receiptCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM event_ai_result_receipts
       WHERE event_id = $1 AND status = 'PROCESSED';`,
      [ids.eventId],
    );
    const outboxCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM outbox_messages
       WHERE event_id = $1;`,
      [ids.eventId],
    );
    expect(receiptCount.rows[0]?.count).toBe(2);
    expect(outboxCount.rows[0]?.count).toBe(4);
  });

  it('nhận replay cùng payload một lần và báo conflict khi cùng resultId đổi nội dung', async () => {
    const face = faceSubmission(ids.eventId);
    const payload = { resultId: face.resultId, revision: face.revision };
    const payloadHash = hash(payload);

    const accepted = await repository.applyResult(face, payloadHash, payload);
    const duplicate = await repository.applyResult(face, payloadHash, payload);
    expect(accepted.disposition).toBe('ACCEPTED');
    expect(duplicate).toMatchObject({ disposition: 'DUPLICATE', aggregateVersion: 1 });
    await expect(
      repository.applyResult(face, hash({ ...payload, changed: true }), {
        ...payload,
        changed: true,
      }),
    ).rejects.toBeInstanceOf(AiResultIdempotencyConflictError);
  });

  it('lưu revision cũ là STALE và không thay projection hiện tại', async () => {
    const newest = faceSubmission(ids.eventId, 2);
    await repository.applyResult(newest, hash({ id: newest.resultId }), { id: newest.resultId });
    const stale = faceSubmission(ids.eventId, 1);
    const response = await repository.applyResult(stale, hash({ id: stale.resultId }), {
      id: stale.resultId,
    });

    expect(response).toMatchObject({ disposition: 'STALE', aggregateVersion: 1 });
    const receipt = await pool.query<{ status: string; ignored_reason: string }>(
      `SELECT status, ignored_reason
       FROM event_ai_result_receipts
       WHERE result_id = $1;`,
      [stale.resultId],
    );
    expect(receipt.rows[0]).toEqual({ status: 'IGNORED', ignored_reason: 'STALE_REVISION' });
  });

  it('không cho MQTT update ghi đè projection AI', async () => {
    const zone = zoneSubmission(ids);
    await repository.applyResult(zone, hash({ id: zone.resultId }), { id: zone.resultId });

    await eventsRepository.updateEvent({
      eventId: ids.eventId,
      cameraId: ids.cameraId,
      zoneId: ids.zoneId,
      eventType: 'PERSON_DETECTED',
      priority: 'P3',
      detectionConfidence: 0.99,
    });

    const result = await pool.query<AggregateRow>(
      `SELECT event_type,
              status,
              priority,
              confidence,
              detection_confidence,
              ai_label,
              ai_results,
              aggregate_version
       FROM events
       WHERE id = $1;`,
      [ids.eventId],
    );
    expect(result.rows[0]).toMatchObject({
      event_type: 'RESTRICTED_ZONE',
      priority: 'P1',
      ai_label: 'RESTRICTED_ZONE',
    });
    expect(Number(result.rows[0]?.confidence)).toBe(0.7);
    expect(Number(result.rows[0]?.detection_confidence)).toBe(0.99);
  });
});
