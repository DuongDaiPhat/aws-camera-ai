import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { EventType } from '../contracts/vertical-slice.ports';

export interface TelegramNotificationJob {
  id: string;
  eventId: string;
  leaseToken: string;
  attemptCount: number;
  escalationLevel: number;
  status: string;
  correlationId: string;
  chatId: string | null;
  telegramUserId: string | null;
  telegramLinkedAt: Date | null;
  recipientActive: boolean | null;
  eventType: EventType;
  cameraName: string | null;
  zoneName: string | null;
  detectedAt: Date;
  timezone: string;
  snapshotKey: string | null;
  snapshotProvider: string | null;
}

interface ClaimedRow {
  id: string;
  event_id: string;
  lease_token: string;
  attempt_count: number;
  escalation_level: number;
  status: string;
  correlation_id: string;
  telegram_chat_id: string | null;
  telegram_user_id: string | null;
  telegram_linked_at: Date | null;
  is_active: boolean | null;
  event_type: EventType;
  camera_name: string | null;
  zone_name: string | null;
  detected_at: Date;
  timezone: string;
  object_key: string | null;
  storage_provider: string | null;
}

const CLAIM_TELEGRAM_SQL = `
  WITH ready AS (
    SELECT n.id FROM notifications n
    WHERE n.channel = 'TELEGRAM'
      AND n.status IN ('PENDING', 'FAILED')
      AND n.attempt_count < 4
      AND (n.status = 'PENDING' OR (n.next_retry_at IS NOT NULL AND n.next_retry_at <= now()))
      AND (n.lease_until IS NULL OR n.lease_until <= now())
    ORDER BY n.created_at, n.id
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ), claimed AS (
    UPDATE notifications n
    SET attempt_count = n.attempt_count + 1, max_attempts = 4,
        lease_token = gen_random_uuid(),
        lease_until = now() + ($2 * interval '1 second')
    FROM ready WHERE n.id = ready.id
    RETURNING n.id, n.event_id, n.recipient_user_id,
              n.lease_token, n.attempt_count, n.escalation_level
  )
  SELECT n.id, n.event_id, n.lease_token, n.attempt_count, n.escalation_level,
         e.status, e.correlation_id, u.telegram_chat_id, u.telegram_user_id,
         u.telegram_linked_at, u.is_active, e.event_type,
         c.name AS camera_name, z.name AS zone_name, e.detected_at,
         COALESCE(c.timezone, 'Asia/Ho_Chi_Minh') AS timezone,
         em.object_key, em.storage_provider
  FROM claimed n
  JOIN events e ON e.id = n.event_id
  LEFT JOIN users u ON u.id = n.recipient_user_id
  LEFT JOIN cameras c ON c.id = e.camera_id
  LEFT JOIN zones z ON z.id = e.zone_id
  LEFT JOIN LATERAL (
    SELECT m.object_key, m.storage_provider
    FROM event_media m WHERE m.event_id = e.id AND m.media_type = 'SNAPSHOT'
    ORDER BY m.created_at DESC LIMIT 1
  ) em ON TRUE
`;

function toTelegramJob(row: ClaimedRow): TelegramNotificationJob {
  return {
    id: row.id,
    eventId: row.event_id,
    leaseToken: row.lease_token,
    attemptCount: row.attempt_count,
    escalationLevel: row.escalation_level,
    status: row.status,
    correlationId: row.correlation_id,
    chatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
    telegramLinkedAt: row.telegram_linked_at,
    recipientActive: row.is_active,
    eventType: row.event_type,
    cameraName: row.camera_name,
    zoneName: row.zone_name,
    detectedAt: row.detected_at,
    timezone: row.timezone,
    snapshotKey: row.object_key,
    snapshotProvider: row.storage_provider,
  };
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly database: DatabaseService) {}

  async claimTelegramBatch(
    limit: number,
    leaseSeconds: number,
  ): Promise<TelegramNotificationJob[]> {
    return this.database.transaction(async (client) => {
      await client.query(`
        UPDATE notifications
        SET status = 'FAILED', failed_at = now(), next_retry_at = NULL,
            error_code = 'LEASE_EXHAUSTED', lease_token = NULL, lease_until = NULL
        WHERE channel = 'TELEGRAM' AND status IN ('PENDING', 'FAILED')
          AND attempt_count >= 4 AND lease_until IS NOT NULL AND lease_until <= now()
      `);
      const claimed = await client.query<ClaimedRow>(CLAIM_TELEGRAM_SQL, [limit, leaseSeconds]);
      return claimed.rows.map(toTelegramJob);
    });
  }

  async findSnapshot(eventId: string): Promise<{ key: string; provider: string } | null> {
    const result = await this.database.query<{ object_key: string; storage_provider: string }>(
      `
      SELECT object_key, storage_provider FROM event_media
      WHERE event_id = $1 AND media_type = 'SNAPSHOT'
      ORDER BY created_at DESC LIMIT 1
    `,
      [eventId],
    );
    const row = result.rows[0];
    return row ? { key: row.object_key, provider: row.storage_provider } : null;
  }

  async eventAllowsDelivery(eventId: string, escalationLevel: number): Promise<boolean> {
    const result = await this.database.query<{ status: string }>(
      'SELECT status FROM events WHERE id = $1 LIMIT 1',
      [eventId],
    );
    const status = result.rows[0]?.status;
    return status === 'NOTIFIED' || (status === 'ESCALATED' && escalationLevel > 0);
  }

  async markSent(job: TelegramNotificationJob, chatId: string, messageId: string): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      `
      UPDATE notifications
      SET status = 'SENT', provider_chat_id = $3, provider_message_id = $4,
          sent_at = now(), failed_at = NULL, next_retry_at = NULL,
          error_code = NULL, error_message = NULL, lease_token = NULL, lease_until = NULL
      WHERE id = $1 AND lease_token = $2 AND status IN ('PENDING', 'FAILED')
      RETURNING id
    `,
      [job.id, job.leaseToken, chatId, messageId],
    );
    if (result.rowCount !== 1) throw new Error('Telegram notification lease đã hết hiệu lực.');
  }

  async markSkipped(job: TelegramNotificationJob): Promise<void> {
    await this.database.query(
      `
      UPDATE notifications SET status = 'SKIPPED', next_retry_at = NULL,
          lease_token = NULL, lease_until = NULL
      WHERE id = $1 AND lease_token = $2
    `,
      [job.id, job.leaseToken],
    );
  }

  async markFailed(
    job: TelegramNotificationJob,
    code: string,
    retryAt: Date | null,
  ): Promise<void> {
    await this.database.query(
      `
      UPDATE notifications SET status = 'FAILED', failed_at = now(),
          next_retry_at = $3, error_code = $4,
          lease_token = NULL, lease_until = NULL
      WHERE id = $1 AND lease_token = $2
    `,
      [job.id, job.leaseToken, retryAt, code],
    );
  }
}
