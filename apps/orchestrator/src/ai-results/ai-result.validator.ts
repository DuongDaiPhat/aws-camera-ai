import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PersonStatus } from '@cam/contracts';
import type { AiResultItemDto, SubmitAiResultDto } from './dto/submit-ai-result.dto';
import type {
  AiResultProjectionItem,
  NormalizedBoundingBox,
  ValidatedAiResultSubmission,
} from './ai-result.types';

const FORBIDDEN_METADATA_KEYS = new Set([
  'image',
  'imagebase64',
  'embedding',
  'vector',
  'token',
  'accesstoken',
  'refreshtoken',
]);
const OTHER_MODULE_LABELS: Readonly<Record<string, readonly string[]>> = {
  M2A_FALL: ['FALL_DETECTED'],
  M2B_POSTURE: ['NORMAL_POSTURE', 'ABNORMAL_POSTURE'],
  M3_FIRE: ['FIRE_SMOKE_DETECTED'],
  M5_WELLNESS: ['WELLNESS_TIMEOUT'],
};
const SCORE_EPSILON = 0.000_001;

function requiredPositiveInteger(config: ConfigService, key: string): number {
  const value = Number(config.getOrThrow<string>(key));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương.`);
  }
  return value;
}

function metadataDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce(
    (maxDepth, child) => Math.max(maxDepth, metadataDepth(child, depth + 1)),
    depth,
  );
}

function containsForbiddenMetadata(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenMetadata);
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_METADATA_KEYS.has(key.replaceAll('_', '').toLowerCase()) ||
      containsForbiddenMetadata(child),
  );
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class AiResultValidator {
  private readonly maxItems: number;
  private readonly maxMetadataBytes: number;
  private readonly maxMetadataDepth: number;
  private readonly maxFutureSeconds: number;

  constructor(configService: ConfigService) {
    this.maxItems = requiredPositiveInteger(configService, 'AI_RESULT_MAX_ITEMS');
    this.maxMetadataBytes = requiredPositiveInteger(configService, 'AI_RESULT_MAX_METADATA_BYTES');
    this.maxMetadataDepth = requiredPositiveInteger(configService, 'AI_RESULT_MAX_METADATA_DEPTH');
    this.maxFutureSeconds = requiredPositiveInteger(configService, 'AI_RESULT_MAX_FUTURE_SECONDS');
  }

  validate(eventId: string, dto: SubmitAiResultDto): ValidatedAiResultSubmission {
    if (dto.eventId !== eventId) {
      this.reject('EVENT_ID_MISMATCH', 'eventId trong payload không khớp URL.');
    }
    this.validateProcessedAt(dto.processedAt);
    if (dto.results.length > this.maxItems) {
      this.reject('TOO_MANY_RESULTS', `Mỗi callback chỉ được tối đa ${this.maxItems} kết quả.`);
    }
    if (dto.error && dto.results.length > 0) {
      this.reject('INVALID_RESULT_SHAPE', 'Kết quả lỗi không được chứa nhãn thành công.');
    }
    if (!dto.error && dto.results.length === 0) {
      this.reject('INVALID_RESULT_SHAPE', 'Kết quả thành công phải có ít nhất một nhãn.');
    }

    dto.results.forEach((result) => this.validateItem(dto, result));
    this.validateModulePayload(dto);

    const results = dto.error
      ? [this.toErrorProjection(dto)]
      : dto.results.map((result) => this.toSuccessProjection(dto, result));

    return {
      schemaVersion: 1,
      resultId: dto.resultId,
      requestId: dto.requestId ?? null,
      eventId: dto.eventId,
      observationId: dto.observationId,
      revision: dto.revision,
      module: dto.module,
      modelVersion: dto.modelVersion,
      processedAt: dto.processedAt,
      personStatus: dto.personStatus ?? null,
      matchedKnownFaceId: dto.matchedKnownFaceId ?? null,
      results,
      error: dto.error ? { code: dto.error.code, message: dto.error.message } : null,
    };
  }

  private validateProcessedAt(processedAt: string): void {
    const processedTime = Date.parse(processedAt);
    if (processedTime > Date.now() + this.maxFutureSeconds * 1_000) {
      this.reject('INVALID_PROCESSED_AT', 'processedAt nằm quá xa trong tương lai.');
    }
  }

  private validateItem(dto: SubmitAiResultDto, result: AiResultItemDto): void {
    if (result.module !== dto.module) {
      this.reject('MODULE_MISMATCH', 'module của result item không khớp callback.');
    }
    if (result.confidence !== null && (result.confidence < 0 || result.confidence > 1)) {
      this.reject('INVALID_CONFIDENCE', 'confidence phải nằm trong khoảng 0..1.');
    }
    this.validateBoundingBox(result.boundingBox);
    const metadataBytes = Buffer.byteLength(JSON.stringify(result.metadata), 'utf8');
    if (metadataBytes > this.maxMetadataBytes) {
      this.reject('METADATA_TOO_LARGE', 'metadata vượt quá giới hạn cho phép.');
    }
    if (metadataDepth(result.metadata) > this.maxMetadataDepth) {
      this.reject('METADATA_TOO_DEEP', 'metadata lồng quá sâu.');
    }
    if (containsForbiddenMetadata(result.metadata)) {
      this.reject('FORBIDDEN_METADATA', 'metadata không được chứa ảnh, vector hoặc token.');
    }
  }

  private validateBoundingBox(box: NormalizedBoundingBox | null): void {
    if (!box) return;
    const values = [box.x, box.y, box.width, box.height];
    if (values.some((value) => value < 0 || value > 1)) {
      this.reject('INVALID_BOUNDING_BOX', 'Tọa độ bounding box phải nằm trong khoảng 0..1.');
    }
    if (box.x + box.width > 1 || box.y + box.height > 1) {
      this.reject('INVALID_BOUNDING_BOX', 'Bounding box vượt ra ngoài khung hình chuẩn hóa.');
    }
  }

  private validateModulePayload(dto: SubmitAiResultDto): void {
    if (dto.module === 'M1_FACE') {
      this.validateFacePayload(dto);
      return;
    }
    if (dto.module === 'M4_ZONE') {
      this.validateZonePayload(dto);
      return;
    }
    if (dto.personStatus || dto.matchedKnownFaceId) {
      this.reject('INVALID_PERSON_FIELDS', 'Chỉ M1_FACE được cập nhật trạng thái người.');
    }
    for (const result of dto.results) {
      if (!OTHER_MODULE_LABELS[dto.module]?.includes(result.label)) {
        this.reject('INVALID_MODULE_LABEL', `Nhãn ${result.label} không hợp lệ cho ${dto.module}.`);
      }
    }
  }

  private validateFacePayload(dto: SubmitAiResultDto): void {
    if (dto.error) {
      if (dto.personStatus || dto.matchedKnownFaceId) {
        this.reject('INVALID_FACE_ERROR', 'M1 lỗi không được gắn trạng thái hoặc người quen.');
      }
      return;
    }
    if (dto.results.length !== 1 || !dto.personStatus) {
      this.reject('INVALID_FACE_RESULT', 'M1 thành công phải có đúng một nhãn và personStatus.');
    }
    const result = dto.results[0];
    if (result.label !== dto.personStatus) {
      this.reject('INVALID_FACE_RESULT', 'Nhãn M1 phải trùng personStatus.');
    }
    if ((dto.personStatus === 'KNOWN') !== Boolean(dto.matchedKnownFaceId)) {
      this.reject(
        'INVALID_FACE_IDENTITY',
        'KNOWN phải có matchedKnownFaceId và nhãn khác phải null.',
      );
    }
    this.validateFaceScore(dto.personStatus, result);
  }

  private validateFaceScore(personStatus: PersonStatus, result: AiResultItemDto): void {
    const similarity = metadataNumber(result.metadata, 'similarity');
    const policyVersion = metadataString(result.metadata, 'confidencePolicyVersion');
    if (!policyVersion) {
      this.reject('INVALID_FACE_METADATA', 'Thiếu confidencePolicyVersion của M1.');
    }
    if (personStatus === 'UNDETERMINED') {
      if (result.confidence !== null || similarity !== null) {
        this.reject(
          'INVALID_FACE_SCORE',
          'UNDETERMINED phải có confidence và similarity bằng null.',
        );
      }
      return;
    }
    if (result.confidence === null) {
      this.reject('INVALID_FACE_SCORE', `${personStatus} phải có confidence.`);
    }
    if (similarity === null) {
      const isEmptyCollection =
        personStatus === 'UNKNOWN' &&
        result.confidence === 1 &&
        policyVersion === 'empty-collection-v1';
      if (!isEmptyCollection) {
        this.reject('INVALID_FACE_SCORE', 'Thiếu similarity cho kết quả nhận diện khuôn mặt.');
      }
      return;
    }
    const expectedConfidence = personStatus === 'KNOWN' ? similarity : 1 - similarity;
    if (Math.abs(result.confidence - expectedConfidence) > SCORE_EPSILON) {
      this.reject('INVALID_FACE_SCORE', 'confidence không đúng score policy của nhãn M1.');
    }
  }

  private validateZonePayload(dto: SubmitAiResultDto): void {
    if (dto.error || dto.results.length !== 1) {
      this.reject('INVALID_ZONE_RESULT', 'M4 phải có đúng một kết quả thành công.');
    }
    const result = dto.results[0];
    const dwellSeconds = metadataNumber(result.metadata, 'dwellSeconds');
    const minDwellSeconds = metadataNumber(result.metadata, 'minDwellSeconds');
    if (
      result.label !== 'RESTRICTED_ZONE' ||
      result.confidence === null ||
      result.metadata.scheduleActive !== true ||
      result.metadata.scoreSource !== 'FRIGATE_PERSON_DETECTION' ||
      dwellSeconds === null ||
      minDwellSeconds === null ||
      dwellSeconds < minDwellSeconds
    ) {
      this.reject(
        'INVALID_ZONE_RESULT',
        'Kết quả M4 chưa chứng minh vùng cấm, lịch và dwell hợp lệ.',
      );
    }
  }

  private toSuccessProjection(
    dto: SubmitAiResultDto,
    result: AiResultItemDto,
  ): AiResultProjectionItem {
    return {
      resultId: dto.resultId,
      observationId: dto.observationId,
      revision: dto.revision,
      module: dto.module,
      label: result.label,
      confidence: result.confidence,
      modelVersion: dto.modelVersion,
      processedAt: dto.processedAt,
      status: 'SUCCESS',
      error: null,
      boundingBox: result.boundingBox,
      metadata: result.metadata,
    };
  }

  private toErrorProjection(dto: SubmitAiResultDto): AiResultProjectionItem {
    const error = dto.error;
    if (!error) throw new Error('AiResultValidator invariant: missing error');
    return {
      resultId: dto.resultId,
      observationId: dto.observationId,
      revision: dto.revision,
      module: dto.module,
      label: null,
      confidence: null,
      modelVersion: dto.modelVersion,
      processedAt: dto.processedAt,
      status: 'ERROR',
      error: { code: error.code, message: error.message },
      boundingBox: null,
      metadata: {},
    };
  }

  private reject(code: string, message: string): never {
    throw new BadRequestException({ error: { code, message } });
  }
}
