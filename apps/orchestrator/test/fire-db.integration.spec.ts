import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { DatabaseService } from '../src/database/database.service';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { FireDeliveryService } from '../src/fire/fire-delivery.service';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { AiResultsRepository } from '../src/ai-results/ai-results.repository';
import { AiResultValidator } from '../src/ai-results/ai-result.validator';
import { AiResultOutboxService } from '../src/ai-results/ai-result-outbox.service';
import { SubmitAiResultDto } from '../src/ai-results/dto/submit-ai-result.dto';
import type { ConfirmedFireResponse } from '../src/fire/fire.dto';
import { confirmedFire, fireConfig } from './fire-fixtures';

const suite = process.env.FIRE_TEST_DATABASE_URL ? describe : describe.skip;

function submission(cameraId: string, evidence: ConfirmedFireResponse): SubmitAiResultDto {
  return {
    schemaVersion: 1,
    resultId: randomUUID(),
    eventId: randomUUID(),
    observationId: `fire:${evidence.sourceSessionId}:${evidence.episodeId}`,
    revision: 1,
    module: 'M3_FIRE',
    modelVersion: evidence.modelVersion,
    processedAt: evidence.processedAt,
    error: null,
    results: [
      {
        module: 'M3_FIRE',
        label: 'FIRE_SMOKE_DETECTED',
        confidence: evidence.incidentConfidence,
        boundingBox: evidence.detections[0].boundingBox,
        metadata: {
          cameraId,
          sourceSessionId: evidence.sourceSessionId,
          episodeId: evidence.episodeId,
          frameId: evidence.frameId,
          firstQualifiedAt: evidence.firstQualifiedAt,
          confirmedAt: evidence.confirmedAt,
          qualifyingFrameIds: evidence.qualifyingFrameIds,
          qualifyingFrameTimestamps: evidence.qualifyingFrameTimestamps,
          consecutiveFrames: 3,
          requiredFrames: 3,
          windowSeconds: 5,
          maxFrameGapSeconds: 1,
          thresholdUsed: 0.5,
          incidentConfidencePolicyVersion: 'fire-only-temporal-min-v1',
          labels: ['fire'],
          detections: evidence.detections,
        },
      },
    ],
  };
}

suite('US-18 durable fire incidents (isolated PostgreSQL)', () => {
  let pool: Pool;
  let repository: FireIncidentsRepository;
  let module: TestingModule;
  let results: AiResultsService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.FIRE_TEST_DATABASE_URL });
    const database = new DatabaseService(pool);
    repository = new FireIncidentsRepository(database);
    module = await Test.createTestingModule({
      providers: [
        AiResultsService,
        AiResultsRepository,
        AiResultValidator,
        { provide: DatabaseService, useValue: database },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            AI_RESULT_MAX_ITEMS: 100,
            AI_RESULT_MAX_METADATA_BYTES: 16384,
            AI_RESULT_MAX_METADATA_DEPTH: 5,
            AI_RESULT_MAX_FUTURE_SECONDS: 5,
          }),
        },
        {
          provide: AiResultOutboxService,
          useValue: { dispatchAvailable: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    results = module.get(AiResultsService);
  });

  afterAll(async () => {
    await module?.close();
    await pool?.end();
  });

  async function camera(): Promise<string> {
    const owner = randomUUID(),
      device = randomUUID(),
      id = randomUUID();
    await pool.query(
      "INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'test','Fire test','ADMIN')",
      [owner, `${owner}@example.test`],
    );
    await pool.query("INSERT INTO devices (id,owner_user_id,name) VALUES ($1,$2,'Fire gate')", [
      device,
      owner,
    ]);
    await pool.query(
      "INSERT INTO cameras (id,device_id,name,slug,rtsp_url) VALUES ($1,$2,'Fire camera',$3,'rtsp://example.test/camera')",
      [id, device, `cam_${id.replaceAll('-', '')}`],
    );
    return id;
  }

  it('concurrent confirmations and restarts create one active event, including after user resolution', async () => {
    const cameraId = await camera();
    const evidence = confirmedFire();
    const [left, right] = await Promise.all([
      repository.confirm(cameraId, evidence, submission(cameraId, evidence)),
      repository.confirm(cameraId, evidence, submission(cameraId, evidence)),
    ]);
    expect(left?.eventId).toBe(right?.eventId);
    expect([left?.created, right?.created].filter(Boolean)).toHaveLength(1);
    await pool.query("UPDATE events SET status='RESOLVED' WHERE id=$1", [left?.eventId]);
    const restarted = confirmedFire(Date.now() + 1000);
    restarted.sourceSessionId = 'source-restarted';
    const repeat = await repository.confirm(cameraId, restarted, submission(cameraId, restarted));
    expect(repeat?.created).toBe(false);
    expect(repeat?.eventId).toBe(left?.eventId);
    const count = await pool.query(
      'SELECT count(*)::int AS count FROM fire_incidents WHERE camera_id=$1',
      [cameraId],
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('persists an immutable payload and reuses receipt after crash between submit and applied marker', async () => {
    const cameraId = await camera();
    const evidence = confirmedFire();
    const payload = submission(cameraId, evidence);
    const incident = await repository.confirm(cameraId, evidence, payload);
    // Other cases leave work pending, so claim the fixture by draining preceding rows.
    let work = await repository.claim(30);
    while (work && work.event_id !== incident?.eventId) {
      await repository.applied(work);
      work = await repository.claim(30);
    }
    if (!work) throw new Error('Missing pending fire work');
    const dto = plainToInstance(SubmitAiResultDto, work.pending_payload);
    expect((await results.submit(work.event_id, dto)).disposition).toBe('ACCEPTED');
    await pool.query(
      "UPDATE fire_incidents SET leased_until=now()-interval '1 second' WHERE id=$1",
      [work.id],
    );
    const delivery = new FireDeliveryService(fireConfig(), repository, results);
    await delivery.dispatch();
    const saved = await pool.query(
      'SELECT delivery_status, pending_payload FROM fire_incidents WHERE id=$1',
      [work.id],
    );
    expect(saved.rows[0].delivery_status).toBe('APPLIED');
    expect(saved.rows[0].pending_payload.resultId).toBe(payload.resultId);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM event_ai_result_receipts WHERE event_id=$1',
          [work.event_id],
        )
      ).rows[0].count,
    ).toBe(1);
    const event = (
      await pool.query(
        'SELECT event_type, priority, detected_at, ai_label, ai_results FROM events WHERE id=$1',
        [work.event_id],
      )
    ).rows[0];
    expect(event).toMatchObject({
      event_type: 'FIRE_SMOKE_DETECTED',
      priority: 'P0',
      ai_label: 'FIRE_SMOKE_DETECTED',
    });
    expect(event.detected_at.toISOString()).toBe(evidence.confirmedAt);
    expect(event.ai_results).toHaveLength(1);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM outbox_messages WHERE event_id=$1', [
          work.event_id,
        ])
      ).rows[0].count,
    ).toBe(2);
    await expect(
      pool.query("UPDATE fire_incidents SET pending_payload='{}'::jsonb WHERE id=$1", [work.id]),
    ).rejects.toThrow('immutable');
  });

  it('observed clear permits a new episode and old clear evidence cannot close a newer episode', async () => {
    const cameraId = await camera();
    const at = Date.now() - 20_000;
    const first = confirmedFire(at);
    await repository.confirm(cameraId, first, submission(cameraId, first));
    await repository.clearActive(cameraId, {
      startedAt: new Date(at + 1000),
      observedAt: new Date(at + 11_000),
    });
    const next = confirmedFire(at + 15_000);
    const fresh = await repository.confirm(cameraId, next, submission(cameraId, next));
    expect(fresh?.created).toBe(true);
    await repository.clearActive(cameraId, {
      startedAt: new Date(at + 1000),
      observedAt: new Date(at + 11_000),
    });
    const row = (
      await pool.query('SELECT observed_clear_at FROM fire_incidents WHERE id=$1', [fresh?.id])
    ).rows[0];
    expect(row.observed_clear_at).toBeNull();
    const replay = await repository.confirm(cameraId, first, submission(cameraId, first));
    expect(replay?.created).toBe(false);
  });

  it('a disabled camera cannot admit or persist a confirmation', async () => {
    const cameraId = await camera();
    await pool.query('UPDATE cameras SET is_enabled=false WHERE id=$1', [cameraId]);
    const evidence = confirmedFire();
    expect(await repository.confirm(cameraId, evidence, submission(cameraId, evidence))).toBeNull();
  });

  it('reserves missing media durably without re-delivering the already applied AI result', async () => {
    const cameraId = await camera();
    const evidence = confirmedFire(Date.now() - 60_000);
    const incident = await repository.confirm(cameraId, evidence, submission(cameraId, evidence));
    await pool.query(
      "UPDATE fire_incidents SET delivery_status='APPLIED', applied_at=now(), available_at=now()-interval '1 day' WHERE id=$1",
      [incident?.id],
    );
    const work = await repository.claimMedia(15, 30, 7);
    expect(work?.event_id).toBe(incident?.eventId);
    expect(work?.camera_slug).toMatch(/^cam_/);
    expect((await repository.claimMedia(15, 30, 7))?.event_id).not.toBe(incident?.eventId);
    const saved = (
      await pool.query(
        'SELECT delivery_status,available_at>now() AS reserved FROM fire_incidents WHERE id=$1',
        [incident?.id],
      )
    ).rows[0];
    expect(saved).toMatchObject({ delivery_status: 'APPLIED', reserved: true });
  });
});
