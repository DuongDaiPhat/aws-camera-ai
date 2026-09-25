import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  TelegramButtons,
  TelegramChannel,
  TelegramSentMessage,
} from '../notification-channel.interface';

interface TelegramResponse<Result> {
  ok: boolean;
  result?: Result;
  error_code?: number;
  parameters?: { retry_after?: number };
}

interface TelegramMessageResponse {
  message_id: number;
  chat: { id: number | string };
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }

  get permanent(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

@Injectable()
export class TelegramAdapter implements TelegramChannel {
  private readonly token: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    if (config.get<string>('TELEGRAM_ENABLED') === 'true' && !this.token) {
      throw new Error('TELEGRAM_BOT_TOKEN bắt buộc khi TELEGRAM_ENABLED=true.');
    }
    this.timeoutMs = Number(config.get<string>('TELEGRAM_TIMEOUT_MS') ?? 5000);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('TELEGRAM_TIMEOUT_MS phải là số nguyên dương.');
    }
  }

  async sendPhoto(
    chatId: string,
    photo: Buffer,
    caption: string,
    buttons: TelegramButtons,
  ): Promise<TelegramSentMessage> {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', caption);
    form.set('reply_markup', JSON.stringify(buttons));
    form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'snapshot.jpg');
    const message = await this.call<TelegramMessageResponse>('sendPhoto', form);
    return { chatId: String(message.chat.id), messageId: String(message.message_id) };
  }

  async sendMessage(
    chatId: string,
    text: string,
    buttons: TelegramButtons,
  ): Promise<TelegramSentMessage> {
    const message = await this.call<TelegramMessageResponse>('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: buttons,
    });
    return { chatId: String(message.chat.id), messageId: String(message.message_id) };
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    await this.call<boolean>('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  async editMessageCaption(chatId: string, messageId: string, caption: string): Promise<void> {
    await this.call<unknown>('editMessageCaption', {
      chat_id: chatId,
      message_id: messageId,
      caption,
      reply_markup: { inline_keyboard: [] },
    });
  }

  async editMessageText(chatId: string, messageId: string, text: string): Promise<void> {
    await this.call<unknown>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] },
    });
  }

  async editMessageReplyMarkup(chatId: string, messageId: string): Promise<void> {
    await this.call<unknown>('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  private async call<Result>(method: string, body: object | FormData): Promise<Result> {
    if (!this.token) throw new TelegramApiError('Telegram chưa được cấu hình.', 401);
    const isForm = body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // A timeout can occur after Telegram accepted the message; delivery is uncertain.
      throw new TelegramApiError('Không nhận được phản hồi từ Telegram.', null);
    }

    return this.parseResponse<Result>(response);
  }

  private async parseResponse<Result>(response: Response): Promise<Result> {
    let data: TelegramResponse<Result>;
    try {
      data = (await response.json()) as TelegramResponse<Result>;
    } catch {
      throw new TelegramApiError('Phản hồi Telegram không hợp lệ.', response.status);
    }
    if (!response.ok || !data.ok || data.result === undefined) {
      throw new TelegramApiError(
        `Telegram trả mã ${data.error_code ?? response.status}.`,
        data.error_code ?? response.status,
        data.parameters?.retry_after ?? null,
      );
    }
    return data.result;
  }
}
