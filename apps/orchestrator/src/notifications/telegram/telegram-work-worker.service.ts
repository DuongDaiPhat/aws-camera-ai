import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { TELEGRAM_CHANNEL, type TelegramChannel } from '../notification-channel.interface';
import { TelegramApiError } from './telegram-api.error';
import { TelegramCallbackService } from './telegram-callback.service';
import { TelegramLinkRepository } from './telegram-link.repository';
import { TelegramWorkConfig } from './telegram-work.config';
import {
  TelegramWorkRepository,
  type TelegramEditJob,
  type TelegramInboxJob,
} from './telegram-work.repository';

@Injectable()
export class TelegramWorkWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramWorkWorker.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly config: TelegramWorkConfig,
    private readonly repository: TelegramWorkRepository,
    private readonly callbacks: TelegramCallbackService,
    private readonly links: TelegramLinkRepository,
    @Inject(TELEGRAM_CHANNEL) private readonly telegram: TelegramChannel,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.interval = setInterval(() => {
      void this.runOnce().catch(() =>
        this.logger.error('Không thể xử lý hàng đợi callback/edit Telegram.'),
      );
    }, this.config.pollMs);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async runOnce(): Promise<void> {
    if (!this.config.enabled || this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < this.config.batchSize; i += 1) {
        const job = await this.repository.claimInbox(
          this.config.leaseSeconds,
          this.config.maxAttempts,
        );
        if (!job) break;
        await this.processInbox(job);
      }
      await this.repository.enqueueEdits(this.config.batchSize);
      for (let i = 0; i < this.config.batchSize; i += 1) {
        const job = await this.repository.claimEdit(
          this.config.leaseSeconds,
          this.config.maxAttempts,
        );
        if (!job) break;
        await this.processEdit(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async processInbox(job: TelegramInboxJob): Promise<void> {
    try {
      const update = job.update_body;
      let outcome = job.outcome;
      if (outcome === null) {
        if (update.kind === 'CALLBACK') {
          outcome = await this.callbacks.confirm({ ...update, updateId: Number(job.update_id) });
        } else if (update.kind === 'LINK') {
          const linked = await this.links.consume(update.tokenHash, update.actorId, update.chatId);
          outcome = linked
            ? 'Đã liên kết Telegram với tài khoản CameraAI.'
            : 'Mã liên kết không hợp lệ hoặc đã hết hạn.';
        } else {
          outcome = 'IGNORED';
        }
        await this.repository.saveOutcome(job, outcome);
      }
      // Nếu HTTP lỗi sau commit, retry chỉ trả lời kết quả đã lưu, không xác nhận lần nữa.
      try {
        if (update.kind === 'CALLBACK')
          await this.telegram.answerCallbackQuery(update.callbackId, outcome);
        if (update.kind === 'LINK')
          await this.telegram.sendMessage(update.chatId, outcome, { inline_keyboard: [] });
      } catch (error: unknown) {
        if (!(error instanceof TelegramApiError) || !error.permanent) throw error;
        this.logger.warn(`Không thể trả lời Telegram updateId=${job.update_id}; kết quả đã lưu.`);
      }
      await this.repository.finishInbox(job);
    } catch (error: unknown) {
      const retry = this.failure(job.attempt_count, error);
      await this.repository.retryInbox(job, retry.code, retry.delaySeconds, retry.terminal);
      this.logger.warn(`Xử lý callback lỗi updateId=${job.update_id} code=${retry.code}`);
    }
  }

  private async processEdit(job: TelegramEditJob): Promise<void> {
    try {
      const text = buildConfirmationText(job);
      if (job.telegram_message_kind === 'PHOTO') {
        await this.telegram.editMessageCaption(job.provider_chat_id, job.provider_message_id, text);
      } else if (job.telegram_message_kind === 'TEXT') {
        await this.telegram.editMessageText(job.provider_chat_id, job.provider_message_id, text);
      } else {
        // Tin cũ trước migration không lưu loại nội dung; vẫn vô hiệu hóa nút an toàn.
        await this.telegram.editMessageReplyMarkup(job.provider_chat_id, job.provider_message_id);
      }
      await this.repository.finishEdit(job);
    } catch (error: unknown) {
      const retry = this.failure(job.attempt_count, error);
      await this.repository.retryEdit(job, retry.code, retry.delaySeconds, retry.terminal);
      this.logger.warn(
        `Sửa tin Telegram lỗi notificationId=${job.notification_id} code=${retry.code}`,
      );
    }
  }

  private failure(
    attempt: number,
    error: unknown,
  ): { code: string; delaySeconds: number; terminal: boolean } {
    const apiError = error instanceof TelegramApiError ? error : null;
    return {
      code: apiError ? `TELEGRAM_${apiError.status ?? 'NETWORK'}` : 'PROCESSING_ERROR',
      delaySeconds: Math.max(
        (this.config.pollMs / 1000) * 2 ** Math.min(attempt, 6),
        apiError?.retryAfterSeconds ?? 0,
      ),
      terminal: attempt >= this.config.maxAttempts || (apiError?.permanent ?? false),
    };
  }
}

export function buildConfirmationText(job: TelegramEditJob): string {
  const name = (job.full_name ?? 'Người chăm sóc').replace(/\s+/g, ' ').slice(0, 120);
  const at = new Intl.DateTimeFormat('vi-VN', {
    timeZone: job.timezone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(job.responded_at);
  const response = job.response === 'IM_OK' ? 'Tôi ổn' : 'Cần giúp đỡ';
  const suffix = `Đã xác nhận bởi ${name} lúc ${at}: ${response}`;
  const limit = job.telegram_message_kind === 'PHOTO' ? 1024 : 4096;
  return `${(job.telegram_message_text ?? '').slice(0, limit - suffix.length - 2)}\n\n${suffix}`;
}
