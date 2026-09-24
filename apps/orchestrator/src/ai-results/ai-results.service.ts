import { createHash } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiResultValidator } from './ai-result.validator';
import { AiResultOutboxService } from './ai-result-outbox.service';
import {
  AiResultEventNotFoundError,
  AiResultIdempotencyConflictError,
  AiResultsRepository,
} from './ai-results.repository';
import type { AiResultAcceptedDto, SubmitAiResultDto } from './dto/submit-ai-result.dto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function toPayload(dto: SubmitAiResultDto): Record<string, unknown> {
  return {
    schemaVersion: dto.schemaVersion,
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
    collectionVersion: dto.collectionVersion ?? null,
    results: dto.results,
    error: dto.error,
  };
}

@Injectable()
export class AiResultsService {
  private readonly logger = new Logger(AiResultsService.name);

  constructor(
    private readonly validator: AiResultValidator,
    private readonly repository: AiResultsRepository,
    private readonly outboxService: AiResultOutboxService,
  ) {}

  async submit(eventId: string, dto: SubmitAiResultDto): Promise<AiResultAcceptedDto> {
    const submission = this.validator.validate(eventId, dto);
    const payload = toPayload(dto);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(canonicalize(payload)))
      .digest('hex');

    try {
      const result = await this.repository.applyResult(submission, payloadHash, payload);
      this.logger.log(
        {
          correlationId: result.correlationId,
          eventId: result.eventId,
          resultId: result.resultId,
          module: submission.module,
          disposition: result.disposition,
        },
        'Đã tiếp nhận kết quả AI',
      );
      if (result.disposition === 'ACCEPTED') void this.outboxService.dispatchAvailable();
      return {
        resultId: result.resultId,
        disposition: result.disposition,
        aggregateVersion: result.aggregateVersion,
      };
    } catch (error) {
      if (error instanceof AiResultEventNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EVENT_NOT_FOUND', message: `Không tìm thấy sự kiện ${eventId}.` },
        });
      }
      if (error instanceof AiResultIdempotencyConflictError) {
        throw new ConflictException({
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: `resultId ${dto.resultId} đã được dùng với nội dung khác.`,
          },
        });
      }
      throw error;
    }
  }
}
