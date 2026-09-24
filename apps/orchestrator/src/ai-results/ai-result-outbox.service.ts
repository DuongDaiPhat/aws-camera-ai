import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsRepository } from '../events/events.repository';
import { EventsService } from '../events/events.service';
import { AiResultsRepository } from './ai-results.repository';

function requiredPositiveInteger(config: ConfigService, key: string): number {
  const value = Number(config.getOrThrow<string>(key));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương.`);
  }
  return value;
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
      let message = await this.aiResultsRepository.claimEventUpdateMessage(this.leaseSeconds);
      while (message) {
        await this.dispatchOne(message.id, message.event_id);
        message = await this.aiResultsRepository.claimEventUpdateMessage(this.leaseSeconds);
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

  private async dispatchOne(messageId: string, eventId: string): Promise<void> {
    try {
      const record = await this.eventsRepository.findEventSummaryById(eventId);
      if (!record) {
        throw new Error(`Không tìm thấy event ${eventId} của outbox message ${messageId}`);
      }
      const summary = await this.eventsService.toEventSummary(record);
      this.eventsService.emitEvent(summary, 'event.updated');
      await this.aiResultsRepository.markOutboxProcessed(messageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ eventId, messageId, err: message }, 'Phát event.updated thất bại');
      await this.aiResultsRepository.releaseOutboxMessage(messageId, this.retrySeconds, message);
    }
  }
}
