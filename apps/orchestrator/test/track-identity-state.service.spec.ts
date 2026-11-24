import { ConfigService } from '@nestjs/config';
import { TrackIdentityStateService } from '../src/face-recognition/track-identity-state.service';

describe('TrackIdentityStateService (Layer 1 State Machine)', () => {
  const baseInput = {
    cameraSlug: 'cam_front',
    trackId: 'track-1',
    eventId: '11111111-1111-4111-8111-111111111111',
    cameraId: '22222222-2222-4222-8222-222222222222',
    ownerScopeId: '33333333-3333-4333-8333-333333333333',
    collectionVersion: 1,
    sourceSessionId: 'cam_front:1700000000.000000',
  };

  it('creates COLLECTING state, tracks best-shot by highest qualityScore, and keeps metrics', () => {
    const svc = new TrackIdentityStateService(new ConfigService({}));
    const { record, created } = svc.getOrCreate(baseInput, 1_000);
    expect(created).toBe(true);
    expect(record.state).toBe('COLLECTING');
    expect(record.currentRevision).toBe(0);

    svc.updateBestShot(
      record,
      {
        imageBuffer: Buffer.from('low'),
        qualityScore: 0.55,
        embedding: null,
        embeddingBase64: null,
        appearanceSignature: null,
        faceBoundingBox: null,
        personBox: [10, 10, 100, 200],
        capturedAt: 1_000,
      },
      1_000,
    );
    svc.updateBestShot(
      record,
      {
        imageBuffer: Buffer.from('best'),
        qualityScore: 0.81,
        embedding: null,
        embeddingBase64: null,
        appearanceSignature: null,
        faceBoundingBox: null,
        personBox: [10, 10, 100, 200],
        capturedAt: 1_400,
      },
      1_400,
    );
    svc.updateBestShot(
      record,
      {
        imageBuffer: Buffer.from('worse'),
        qualityScore: 0.62,
        embedding: null,
        embeddingBase64: null,
        appearanceSignature: null,
        faceBoundingBox: null,
        personBox: [10, 10, 100, 200],
        capturedAt: 1_800,
      },
      1_800,
    );

    expect(record.samplesCollected).toBe(3);
    expect(record.bestShot?.imageBuffer.toString()).toBe('best');
    expect(record.bestShot?.qualityScore).toBe(0.81);
    expect(svc.getMetrics().tracksCreated).toBe(1);
  });

  it('freezes KNOWN forever and never downgrades even on subsequent UNKNOWN/UNDETERMINED results', () => {
    const svc = new TrackIdentityStateService(new ConfigService({}));
    const { record } = svc.getOrCreate(baseInput, 1_000);
    const rev = svc.markDispatched(
      record,
      { qualityScore: 0.85, embedding: null, appearanceSignature: null, box: null },
      false,
      1_100,
    );
    expect(rev).toBe(1);
    expect(record.state).toBe('PENDING_RECOGNITION');
    expect(record.bestShot).toBeNull();

    svc.applyRecognitionResult(
      {
        cameraSlug: baseInput.cameraSlug,
        trackId: baseInput.trackId,
        eventId: baseInput.eventId,
        revision: 1,
        personStatus: 'KNOWN',
        matchedKnownFaceId: '44444444-4444-4444-8444-444444444444',
        matchedPersonName: 'Alice',
      },
      1_300,
    );
    expect(record.state).toBe('KNOWN');

    // Attempted downgrade must be ignored.
    svc.applyRecognitionResult(
      {
        cameraSlug: baseInput.cameraSlug,
        trackId: baseInput.trackId,
        eventId: baseInput.eventId,
        revision: 2,
        personStatus: 'UNKNOWN',
      },
      1_500,
    );
    expect(record.state).toBe('KNOWN');
    expect(record.matchedPersonName).toBe('Alice');
  });

  it('enforces UNKNOWN single recheck only on sufficient quality jump', () => {
    const svc = new TrackIdentityStateService(
      new ConfigService({
        FACE_UNKNOWN_ALLOW_SINGLE_RECHECK: 'true',
        FACE_UNKNOWN_RECHECK_MIN_QUALITY_GAIN: '0.15',
      }),
    );
    const { record } = svc.getOrCreate(baseInput, 1_000);
    svc.markDispatched(
      record,
      { qualityScore: 0.6, embedding: null, appearanceSignature: null, box: null },
      false,
      1_100,
    );
    svc.applyRecognitionResult(
      {
        eventId: baseInput.eventId,
        revision: 1,
        personStatus: 'UNKNOWN',
      },
      1_200,
    );
    expect(record.state).toBe('UNKNOWN');

    expect(svc.canRetryUnknown(record, 0.7)).toBe(false);
    expect(svc.canRetryUnknown(record, 0.75)).toBe(true);
    expect(svc.canRetryUnknown(record, 0.9, true)).toBe(false);

    record.unknownRecheckUsed = true;
    expect(svc.canRetryUnknown(record, 0.99)).toBe(false);
  });

  it('enforces UNDETERMINED bounded retries with cooldown and improved qualityScore', () => {
    const svc = new TrackIdentityStateService(
      new ConfigService({
        FACE_UNDETERMINED_MAX_RETRIES: '2',
        FACE_UNDETERMINED_RETRY_COOLDOWN_MS: '4000',
      }),
    );
    const { record } = svc.getOrCreate(baseInput, 1_000);
    svc.markDispatched(
      record,
      { qualityScore: 0.5, embedding: null, appearanceSignature: null, box: null },
      false,
      1_100,
    );
    svc.applyRecognitionResult(
      {
        eventId: baseInput.eventId,
        revision: 1,
        personStatus: 'UNDETERMINED',
      },
      2_000,
    );
    expect(record.state).toBe('UNDETERMINED');
    expect(svc.canAttemptUndeterminedRetry(record, 5_000)).toBe(false);
    expect(svc.canAttemptUndeterminedRetry(record, 6_000)).toBe(true);
    expect(svc.canRetryUndeterminedWithScore(record, 0.5)).toBe(false);
    expect(svc.canRetryUndeterminedWithScore(record, 0.65)).toBe(true);

    record.undeterminedRetriesUsed = 2;
    expect(svc.canAttemptUndeterminedRetry(record, 20_000)).toBe(false);
  });

  it('cleans up expired track states after FACE_TRACK_STATE_TTL_MS', () => {
    const svc = new TrackIdentityStateService(
      new ConfigService({ FACE_TRACK_STATE_TTL_MS: '5000' }),
    );
    svc.getOrCreate(baseInput, 1_000);
    expect(svc.get(baseInput.cameraSlug, baseInput.trackId, 4_000)).not.toBeNull();
    expect(svc.get(baseInput.cameraSlug, baseInput.trackId, 7_000)).toBeNull();
    expect(svc.findByEventId(baseInput.eventId, 7_000)).toBeNull();
  });
});
