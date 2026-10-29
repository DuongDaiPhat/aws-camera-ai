import { ConfigService } from '@nestjs/config';
import { RestAreaEvaluator } from '../src/fall-detection/evaluator/rest-area.evaluator';
import { FallIncidentCoordinator } from '../src/fall-detection/coordinator/fall-incident.coordinator';
import { PoseFrameConsumer } from '../src/fall-detection/consumer/pose-frame.consumer';
import { unpackPoseFrameEnvelope } from '../src/fall-detection/envelope/pose-frame-envelope';

const config = new ConfigService({ M2A_ENABLED: 'true' });
const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
const context = {
  cameraId: '11111111-1111-4111-8111-111111111111',
  cameraSlug: 'qa-camera',
  sourceSessionId: 'qa-session',
  frameId: 'qa-frame',
  frameTimestamp: new Date('2026-10-18T00:00:16Z'),
  imageBytes: Buffer.from([255, 216, 255, 217]),
  persons: [{ trackId: 'qa-track', boundingBox: box, observedAt: Date.now() / 1000 }],
};
const confirmed = {
  trackId: 'qa-track',
  cameraSlug: 'qa-camera',
  sourceSessionId: 'qa-session',
  state: 'CONFIRMED',
  frameId: context.frameId,
  observedAt: context.frameTimestamp.toISOString(),
  poseAvailable: true,
  reason: 'IMMOBILE_CONFIRMED',
  thresholdSeconds: 3,
  error: null,
  episodeId: '22222222-2222-4222-8222-222222222222',
  candidateStartedAt: '2026-10-18T00:00:12.800Z',
  confirmedAt: '2026-10-18T00:00:16Z',
  modelVersion: 'pose-lite-qa',
  processedAt: '2026-10-18T00:00:16Z',
  immobileSeconds: 3.2,
  torsoAngleDeg: 10,
  confidence: 0.98,
};
function envelope(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      sourceSessionId: 's',
      frameId: 'f',
      cameraSlug: 'qa-camera',
      frameTimestamp: Date.now() / 1000,
      frameWidth: 640,
      frameHeight: 480,
      persons: context.persons,
      ...overrides,
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, context.imageBytes]);
}
function setup(response = confirmed, rest?: RestAreaEvaluator) {
  const repository = {
    createConfirmedIncident: jest.fn().mockImplementation((input) => ({
      eventId: 'event',
      fallIncidentId: 'incident',
      resultId: 'result',
      isNew: true,
      deliveryStatus: 'PENDING',
      pendingPayload: { ...input.pendingPayload, eventId: 'event', resultId: 'result' },
    })),
    markApplied: jest.fn(),
  };
  const ai = { submit: jest.fn().mockResolvedValue({ disposition: 'ACCEPTED' }) };
  const coordinator = new FallIncidentCoordinator(
    config,
    rest ?? ({ isPersonInRestArea: jest.fn().mockResolvedValue(false) } as never),
    { evaluateFall: jest.fn().mockResolvedValue(response) } as never,
    repository as never,
    ai as never,
    { storeBufferSnapshot: jest.fn() } as never,
  );
  return { coordinator, repository, ai };
}
describe('QA fall safety regression', () => {
  it.each([
    { cameraSlug: 'other-camera' },
    { sourceSessionId: 'other-session' },
    { frameId: 'other-frame' },
    { observedAt: '2026-10-18T00:00:15Z' },
    { episodeId: 'invalid' },
    { confirmedAt: 'invalid' },
    { candidateStartedAt: undefined },
    { immobileSeconds: 3 },
    { immobileSeconds: NaN },
    { confidence: 1.1 },
    { confirmedAt: '2026-10-18T00:00:17Z' },
    { torsoAngleDeg: 30 },
  ])('rejects malformed confirmation evidence %j', async (patch) => {
    const { coordinator, repository } = setup({ ...confirmed, ...patch } as typeof confirmed);
    await coordinator.processFrame(context);
    expect(repository.createConfirmedIncident).not.toHaveBeenCalled();
  });
  it('US16 envelope rejects unsupported schema version', () => {
    expect(unpackPoseFrameEnvelope(envelope({ schemaVersion: 2 }))).toBeNull();
  });
  it('US16 envelope rejects negative bbox dimensions', () => {
    expect(
      unpackPoseFrameEnvelope(
        envelope({
          persons: [{ trackId: 't', observedAt: 1, boundingBox: { ...box, width: -1 } }],
        }),
      ),
    ).toBeNull();
  });
  it.each([
    ['stale', -1.1],
    ['future', 0.6],
  ])('US16 rejects %s frame before inference', async (_kind, offset) => {
    const processor = { processFrame: jest.fn() };
    const consumer = new PoseFrameConsumer(
      config,
      { findBySlug: jest.fn().mockResolvedValue({ id: 'cam', is_enabled: true }) } as never,
      processor as never,
    );
    await consumer.handlePoseFrame(
      envelope({ frameTimestamp: Date.now() / 1000 + Number(offset) }),
    );
    expect(processor.processFrame).not.toHaveBeenCalled();
  });
  it('US17 does not create fall when REST_AREA lookup is unavailable', async () => {
    const rest = new RestAreaEvaluator({
      listByCameraId: jest.fn().mockRejectedValue(new Error('DB unavailable')),
    } as never);
    const { coordinator, repository } = setup(confirmed, rest);
    await coordinator.processFrame(context).catch(() => undefined);
    expect(repository.createConfirmedIncident).not.toHaveBeenCalled();
  });
  it('US16 does not create incident from response for another track', async () => {
    const { coordinator, repository } = setup({ ...confirmed, trackId: 'other-track' });
    await coordinator.processFrame(context);
    expect(repository.createConfirmedIncident).not.toHaveBeenCalled();
  });
  it('US16 does not synthesize missing episode evidence', async () => {
    const { coordinator, repository } = setup({ ...confirmed, episodeId: undefined } as never);
    await coordinator.processFrame(context);
    expect(repository.createConfirmedIncident).not.toHaveBeenCalled();
  });
  it('US17 retries the pending submission after a transient AI submit failure', async () => {
    const { coordinator, repository, ai } = setup();
    ai.submit
      .mockRejectedValueOnce(new Error('temporary submit failure'))
      .mockResolvedValueOnce({ disposition: 'ACCEPTED' });
    await coordinator.processFrame(context);
    await coordinator.processFrame(context);
    expect(ai.submit).toHaveBeenCalledTimes(2);
    expect(repository.markApplied).toHaveBeenCalledTimes(1);
  });
});
