/** Live-test wrapper: one photo request to the verified recipient, then only its edits/ack. */
import { TelegramApiError } from '../src/notifications/telegram/telegram-api.error';
import type {
  TelegramButtons,
  TelegramChannel,
  TelegramSentMessage,
} from '../src/notifications/notification-channel.interface';

export class LimitedTelegramChannel implements TelegramChannel {
  photoAttempts = 0;
  sent: TelegramSentMessage | null = null;
  captionEdited = false;
  callbackAnswered = false;
  readonly callbackData = new Set<string>();

  constructor(
    private readonly delegate: TelegramChannel,
    private readonly recipient: string,
    private readonly approved: () => boolean,
  ) {}

  async sendPhoto(
    chatId: string,
    photo: Buffer,
    caption: string,
    buttons: TelegramButtons,
  ): Promise<TelegramSentMessage> {
    if (
      !this.approved() ||
      chatId !== this.recipient ||
      this.photoAttempts !== 0 ||
      !caption.includes('Camera: US18 TEST bucket11')
    )
      throw new TelegramApiError('Live-test send scope or one-request budget exceeded', 400);
    for (const row of buttons.inline_keyboard)
      for (const button of row) this.callbackData.add(button.callback_data);
    this.photoAttempts += 1; // An uncertain network result must not cause another real request.
    this.sent = await this.delegate.sendPhoto(chatId, photo, caption, buttons);
    return this.sent;
  }

  async sendMessage(
    _chatId: string,
    _text: string,
    _buttons: TelegramButtons,
  ): Promise<TelegramSentMessage> {
    throw new TelegramApiError(
      'Live test requires exactly one photo; text fallback is disabled',
      400,
    );
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    if (!this.sent) throw new TelegramApiError('No live-test message to acknowledge', 400);
    await this.delegate.answerCallbackQuery(callbackQueryId, text);
    this.callbackAnswered = true;
  }

  async editMessageCaption(chatId: string, messageId: string, caption: string): Promise<void> {
    this.requireSentMessage(chatId, messageId);
    await this.delegate.editMessageCaption(chatId, messageId, caption);
    this.captionEdited = true;
  }

  async editMessageText(chatId: string, messageId: string, text: string): Promise<void> {
    this.requireSentMessage(chatId, messageId);
    await this.delegate.editMessageText(chatId, messageId, text);
  }

  async editMessageReplyMarkup(chatId: string, messageId: string): Promise<void> {
    this.requireSentMessage(chatId, messageId);
    await this.delegate.editMessageReplyMarkup(chatId, messageId);
  }

  private requireSentMessage(chatId: string, messageId: string): void {
    if (chatId !== this.recipient || this.sent?.messageId !== messageId)
      throw new TelegramApiError('Message is outside the live-test scope', 400);
  }
}
