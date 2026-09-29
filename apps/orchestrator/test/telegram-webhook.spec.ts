import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { TelegramWebhookGuard } from '../src/notifications/telegram/telegram-webhook.guard';
import {
  TelegramWebhookService,
  parseTelegramUpdate,
} from '../src/notifications/telegram/telegram-webhook.service';
import { TelegramWebhookRepository } from '../src/notifications/telegram/telegram-webhook.repository';
import { TelegramLinkService } from '../src/notifications/telegram/telegram-link.service';
import { TELEGRAM_CHANNEL } from '../src/notifications/notification-channel.interface';

const LINK_UPDATE = {
  update_id: 1001,
  message: {
    text: `/start ${'x'.repeat(43)}`,
    from: { id: 12345 },
    chat: { id: 12345, type: 'private' },
  },
};

describe('Telegram webhook', () => {
  const inbox = {
    store: jest.fn(),
    isProcessed: jest.fn(),
    markProcessed: jest.fn(),
  };
  const links = { consume: jest.fn() };
  const telegram = { sendMessage: jest.fn() };
  let service: TelegramWebhookService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TelegramWebhookService,
        { provide: TelegramWebhookRepository, useValue: inbox },
        { provide: TelegramLinkService, useValue: links },
        { provide: TELEGRAM_CHANNEL, useValue: telegram },
      ],
    }).compile();
    service = module.get(TelegramWebhookService);
    inbox.isProcessed.mockResolvedValue(false);
    links.consume.mockResolvedValue(true);
    telegram.sendMessage.mockResolvedValue({ chatId: '12345', messageId: '42' });
  });

  it('ACK sau khi lưu yêu cầu liên kết, không lưu token thô hay gọi mạng trong request', async () => {
    await expect(service.receive(LINK_UPDATE)).resolves.toEqual({ ok: true });

    expect(inbox.store).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        kind: 'LINK',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(inbox.store.mock.calls[0][1])).not.toContain('x'.repeat(43));
    expect(links.consume).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it('bỏ qua group chat mà không cấp quyền liên kết', () => {
    expect(
      parseTelegramUpdate({
        ...LINK_UPDATE,
        message: { ...LINK_UPDATE.message, chat: { id: -100, type: 'supergroup' } },
      }),
    ).toEqual({ kind: 'IGNORED', updateId: 1001 });
  });

  it('ACK callback đã lưu bền vững để worker gọi US-13', async () => {
    const callback = {
      update_id: 1002,
      callback_query: {
        id: 'callback-1',
        from: { id: 12345 },
        message: { message_id: 42, chat: { id: 12345 } },
        data: 'cf:6cc3d21fefe44bb4b32dce067494d70a:ok',
      },
    };
    await expect(service.receive(callback)).resolves.toEqual({ ok: true });
    expect(inbox.store).toHaveBeenCalledWith(
      1002,
      expect.objectContaining({
        callbackId: 'callback-1',
        actorId: '12345',
      }),
    );
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it('không ACK thành công khi database không lưu được inbox', async () => {
    inbox.store.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.receive(LINK_UPDATE)).rejects.toThrow('DB unavailable');
  });
});

describe('TelegramWebhookGuard', () => {
  const guard = new TelegramWebhookGuard(
    new ConfigService({
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_WEBHOOK_SECRET: 'valid_webhook_secret',
    }),
  );

  function context(secret: string | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ header: () => secret }) }),
    } as ExecutionContext;
  }

  it('chỉ cho qua request có webhook secret đúng', () => {
    expect(guard.canActivate(context('valid_webhook_secret'))).toBe(true);
    expect(() => guard.canActivate(context(undefined))).toThrow();
    expect(() => guard.canActivate(context('invalid_webhook_secret'))).toThrow();
  });
});
