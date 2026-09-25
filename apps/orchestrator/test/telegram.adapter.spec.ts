import { ConfigService } from '@nestjs/config';
import { TelegramAdapter } from '../src/notifications/telegram/telegram.adapter';

describe('TelegramAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('upload bytes bằng multipart thay vì URL MinIO nội bộ', async () => {
    const telegramFetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 42, chat: { id: 12345 } },
        }),
        { status: 200 },
      ),
    );
    global.fetch = telegramFetch;
    const config = new ConfigService({
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
    });
    const adapter = new TelegramAdapter(config);

    const result = await adapter.sendPhoto('12345', Buffer.from('jpeg-bytes'), 'Cảnh báo', {
      inline_keyboard: [[{ text: 'Tôi ổn', callback_data: 'cf:abc:ok' }]],
    });

    expect(result).toEqual({ chatId: '12345', messageId: '42' });
    const request = telegramFetch.mock.calls[0][1];
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.body.get('photo')).toBeInstanceOf(Blob);
    expect(request.body.get('photo')).not.toBe('http://minio:9000/snapshot.jpg');
  });
});
