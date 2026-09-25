import { Module } from '@nestjs/common';
import { NotificationRetryWorker } from './notification-retry-worker.service';
import { TELEGRAM_CHANNEL } from './notification-channel.interface';
import { NotificationsRepository } from './notifications.repository';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { TelegramLinkController } from './telegram/telegram-link.controller';
import { TelegramLinkRepository } from './telegram/telegram-link.repository';
import { TelegramLinkService } from './telegram/telegram-link.service';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { TelegramWebhookGuard } from './telegram/telegram-webhook.guard';
import { TelegramWebhookRepository } from './telegram/telegram-webhook.repository';
import { TelegramWebhookService } from './telegram/telegram-webhook.service';

@Module({
  controllers: [TelegramLinkController, TelegramWebhookController],
  providers: [
    NotificationsRepository,
    NotificationRetryWorker,
    TelegramAdapter,
    TelegramLinkRepository,
    TelegramLinkService,
    TelegramWebhookGuard,
    TelegramWebhookRepository,
    TelegramWebhookService,
    { provide: TELEGRAM_CHANNEL, useExisting: TelegramAdapter },
  ],
  exports: [NotificationsRepository],
})
export class NotificationsModule {}
