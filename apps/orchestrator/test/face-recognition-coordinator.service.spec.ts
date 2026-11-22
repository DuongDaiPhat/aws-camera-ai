import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import type { AiResultsService } from '../src/ai-results/ai-results.service';
import type { CloudQueueService } from '../src/cloud-queue/cloud-queue.service';
import type { DatabaseService } from '../src/database/database.service';
import type { CameraRecord, EventRecord, EventsRepository } from '../src/events/events.repository';
import {
  FaceQualityGateClient,
  type FaceQualityGateResult,
} from '../src/face-recognition/face-quality-gate.client';
import { FaceRecognitionCoordinatorService } from '../src/face-recognition/face-recognition-coordinator.service';
import { FaceSessionCacheService } from '../src/face-recognition/face-session-cache.service';
import { TrackIdentityStateService } from '../src/face-recognition/track-identity-state.service';
import type { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';

function encodeVector(values: number[]): string {
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    buf.writeFloatLE(values[i]!, i * 4);
  }
  return buf.toString('base64');
}

async function solidJpeg(
  top: { r: number; g: number; b: number },
  bottom: { r: number; g: number; b: number },
): Promise<Buffer> {
  const width = 24;
  const height = 24;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const c = y < height / 2 ? top : bottom;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      raw[idx] = c.r;
      raw[idx + 1] = c.g;
      raw[idx + 2] = c.b;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

function makeCamera(overrides: Partial<CameraRecord> = {}): CameraRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Front Door',
    slug: 'cam_front',
    owner_user_id: '33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    camera_id: '22222222-2222-4222-8222-222222222222',
    zone_id: null,
    event_type: 'PERSON_DETECTED',
    status: 'DETECTED',
    priority: 'P3',
    source: 'FRIGATE',
    track_id: 'track-1',
    dedup_key: 'frigate:cam_front:track-1',
    confidence: null,
    detection_confidence: 0.9,
    ai_results: [],
    correlation_id: '44444444-4444-4444-8444-444444444444',
    detected_at: new Date('2026-11-22T00:00:00.000Z'),
    created_at: new Date('2026-11-22T00:00:00.000Z'),
    updated_at: new Date('2026-11-22T00:00:00.000Z'),
    ...overrides,
  };
}

function makeGateResult(overrides: Partial<FaceQualityGateResult> = {}): FaceQualityGateResult {
  return {
    passed: true,
    qualityScore: 0.9,
    faceCount: 1,
    rejectionReason: null,
    metrics: null,
    boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
    embeddingBase64: encodeVector([1, 0, 0, 0]),
    embeddingDim: 4,
    modelVersion: 'yunet-2023mar-sface-2021dec',
    gateStatus: 'READY',
    failOpenApplied: false,
    ...overrides,
  };
}

describe('FaceRecognitionCoordinatorService (Layers 1-4 E2E Orchestration)', () => {
  const aliceId = '55555555-5555-4555-8555-555555555555';

  function buildHarness(envOverrides: Record<string, string> = {}) {
    const config = new ConfigService({
      FACE_JOB_TRANSPORT: 'sqs',
      FACE_TRACK_OPTIMIZATION_ENABLED: 'true',
      FACE_MIN_SAMPLE_INTERVAL_MS: '350',
      FACE_BEST_SHOT_WINDOW_MS: '1200',
      FACE_BEST_SHOT_MAX_SAMPLES: '4',
      FACE_BEST_SHOT_EARLY_DISPATCH_SCORE: '0.82',
      FACE_UNDETERMINED_MAX_RETRIES: '2',
      FACE_UNDETERMINED_RETRY_COOLDOWN_MS: '4000',
      FACE_UNKNOWN_ALLOW_SINGLE_RECHECK: 'true',
      FACE_UNKNOWN_RECHECK_MIN_QUALITY_GAIN: '0.15',
      ...envOverrides,
    });
    const stateService = new TrackIdentityStateService(config);
    const sessionCache = new FaceSessionCacheService(config);
    const assess = jest.fn<Promise<FaceQualityGateResult>, [Buffer]>();
    const qualityGateClient = { assess } as unknown as FaceQualityGateClient;
    const getCroppedSnapshot = jest.fn<Promise<Buffer | null>, [string]>();
    const frigateMedia = { getCroppedSnapshot } as unknown as FrigateMediaAdapter;
    const submitAiResult = jest.fn().mockResolvedValue({
      resultId: '66666666-6666-4666-8666-666666666666',
      disposition: 'ACCEPTED',
      aggregateVersion: 2,
    });
    const aiResultsService = { submit: submitAiResult } as unknown as AiResultsService;
    const enqueueFaceJob = jest.fn().mockResolvedValue({
      created: true,
      jobId: '77777777-7777-4777-8777-777777777777',
      status: 'PENDING',
    });
    const registerRecognitionResultListener = jest.fn();
    const cloudQueue = {
      enqueueFaceJob,
      registerRecognitionResultListener,
    } as unknown as CloudQueueService;
    const faceQueueAdd = jest.fn().mockResolvedValue({});
    const faceQueue = { add: faceQueueAdd } as unknown as Queue;
    const eventsRepository = {
      getSyncedFaceCollectionVersion: jest.fn().mockResolvedValue(1),
    } as unknown as EventsRepository;
    let currentCollectionVersion = 1;
    const dbQuery = jest.fn(async (sql: string) => {
      if (sql.includes('cloud_face_collections')) {
        return { rows: [{ version: currentCollectionVersion }] };
      }
      if (sql.includes('known_faces')) {
        return { rows: [{ person_name: 'Alice' }] };
      }
      return { rows: [] };
    });
    const databaseService = { query: dbQuery } as unknown as DatabaseService;

    const coordinator = new FaceRecognitionCoordinatorService(
      config,
      stateService,
      sessionCache,
      qualityGateClient,
      frigateMedia,
      aiResultsService,
      eventsRepository,
      databaseService,
      cloudQueue,
      faceQueue,
    );

    return {
      coordinator,
      stateService,
      sessionCache,
      assess,
      getCroppedSnapshot,
      submitAiResult,
      enqueueFaceJob,
      faceQueueAdd,
      setCollectionVersion: (v: number) => {
        currentCollectionVersion = v;
      },
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('produces 0 AWS calls when person shows back of head / no face through entire track', async () => {
    const h = buildHarness();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    h.getCroppedSnapshot.mockResolvedValue(Buffer.from('back-of-head'));
    h.assess.mockResolvedValue(
      makeGateResult({
        passed: false,
        qualityScore: 0,
        faceCount: 0,
        rejectionReason: 'NO_FACE_DETECTED',
        embeddingBase64: null,
        embeddingDim: null,
        boundingBox: null,
      }),
    );

    const camera = makeCamera();
    const event = makeEvent();
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event,
      after: { id: 'track-1', camera: 'cam_front', frame_time: 10, label: 'person', score: 0.9 },
      isCreated: true,
      camera,
    });
    now += 400;
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event,
      after: { id: 'track-1', camera: 'cam_front', frame_time: 10.4, label: 'person', score: 0.91 },
      isCreated: false,
      camera,
    });
    now += 400;
    await h.coordinator.handleTrackEvent({
      messageType: 'end',
      event,
      after: { id: 'track-1', camera: 'cam_front', frame_time: 10.8, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });

    expect(h.enqueueFaceJob).not.toHaveBeenCalled();
    expect(h.faceQueueAdd).not.toHaveBeenCalled();
    expect(h.stateService.getMetrics().gateRejected).toBe(2);
    h.coordinator.onModuleDestroy();
  });

  it('selects the highest quality Best-Shot within window and freezes KNOWN across updates', async () => {
    const h = buildHarness();
    let now = 20_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const camera = makeCamera();
    const event = makeEvent();

    const crop1 = Buffer.from('crop-score-0.55');
    const crop2 = Buffer.from('crop-score-0.78');
    const crop3 = Buffer.from('crop-score-0.61');
    const crop4 = Buffer.from('crop-score-0.65');

    h.getCroppedSnapshot
      .mockResolvedValueOnce(crop1)
      .mockResolvedValueOnce(crop2)
      .mockResolvedValueOnce(crop3)
      .mockResolvedValueOnce(crop4);
    h.assess
      .mockResolvedValueOnce(makeGateResult({ qualityScore: 0.55 }))
      .mockResolvedValueOnce(makeGateResult({ qualityScore: 0.78 }))
      .mockResolvedValueOnce(makeGateResult({ qualityScore: 0.61 }))
      .mockResolvedValueOnce(makeGateResult({ qualityScore: 0.65 }));

    for (let i = 0; i < 4; i++) {
      await h.coordinator.handleTrackEvent({
        messageType: i === 0 ? 'new' : 'update',
        event,
        after: {
          id: 'track-1',
          camera: 'cam_front',
          frame_time: 20 + i * 0.4,
          label: 'person',
          score: 0.9,
          box: [100, 100, 200, 300],
        },
        isCreated: i === 0,
        camera,
      });
      now += 400;
    }

    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);
    expect(h.enqueueFaceJob).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: event.id,
        revision: 1,
        imageBuffer: crop2, // Best-Shot (0.78) selected over later 0.61 and 0.65!
      }),
    );

    // While PENDING_RECOGNITION, updates are skipped.
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event,
      after: { id: 'track-1', camera: 'cam_front', frame_time: 22, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.stateService.getMetrics().pendingSkips).toBe(1);
    expect(h.getCroppedSnapshot).toHaveBeenCalledTimes(4);

    // Recognition finishes as KNOWN.
    await h.coordinator.onRecognitionResult({
      eventId: event.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 'track-1',
      collectionVersion: 1,
      revision: 1,
      personStatus: 'KNOWN',
      matchedKnownFaceId: aliceId,
      similarity: 0.96,
      disposition: 'ACCEPTED',
    });

    // Subsequent updates are frozen forever for this track.
    for (let i = 0; i < 3; i++) {
      now += 1000;
      await h.coordinator.handleTrackEvent({
        messageType: 'update',
        event,
        after: {
          id: 'track-1',
          camera: 'cam_front',
          frame_time: 23 + i,
          label: 'person',
          score: 0.92,
          box: [150 + i * 10, 100, 250 + i * 10, 300],
        },
        isCreated: false,
        camera,
      });
    }
    expect(h.stateService.getMetrics().frozenKnownSkips).toBe(3);
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);
    expect(h.getCroppedSnapshot).toHaveBeenCalledTimes(4);
    h.coordinator.onModuleDestroy();
  });

  it('hits local embedding session cache on track drop with 0 AWS calls, while calling AWS for tailgating stranger', async () => {
    const h = buildHarness();
    let now = 30_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const camera = makeCamera();

    const aliceCrop = await solidJpeg({ r: 10, g: 40, b: 220 }, { r: 25, g: 25, b: 30 });
    const strangerCrop = await solidJpeg({ r: 220, g: 30, b: 20 }, { r: 240, g: 240, b: 240 });
    const aliceEmb = encodeVector([1, 0, 0, 0]);
    const aliceEmbDropped = encodeVector([0.96, 0.2, 0, 0]);
    const strangerEmb = encodeVector([0, 1, 0, 0]);

    // Track 1: Alice identified by AWS.
    const event1 = makeEvent({ id: '11111111-1111-4111-8111-111111111111', track_id: 'track-1' });
    h.getCroppedSnapshot.mockResolvedValueOnce(aliceCrop);
    h.assess.mockResolvedValueOnce(
      makeGateResult({ qualityScore: 0.9, embeddingBase64: aliceEmb }),
    );

    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event1,
      after: {
        id: 'track-1',
        camera: 'cam_front',
        frame_time: 30,
        label: 'person',
        score: 0.92,
        box: [100, 100, 220, 340],
      },
      isCreated: true,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);

    await h.coordinator.onRecognitionResult({
      eventId: event1.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 'track-1',
      collectionVersion: 1,
      revision: 1,
      personStatus: 'KNOWN',
      matchedKnownFaceId: aliceId,
      matchedPersonName: 'Alice',
      similarity: 0.95,
      disposition: 'ACCEPTED',
    });

    // End Track 1 at t=31s
    now += 1_000;
    await h.coordinator.handleTrackEvent({
      messageType: 'end',
      event: event1,
      after: {
        id: 'track-1',
        camera: 'cam_front',
        frame_time: 31,
        label: 'person',
        score: 0.9,
        box: [105, 100, 225, 340],
      },
      isCreated: false,
      camera,
    });

    // Track 2: Frigate dropped Alice's track and created track-2 at far box -> embedding cache hits!
    now += 1_000;
    const event2 = makeEvent({ id: '11111111-1111-4111-8111-111111111112', track_id: 'track-2' });
    h.getCroppedSnapshot.mockResolvedValueOnce(aliceCrop);
    h.assess.mockResolvedValueOnce(
      makeGateResult({ qualityScore: 0.88, embeddingBase64: aliceEmbDropped }),
    );
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event2,
      after: {
        id: 'track-2',
        camera: 'cam_front',
        frame_time: 32,
        label: 'person',
        score: 0.91,
        box: [600, 100, 720, 340],
      },
      isCreated: true,
      camera,
    });

    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1); // Still 1: 0 extra AWS calls!
    expect(h.stateService.getMetrics().sessionCacheHits).toBe(1);
    expect(h.submitAiResult).toHaveBeenCalledWith(
      event2.id,
      expect.objectContaining({
        eventId: event2.id,
        observationId: 'track:track-2:face',
        personStatus: 'KNOWN',
        matchedKnownFaceId: aliceId,
        revision: 1,
        results: [
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'local-session-cache',
              cacheHit: true,
            }),
          }),
        ],
      }),
    );

    // Track 3: Tailgating stranger right next to Track 1/2 with different appearance & face -> MUST call AWS!
    now += 1_000;
    const event3 = makeEvent({
      id: '11111111-1111-4111-8111-111111111113',
      track_id: 'track-stranger',
    });
    h.getCroppedSnapshot.mockResolvedValueOnce(strangerCrop);
    h.assess.mockResolvedValueOnce(
      makeGateResult({ qualityScore: 0.89, embeddingBase64: strangerEmb }),
    );
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event3,
      after: {
        id: 'track-stranger',
        camera: 'cam_front',
        frame_time: 33,
        label: 'person',
        score: 0.9,
        box: [108, 102, 228, 342],
      },
      isCreated: true,
      camera,
    });

    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(2);
    expect(h.enqueueFaceJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventId: event3.id,
        trackId: 'track-stranger',
        revision: 1,
      }),
    );
    h.coordinator.onModuleDestroy();
  });

  it('invalidates cached identity when collectionVersion increments, forcing fresh AWS recognition', async () => {
    const h = buildHarness();
    let now = 40_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const camera = makeCamera();
    const crop = Buffer.from('same-person-crop');
    const emb = encodeVector([1, 0, 0, 0]);

    const event1 = makeEvent({ id: '11111111-1111-4111-8111-111111111121', track_id: 't1' });
    h.getCroppedSnapshot.mockResolvedValue(crop);
    h.assess.mockResolvedValue(makeGateResult({ qualityScore: 0.9, embeddingBase64: emb }));

    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event1,
      after: { id: 't1', camera: 'cam_front', frame_time: 40, label: 'person', score: 0.9 },
      isCreated: true,
      camera,
    });
    await h.coordinator.onRecognitionResult({
      eventId: event1.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't1',
      collectionVersion: 1,
      revision: 1,
      personStatus: 'KNOWN',
      matchedKnownFaceId: aliceId,
      similarity: 0.95,
      disposition: 'ACCEPTED',
    });

    // Owner updates known_faces -> collectionVersion bumps to 2!
    h.setCollectionVersion(2);
    now += 1_000;

    const event2 = makeEvent({ id: '11111111-1111-4111-8111-111111111122', track_id: 't2' });
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event2,
      after: { id: 't2', camera: 'cam_front', frame_time: 41, label: 'person', score: 0.9 },
      isCreated: true,
      camera,
    });

    // Must NOT hit stale collectionVersion=1 cache; must dispatch to AWS!
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(2);
    expect(h.stateService.getMetrics().sessionCacheHits).toBe(0);
    h.coordinator.onModuleDestroy();
  });

  it('allows single UNKNOWN recheck only on >= 0.15 quality jump', async () => {
    const h = buildHarness();
    let now = 50_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const camera = makeCamera();
    const emb = encodeVector([0, 0, 1, 0]);
    h.getCroppedSnapshot.mockResolvedValue(Buffer.from('crop'));

    const evUnknown = makeEvent({ id: '11111111-1111-4111-8111-111111111131', track_id: 't-unk' });
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.6, embeddingBase64: emb }));
    now += 1_500;
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: evUnknown,
      after: { id: 't-unk', camera: 'cam_front', frame_time: 51, label: 'person', score: 0.9 },
      isCreated: true,
      camera,
    });
    // Trigger dispatch on window elapsed
    now += 1_300;
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.55, embeddingBase64: emb }));
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUnknown,
      after: { id: 't-unk', camera: 'cam_front', frame_time: 52, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);

    await h.coordinator.onRecognitionResult({
      eventId: evUnknown.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't-unk',
      collectionVersion: 1,
      revision: 1,
      personStatus: 'UNKNOWN',
      disposition: 'ACCEPTED',
    });

    // Quality jump +0.10 (< 0.15) -> NO recheck
    now += 500;
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.7, embeddingBase64: emb }));
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUnknown,
      after: { id: 't-unk', camera: 'cam_front', frame_time: 53, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);

    // Quality jump +0.20 (>= 0.15) -> recheck revision 2!
    now += 500;
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.8, embeddingBase64: emb }));
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUnknown,
      after: { id: 't-unk', camera: 'cam_front', frame_time: 54, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(2);
    expect(h.enqueueFaceJob).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }));

    // Return UNKNOWN again -> second recheck blocked before sampling!
    await h.coordinator.onRecognitionResult({
      eventId: evUnknown.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't-unk',
      collectionVersion: 1,
      revision: 2,
      personStatus: 'UNKNOWN',
      disposition: 'ACCEPTED',
    });
    const assessCountBeforeBlockedUpdate = h.assess.mock.calls.length;
    now += 500;
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUnknown,
      after: { id: 't-unk', camera: 'cam_front', frame_time: 55, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.assess).toHaveBeenCalledTimes(assessCountBeforeBlockedUpdate);
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(2);
    expect(h.stateService.getMetrics().retriesDispatched).toBe(1);
    h.coordinator.onModuleDestroy();
  });

  it('allows bounded UNDETERMINED retries after cooldown on improved quality only up to maxRetries', async () => {
    const h = buildHarness();
    let now = 60_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const camera = makeCamera();
    const emb = encodeVector([0, 0, 1, 0]);
    h.getCroppedSnapshot.mockResolvedValue(Buffer.from('crop'));

    const evUndet = makeEvent({ id: '11111111-1111-4111-8111-111111111132', track_id: 't-und' });
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.83, embeddingBase64: emb }));
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: evUndet,
      after: { id: 't-und', camera: 'cam_front', frame_time: 56, label: 'person', score: 0.9 },
      isCreated: true,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);

    await h.coordinator.onRecognitionResult({
      eventId: evUndet.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't-und',
      collectionVersion: 1,
      revision: 1,
      personStatus: 'UNDETERMINED',
      disposition: 'ACCEPTED',
    });

    // Within 4s cooldown -> skipped before sampling!
    const assessBeforeCooldown = h.assess.mock.calls.length;
    now += 2_000;
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUndet,
      after: { id: 't-und', camera: 'cam_front', frame_time: 58, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.assess).toHaveBeenCalledTimes(assessBeforeCooldown);
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);

    // After 4s cooldown with improved score -> retry 1 (revision 2)
    now += 2_500;
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.9, embeddingBase64: emb }));
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUndet,
      after: { id: 't-und', camera: 'cam_front', frame_time: 60.5, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(2);
    expect(h.enqueueFaceJob).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }));

    // Second UNDETERMINED -> after 4s cooldown with further improved score -> retry 2 (revision 3)
    await h.coordinator.onRecognitionResult({
      eventId: evUndet.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't-und',
      collectionVersion: 1,
      revision: 2,
      personStatus: 'UNDETERMINED',
      disposition: 'ACCEPTED',
    });
    now += 4_500;
    h.assess.mockResolvedValueOnce(makeGateResult({ qualityScore: 0.95, embeddingBase64: emb }));
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUndet,
      after: { id: 't-und', camera: 'cam_front', frame_time: 65, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(3);
    expect(h.enqueueFaceJob).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 3 }));

    // Third UNDETERMINED -> maxRetries (2) exhausted -> blocked before sampling!
    await h.coordinator.onRecognitionResult({
      eventId: evUndet.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't-und',
      collectionVersion: 1,
      revision: 3,
      personStatus: 'UNDETERMINED',
      disposition: 'ACCEPTED',
    });
    const assessAfterExhaustion = h.assess.mock.calls.length;
    now += 5_000;
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event: evUndet,
      after: { id: 't-und', camera: 'cam_front', frame_time: 70, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });
    expect(h.assess).toHaveBeenCalledTimes(assessAfterExhaustion);
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(3);
    expect(h.stateService.getMetrics().retriesDispatched).toBe(2);
    h.coordinator.onModuleDestroy();
  });

  it('falls back cleanly to legacy immediate dispatch on isCreated when FACE_TRACK_OPTIMIZATION_ENABLED=false', async () => {
    const h = buildHarness({
      FACE_TRACK_OPTIMIZATION_ENABLED: 'false',
      FACE_JOB_TRANSPORT: 'bullmq',
    });
    const camera = makeCamera();
    const event = makeEvent();

    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event,
      after: {
        id: 'track-1',
        camera: 'cam_front',
        frame_time: 100,
        start_time: 100,
        label: 'person',
        score: 0.9,
      },
      isCreated: true,
      camera,
    });
    await h.coordinator.handleTrackEvent({
      messageType: 'update',
      event,
      after: { id: 'track-1', camera: 'cam_front', frame_time: 101, label: 'person', score: 0.9 },
      isCreated: false,
      camera,
    });

    expect(h.assess).not.toHaveBeenCalled();
    expect(h.faceQueueAdd).toHaveBeenCalledTimes(1);
    expect(h.faceQueueAdd).toHaveBeenCalledWith(
      'match_face',
      expect.objectContaining({
        eventId: event.id,
        trackId: 'track-1',
        cameraSlug: 'cam_front',
      }),
    );
    h.coordinator.onModuleDestroy();
  });

  it('matches spatial+appearance Re-ID on track drop with 0 quality-gate/AWS calls and flushes pending bestShot on end', async () => {
    const h = buildHarness();
    let now = 70_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const camera = makeCamera();

    const personCrop1 = await solidJpeg({ r: 20, g: 50, b: 220 }, { r: 25, g: 25, b: 30 });
    const personCrop2 = await solidJpeg({ r: 24, g: 54, b: 215 }, { r: 30, g: 30, b: 35 });

    // Track 1: bestShot has 0.65 (< 0.82 earlyDispatch), then 'end' arrives early at +200ms -> dispatches on end!
    const event1 = makeEvent({ id: '11111111-1111-4111-8111-111111111141', track_id: 't-end-1' });
    h.getCroppedSnapshot.mockResolvedValueOnce(personCrop1);
    h.assess.mockResolvedValueOnce(
      makeGateResult({ qualityScore: 0.65, embeddingBase64: encodeVector([1, 0, 0, 0]) }),
    );
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event1,
      after: {
        id: 't-end-1',
        camera: 'cam_front',
        frame_time: 70,
        label: 'person',
        score: 0.9,
        box: [100, 100, 220, 340],
      },
      isCreated: true,
      camera,
    });
    expect(h.enqueueFaceJob).not.toHaveBeenCalled();

    now += 200;
    await h.coordinator.handleTrackEvent({
      messageType: 'end',
      event: event1,
      after: {
        id: 't-end-1',
        camera: 'cam_front',
        frame_time: 70.2,
        label: 'person',
        score: 0.9,
        box: [105, 100, 225, 340],
      },
      isCreated: false,
      camera,
    });
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1);

    await h.coordinator.onRecognitionResult({
      eventId: event1.id,
      cameraSlug: 'cam_front',
      ownerScopeId: camera.owner_user_id!,
      trackId: 't-end-1',
      collectionVersion: 1,
      revision: 1,
      personStatus: 'KNOWN',
      matchedKnownFaceId: aliceId,
      matchedPersonName: 'Alice',
      similarity: 0.96,
      disposition: 'ACCEPTED',
    });

    // Track 2 appears 1s later at nearby box with same appearance -> spatial-appearance Re-ID hits BEFORE quality gate!
    now += 1_000;
    const event2 = makeEvent({ id: '11111111-1111-4111-8111-111111111142', track_id: 't-reid-2' });
    h.getCroppedSnapshot.mockResolvedValueOnce(personCrop2);
    await h.coordinator.handleTrackEvent({
      messageType: 'new',
      event: event2,
      after: {
        id: 't-reid-2',
        camera: 'cam_front',
        frame_time: 71.2,
        label: 'person',
        score: 0.91,
        box: [112, 102, 232, 342],
      },
      isCreated: true,
      camera,
    });

    expect(h.assess).toHaveBeenCalledTimes(1); // NOT called for t-reid-2!
    expect(h.enqueueFaceJob).toHaveBeenCalledTimes(1); // 0 AWS calls!
    expect(h.stateService.getMetrics().spatialReidHits).toBe(1);
    expect(h.submitAiResult).toHaveBeenCalledWith(
      event2.id,
      expect.objectContaining({
        personStatus: 'KNOWN',
        matchedKnownFaceId: aliceId,
        results: [
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'local-session-cache',
              cacheHit: true,
              matchMethod: 'spatial-appearance',
            }),
          }),
        ],
      }),
    );
    h.coordinator.onModuleDestroy();
  });
});
