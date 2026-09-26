import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EscalationRepository } from './escalation.repository';

@Injectable()
export class EscalationDeadlineWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscalationDeadlineWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly repository: EscalationRepository,
    private readonly configService: ConfigService,
  ) {
    this.pollIntervalMs = Number(
      this.configService.get<number>('ESCALATION_POLL_INTERVAL_MS') ?? 5000,
    );
    this.batchSize = Number(this.configService.get<number>('ESCALATION_BATCH_SIZE') ?? 10);
  }

  onModuleInit(): void {
    this.logger.log(
      `Khởi động EscalationDeadlineWorker (quét mỗi ${this.pollIntervalMs}ms, tối đa ${this.batchSize} events/lần)`,
    );
    // Quét ngay khi khởi động để phục hồi các deadline quá hạn trong lúc server tắt (FR-ESC-07)
    void this.scanAndProcessDueDeadlines();

    this.timer = setInterval(() => {
      void this.scanAndProcessDueDeadlines();
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Đã dừng EscalationDeadlineWorker');
  }

  /**
   * Quét và leo thang tự động các sự kiện quá hạn deadline (FR-ESC-02, FR-ESC-07)
   */
  async scanAndProcessDueDeadlines(): Promise<number> {
    if (this.isProcessing) {
      return 0;
    }

    this.isProcessing = true;
    let processedCount = 0;
    const client = await this.repository.getPoolClient();

    try {
      await client.query('BEGIN');
      const dueEvents = await this.repository.findDueEventsForEscalation(client, this.batchSize);

      if (dueEvents.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      const now = new Date();
      for (const event of dueEvents) {
        const latenessMs = event.escalation_deadline_at
          ? now.getTime() - new Date(event.escalation_deadline_at).getTime()
          : 0;

        this.logger.warn(
          `Sự kiện ${event.id} (${event.event_type}, ${event.priority}) đã hết thời gian chờ (trễ ${latenessMs}ms). Tự động chuyển sang ESCALATED`,
        );

        await this.repository.updateEventStatus(client, event.id, event.version, {
          status: 'ESCALATED',
          escalatedAt: now,
          escalationDeadlineAt: null,
        });

        await this.repository.createStatusHistory(client, {
          eventId: event.id,
          fromStatus: 'NOTIFIED',
          toStatus: 'ESCALATED',
          reason: 'TIMEOUT',
          actorType: 'SYSTEM',
          metadata: {
            deadlineAt: event.escalation_deadline_at,
            latenessMs,
            recoveredAfterRestart: true,
          },
        });

        // Tạo notification intent khẩn cấp cho worker gọi điện/thông báo (US-14/US-27)
        await this.repository.createNotificationIntent(client, {
          eventId: event.id,
          channel: 'CONNECT_CALL',
          status: 'PENDING',
          escalationLevel: 1,
          payload: {
            reason: 'TIMEOUT',
            originalPriority: event.priority,
            deadlineAt: event.escalation_deadline_at,
          },
        });

        processedCount++;
      }

      await client.query('COMMIT');
      return processedCount;
    } catch (error) {
      this.logger.error('Lỗi khi quét và xử lý deadline leo thang', error);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.debug('Lỗi rollback scanAndProcessDueDeadlines', rollbackErr);
      }
      return 0;
    } finally {
      client.release();
      this.isProcessing = false;
    }
  }
}
