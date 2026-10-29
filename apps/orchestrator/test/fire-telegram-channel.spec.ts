import type { TelegramChannel } from '../src/notifications/notification-channel.interface';
import { LimitedTelegramChannel } from './fire-telegram-channel';

function delegate(): TelegramChannel {
  return {
    sendPhoto: jest.fn().mockResolvedValue({ chatId: 'verified-chat', messageId: 'message-1' }),
    sendMessage: jest.fn(),
    answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
    editMessageCaption: jest.fn().mockResolvedValue(undefined),
    editMessageText: jest.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
  };
}
const buttons = { inline_keyboard: [[{ text: 'Tôi ổn', callback_data: 'cf:fixture:ok' }]] };
const caption = 'Cảnh báo: Phát hiện lửa\nCamera: US18 TEST bucket11';

describe('explicit one-photo live Telegram scope', () => {
  it('does not call the provider before explicit approval', async () => {
    const api = delegate();
    const channel = new LimitedTelegramChannel(api, 'verified-chat', () => false);
    await expect(
      channel.sendPhoto('verified-chat', Buffer.from('photo'), caption, buttons),
    ).rejects.toThrow('scope');
    expect(api.sendPhoto).not.toHaveBeenCalled();
  });
  it('allows one photo request and refuses duplicate requests or text fallback', async () => {
    const api = delegate();
    const channel = new LimitedTelegramChannel(api, 'verified-chat', () => true);
    await channel.sendPhoto('verified-chat', Buffer.from('photo'), caption, buttons);
    await expect(
      channel.sendPhoto('verified-chat', Buffer.from('photo'), caption, buttons),
    ).rejects.toThrow('budget');
    await expect(channel.sendMessage('verified-chat', 'fallback', buttons)).rejects.toThrow(
      'fallback',
    );
    expect(api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
  it('cannot send to another chat or edit another message', async () => {
    const api = delegate();
    const channel = new LimitedTelegramChannel(api, 'verified-chat', () => true);
    await expect(
      channel.sendPhoto('other-chat', Buffer.from('photo'), caption, buttons),
    ).rejects.toThrow('scope');
    await channel.sendPhoto('verified-chat', Buffer.from('photo'), caption, buttons);
    await expect(
      channel.editMessageCaption('verified-chat', 'other-message', 'done'),
    ).rejects.toThrow('scope');
    await channel.editMessageCaption('verified-chat', 'message-1', 'done');
    expect(channel.captionEdited).toBe(true);
    expect(api.editMessageCaption).toHaveBeenCalledTimes(1);
  });
});
