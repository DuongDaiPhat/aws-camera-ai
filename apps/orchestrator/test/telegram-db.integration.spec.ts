import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DatabaseService } from '../src/database/database.service';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { TelegramLinkRepository } from '../src/notifications/telegram/telegram-link.repository';
import { TelegramWebhookRepository } from '../src/notifications/telegram/telegram-webhook.repository';
import { hashTelegramLinkToken } from '../src/notifications/telegram/telegram-link.service';
import { ConfigService } from '@nestjs/config';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import { EscalationRulesRepository } from '../src/escalation-rules/escalation-rules.repository';
import { TelegramWorkRepository } from '../src/notifications/telegram/telegram-work.repository';
import { TelegramWorkConfig } from '../src/notifications/telegram/telegram-work.config';
import {
  TelegramCallbackService,
  type TelegramCallback,
} from '../src/notifications/telegram/telegram-callback.service';
import { TelegramWorkWorker } from '../src/notifications/telegram/telegram-work-worker.service';
import { TelegramWebhookService } from '../src/notifications/telegram/telegram-webhook.service';
import { TelegramApiError } from '../src/notifications/telegram/telegram-api.error';
import { NotificationRetryWorker } from '../src/notifications/notification-retry-worker.service';
import { EscalationDeadlineWorkerService } from '../src/escalation/escalation-deadline-worker.service';

const POSTGRES_PORT = 5432;
const STARTUP_TIMEOUT_MS = 120000;

describe('Telegram delivery PostgreSQL integration', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let notifications: NotificationsRepository;
  let links: TelegramLinkRepository;
  let inbox: TelegramWebhookRepository;
  let userId: string;
  let eventId: string;
  let engine: EscalationEngineService;
  let work: TelegramWorkRepository;
  let callbacks: TelegramCallbackService;
  const config = new TelegramWorkConfig(new ConfigService({ TELEGRAM_ENABLED: 'true' }));
  const events = { publishCommittedUpdate: jest.fn().mockResolvedValue(undefined) };
  const telegram = {
    sendPhoto: jest.fn(),
    sendMessage: jest.fn(),
    answerCallbackQuery: jest.fn(),
    editMessageCaption: jest.fn(),
    editMessageText: jest.fn(),
    editMessageReplyMarkup: jest.fn(),
  };

  function worker(): TelegramWorkWorker {
    return new TelegramWorkWorker(config, work, callbacks, links, telegram);
  }

  function callback(notificationId: string, updateId = 10001, action = 'ok'): TelegramCallback {
    return {
      kind: 'CALLBACK',
      updateId,
      callbackId: `callback-${updateId}`,
      actorId: '12345',
      chatId: '12345',
      messageId: '42',
      data: `cf:${notificationId.replace(/-/g, '')}:${action}`,
    };
  }

  async function sentNotification(
    recipientId = userId,
    chatId = '12345',
    messageId = '42',
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO notifications (event_id, recipient_user_id, channel, status, provider_chat_id,
         provider_message_id, sent_at, telegram_message_kind, telegram_message_text)
       VALUES ($1, $2, 'TELEGRAM', 'SENT', $3, $4, now(), 'PHOTO', 'Cảnh báo: Người không quen') RETURNING id`,
      [eventId, recipientId, chatId, messageId],
    );
    return result.rows[0].id;
  }

  async function assertDecision(status: string, count = 1): Promise<void> {
    const result = await pool.query<{ status: string; count: string }>(
      `SELECT e.status, (SELECT count(*) FROM confirmations c WHERE c.event_id = e.id) AS count
       FROM events e WHERE e.id = $1`,
      [eventId],
    );
    expect(result.rows[0]).toEqual({ status, count: String(count) });
  }

  jest.setTimeout(STARTUP_TIMEOUT_MS);

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'camerai_test',
        POSTGRES_USER: 'camerai_test',
        POSTGRES_PASSWORD: 'camerai_test_password',
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(POSTGRES_PORT),
      database: 'camerai_test',
      user: 'camerai_test',
      password: 'camerai_test_password',
    });
    const migrationDirectory = resolve(__dirname, '../../../db/migrations');
    for (const filename of (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      await pool.query(await readFile(resolve(migrationDirectory, filename), 'utf8'));
    }

    const database = new DatabaseService(pool);
    notifications = new NotificationsRepository(database);
    links = new TelegramLinkRepository(database);
    inbox = new TelegramWebhookRepository(database);
    work = new TelegramWorkRepository(database);
    engine = new EscalationEngineService(
      new EscalationRepository(pool),
      new EscalationRulesRepository(pool),
    );
    callbacks = new TelegramCallbackService(work, engine, config, events);

    const user = await pool.query<{ id: string }>(`
      INSERT INTO users (email, password_hash, full_name, role,
                         telegram_chat_id, telegram_user_id, telegram_linked_at)
      VALUES ('telegram@test.local', 'test-hash', 'Tester', 'CAREGIVER',
              '12345', '12345', now()) RETURNING id
    `);
    userId = user.rows[0].id;
    const device = await pool.query<{ id: string }>(
      `
      INSERT INTO devices (owner_user_id, name) VALUES ($1, 'Test gateway') RETURNING id
    `,
      [userId],
    );
    const camera = await pool.query<{ id: string }>(
      `
      INSERT INTO cameras (device_id, name, slug, rtsp_url)
      VALUES ($1, 'Cửa chính', 'cam_telegram_test', 'rtsp://test') RETURNING id
    `,
      [device.rows[0].id],
    );
    const event = await pool.query<{ id: string }>(
      `
      INSERT INTO events (camera_id, event_type, status, detected_at)
      VALUES ($1, 'UNKNOWN_PERSON', 'NOTIFIED', now()) RETURNING id
    `,
      [camera.rows[0].id],
    );
    eventId = event.rows[0].id;
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    // Chỉ dọn fixture trong PostgreSQL testcontainer riêng, không đụng DB ứng dụng.
    await pool.query('TRUNCATE confirmations, notifications, telegram_webhook_inbox CASCADE');
    await pool.query('DELETE FROM event_status_history WHERE event_id = $1', [eventId]);
    await pool.query(
      `UPDATE events SET status = 'NOTIFIED', version = 1,
      escalation_deadline_at = now() + interval '2 minutes', resolved_at = NULL, escalated_at = NULL WHERE id = $1`,
      [eventId],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('claim bằng lease, retry trên cùng notification và lưu chat/message ID', async () => {
    const created = await pool.query<{ id: string }>(
      `
      INSERT INTO notifications (event_id, recipient_user_id, channel, status, max_attempts)
      VALUES ($1, $2, 'TELEGRAM', 'PENDING', 4) RETURNING id
    `,
      [eventId, userId],
    );
    const notificationId = created.rows[0].id;

    const [first] = await notifications.claimTelegramBatch(1, 30);
    expect(first).toMatchObject({ id: notificationId, attemptCount: 1, chatId: '12345' });
    expect(await notifications.claimTelegramBatch(1, 30)).toEqual([]);

    await notifications.markFailed(first, 'TELEGRAM_500', new Date(Date.now() - 1000));
    // Dùng đồng hồ DB để không phụ thuộc độ lệch giờ giữa Windows và Docker VM.
    await pool.query('UPDATE notifications SET next_retry_at = now() WHERE id = $1', [
      notificationId,
    ]);
    const [second] = await notifications.claimTelegramBatch(1, 30);
    expect(second).toMatchObject({ id: notificationId, attemptCount: 2 });
    await notifications.markSent(second, '12345', '42');

    const persisted = await pool.query<{
      status: string;
      attempt_count: number;
      provider_chat_id: string;
      provider_message_id: string;
    }>(
      `
      SELECT status, attempt_count, provider_chat_id, provider_message_id
      FROM notifications WHERE id = $1
    `,
      [notificationId],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'SENT',
      attempt_count: 2,
      provider_chat_id: '12345',
      provider_message_id: '42',
    });
  });

  it('dedup Telegram update_id trước ACK', async () => {
    expect(await inbox.store(5678, { kind: 'IGNORED' })).toBe(true);
    expect(await inbox.store(5678, { kind: 'IGNORED' })).toBe(false);
    await expect(inbox.store(5678, { kind: 'LINK' })).rejects.toMatchObject({ status: 409 });
    await inbox.markProcessed(5678);
    expect(await inbox.isProcessed(5678)).toBe(true);
  });

  it('mã liên kết chỉ tiêu thụ một lần và replay của cùng actor là idempotent', async () => {
    const tokenHash = hashTelegramLinkToken('x'.repeat(43));
    await links.create(userId, tokenHash);
    expect(await links.consume(tokenHash, '12345', '12345')).toBe(true);
    expect(await links.consume(tokenHash, '12345', '12345')).toBe(true);
    expect(await links.consume(tokenHash, '99999', '99999')).toBe(false);
  });

  it('callback → engine → DB → edit; replay sau commit không thêm confirmation', async () => {
    const id = await sentNotification();
    const update = callback(id);
    await inbox.store(update.updateId, update);
    await worker().runOnce();
    await assertDecision('RESOLVED');
    expect(events.publishCommittedUpdate).toHaveBeenCalledWith(eventId);
    expect(telegram.editMessageCaption).toHaveBeenCalledWith(
      '12345',
      '42',
      expect.stringContaining('Đã xác nhận bởi Tester'),
    );
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith(
      update.callbackId,
      'Đã xác nhận bạn an toàn.',
    );
    const persisted = await pool.query(
      'SELECT notification_id, source_message_id, source_update_id FROM confirmations WHERE event_id = $1',
      [eventId],
    );
    expect(persisted.rows[0]).toMatchObject({
      notification_id: id,
      source_message_id: '42',
      source_update_id: '10001',
    });
    // Mô phỏng process dừng sau engine commit nhưng trước khi ghi outcome inbox.
    await pool.query(
      `UPDATE telegram_webhook_inbox SET status = 'PENDING', outcome = NULL WHERE update_id = $1`,
      [update.updateId],
    );
    await worker().runOnce();
    await assertDecision('RESOLVED');
    expect(telegram.editMessageCaption).toHaveBeenCalledTimes(1);
    expect(
      await inbox.store(update.updateId + 1, { ...update, updateId: update.updateId + 1 }),
    ).toBe(false);
    await expect(
      inbox.store(update.updateId, { ...update, actorId: '99999' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('NEED_HELP tạo escalation intent một lần dù callback bị replay', async () => {
    const update = callback(await sentNotification(), 10002, 'help');
    await callbacks.confirm(update);
    await callbacks.confirm(update);
    await assertDecision('ESCALATED');
    const result = await pool.query(
      `SELECT count(*) FROM notifications WHERE event_id = $1 AND channel = 'CONNECT_CALL'`,
      [eventId],
    );
    expect(result.rows[0].count).toBe('1');
  });

  it.each([
    ['sai actor', { actorId: '99999' }],
    ['sai chat', { chatId: '99999' }],
    ['sai message', { messageId: '99999' }],
    ['sai action', { data: 'cf:invalid:delete' }],
  ])('chặn callback %s', async (_name, overrides) => {
    const update = { ...callback(await sentNotification()), ...overrides };
    await inbox.store(update.updateId, update);
    await worker().runOnce();
    await assertDecision('NOTIFIED', 0);
    expect(await inbox.isProcessed(update.updateId)).toBe(true);
    expect(telegram.editMessageCaption).not.toHaveBeenCalled();
  });

  it('chặn callback hết hạn dù actor/chat/message đúng', async () => {
    const id = await sentNotification();
    await pool.query(`UPDATE notifications SET sent_at = now() - interval '2 days' WHERE id = $1`, [
      id,
    ]);
    expect(await callbacks.confirm(callback(id))).toContain('hết hạn');
    await assertDecision('NOTIFIED', 0);
  });

  it('hai actor bấm đồng thời: chỉ một quyết định và replay người thua không thêm audit', async () => {
    const admin = await pool.query<{
      id: string;
    }>(`INSERT INTO users (email, password_hash, full_name, role,
      telegram_user_id, telegram_chat_id, telegram_linked_at) VALUES ('admin-telegram@test.local', 'hash', 'Admin', 'ADMIN',
      '67890', '67890', now()) ON CONFLICT (email) DO UPDATE SET is_active = TRUE RETURNING id`);
    const first = callback(await sentNotification(), 20001, 'ok');
    const second = {
      ...callback(await sentNotification(admin.rows[0].id, '67890', '43'), 20002, 'help'),
      actorId: '67890',
      chatId: '67890',
      messageId: '43',
    };
    await Promise.all([callbacks.confirm(first), callbacks.confirm(second)]);
    await Promise.all([callbacks.confirm(first), callbacks.confirm(second)]);
    const counts = await pool.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE is_authoritative) AS authoritative
      FROM confirmations WHERE event_id = $1`,
      [eventId],
    );
    expect(counts.rows[0]).toEqual({ total: '2', authoritative: '1' });
    const history = await pool.query(
      'SELECT count(*) FROM event_status_history WHERE event_id = $1',
      [eventId],
    );
    expect(history.rows[0].count).toBe('1');
    await worker().runOnce();
    expect(telegram.editMessageCaption).toHaveBeenCalledTimes(2);
  });

  it('dashboard xác nhận trước, callback nhận đã xử lý; edit lỗi chỉ retry edit sau restart', async () => {
    const id = await sentNotification();
    await engine.confirmInitial(eventId, userId, { response: 'IM_OK', channel: 'DASHBOARD' });
    const update = callback(id, 30001, 'help');
    await inbox.store(update.updateId, update);
    telegram.editMessageCaption.mockRejectedValueOnce(new TelegramApiError('timeout', null));
    await worker().runOnce();
    await assertDecision('RESOLVED', 2);
    const edit = await pool.query(
      'SELECT status, attempt_count FROM telegram_message_edits WHERE notification_id = $1',
      [id],
    );
    expect(edit.rows[0]).toMatchObject({ status: 'PENDING', attempt_count: 1 });
    await pool.query(
      'UPDATE telegram_message_edits SET available_at = now() WHERE notification_id = $1',
      [id],
    );
    await worker().runOnce();
    await assertDecision('RESOLVED', 2);
    expect(telegram.editMessageCaption).toHaveBeenCalledTimes(2);
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('lease hết hạn được worker mới nhận lại mà không reset attempt', async () => {
    const update = callback(await sentNotification(), 40001);
    await inbox.store(update.updateId, update);
    const first = await work.claimInbox(30, 8);
    expect(first?.attempt_count).toBe(1);
    expect(await work.claimInbox(30, 8)).toBeNull();
    await pool.query(
      `UPDATE telegram_webhook_inbox SET lease_until = now() - interval '1 second' WHERE update_id = $1`,
      [update.updateId],
    );
    await worker().runOnce();
    await assertDecision('RESOLVED');
    const row = await pool.query(
      'SELECT attempt_count, status FROM telegram_webhook_inbox WHERE update_id = $1',
      [update.updateId],
    );
    expect(row.rows[0]).toMatchObject({ attempt_count: 2, status: 'PROCESSED' });
  });

  it('webhook lưu link hash và worker phục hồi liên kết sau ACK', async () => {
    const token = 'z'.repeat(43);
    // Tạo fixture trực tiếp để không vướng rate limit của ca liên kết trước.
    await pool.query(
      `INSERT INTO telegram_link_requests (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
      [userId, hashTelegramLinkToken(token)],
    );
    const webhook = new TelegramWebhookService(inbox);
    await webhook.receive({
      update_id: 50001,
      message: {
        text: `/start ${token}`,
        from: { id: 12345 },
        chat: { id: 12345, type: 'private' },
      },
    });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    await worker().runOnce();
    expect(await inbox.isProcessed(50001)).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('Đã liên kết'),
      { inline_keyboard: [] },
    );
  });

  it('Telegram lỗi đủ 4 attempts theo 2/4/8; deadline không đổi và engine vẫn escalation', async () => {
    await pool.query(
      `INSERT INTO notifications (event_id, recipient_user_id, channel, status)
      VALUES ($1, $2, 'TELEGRAM', 'PENDING')`,
      [eventId, userId],
    );
    const original = await pool.query('SELECT escalation_deadline_at FROM events WHERE id = $1', [
      eventId,
    ]);
    telegram.sendMessage.mockRejectedValue(new TelegramApiError('service unavailable', 503));
    const senderConfig = new ConfigService({
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BATCH_SIZE: '1',
      TELEGRAM_MEDIA_WAIT_MS: '1',
    });
    const storage = { upload: jest.fn(), download: jest.fn(), getPresignedUrl: jest.fn() };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const started = Date.now();
      await new NotificationRetryWorker(senderConfig, notifications, telegram, storage).runOnce();
      const result = await pool.query(
        `SELECT status, attempt_count, max_attempts, next_retry_at, failed_at
        FROM notifications WHERE event_id = $1 AND channel = 'TELEGRAM'`,
        [eventId],
      );
      expect(result.rows[0]).toMatchObject({
        status: 'FAILED',
        attempt_count: attempt,
        max_attempts: 4,
      });
      if (attempt < 4) {
        expect(result.rows[0].next_retry_at.getTime()).toBeGreaterThanOrEqual(
          started + [2, 4, 8][attempt - 1] * 1000,
        );
        await pool.query(`UPDATE notifications SET next_retry_at = now() WHERE event_id = $1`, [
          eventId,
        ]);
      } else {
        expect(result.rows[0].next_retry_at).toBeNull();
        expect(result.rows[0].failed_at).toBeInstanceOf(Date);
      }
    }
    const after = await pool.query(
      'SELECT status, escalation_deadline_at FROM events WHERE id = $1',
      [eventId],
    );
    expect(after.rows[0]).toMatchObject({
      status: 'NOTIFIED',
      escalation_deadline_at: original.rows[0].escalation_deadline_at,
    });
    await pool.query(
      `UPDATE events SET escalation_deadline_at = now() - interval '1 second' WHERE id = $1`,
      [eventId],
    );
    const deadline = new EscalationDeadlineWorkerService(
      new EscalationRepository(pool),
      new ConfigService(),
    );
    expect(await deadline.scanAndProcessDueDeadlines()).toBe(1);
    await assertDecision('ESCALATED', 0);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('callback đua với deadline không tạo hai transition trái ngược', async () => {
    const update = callback(await sentNotification(), 60001);
    await pool.query(
      `UPDATE events SET escalation_deadline_at = now() - interval '1 second' WHERE id = $1`,
      [eventId],
    );
    const deadline = new EscalationDeadlineWorkerService(
      new EscalationRepository(pool),
      new ConfigService(),
    );
    await Promise.all([callbacks.confirm(update), deadline.scanAndProcessDueDeadlines()]);
    const result = await pool.query(
      'SELECT status, escalation_deadline_at FROM events WHERE id = $1',
      [eventId],
    );
    expect(['RESOLVED', 'ESCALATED']).toContain(result.rows[0].status);
    expect(result.rows[0].escalation_deadline_at).toBeNull();
    const history = await pool.query(
      'SELECT count(*) FROM event_status_history WHERE event_id = $1',
      [eventId],
    );
    expect(history.rows[0].count).toBe('1');
  });

  it('replay cùng update nhưng đổi response không ghi đè confirmation', async () => {
    const id = await sentNotification();
    await callbacks.confirm(callback(id, 70001, 'ok'));
    await callbacks.confirm(callback(id, 70001, 'help'));
    await assertDecision('RESOLVED');
  });

  it('tài khoản có link nhưng không sở hữu camera bị từ chối', async () => {
    const outsider = await pool.query<{
      id: string;
    }>(`INSERT INTO users (email, password_hash, full_name, role,
      telegram_user_id, telegram_chat_id, telegram_linked_at) VALUES ('outside@test.local', 'hash', 'Outside', 'CAREGIVER',
      '55555', '55555', now()) RETURNING id`);
    const id = await sentNotification(outsider.rows[0].id, '55555', '44');
    await callbacks.confirm({
      ...callback(id, 80001),
      actorId: '55555',
      chatId: '55555',
      messageId: '44',
    });
    await assertDecision('NOTIFIED', 0);
  });
});
