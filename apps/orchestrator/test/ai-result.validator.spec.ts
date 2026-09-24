import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiResultValidator } from '../src/ai-results/ai-result.validator';
import { AiResultItemDto, SubmitAiResultDto } from '../src/ai-results/dto/submit-ai-result.dto';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function faceItem(overrides: Partial<AiResultItemDto> = {}): AiResultItemDto {
  return Object.assign(new AiResultItemDto(), {
    module: 'M1_FACE',
    label: 'UNKNOWN',
    confidence: 0.8,
    boundingBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.5 },
    metadata: {
      similarity: 0.2,
      thresholdUsed: 0.6,
      confidencePolicyVersion: 'inverse-similarity-v1',
      qualityReason: null,
    },
    ...overrides,
  });
}

function faceSubmission(overrides: Partial<SubmitAiResultDto> = {}): SubmitAiResultDto {
  return Object.assign(new SubmitAiResultDto(), {
    schemaVersion: 1,
    resultId: '22222222-2222-4222-8222-222222222222',
    requestId: '33333333-3333-4333-8333-333333333333',
    eventId: EVENT_ID,
    observationId: 'frame-101',
    revision: 1,
    module: 'M1_FACE',
    modelVersion: 'face-v1',
    processedAt: new Date().toISOString(),
    personStatus: 'UNKNOWN',
    matchedKnownFaceId: null,
    collectionVersion: 1,
    results: [faceItem()],
    error: null,
    ...overrides,
  });
}

describe('AiResultValidator (US-11)', () => {
  let validator: AiResultValidator;

  beforeEach(() => {
    validator = new AiResultValidator(
      new ConfigService({
        AI_RESULT_MAX_ITEMS: '20',
        AI_RESULT_MAX_METADATA_BYTES: '16384',
        AI_RESULT_MAX_METADATA_DEPTH: '5',
        AI_RESULT_MAX_FUTURE_SECONDS: '300',
      }),
    );
  });

  it('chuẩn hóa M1 UNKNOWN với confidence bằng 1 trừ similarity', () => {
    const result = validator.validate(EVENT_ID, faceSubmission());

    expect(result.personStatus).toBe('UNKNOWN');
    expect(result.results[0]).toMatchObject({
      label: 'UNKNOWN',
      confidence: 0.8,
      status: 'SUCCESS',
      modelVersion: 'face-v1',
    });
  });

  it('từ chối khi confidence UNKNOWN bị gán bằng similarity', () => {
    const dto = faceSubmission({ results: [faceItem({ confidence: 0.2 })] });
    expect(() => validator.validate(EVENT_ID, dto)).toThrow(BadRequestException);
  });

  it('giữ UNDETERMINED với confidence null và không coi no-face là lỗi kỹ thuật', () => {
    const dto = faceSubmission({
      personStatus: 'UNDETERMINED',
      results: [
        faceItem({
          label: 'UNDETERMINED',
          confidence: null,
          metadata: {
            similarity: null,
            thresholdUsed: 0.6,
            confidencePolicyVersion: 'inverse-similarity-v1',
            qualityReason: 'NO_FACE',
          },
        }),
      ],
    });

    expect(validator.validate(EVENT_ID, dto).results[0]).toMatchObject({
      label: 'UNDETERMINED',
      confidence: null,
      status: 'SUCCESS',
    });
  });

  it('từ chối bounding box vượt khung hình chuẩn hóa', () => {
    const dto = faceSubmission({
      results: [faceItem({ boundingBox: { x: 0.8, y: 0, width: 0.3, height: 1 } })],
    });
    expect(() => validator.validate(EVENT_ID, dto)).toThrow(BadRequestException);
  });

  it('từ chối metadata chứa embedding hoặc token', () => {
    const dto = faceSubmission({
      results: [faceItem({ metadata: { embedding: [0.1, 0.2] } })],
    });
    expect(() => validator.validate(EVENT_ID, dto)).toThrow(BadRequestException);
  });

  it('phân biệt lỗi kỹ thuật M1 với UNDETERMINED', () => {
    const dto = faceSubmission({
      personStatus: undefined,
      results: [],
      error: { code: 'MODEL_TIMEOUT', message: 'Model timeout' },
    });
    const result = validator.validate(EVENT_ID, dto);
    expect(result.results[0]).toMatchObject({
      label: null,
      confidence: null,
      status: 'ERROR',
      error: { code: 'MODEL_TIMEOUT' },
    });
  });

  it('từ chối M4 chưa đủ dwell', () => {
    const dto = faceSubmission({
      module: 'M4_ZONE',
      personStatus: undefined,
      results: [
        Object.assign(new AiResultItemDto(), {
          module: 'M4_ZONE',
          label: 'RESTRICTED_ZONE',
          confidence: 0.75,
          boundingBox: null,
          metadata: {
            scheduleActive: true,
            scoreSource: 'FRIGATE_PERSON_DETECTION',
            dwellSeconds: 1,
            minDwellSeconds: 2,
          },
        }),
      ],
    });
    expect(() => validator.validate(EVENT_ID, dto)).toThrow(BadRequestException);
  });
});
