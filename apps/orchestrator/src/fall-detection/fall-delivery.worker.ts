import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AiResultsService } from '../ai-results/ai-results.service';
import { FallIncidentRepository } from './repository/fall-incident.repository';

/** Drain persisted evidence even after camera loss, restart, or disabling M2a admission. */
@Injectable()
export class FallDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FallDeliveryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly repository: FallIncidentRepository,
    private readonly aiResults: AiResultsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const incident = await this.repository.claimPending();
      if (!incident) return;
      try {
        const receipt = await this.aiResults.submit(incident.event_id, incident.pending_payload);
        if (!['ACCEPTED', 'DUPLICATE'].includes(receipt.disposition)) {
          throw new Error(`Fall submission was not applied: ${receipt.disposition}`);
        }
        await this.repository.markApplied(incident.id, incident.lease_token);
      } catch (error) {
        await this.repository.releaseForRetry(
          incident.id,
          incident.lease_token,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      this.logger.error(
        `Fall delivery retry failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
