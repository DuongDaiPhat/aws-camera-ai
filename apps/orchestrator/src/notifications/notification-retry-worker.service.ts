import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';
import { TELEGRAM_CHANNEL, type TelegramChannel } from './notification-channel.interface';
import { NotificationsRepository, type TelegramNotificationJob } from './notifications.repository';
import { TelegramApiError } from './telegram/telegram.adapter';
import { buildTelegramAlert, buildTelegramButtons } from './telegram/telegram-message-builder';

const RETRY_DELAYS_SECONDS = [2, 4, 8];
const MAX_TELEGRAM_PHOTO_BYTES = 10_000_000;

export function nextTelegramRetry(
  attemptCount: number,
  finishedAt: Date,
  retryAfterSeconds: number | null = null,
): Date | null {
  const backoff = RETRY_DELAYS_SECONDS[attemptCount - 1];
  if (backoff === undefined) return null;
  return new Date(finishedAt.getTime() + Math.max(backoff, retryAfterSeconds ?? 0) * 1000);
}

@Injectable()
export class NotificationRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRetryWorker.name);
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly leaseSeconds: number;
  private readonly batchSize: number;
  private readonly mediaWaitMs: number;
  private readonly storageProvider: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly repository: NotificationsRepository,
    @Inject(TELEGRAM_CHANNEL) private readonly telegram: TelegramChannel,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {
    this.enabled = config.get<string>('TELEGRAM_ENABLED') === 'true';
    this.pollMs = this.positiveInteger(config, 'TELEGRAM_POLL_MS', 3000);
    this.leaseSeconds = this.positiveInteger(config, 'TELEGRAM_LEASE_SECONDS', 30);
    this.batchSize = this.positiveInteger(config, 'TELEGRAM_BATCH_SIZE', 20);
    this.mediaWaitMs = this.positiveInteger(config, 'TELEGRAM_MEDIA_WAIT_MS', 1000);
    this.storageProvider = config.get<string>('STORAGE_PROVIDER', 'MINIO').toUpperCase();
    const timeoutMs = this.positiveInteger(config, 'TELEGRAM_TIMEOUT_MS', 5000);
    if (this.leaseSeconds * 1000 <= timeoutMs + this.mediaWaitMs + 5000) {
      throw new Error('TELEGRAM_LEASE_SECONDS phải dài hơn thời gian gửi và chờ ảnh.');
    }
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.interval = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.error('Không thể quét hàng đợi Telegram.', error);
      });
    }, this.pollMs);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async runOnce(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      // Claim immediately before each HTTP call so a queued job cannot lose its lease in memory.
      for (let index = 0; index < this.batchSize; index += 1) {
        const [job] = await this.repository.claimTelegramBatch(1, this.leaseSeconds);
        if (!job) break;
        await this.deliver(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(job: TelegramNotificationJob): Promise<void> {
    if (!this.canDeliverForStatus(job.status, job.escalationLevel)) {
      await this.repository.markSkipped(job);
      return;
    }
    if (!this.hasVerifiedRecipient(job)) {
      await this.repository.markFailed(job, 'TELEGRAM_LINK_NOT_VERIFIED', null);
      return;
    }

    const event = {
      eventType: job.eventType,
      cameraName: job.cameraName,
      zoneName: job.zoneName,
      detectedAt: job.detectedAt,
      timezone: job.timezone,
    };
    try {
      const photo = await this.loadSnapshot(job);
      if (!(await this.repository.eventAllowsDelivery(job.eventId, job.escalationLevel))) {
        await this.repository.markSkipped(job);
        return;
      }
      const buttons = buildTelegramButtons(job.id);
      const message = photo
        ? await this.telegram.sendPhoto(
            job.chatId,
            photo,
            buildTelegramAlert(event, false),
            buttons,
          )
        : await this.telegram.sendMessage(job.chatId, buildTelegramAlert(event, true), buttons);
      await this.repository.markSent(job, message.chatId, message.messageId);
    } catch (error: unknown) {
      await this.handleDeliveryFailure(job, error);
    }
  }

  private hasVerifiedRecipient(
    job: TelegramNotificationJob,
  ): job is TelegramNotificationJob & { chatId: string } {
    return Boolean(job.recipientActive && job.chatId && job.telegramUserId && job.telegramLinkedAt);
  }

  private canDeliverForStatus(status: string, escalationLevel: number): boolean {
    return status === 'NOTIFIED' || (status === 'ESCALATED' && escalationLevel > 0);
  }

  private async handleDeliveryFailure(job: TelegramNotificationJob, error: unknown): Promise<void> {
    const telegramError = error instanceof TelegramApiError ? error : null;
    const retryAt = telegramError?.permanent
      ? null
      : nextTelegramRetry(job.attemptCount, new Date(), telegramError?.retryAfterSeconds);
    const code = telegramError
      ? telegramError.status === null
        ? 'DELIVERY_UNCERTAIN'
        : `TELEGRAM_${telegramError.status}`
      : 'DELIVERY_ERROR';
    await this.repository.markFailed(job, code, retryAt);
    this.logger.warn(
      `Telegram delivery failed eventId=${job.eventId} correlationId=${job.correlationId} attempt=${job.attemptCount} code=${code}`,
    );
  }

  private async loadSnapshot(job: TelegramNotificationJob): Promise<Buffer | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot =
        attempt === 0 && job.snapshotKey && job.snapshotProvider
          ? { key: job.snapshotKey, provider: job.snapshotProvider }
          : await this.repository.findSnapshot(job.eventId);
      if (snapshot?.provider === this.storageProvider) {
        try {
          const photo = await this.storage.download(snapshot.key);
          if (photo.length <= MAX_TELEGRAM_PHOTO_BYTES) return photo;
        } catch {
          // The object may not be available immediately after its metadata is committed.
        }
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, this.mediaWaitMs));
    }
    this.logger.warn(
      `Gửi cảnh báo không có ảnh eventId=${job.eventId} correlationId=${job.correlationId}`,
    );
    return null;
  }

  private positiveInteger(config: ConfigService, key: string, fallback: number): number {
    const value = Number(config.get<string>(key) ?? fallback);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} phải là số nguyên dương.`);
    return value;
  }
}
