import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  NotificationRetryWorker,
  nextTelegramRetry,
} from '../src/notifications/notification-retry-worker.service';
import {
  NotificationsRepository,
  type TelegramNotificationJob,
} from '../src/notifications/notifications.repository';
import { TELEGRAM_CHANNEL } from '../src/notifications/notification-channel.interface';
import { STORAGE_SERVICE } from '../src/storage/storage.interface';
import { TelegramApiError } from '../src/notifications/telegram/telegram.adapter';

const JOB: TelegramNotificationJob = {
  id: '6cc3d21f-efe4-4bb4-b32d-ce067494d70a',
  eventId: '11111111-1111-1111-1111-111111111111',
  leaseToken: '22222222-2222-2222-2222-222222222222',
  attemptCount: 1,
  escalationLevel: 0,
  status: 'NOTIFIED',
  correlationId: '33333333-3333-3333-3333-333333333333',
  chatId: '12345',
  telegramUserId: '67890',
  telegramLinkedAt: new Date(),
  recipientActive: true,
  eventType: 'UNKNOWN_PERSON',
  cameraName: 'Cửa chính',
  zoneName: null,
  detectedAt: new Date('2026-09-23T07:32:10Z'),
  timezone: 'Asia/Ho_Chi_Minh',
  snapshotKey: 'events/snapshot.jpg',
  snapshotProvider: 'MINIO',
};

describe('NotificationRetryWorker', () => {
  const repository = {
    claimTelegramBatch: jest.fn(),
    findSnapshot: jest.fn(),
    eventAllowsDelivery: jest.fn(),
    markSent: jest.fn(),
    markSkipped: jest.fn(),
    markFailed: jest.fn(),
  };
  const telegram = {
    sendPhoto: jest.fn(),
    sendMessage: jest.fn(),
  };
  const storage = { download: jest.fn() };
  let worker: NotificationRetryWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        NotificationRetryWorker,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            TELEGRAM_ENABLED: 'true',
            STORAGE_PROVIDER: 'MINIO',
            TELEGRAM_BATCH_SIZE: '1',
          }),
        },
        { provide: NotificationsRepository, useValue: repository },
        { provide: TELEGRAM_CHANNEL, useValue: telegram },
        { provide: STORAGE_SERVICE, useValue: storage },
      ],
    }).compile();
    worker = module.get(NotificationRetryWorker);
    repository.claimTelegramBatch.mockResolvedValueOnce([JOB]).mockResolvedValue([]);
    repository.eventAllowsDelivery.mockResolvedValue(true);
    storage.download.mockResolvedValue(Buffer.from('jpeg'));
    telegram.sendPhoto.mockResolvedValue({ chatId: '12345', messageId: '42' });
  });

  it('gửi bytes snapshot và ghi chat/message ID', async () => {
    await worker.runOnce();

    expect(telegram.sendPhoto).toHaveBeenCalledWith(
      '12345',
      Buffer.from('jpeg'),
      expect.stringContaining('Người không quen'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) }),
    );
    expect(repository.markSent).toHaveBeenCalledWith(JOB, '12345', '42');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('bỏ qua cảnh báo khi event đã được xử lý trước lúc gửi', async () => {
    repository.eventAllowsDelivery.mockResolvedValue(false);
    await worker.runOnce();

    expect(repository.markSkipped).toHaveBeenCalledWith(JOB);
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });

  it('không gửi lại cảnh báo caregiver cũ sau khi event đã ESCALATED', async () => {
    repository.claimTelegramBatch
      .mockReset()
      .mockResolvedValueOnce([{ ...JOB, status: 'ESCALATED' }])
      .mockResolvedValue([]);
    await worker.runOnce();

    expect(repository.markSkipped).toHaveBeenCalledWith(expect.objectContaining({ id: JOB.id }));
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });

  it('không gửi cho người chưa liên kết Telegram đã xác minh', async () => {
    repository.claimTelegramBatch
      .mockReset()
      .mockResolvedValueOnce([{ ...JOB, telegramLinkedAt: null }])
      .mockResolvedValue([]);
    await worker.runOnce();

    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.any(Object),
      'TELEGRAM_LINK_NOT_VERIFIED',
      null,
    );
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });

  it('lên lịch retry khi Telegram lỗi tạm thời', async () => {
    telegram.sendPhoto.mockRejectedValue(new Error('timeout'));
    await worker.runOnce();

    expect(repository.markFailed).toHaveBeenCalledWith(JOB, 'DELIVERY_ERROR', expect.any(Date));
  });

  it('gửi text có hai nút khi snapshot không sẵn sàng', async () => {
    repository.claimTelegramBatch
      .mockReset()
      .mockResolvedValueOnce([
        {
          ...JOB,
          snapshotKey: null,
          snapshotProvider: null,
        },
      ])
      .mockResolvedValue([]);
    repository.findSnapshot.mockResolvedValue(null);
    telegram.sendMessage.mockResolvedValue({ chatId: '12345', messageId: '43' });

    await worker.runOnce();

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('Chưa lấy được ảnh'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) }),
    );
    expect(repository.markSent).toHaveBeenCalledWith(expect.any(Object), '12345', '43');
  });

  it('dừng retry khi bot bị Telegram chặn vĩnh viễn', async () => {
    telegram.sendPhoto.mockRejectedValue(new TelegramApiError('blocked', 403));
    await worker.runOnce();

    expect(repository.markFailed).toHaveBeenCalledWith(JOB, 'TELEGRAM_403', null);
  });
});

describe('Telegram retry schedule', () => {
  it('chờ 2, 4, 8 giây rồi dừng sau attempt thứ tư', () => {
    const finishedAt = new Date('2026-09-23T07:00:00Z');
    expect(nextTelegramRetry(1, finishedAt)?.toISOString()).toBe('2026-09-23T07:00:02.000Z');
    expect(nextTelegramRetry(2, finishedAt)?.toISOString()).toBe('2026-09-23T07:00:04.000Z');
    expect(nextTelegramRetry(3, finishedAt)?.toISOString()).toBe('2026-09-23T07:00:08.000Z');
    expect(nextTelegramRetry(4, finishedAt)).toBeNull();
    expect(nextTelegramRetry(1, finishedAt, 10)?.toISOString()).toBe('2026-09-23T07:00:10.000Z');
  });
});
