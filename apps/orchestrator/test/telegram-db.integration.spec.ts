import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DatabaseService } from '../src/database/database.service';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { TelegramLinkRepository } from '../src/notifications/telegram/telegram-link.repository';
import { TelegramWebhookRepository } from '../src/notifications/telegram/telegram-webhook.repository';
import { hashTelegramLinkToken } from '../src/notifications/telegram/telegram-link.service';

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
});
