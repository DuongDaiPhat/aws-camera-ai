import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_TYPES, type EventType } from '@cam/contracts';
import { EscalationEngineService } from '../escalation/escalation-engine.service';
import type { AiCandidateResult } from '../escalation/escalation-policy';
import { EventsRepository } from '../events/events.repository';
import { EventsService } from '../events/events.service';
import {
  AiResultsRepository,
  type AiEscalationSnapshot,
  type AiResultOutboxRow,
} from './ai-results.repository';

function requiredPositiveInteger(config: ConfigService, key: string): number {
  const value = Number(config.getOrThrow<string>(key));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương.`);
  }
  return value;
}

function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && EVENT_TYPES.some((eventType) => eventType === value);
}

function hasCandidateFields(
  value: unknown,
): value is Record<
  | 'eventType'
  | 'resultId'
  | 'observationId'
  | 'processedAt'
  | 'module'
  | 'label'
  | 'confidence'
  | 'modelVersion',
  unknown
> {
  if (value === null || typeof value !== 'object') return false;
  return (
    'eventType' in value &&
    'resultId' in value &&
    'observationId' in value &&
    'processedAt' in value &&
    'module' in value &&
    'label' in value &&
    'confidence' in value &&
    'modelVersion' in value
  );
}

function isEscalationCandidate(
  value: unknown,
): value is AiCandidateResult & { eventType: EventType } {
  if (!hasCandidateFields(value)) return false;
  return (
    isEventType(value.eventType) &&
    typeof value.resultId === 'string' &&
    typeof value.observationId === 'string' &&
    typeof value.processedAt === 'string' &&
    typeof value.module === 'string' &&
    typeof value.label === 'string' &&
    (value.confidence === null ||
      (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) &&
    typeof value.modelVersion === 'string'
  );
}

function escalationCandidates(payload: unknown): AiCandidateResult[] {
  if (payload === null || typeof payload !== 'object' || !('candidates' in payload)) {
    throw new Error('Outbox evaluate-escalation thiếu candidates.');
  }
  const candidates = payload.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error('Outbox evaluate-escalation có candidates không hợp lệ.');
  }
  const parsedCandidates: unknown[] = candidates;
  if (!parsedCandidates.every(isEscalationCandidate)) {
    throw new Error('Outbox evaluate-escalation chứa candidate không hợp lệ.');
  }
  return parsedCandidates.map((candidate) => ({
    eventType: candidate.eventType,
    resultId: candidate.resultId,
    observationId: candidate.observationId,
    processedAt: candidate.processedAt,
    module: candidate.module,
    label: candidate.label,
    confidence: candidate.confidence,
    modelVersion: candidate.modelVersion,
  }));
}

function shouldSkipEvaluation(
  status: AiEscalationSnapshot['status'],
  candidateCount: number,
): boolean {
  if (['RESOLVED', 'CLOSED', 'NOTIFIED', 'ESCALATED'].includes(status)) return true;
  return candidateCount === 0 && (status === 'AI_FAILED' || status === 'LOGGED_ONLY');
}

@Injectable()
export class AiResultOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiResultOutboxService.name);
  private readonly pollMs: number;
  private readonly leaseSeconds: number;
  private readonly retrySeconds: number;
  private timer: NodeJS.Timeout | null = null;
  private isDispatching = false;

  constructor(
    configService: ConfigService,
    private readonly aiResultsRepository: AiResultsRepository,
    private readonly eventsRepository: EventsRepository,
    private readonly eventsService: EventsService,
    private readonly escalationEngine: EscalationEngineService,
  ) {
    this.pollMs = requiredPositiveInteger(configService, 'AI_RESULT_OUTBOX_POLL_MS');
    this.leaseSeconds = requiredPositiveInteger(configService, 'AI_RESULT_OUTBOX_LEASE_SECONDS');
    this.retrySeconds = requiredPositiveInteger(configService, 'AI_RESULT_OUTBOX_RETRY_SECONDS');
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchAvailable(), this.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatchAvailable(): Promise<void> {
    if (this.isDispatching) return;
    this.isDispatching = true;
    try {
      let message = await this.aiResultsRepository.claimOutboxMessage(this.leaseSeconds);
      while (message) {
        await this.dispatchOne(message);
        message = await this.aiResultsRepository.claimOutboxMessage(this.leaseSeconds);
      }
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Quét AI result outbox thất bại',
      );
    } finally {
      this.isDispatching = false;
    }
  }

  private async dispatchOne(message: AiResultOutboxRow): Promise<void> {
    const { id: messageId, event_id: eventId } = message;
    try {
      const snapshot = await this.aiResultsRepository.findEscalationSnapshot(eventId);
      if (!snapshot) {
        throw new Error(`Không tìm thấy event ${eventId} của outbox message ${messageId}`);
      }
      if (Number(snapshot.aggregate_version) > Number(message.aggregate_version)) {
        await this.aiResultsRepository.markOutboxProcessed(messageId);
        return;
      }
      if (message.message_type === 'evaluate-escalation') {
        await this.dispatchEscalation(message, snapshot);
        return;
      }
      await this.dispatchEventUpdate(messageId, eventId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ eventId, messageId, err: message }, 'Xử lý AI result outbox thất bại');
      await this.aiResultsRepository.releaseOutboxMessage(messageId, this.retrySeconds, message);
    }
  }

  private async dispatchEscalation(
    message: AiResultOutboxRow,
    snapshot: AiEscalationSnapshot,
  ): Promise<void> {
    const candidates = escalationCandidates(message.payload);
    if (shouldSkipEvaluation(snapshot.status, candidates.length)) {
      await this.aiResultsRepository.markOutboxProcessed(message.id);
      return;
    }
    await this.escalationEngine.evaluateAndTransition(
      message.event_id,
      {
        eventType: snapshot.event_type,
        detectedAt: snapshot.detected_at,
        aiResults: candidates,
        confidence: snapshot.confidence === null ? null : Number(snapshot.confidence),
        aiLabel: snapshot.ai_label,
      },
      message.id,
    );
  }

  private async dispatchEventUpdate(messageId: string, eventId: string): Promise<void> {
    const record = await this.eventsRepository.findEventSummaryById(eventId);
    if (!record) {
      throw new Error(`Không tìm thấy event ${eventId} của outbox message ${messageId}`);
    }
    const summary = await this.eventsService.toEventSummary(record);
    this.eventsService.emitEvent(summary, 'event.updated');
    await this.aiResultsRepository.markOutboxProcessed(messageId);
  }
}
