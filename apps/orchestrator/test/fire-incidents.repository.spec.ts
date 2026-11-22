import type { PoolClient } from 'pg';
import type { DatabaseService } from '../src/database/database.service';
import type { SubmitAiResultDto } from '../src/ai-results/dto/submit-ai-result.dto';
import type { ConfirmedFireResponse } from '../src/fire/fire.dto';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';

function createEvidence(overrides: Partial<ConfirmedFireResponse> = {}): ConfirmedFireResponse {
  return {
    confirmed: true,
    cameraSlug: 'cam_fire',
    sourceSessionId: 'sess-1',
    episodeId: 'ep-1',
    firstQualifiedAt: '2026-11-20T00:00:00.000Z',
    confirmedAt: '2026-11-20T00:00:02.000Z',
    observedAt: '2026-11-20T00:00:02.000Z',
    modelVersion: 'fire-yolo26n-v1',
    thresholdUsed: 0.5,
    requiredFrames: 3,
    windowSeconds: 5,
    maxFrameGapSeconds: 2,
    confidencePolicyVersion: 'fire-temporal-v2',
    incidentConfidence: 0.88,
    qualifyingFrameIds: ['f1', 'f2', 'f3'],
    ...overrides,
  } as unknown as ConfirmedFireResponse;
}

function createPayload(): SubmitAiResultDto {
  return {
    schemaVersion: 1,
    resultId: 'res-1',
    eventId: 'evt-1',
    observationId: 'fire:sess-1:ep-1',
    revision: 1,
    module: 'M3_FIRE',
    modelVersion: 'fire-yolo26n-v1',
    processedAt: '2026-11-20T00:00:02.000Z',
    error: null,
    results: [],
  } as unknown as SubmitAiResultDto;
}

describe('FireIncidentsRepository', () => {
  it('queries enabled cameras and finds enabled camera by slug', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ slug: 'cam_1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'cam-id-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repo = new FireIncidentsRepository({ query } as unknown as DatabaseService);

    await expect(repo.listEnabledCameras(10)).resolves.toEqual([{ slug: 'cam_1' }]);
    await expect(repo.findEnabledCamera('cam_1')).resolves.toBe('cam-id-1');
    await expect(repo.findEnabledCamera('missing')).resolves.toBeNull();
  });

  it('handles confirm branches: disabled camera, existing incident, stale episode, and fresh insert', async () => {
    const clientQuery = jest.fn();
    const db = {
      query: jest.fn(),
      transaction: jest.fn(async (work: (c: PoolClient) => Promise<unknown>) =>
        work({ query: clientQuery } as unknown as PoolClient),
      ),
    } as unknown as DatabaseService;
    const repo = new FireIncidentsRepository(db);
    const evidence = createEvidence();
    const payload = createPayload();

    // 1. Camera missing/disabled
    clientQuery.mockResolvedValueOnce({ rows: [] });
    await expect(repo.confirm('cam-1', evidence, payload)).resolves.toBeNull();

    // 2. Existing active/matching incident
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 'cam-1' }] }).mockResolvedValueOnce({
      rows: [{ id: 'inc-old', event_id: 'evt-old', camera_id: 'cam-1' }],
    });
    await expect(repo.confirm('cam-1', evidence, payload)).resolves.toEqual({
      id: 'inc-old',
      eventId: 'evt-old',
      cameraId: 'cam-1',
      created: false,
    });

    // 3. Stale confirmation after observed_clear_at
    clientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cam-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ found: true }] });
    await expect(repo.confirm('cam-1', evidence, payload)).resolves.toBeNull();

    // 4. Fresh incident insert
    clientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cam-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    const created = await repo.confirm('cam-1', evidence, payload);
    expect(created).toMatchObject({
      eventId: 'evt-1',
      cameraId: 'cam-1',
      created: true,
    });
    expect(typeof created?.id).toBe('string');
  });

  it('handles clearActive, claim, claimMedia, applied, and retry', async () => {
    const clientQuery = jest.fn();
    const dbQuery = jest.fn();
    const repo = new FireIncidentsRepository({
      query: dbQuery,
      transaction: jest.fn(async (work: (c: PoolClient) => Promise<unknown>) =>
        work({ query: clientQuery } as unknown as PoolClient),
      ),
    } as unknown as DatabaseService);

    const proof = {
      startedAt: new Date('2026-11-20T00:00:00Z'),
      observedAt: new Date('2026-11-20T00:00:05Z'),
    };
    clientQuery.mockResolvedValueOnce({ rows: [] });
    await repo.clearActive('cam-1', proof);
    expect(clientQuery).toHaveBeenCalledTimes(1);

    clientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cam-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    await repo.clearActive('cam-1', proof);
    expect(clientQuery).toHaveBeenCalledTimes(3);

    const pending = { id: 'inc-1', event_id: 'evt-1', pending_payload: {}, lease_token: 'tok-1' };
    const mediaWork = {
      id: 'inc-1',
      event_id: 'evt-1',
      camera_slug: 'cam_1',
      confirmed_at: new Date(),
      first_qualified_at: new Date(),
      retain: true,
    };
    dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pending] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [mediaWork] })
      .mockResolvedValue({ rows: [] });

    await expect(repo.claim(30)).resolves.toBeNull();
    await expect(repo.claim(30)).resolves.toEqual(pending);
    await expect(repo.claimMedia(15, 30, 7)).resolves.toBeNull();
    await expect(repo.claimMedia(15, 30, 7)).resolves.toEqual(mediaWork);
    await repo.applied(pending);
    await repo.retry(pending, 5, 'ERR_TEMP');
    expect(dbQuery).toHaveBeenCalledTimes(6);
  });
});
