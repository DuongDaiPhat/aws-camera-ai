import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ValidationPipe, ConsoleLogger, type INestApplication } from '@nestjs/common';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { hash } from 'argon2';
import cookieParser from 'cookie-parser';
import { DatabaseModule, PG_POOL } from '../src/database/database.module';
import { FireModule } from '../src/fire/fire.module';
import { FireAiClient } from '../src/fire/fire-ai.client';
import { FireConfig } from '../src/fire/fire.config';
import type { FireResponseDto } from '../src/fire/fire.dto';
import { EventsService } from '../src/events/events.service';
import { TOKEN_SERVICE, type AuthUser, type TokenService } from '../src/auth/auth.types';
import { STORAGE_SERVICE, type IStorageService } from '../src/storage/storage.interface';

const suite = process.env.FIRE_VIDEO_DATABASE_URL ? describe : describe.skip;
const reportDir = process.env.FIRE_VIDEO_REPORT_DIR;
const review = process.env.FIRE_VIDEO_REVIEW === 'true';
const manualReview = process.env.FIRE_VIDEO_MANUAL_REVIEW === 'true';
const reviewWaitMs = Number(process.env.FIRE_VIDEO_REVIEW_WAIT_MS ?? 300000);
const evidenceWaitMs = review ? 240_000 : 150_000;
function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing isolated gate setting: ${key}`);
  return value;
}

suite('US-18 real raw-video integration (isolated Docker stack)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let base: string;
  let cameraId: string;
  let owner: AuthUser;
  const observations: {
    at: string;
    score: number | null;
    confirmed: boolean;
    reason: string;
    ms: number;
    processingClockLeadMs: number;
  }[] = [];
  const snapshots = new Map<string, string>();
  const confirmations = new Map<string, FireResponseDto>();
  const updates: unknown[] = [];
  let unsubscribe = (): void => {};

  beforeAll(async () => {
    const endpoint = required('FIRE_VIDEO_MINIO_URL');
    const settings = {
      ...parseEnv(readFileSync(join(__dirname, '../../../.env.example'), 'utf8')),
      DATABASE_URL: required('FIRE_VIDEO_DATABASE_URL'),
      MQTT_URL: required('FIRE_VIDEO_MQTT_URL'),
      AI_SERVICE_URL: required('FIRE_VIDEO_AI_URL'),
      FRIGATE_URL: required('FIRE_VIDEO_FRIGATE_URL'),
      MINIO_ENDPOINT: endpoint,
      MINIO_PUBLIC_ENDPOINT: process.env.FIRE_VIDEO_PUBLIC_MINIO_URL ?? endpoint,
      MINIO_ROOT_USER: 'us18-test',
      MINIO_ROOT_PASSWORD: 'us18-test-only-password',
      STORAGE_BUCKET: 'us18-media',
      JWT_SECRET: 'us18-isolated-test-secret-32-characters',
      AI_INTERNAL_TOKEN: 'us18-isolated-ai-token-32-characters',
      INTERNAL_SERVICE_TOKEN: 'us18-isolated-callback-token-32-characters',
      M3_ENABLED: 'true',
      TELEGRAM_ENABLED: 'false',
    };
    const storageClient = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.MINIO_ROOT_USER,
        secretAccessKey: settings.MINIO_ROOT_PASSWORD,
      },
    });
    try {
      await storageClient.send(new CreateBucketCommand({ Bucket: settings.STORAGE_BUCKET }));
    } finally {
      storageClient.destroy();
    }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [(): Record<string, string> => settings],
        }),
        DatabaseModule,
        FireModule,
      ],
    })
      .setLogger(new ConsoleLogger('US18', { logLevels: ['warn', 'error'] }))
      .compile();
    app = module.createNestApplication({ logger: ['error', 'warn'] });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    if (review) app.enableCors({ origin: /^http:\/\/127\.0\.0\.1:\d+$/, credentials: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    const ai = module.get(FireAiClient);
    const detect = ai.detect.bind(ai);
    jest.spyOn(ai, 'detect').mockImplementation(async (frame) => {
      const started = performance.now();
      const result = await detect(frame);
      observations.push({
        at: result.observedAt,
        score: result.maxConfidence,
        confirmed: result.confirmed,
        reason: result.reason,
        ms: performance.now() - started,
        processingClockLeadMs: Date.parse(result.processedAt) - Date.now(),
      });
      if (result.reason === 'CONFIRMED') {
        snapshots.set(result.frameId, createHash('sha256').update(frame.image).digest('hex'));
        confirmations.set(result.frameId, result);
        if (reportDir)
          appendFileSync(join(reportDir, 'ai-confirmations.jsonl'), JSON.stringify(result) + '\n');
      }
      return result;
    });
    await app.listen(review ? 3001 : 0, review ? '0.0.0.0' : '127.0.0.1');
    base = await app.getUrl();
    pool = app.get<Pool>(PG_POOL);
    owner = {
      id: randomUUID(),
      email: review ? 'us18-review@example.test' : `${randomUUID()}@example.test`,
      passwordHash: review ? await hash('US18-local-review-only!') : 'test',
      fullName: 'Isolated fire gate',
      role: 'ADMIN',
      isActive: true,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date(),
    };
    token = app.get<TokenService>(TOKEN_SERVICE).issueTokenPair(owner).accessToken;
    const subscription = app
      .get(EventsService)
      .streamEvents(token)
      .subscribe((value) => updates.push(value));
    unsubscribe = (): void => subscription.unsubscribe();
    await pool.query(
      "INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,$3,$4,'ADMIN')",
      [owner.id, owner.email, owner.passwordHash, owner.fullName],
    );
    const device = randomUUID();
    cameraId = randomUUID();
    await pool.query(
      "INSERT INTO devices(id,owner_user_id,name) VALUES($1,$2,'US18 isolated gate')",
      [device, owner.id],
    );
    await pool.query(
      "INSERT INTO cameras(id,device_id,name,slug,rtsp_url) VALUES($1,$2,'Raw fire video','cam_fire','rtsp://example.test/isolated')",
      [cameraId, device],
    );
  }, 40_000);

  afterAll(async () => {
    unsubscribe();
    jest.restoreAllMocks();
    if (app) await app.close();
  });

  async function completeConfirmation(eventId: string): Promise<void> {
    if (review) {
      if (!reportDir) throw new Error('Review report directory is required');
      writeFileSync(join(reportDir, 'review-ready.json'), JSON.stringify({ eventId }));
      if (manualReview) {
        await waitForManualConfirmation(eventId, reportDir);
        return;
      }
      const reviewStarted = performance.now();
      const marker = join(reportDir, 'review-complete.json');
      while (!existsSync(marker)) {
        if (performance.now() - reviewStarted > reviewWaitMs)
          throw new Error('Browser review did not finish');
        await delay(500);
      }
      const completed: unknown = JSON.parse(readFileSync(marker, 'utf8'));
      expect(completed).toMatchObject({ eventId });
      return;
    }
    const confirmation = await fetch(`${base}/api/v1/events/${eventId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'IM_OK', commandId: randomUUID() }),
    });
    expect(confirmation.status).toBeLessThan(300);
  }

  async function waitForManualConfirmation(eventId: string, directory: string): Promise<void> {
    const started = performance.now();
    while (performance.now() - started < reviewWaitMs) {
      const { status } = await app.get(EventsService).getEvent(eventId);
      if (status === 'RESOLVED' || status === 'CLOSED') {
        const response = status === 'RESOLVED' ? 'IM_OK' : 'ACKNOWLEDGED';
        const phase = status === 'RESOLVED' ? 'INITIAL' : 'EMERGENCY';
        const confirmations = await pool.query<{
          channel: string;
          response: string;
          phase: string;
          user_id: string;
        }>(
          `SELECT channel,response,phase,user_id FROM confirmations
           WHERE event_id=$1 AND is_authoritative=TRUE AND phase=$2`,
          [eventId, phase],
        );
        expect(confirmations.rows).toEqual([
          { channel: 'DASHBOARD', response, phase, user_id: owner.id },
        ]);
        writeFileSync(
          join(directory, 'manual-review-result.json'),
          JSON.stringify(
            {
              eventId,
              finalStatus: status,
              confirmationChannel: 'DASHBOARD',
              confirmationResponse: response,
              phase,
              visualAssertionsAutomated: false,
              note: 'Backend confirmation verified; visual acceptance must be recorded by the operator',
            },
            null,
            2,
          ),
        );
        return;
      }
      await delay(500);
    }
    throw new Error('Manual dashboard confirmation did not finish within the review window');
  }

  async function saveObservations(): Promise<void> {
    if (!reportDir) return;
    writeFileSync(join(reportDir, 'observations.json'), JSON.stringify(observations, null, 2));
    const incidents = await pool.query(
      'SELECT event_id,delivery_status,last_error FROM fire_incidents WHERE camera_id=$1',
      [cameraId],
    );
    writeFileSync(join(reportDir, 'database.json'), JSON.stringify(incidents.rows, null, 2));
  }

  function saveConfirmation(frameId: string): void {
    const confirmation = confirmations.get(frameId);
    expect(confirmation).toBeDefined();
    if (reportDir)
      writeFileSync(join(reportDir, 'confirmation.json'), JSON.stringify(confirmation, null, 2));
  }

  it(
    'creates one P0 incident with exact snapshot, clip, notification intent, SSE and user confirmation',
    async () => {
      const started = Date.now();
      let eventId: string | undefined;
      while (Date.now() - started < evidenceWaitMs) {
        const row = (
          await pool.query<{ event_id: string }>(
            "SELECT event_id FROM fire_incidents WHERE camera_id=$1 AND delivery_status='APPLIED' LIMIT 1",
            [cameraId],
          )
        ).rows[0];
        if (row) {
          eventId = row.event_id;
          const media = await pool.query('SELECT media_type FROM event_media WHERE event_id=$1', [
            eventId,
          ]);
          if (media.rows.some((item) => item.media_type === 'CLIP')) break;
        }
        await delay(500);
      }
      await saveObservations();
      expect(observations.some((item) => item.score !== null && item.score >= 0.5)).toBe(true);
      expect(eventId).toBeDefined();
      if (!eventId)
        throw new Error(
          'No confirmed real-video incident; inspect the saved observations and container logs',
        );
      const detail = await app.get(EventsService).getEvent(eventId);
      expect(detail).toMatchObject({
        eventType: 'FIRE_SMOKE_DETECTED',
        priority: 'P0',
        status: review ? expect.stringMatching(/^(NOTIFIED|ESCALATED)$/) : 'NOTIFIED',
      });
      expect(detail.aiResults?.[0]).toMatchObject({
        module: 'M3_FIRE',
        label: 'FIRE_SMOKE_DETECTED',
      });
      const incident = (
        await pool.query(
          'SELECT pending_payload, confirmed_at, first_qualified_at, model_version FROM fire_incidents WHERE event_id=$1',
          [eventId],
        )
      ).rows[0];
      const expectedModelVersion = app.get(FireConfig).modelVersion;
      expect(incident.model_version).toBe(expectedModelVersion);
      expect(incident.pending_payload.modelVersion).toBe(expectedModelVersion);
      const metadata = incident.pending_payload.results[0].metadata;
      saveConfirmation(metadata.frameId);
      expect(metadata.qualifyingFrameIds).toHaveLength(3);
      expect(new Set(metadata.qualifyingFrameIds).size).toBe(3);
      const media = (
        await pool.query<{ media_type: string; object_key: string; checksum_sha256: string }>(
          'SELECT media_type,object_key,checksum_sha256 FROM event_media WHERE event_id=$1',
          [eventId],
        )
      ).rows;
      expect(media.map((item) => item.media_type).sort()).toEqual(['CLIP', 'SNAPSHOT']);
      const snapshot = media.find((item) => item.media_type === 'SNAPSHOT');
      expect(snapshot?.checksum_sha256).toBe(snapshots.get(metadata.frameId));
      if (!snapshot) throw new Error('Missing exact evidence snapshot');
      const image = await app.get<IStorageService>(STORAGE_SERVICE).download(snapshot.object_key);
      expect(createHash('sha256').update(image).digest('hex')).toBe(snapshot.checksum_sha256);
      if (reportDir) writeFileSync(join(reportDir, 'confirmation-snapshot.jpg'), image);
      const notifications = (
        await pool.query('SELECT channel,status FROM notifications WHERE event_id=$1', [eventId])
      ).rows;
      expect(notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channel: 'TELEGRAM', status: 'PENDING' }),
        ]),
      );
      expect(updates.length).toBeGreaterThan(0);
      const response = await fetch(`${base}/api/v1/events/${eventId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      await completeConfirmation(eventId);
      const finalStatus = (await app.get(EventsService).getEvent(eventId)).status;
      expect(finalStatus).toMatch(review ? /^(RESOLVED|CLOSED)$/ : /^RESOLVED$/);
      await delay(3000);
      expect(
        (
          await pool.query('SELECT count(*)::int AS count FROM fire_incidents WHERE camera_id=$1', [
            cameraId,
          ])
        ).rows[0].count,
      ).toBe(1);
      if (reportDir)
        writeFileSync(
          join(reportDir, 'result.json'),
          JSON.stringify(
            {
              eventId,
              modelVersion: expectedModelVersion,
              detail,
              media,
              notifications,
              updates: updates.length,
              inferenceCalls: observations.length,
              nodeVersion: process.version,
              processingClockLeadMaxMs: Math.max(
                ...observations.map((item) => item.processingClockLeadMs),
              ),
              processingClockLeadMinMs: Math.min(
                ...observations.map((item) => item.processingClockLeadMs),
              ),
              confirmationSpanMs:
                incident.confirmed_at.getTime() - incident.first_qualified_at.getTime(),
              finalStatus,
              browserReview: review,
              manualBrowserReview: manualReview,
              externalDeliveryTested: false,
            },
            null,
            2,
          ),
        );
    },
    review ? reviewWaitMs + 300_000 : 180_000,
  );
});
