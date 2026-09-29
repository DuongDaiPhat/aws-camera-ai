import { Module } from '@nestjs/common';
import { EscalationModule } from '../escalation/escalation.module';
import { EventsModule } from '../events/events.module';
import { TelegramCallbackService } from './telegram/telegram-callback.service';
import { TelegramWorkConfig } from './telegram/telegram-work.config';
import { TelegramWorkRepository } from './telegram/telegram-work.repository';
import { TelegramWorkWorker } from './telegram/telegram-work-worker.service';
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
  imports: [EscalationModule, EventsModule],
  controllers: [TelegramLinkController, TelegramWebhookController],
  providers: [
    TelegramCallbackService,
    TelegramWorkConfig,
    TelegramWorkRepository,
    TelegramWorkWorker,
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
