import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AiResultsService } from '../ai-results/ai-results.service';
import { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import { FireConfig } from './fire.config';
import { FireIncidentsRepository } from './fire-incidents.repository';

@Injectable()
export class FireDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FireDeliveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  constructor(
    private readonly config: FireConfig,
    private readonly repository: FireIncidentsRepository,
    private readonly results: AiResultsService,
  ) {}

  onModuleInit(): void {
    // Durable work continues even when M3 admission is disabled for rollback.
    this.timer = setInterval(() => {
      void this.dispatch().catch((error) =>
        this.logger.error({ err: error }, 'Fire delivery poll failed'),
      );
    }, this.config.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const work = await this.repository.claim(this.config.leaseSeconds);
      if (!work) return;
      try {
        const dto = plainToInstance(SubmitAiResultDto, work.pending_payload);
        if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
          throw new Error('Invalid persisted fire submission');
        const receipt = await this.results.submit(work.event_id, dto);
        if (!['ACCEPTED', 'DUPLICATE'].includes(receipt.disposition))
          throw new Error('Fire receipt was not applied');
        await this.repository.applied(work);
      } catch (error) {
        this.logger.error(
          {
            eventId: work.event_id,
            incidentId: work.id,
            error: error instanceof Error ? error.message : 'Unknown fire delivery error',
          },
          'Fire pending result delivery failed',
        );
        await this.repository.retry(work, this.config.retrySeconds, 'FIRE_RESULT_DELIVERY_FAILED');
      }
    } finally {
      this.busy = false;
    }
  }
}
