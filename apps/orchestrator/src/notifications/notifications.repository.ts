import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { EventType } from '../contracts/vertical-slice.ports';
import type { TelegramDeliveryScope } from './telegram-delivery-scope';
import { hasFireOnlyNotificationEvidence } from './fire-image-evidence';

export interface TelegramNotificationJob {
  id: string;
  eventId: string;
  leaseToken: string;
  attemptCount: number;
  maxAttempts?: number;
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
  max_attempts: number;
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

const DELIVERY_SCOPE_SQL = `
  AND n.recipient_user_id = $4::uuid AND n.created_at >= $6::timestamptz
  AND now() < $7::timestamptz
  AND EXISTS (SELECT 1 FROM events scoped WHERE scoped.id=n.event_id
    AND scoped.camera_id=$5::uuid AND scoped.event_type='FIRE_SMOKE_DETECTED'
    AND scoped.detected_at >= $6::timestamptz)
  AND (SELECT COALESCE(sum(budget.attempt_count),0) FROM notifications budget
    JOIN events be ON be.id=budget.event_id WHERE budget.channel='TELEGRAM'
    AND budget.recipient_user_id=$4::uuid AND be.camera_id=$5::uuid
    AND be.event_type='FIRE_SMOKE_DETECTED' AND be.detected_at >= $6::timestamptz
    AND budget.created_at >= $6::timestamptz) < $8::int
`;
const claimTelegramSql = (scoped: boolean): string => `
  WITH ready AS (
    SELECT n.id FROM notifications n
    WHERE n.channel = 'TELEGRAM'
      ${scoped ? DELIVERY_SCOPE_SQL : ''}
      AND n.status IN ('PENDING', 'FAILED')
      AND n.attempt_count < CASE WHEN n.attempt_count = 0 THEN $3 ELSE n.max_attempts END
      AND (n.status = 'PENDING' OR (n.next_retry_at IS NOT NULL AND n.next_retry_at <= now()))
      AND (n.lease_until IS NULL OR n.lease_until <= now())
    ORDER BY n.created_at, n.id
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ), claimed AS (
    UPDATE notifications n
    SET attempt_count = n.attempt_count + 1,
        max_attempts = CASE WHEN n.attempt_count = 0 THEN $3 ELSE n.max_attempts END,
        lease_token = gen_random_uuid(),
        lease_until = now() + ($2 * interval '1 second')
    FROM ready WHERE n.id = ready.id
    RETURNING n.id, n.event_id, n.recipient_user_id,
              n.lease_token, n.attempt_count, n.max_attempts, n.escalation_level
  )
  SELECT n.id, n.event_id, n.lease_token, n.attempt_count, n.max_attempts, n.escalation_level,
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
    maxAttempts: row.max_attempts,
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
    maxAttempts = 4,
    scope?: TelegramDeliveryScope,
  ): Promise<TelegramNotificationJob[]> {
    return this.database.transaction(async (client) => {
      if (scope)
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `telegram-scope:${scope.cameraId}:${scope.recipientUserId}:${scope.createdAfter}`,
        ]);
      await client.query(`
        UPDATE notifications
        SET status = 'FAILED', failed_at = now(), next_retry_at = NULL,
            error_code = 'LEASE_EXHAUSTED', lease_token = NULL, lease_until = NULL
        WHERE channel = 'TELEGRAM' AND status IN ('PENDING', 'FAILED')
          AND attempt_count >= max_attempts AND lease_until IS NOT NULL AND lease_until <= now()
      `);
      const claimed = await client.query<ClaimedRow>(claimTelegramSql(Boolean(scope)), [
        limit,
        leaseSeconds,
        maxAttempts,
        ...(scope
          ? [
              scope.recipientUserId,
              scope.cameraId,
              scope.createdAfter,
              scope.until,
              scope.maxAttempts,
            ]
          : []),
      ]);
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

  async findFireSnapshotMetadata(eventId: string, snapshotKey: string): Promise<unknown> {
    const result = await this.database.query<{ metadata: unknown }>(
      `SELECT f.pending_payload->'results'->0->'metadata' AS metadata
       FROM fire_incidents f JOIN event_media m ON m.event_id=f.event_id
       WHERE f.event_id=$1 AND m.media_type='SNAPSHOT' AND m.object_key=$2 LIMIT 1`,
      [eventId, snapshotKey],
    );
    return result.rows[0]?.metadata ?? null;
  }

  async eventAllowsDelivery(eventId: string, escalationLevel: number): Promise<boolean> {
    const result = await this.database.query<{
      status: string;
      event_type: EventType;
      ai_results: unknown;
    }>('SELECT status, event_type, ai_results FROM events WHERE id = $1 LIMIT 1', [eventId]);
    const event = result.rows[0];
    if (
      event?.event_type === 'FIRE_SMOKE_DETECTED' &&
      !hasFireOnlyNotificationEvidence(event.ai_results)
    )
      return false;
    const status = event?.status;
    return status === 'NOTIFIED' || (status === 'ESCALATED' && escalationLevel > 0);
  }

  async markSent(
    job: TelegramNotificationJob,
    chatId: string,
    messageId: string,
    kind: 'PHOTO' | 'TEXT' | null = null,
    text: string | null = null,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const event = (
        await client.query('SELECT event_type,status FROM events WHERE id=$1 FOR UPDATE', [
          job.eventId,
        ])
      ).rows[0];
      const sent = await client.query<{ sent_at: Date }>(
        `UPDATE notifications SET status='SENT',provider_chat_id=$3,
        provider_message_id=$4,telegram_message_kind=$5,telegram_message_text=$6,sent_at=clock_timestamp(),
        failed_at=NULL,next_retry_at=NULL,error_code=NULL,error_message=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND lease_token=$2 AND status IN ('PENDING','FAILED') RETURNING sent_at`,
        [job.id, job.leaseToken, chatId, messageId, kind, text],
      );
      if (sent.rowCount !== 1) throw new Error('Telegram notification lease is no longer valid.');
      if (event?.event_type === 'WELLNESS_TIMEOUT' && job.escalationLevel === 0) {
        await client.query('SELECT id FROM wellness_check_runs WHERE event_id=$1 FOR UPDATE', [
          job.eventId,
        ]);
        if (event.status !== 'NOTIFIED') return;
        const run = await client.query<{ confirmation_deadline_at: Date }>(
          `UPDATE wellness_check_runs r
          SET request_sent_at=$2::timestamptz,confirmation_deadline_at=$2::timestamptz+grace_seconds*interval '1 second'
          WHERE event_id=$1 AND request_sent_at IS NULL
            AND EXISTS(SELECT 1 FROM notifications n WHERE n.id=$3 AND n.recipient_user_id=r.resident_user_id)
          RETURNING confirmation_deadline_at`,
          [job.eventId, sent.rows[0].sent_at, job.id],
        );
        if (run.rows.length)
          await client.query(
            `UPDATE events SET escalation_deadline_at=$2,version=version+1,
          aggregate_version=aggregate_version+1 WHERE id=$1`,
            [job.eventId, run.rows[0].confirmation_deadline_at],
          );
        if (run.rows.length)
          await client.query(
            `INSERT INTO outbox_messages(event_id,aggregate_version,message_type,payload)
          SELECT id,aggregate_version,'event.updated','{}'::jsonb FROM events WHERE id=$1
          ON CONFLICT(event_id,aggregate_version,message_type) DO NOTHING`,
            [job.eventId],
          );
      }
    });
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
