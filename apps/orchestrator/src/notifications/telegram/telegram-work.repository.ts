import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { TelegramCallback } from './telegram-callback.service';

type InboxBody =
  | TelegramCallback
  | { kind: 'LINK'; actorId: string; chatId: string; tokenHash: string }
  | { kind: 'IGNORED'; updateId: number };

export interface TelegramInboxJob {
  update_id: string;
  update_body: InboxBody;
  attempt_count: number;
  lease_token: string;
  outcome: string | null;
}

export interface TelegramEditJob {
  notification_id: string;
  attempt_count: number;
  lease_token: string;
  provider_chat_id: string;
  provider_message_id: string;
  telegram_message_kind: 'PHOTO' | 'TEXT' | null;
  telegram_message_text: string | null;
  full_name: string | null;
  responded_at: Date;
  response: string;
  timezone: string;
}

@Injectable()
export class TelegramWorkRepository {
  constructor(private readonly database: DatabaseService) {}

  async findCallbackTarget(
    notificationId: string,
    telegramUserId: string,
  ): Promise<{
    eventId: string;
    actorUserId: string;
  } | null> {
    const result = await this.database.query<{ event_id: string; user_id: string }>(
      `SELECT n.event_id, u.id AS user_id FROM notifications n
       JOIN users u ON u.id = n.recipient_user_id
       WHERE n.id = $1 AND u.telegram_user_id = $2 LIMIT 1`,
      [notificationId, telegramUserId],
    );
    const row = result.rows[0];
    return row ? { eventId: row.event_id, actorUserId: row.user_id } : null;
  }

  async claimInbox(leaseSeconds: number, maxAttempts: number): Promise<TelegramInboxJob | null> {
    await this.database.query(
      `UPDATE telegram_webhook_inbox SET status = 'FAILED', last_error = 'LEASE_EXHAUSTED',
         lease_token = NULL, lease_until = NULL
       WHERE status = 'PENDING' AND attempt_count >= $1 AND lease_until <= now()`,
      [maxAttempts],
    );
    const result = await this.database.query<TelegramInboxJob>(
      `WITH ready AS (
        SELECT update_id FROM telegram_webhook_inbox
        WHERE status = 'PENDING' AND attempt_count < $2 AND available_at <= now()
          AND (lease_until IS NULL OR lease_until <= now())
        ORDER BY created_at, update_id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE telegram_webhook_inbox i SET attempt_count = i.attempt_count + 1,
        lease_token = gen_random_uuid(), lease_until = now() + ($1 * interval '1 second')
      FROM ready WHERE i.update_id = ready.update_id
      RETURNING i.update_id, i.update_body, i.attempt_count, i.lease_token, i.outcome`,
      [leaseSeconds, maxAttempts],
    );
    return result.rows[0] ?? null;
  }

  async saveOutcome(job: TelegramInboxJob, outcome: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE telegram_webhook_inbox SET outcome = $3
       WHERE update_id = $1 AND lease_token = $2`,
      [job.update_id, job.lease_token, outcome],
    );
    if (result.rowCount !== 1) throw new Error('Telegram inbox lease đã hết hiệu lực.');
  }

  async finishInbox(job: TelegramInboxJob): Promise<void> {
    await this.database.query(
      `UPDATE telegram_webhook_inbox SET status = 'PROCESSED', processed_at = now(),
         lease_token = NULL, lease_until = NULL, last_error = NULL
       WHERE update_id = $1 AND lease_token = $2`,
      [job.update_id, job.lease_token],
    );
  }

  async retryInbox(
    job: TelegramInboxJob,
    errorCode: string,
    delaySeconds: number,
    terminal: boolean,
  ): Promise<void> {
    await this.database.query(
      `UPDATE telegram_webhook_inbox SET status = $3, last_error = $4,
         available_at = now() + ($5 * interval '1 second'), lease_token = NULL, lease_until = NULL
       WHERE update_id = $1 AND lease_token = $2`,
      [job.update_id, job.lease_token, terminal ? 'FAILED' : 'PENDING', errorCode, delaySeconds],
    );
  }

  async enqueueEdits(limit: number): Promise<void> {
    // Reconcile từ DB bao phủ cả xác nhận dashboard và send hoàn tất sau confirmation.
    await this.database.query(
      `INSERT INTO telegram_message_edits (notification_id)
       SELECT n.id FROM notifications n
       JOIN confirmations c ON c.event_id = n.event_id AND c.phase = 'INITIAL' AND c.is_authoritative = TRUE
       WHERE n.channel = 'TELEGRAM' AND n.escalation_level = 0 AND n.status IN ('SENT', 'CONFIRMED')
         AND n.provider_chat_id IS NOT NULL AND n.provider_message_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM telegram_message_edits j WHERE j.notification_id = n.id)
       ORDER BY n.created_at LIMIT $1 ON CONFLICT DO NOTHING`,
      [limit],
    );
  }

  async claimEdit(leaseSeconds: number, maxAttempts: number): Promise<TelegramEditJob | null> {
    await this.database.query(
      `UPDATE telegram_message_edits SET status = 'FAILED', last_error = 'LEASE_EXHAUSTED',
         lease_token = NULL, lease_until = NULL
       WHERE status = 'PENDING' AND attempt_count >= $1 AND lease_until <= now()`,
      [maxAttempts],
    );
    const result = await this.database.query<TelegramEditJob>(
      `WITH ready AS (
         SELECT notification_id FROM telegram_message_edits
         WHERE status = 'PENDING' AND attempt_count < $2 AND available_at <= now()
           AND (lease_until IS NULL OR lease_until <= now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       ), claimed AS (
         UPDATE telegram_message_edits j SET attempt_count = j.attempt_count + 1,
           lease_token = gen_random_uuid(), lease_until = now() + ($1 * interval '1 second')
         FROM ready WHERE j.notification_id = ready.notification_id
         RETURNING j.notification_id, j.attempt_count, j.lease_token
       ) SELECT j.notification_id, j.attempt_count, j.lease_token, n.provider_chat_id,
         n.provider_message_id, n.telegram_message_kind, n.telegram_message_text,
         u.full_name, cf.responded_at, cf.response, COALESCE(cam.timezone, 'Asia/Ho_Chi_Minh') AS timezone
       FROM claimed j JOIN notifications n ON n.id = j.notification_id
       JOIN confirmations cf ON cf.event_id = n.event_id AND cf.phase = 'INITIAL' AND cf.is_authoritative = TRUE
       LEFT JOIN users u ON u.id = cf.user_id
       JOIN events e ON e.id = n.event_id JOIN cameras cam ON cam.id = e.camera_id`,
      [leaseSeconds, maxAttempts],
    );
    return result.rows[0] ?? null;
  }

  async finishEdit(job: TelegramEditJob): Promise<void> {
    await this.database.transaction(async (client) => {
      const finished = await client.query(
        `UPDATE telegram_message_edits SET status = 'PROCESSED', processed_at = now(),
           lease_token = NULL, lease_until = NULL, last_error = NULL
         WHERE notification_id = $1 AND lease_token = $2 RETURNING notification_id`,
        [job.notification_id, job.lease_token],
      );
      if (finished.rowCount === 1) {
        await client.query(
          `UPDATE notifications SET status = 'CONFIRMED'
          WHERE id = $1 AND status = 'SENT'`,
          [job.notification_id],
        );
      }
    });
  }

  async retryEdit(
    job: TelegramEditJob,
    errorCode: string,
    delaySeconds: number,
    terminal: boolean,
  ): Promise<void> {
    await this.database.query(
      `UPDATE telegram_message_edits SET status = $3, last_error = $4,
         available_at = now() + ($5 * interval '1 second'), lease_token = NULL, lease_until = NULL
       WHERE notification_id = $1 AND lease_token = $2`,
      [
        job.notification_id,
        job.lease_token,
        terminal ? 'FAILED' : 'PENDING',
        errorCode,
        delaySeconds,
      ],
    );
  }
}
