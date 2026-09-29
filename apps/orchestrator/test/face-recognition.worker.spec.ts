import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import {
  FaceRecognitionWorker,
  type MatchFaceJob,
} from '../src/face-recognition/face-recognition.worker';
import type { AiResultsService } from '../src/ai-results/ai-results.service';
import type { SubmitAiResultDto } from '../src/ai-results/dto/submit-ai-result.dto';
import type { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function faceJob(overrides: Partial<MatchFaceJob> = {}): Job<MatchFaceJob, void, string> {
  return {
    data: {
      eventId: EVENT_ID,
      trackId: 'track-1',
      cameraSlug: 'front-door',
      ownerScopeId: '22222222-2222-4222-8222-222222222222',
      collectionVersion: 7,
      ...overrides,
    },
  } as Job<MatchFaceJob, void, string>;
}

describe('FaceRecognitionWorker (US-10 -> US-11)', () => {
  let getCroppedSnapshot: jest.MockedFunction<FrigateMediaAdapter['getCroppedSnapshot']>;
  let submit: jest.MockedFunction<AiResultsService['submit']>;
  let worker: FaceRecognitionWorker;

  beforeEach(() => {
    getCroppedSnapshot = jest.fn();
    submit = jest.fn().mockResolvedValue({
      resultId: '33333333-3333-4333-8333-333333333333',
      disposition: 'ACCEPTED',
      aggregateVersion: 2,
    });
    worker = new FaceRecognitionWorker(
      { getCroppedSnapshot } as unknown as FrigateMediaAdapter,
      { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService,
      { submit } as unknown as AiResultsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['NO_FACE_DETECTED', 'MULTIPLE_FACES'])(
    'chuẩn hóa quality outcome %s của producer cũ thành UNDETERMINED',
    async (code) => {
      getCroppedSnapshot.mockResolvedValue(Buffer.from('jpg'));
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          requestId: '33333333-3333-4333-8333-333333333333',
          collectionVersion: 7,
          personStatus: 'UNDETERMINED',
          labelConfidence: null,
          similarity: null,
          confidencePolicyVersion: 'v1',
          qualityReason: null,
          modelVersion: 'face-v1',
          processedAt: '2026-09-28T05:00:00.000Z',
          error: { code, message: 'Không thấy mặt rõ ràng' },
        }),
      } as unknown as Response);

      await worker.process(faceJob());

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0][1]).toMatchObject({
        personStatus: 'UNDETERMINED',
        matchedKnownFaceId: null,
        error: null,
        results: [
          {
            label: 'UNDETERMINED',
            confidence: null,
            metadata: { similarity: null, qualityReason: code },
          },
        ],
      });
    },
  );

  it.each(['MODEL_NOT_LOADED', 'COLLECTION_NOT_READY', 'PROVIDER_UNAVAILABLE'])(
    'giữ %s là lỗi kỹ thuật, không tạo nhãn thành công',
    async (code) => {
      getCroppedSnapshot.mockResolvedValue(Buffer.from('jpg'));
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          requestId: '33333333-3333-4333-8333-333333333333',
          collectionVersion: 7,
          personStatus: null,
          modelVersion: 'face-v1',
          processedAt: '2026-09-28T05:00:00.000Z',
          error: { code, message: 'Không phân tích được ảnh' },
        }),
      } as unknown as Response);

      await worker.process(faceJob());

      expect(submit.mock.calls[0][1]).toMatchObject({ results: [], error: { code } });
      expect(submit.mock.calls[0][1].personStatus).toBeUndefined();
    },
  );

  it('gửi lỗi kỹ thuật qua receipt US-11 khi không lấy được crop', async () => {
    getCroppedSnapshot.mockResolvedValue(null);

    await worker.process(faceJob());

    expect(submit).toHaveBeenCalledTimes(1);
    const [eventId, dto] = submit.mock.calls[0] as [string, SubmitAiResultDto];
    expect(eventId).toBe(EVENT_ID);
    expect(dto).toMatchObject({
      schemaVersion: 1,
      eventId: EVENT_ID,
      observationId: 'track:track-1:face',
      module: 'M1_FACE',
      results: [],
      error: { code: 'IMAGE_DECODE_FAILED' },
    });
    expect(dto.personStatus).toBeUndefined();
  });

  it('chuẩn hóa MatchResponse UNKNOWN thành SubmitAiResultDto của US-11', async () => {
    getCroppedSnapshot.mockResolvedValue(Buffer.from('jpg'));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        requestId: '33333333-3333-4333-8333-333333333333',
        collectionVersion: 7,
        labelConfidence: 0.8,
        confidencePolicyVersion: 'inverse-similarity-v1',
        qualityReason: null,
        personStatus: 'UNKNOWN',
        matchedKnownFaceId: null,
        similarity: 0.2,
        thresholdUsed: 0.6,
        boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
        modelVersion: 'face-v1',
        provider: 'local',
        fellBackToLocal: false,
        processedAt: '2026-09-28T05:00:00.000Z',
        error: null,
      }),
    } as unknown as Response);

    await worker.process(faceJob());

    const [, dto] = submit.mock.calls[0] as [string, SubmitAiResultDto];
    expect(dto).toMatchObject({
      resultId: '33333333-3333-4333-8333-333333333333',
      requestId: '33333333-3333-4333-8333-333333333333',
      eventId: EVENT_ID,
      observationId: 'track:track-1:face',
      module: 'M1_FACE',
      modelVersion: 'face-v1',
      personStatus: 'UNKNOWN',
      collectionVersion: 7,
      error: null,
    });
    expect(dto.results).toEqual([
      {
        module: 'M1_FACE',
        label: 'UNKNOWN',
        confidence: 0.8,
        boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
        metadata: {
          similarity: 0.2,
          thresholdUsed: 0.6,
          confidencePolicyVersion: 'inverse-similarity-v1',
          qualityReason: null,
          collectionVersion: 7,
          provider: 'local',
          fellBackToLocal: false,
        },
      },
    ]);
  });
});
