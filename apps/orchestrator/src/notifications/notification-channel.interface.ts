export const TELEGRAM_CHANNEL = Symbol('TELEGRAM_CHANNEL');

export interface TelegramButtons {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramSentMessage {
  messageId: string;
  chatId: string;
}

export interface TelegramChannel {
  sendPhoto(
    chatId: string,
    photo: Buffer,
    caption: string,
    buttons: TelegramButtons,
  ): Promise<TelegramSentMessage>;
  sendMessage(chatId: string, text: string, buttons: TelegramButtons): Promise<TelegramSentMessage>;
  answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
  editMessageCaption(chatId: string, messageId: string, caption: string): Promise<void>;
  editMessageText(chatId: string, messageId: string, text: string): Promise<void>;
  editMessageReplyMarkup(chatId: string, messageId: string): Promise<void>;
}
