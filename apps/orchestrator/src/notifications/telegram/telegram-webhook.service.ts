import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TELEGRAM_CHANNEL, type TelegramChannel } from '../notification-channel.interface';
import { TelegramLinkService } from './telegram-link.service';
import { hashTelegramLinkToken } from './telegram-link.service';
import { TelegramWebhookRepository } from './telegram-webhook.repository';

type TelegramUpdate =
  | {
      kind: 'CALLBACK';
      updateId: number;
      callbackId: string;
      actorId: string;
      chatId: string | null;
      messageId: string | null;
      data: string | null;
    }
  | { kind: 'LINK'; updateId: number; token: string; actorId: string; chatId: string }
  | { kind: 'IGNORED'; updateId: number };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function telegramId(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;
}

function privateChatActor(
  message: Record<string, unknown>,
  chat: Record<string, unknown> | null,
): string | null {
  const actorId = telegramId(record(message.from)?.id);
  const chatId = telegramId(chat?.id);
  return actorId && chatId && chat?.type === 'private' && actorId === chatId ? actorId : null;
}

function parseCallback(updateId: number, callback: Record<string, unknown>): TelegramUpdate {
  const actorId = telegramId(record(callback.from)?.id);
  const message = record(callback.message);
  if (typeof callback.id !== 'string' || !actorId) {
    throw new BadRequestException('Telegram callback không hợp lệ.');
  }
  return {
    kind: 'CALLBACK',
    updateId,
    callbackId: callback.id,
    actorId,
    chatId: telegramId(record(message?.chat)?.id),
    messageId: telegramId(message?.message_id),
    data: typeof callback.data === 'string' ? callback.data : null,
  };
}

function parseMessage(updateId: number, value: unknown): TelegramUpdate {
  const message = record(value);
  const text = message?.text;
  if (typeof text !== 'string' || !text.startsWith('/start ')) {
    return { kind: 'IGNORED', updateId };
  }
  const chat = record(message?.chat);
  const chatId = telegramId(chat?.id);
  const actorId = message ? privateChatActor(message, chat) : null;
  if (!actorId || !chatId) {
    return { kind: 'IGNORED', updateId };
  }
  return { kind: 'LINK', updateId, actorId, chatId, token: text.slice(7).trim() };
}

export function parseTelegramUpdate(value: unknown): TelegramUpdate {
  const update = record(value);
  if (!update) throw new BadRequestException('Telegram update không hợp lệ.');
  const updateId = update.update_id;
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId < 0) {
    throw new BadRequestException('Telegram update_id không hợp lệ.');
  }

  const callback = record(update.callback_query);
  return callback ? parseCallback(updateId, callback) : parseMessage(updateId, update.message);
}

@Injectable()
export class TelegramWebhookService {
  private readonly logger = new Logger(TelegramWebhookService.name);

  constructor(
    private readonly inbox: TelegramWebhookRepository,
    private readonly links: TelegramLinkService,
    @Inject(TELEGRAM_CHANNEL) private readonly telegram: TelegramChannel,
  ) {}

  async receive(body: unknown): Promise<{ ok: true }> {
    const update = parseTelegramUpdate(body);
    const minimalBody =
      update.kind === 'LINK'
        ? {
            kind: 'LINK',
            actorId: update.actorId,
            chatId: update.chatId,
            tokenHash: hashTelegramLinkToken(update.token),
          }
        : update;
    await this.inbox.store(update.updateId, minimalBody);

    if (update.kind === 'CALLBACK') {
      // Keep the update in the durable inbox until US-13 provides the canonical confirm port.
      throw new ServiceUnavailableException('Confirmation service chưa sẵn sàng.');
    }
    if (update.kind === 'LINK' && !(await this.inbox.isProcessed(update.updateId))) {
      const linked = await this.links.consume(update.token, update.actorId, update.chatId);
      await this.inbox.markProcessed(update.updateId);
      try {
        await this.telegram.sendMessage(
          update.chatId,
          linked
            ? 'Đã liên kết Telegram với tài khoản CameraAI.'
            : 'Mã liên kết không hợp lệ hoặc đã hết hạn.',
          { inline_keyboard: [] },
        );
      } catch {
        this.logger.warn(`Không thể trả lời liên kết Telegram updateId=${update.updateId}`);
      }
    } else {
      await this.inbox.markProcessed(update.updateId);
    }
    return { ok: true };
  }
}
