import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from '../../events/events.service';
import { EscalationEngineService } from '../../escalation/escalation-engine.service';
import { TelegramWorkRepository } from './telegram-work.repository';
import { TelegramWorkConfig } from './telegram-work.config';
import type { TelegramUpdate } from './telegram-webhook.service';

export type TelegramCallback = Extract<TelegramUpdate, { kind: 'CALLBACK' }>;

@Injectable()
export class TelegramCallbackService {
  constructor(
    private readonly repository: TelegramWorkRepository,
    private readonly engine: EscalationEngineService,
    private readonly config: TelegramWorkConfig,
    @Inject(EventsService) private readonly events: Pick<EventsService, 'publishCommittedUpdate'>,
  ) {}

  async confirm(update: TelegramCallback): Promise<string> {
    const parsed = parseCallbackData(update.data);
    if (!parsed || !update.chatId || !update.messageId) return 'Nút xác nhận không hợp lệ.';
    const target = await this.repository.findCallbackTarget(parsed.notificationId, update.actorId);
    if (!target) return 'Bạn không có quyền xác nhận tin này.';
    try {
      await this.engine.confirmInitial(target.eventId, target.actorUserId, {
        response: parsed.response,
        channel: 'TELEGRAM',
        notificationId: parsed.notificationId,
        sourceMessageId: update.messageId,
        sourceUpdateId: String(update.updateId),
        telegramSource: {
          notificationId: parsed.notificationId,
          telegramUserId: update.actorId,
          chatId: update.chatId,
          messageId: update.messageId,
          ttlSeconds: this.config.callbackTtlSeconds,
        },
      });
      await this.events.publishCommittedUpdate(target.eventId);
      return parsed.response === 'IM_OK'
        ? 'Đã xác nhận bạn an toàn.'
        : 'Đã ghi nhận yêu cầu giúp đỡ.';
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        await this.events.publishCommittedUpdate(target.eventId);
        return 'Sự kiện đã được xử lý hoặc không còn chờ xác nhận.';
      }
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        return 'Bạn không có quyền xác nhận tin này hoặc nút đã hết hạn.';
      }
      throw error;
    }
  }
}

export function parseCallbackData(data: string | null): {
  notificationId: string;
  response: 'IM_OK' | 'NEED_HELP';
} | null {
  // UUID ngẫu nhiên chỉ định danh notification, không thay thế kiểm tra quyền/chat/message.
  const match = /^cf:([a-f0-9]{32}):(ok|help)$/.exec(data ?? '');
  if (!match) return null;
  const id = match[1];
  return {
    notificationId: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    response: match[2] === 'ok' ? 'IM_OK' : 'NEED_HELP',
  };
}
