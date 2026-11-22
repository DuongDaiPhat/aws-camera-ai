import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { NotificationConfig } from './notification-cloud.config';
import type {
  AttemptRow,
  ClaimJobRow,
  ClaimReason,
  ClaimRequest,
  ClaimResponse,
  Delivery,
  JobRow,
} from './notification-cloud.types';
import { dryRunDelivery, readDelivery } from './notification-delivery';

const conflict = () => new ConflictException('Notification claim does not match its job');

export const notificationJobSelect = `
  SELECT j.envelope, j.cached_result, j.owner_user_id,
    j.event_id AS job_event_id, j.camera_id AS job_camera_id,
    n.event_id, n.channel, n.delivery_driver, n.status`;

export function matchesJob(id: string, job: JobRow): boolean {
  const intent = job.envelope.payload;
  return (
    job.delivery_driver === 'sqs' &&
    intent.notificationId === id &&
    intent.eventId === job.event_id &&
    intent.eventId === job.job_event_id &&
    intent.ownerScopeId === job.owner_user_id &&
    intent.channel === job.channel
  );
}

export async function claimNotification(
  client: PoolClient,
  config: NotificationConfig,
  id: string,
  request: ClaimRequest,
): Promise<ClaimResponse> {
  // Escalation already holds the event lock when it writes a notification.
  await client.query(
    `SELECT e.id FROM events e JOIN notifications n ON n.event_id = e.id
     WHERE n.id = $1 FOR UPDATE OF e`,
    [id],
  );
  const {
    rows: [job],
  } = await client.query<ClaimJobRow>(
    `${notificationJobSelect},
       e.status AS event_status, e.version AS event_version, e.camera_id,
       d.owner_user_id AS current_owner, n.recipient_user_id, n.emergency_contact_id,
       n.payload @> '{"cloudContactRequired":true}'::jsonb AS cloud_contact_required,
       decision.reason AS claim_reason, mode.notification_driver AS current_driver,
       j.created_at + ($2 * interval '1 second') <= clock_timestamp() AS expired
     FROM cloud_jobs j JOIN notifications n ON n.id = j.id
     JOIN events e ON e.id = n.event_id
     LEFT JOIN cameras c ON c.id = e.camera_id LEFT JOIN devices d ON d.id = c.device_id
     LEFT JOIN cloud_notification_claim_decisions decision ON decision.notification_id = j.id
     JOIN cloud_transport_mode mode ON mode.singleton
     WHERE j.id = $1 AND j.kind = 'notification.job' AND j.envelope IS NOT NULL
     FOR UPDATE OF j, n`,
    [id, config.intentTtl],
  );
  if (!job) throw new NotFoundException('Notification job not found');
  const intent = job.envelope.payload;
  if (
    !matchesJob(id, job) ||
    request.eventId !== intent.eventId ||
    request.expectedEventVersion !== intent.expectedEventVersion
  )
    throw conflict();

  const {
    rows: [attempt],
  } = await client.query<AttemptRow & { live: boolean }>(
    `SELECT *, lease_until > clock_timestamp() AS live FROM cloud_notification_attempts
     WHERE notification_id = $1`,
    [id],
  );

  if (job.status === 'SENT' || job.status === 'CONFIRMED') {
    return noOp(client, id, 'ALREADY_SENT');
  }
  if (job.claim_reason)
    return { notificationId: id, disposition: 'NO_OP', reason: job.claim_reason };
  if (job.status !== 'PENDING') return noOp(client, id, 'CANCELLED');
  if (attempt?.uncertain_at) return noOp(client, id, 'UNCERTAIN');
  if (job.cached_result && attempt) throw busy(id, attempt.lease_until);
  if (attempt?.mode === 'REAL') {
    if (attempt.live) throw busy(id, attempt.lease_until);
    await client.query(
      'UPDATE cloud_notification_attempts SET uncertain_at = clock_timestamp() WHERE attempt_id = $1',
      [attempt.attempt_id],
    );
    return noOp(client, id, 'UNCERTAIN');
  }
  if (config.driver !== 'sqs' || job.current_driver !== 'sqs') return noOp(client, id, 'CANCELLED');
  if (job.event_status === 'RESOLVED' || job.event_status === 'CLOSED') {
    return noOp(client, id, 'RESOLVED');
  }
  if (job.event_version !== intent.expectedEventVersion) return noOp(client, id, 'STALE_VERSION');
  if (
    job.current_owner !== job.owner_user_id ||
    job.camera_id !== job.job_camera_id ||
    !['NOTIFIED', 'ESCALATED'].includes(job.event_status)
  )
    return noOp(client, id, 'CANCELLED');
  if (job.expired || (attempt && !attempt.live)) return noOp(client, id, 'EXPIRED');

  const { delivery, recipientKey } = await readDelivery(client, job, config);
  const blocked = recipientKey === null;
  if (attempt) {
    if (attempt.claim_id !== request.claimId) throw busy(id, attempt.lease_until);
    return claimed(attempt, dryRunDelivery(delivery));
  }
  const mode = config.dryRun || blocked ? 'DRY_RUN' : 'REAL';
  if (mode === 'REAL') {
    const limitKey = `notification-recipient/${recipientKey}/${job.channel}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [limitKey]);
    const {
      rows: [limits],
    } = await client.query<{ today: number; retry_at: Date | null }>(
      `WITH reservations AS (
         SELECT COALESCE(r.received_at, a.lease_until) AS possible_call_at
         FROM cloud_notification_attempts a
         LEFT JOIN cloud_notification_outcomes o ON o.attempt_id = a.attempt_id
         LEFT JOIN cloud_result_receipts r ON r.id = o.outcome_id
         WHERE a.recipient_key = $1 AND a.channel = $2 AND a.mode = 'REAL'
           AND (o.outcome_id IS NULL OR o.provider_called OR o.status = 'UNCERTAIN')
       )
       SELECT count(*) FILTER (WHERE possible_call_at >= date_trunc('day', clock_timestamp(), 'UTC'))::int AS today,
         max(possible_call_at + ($3 * interval '1 second')) FILTER (
           WHERE possible_call_at + ($3 * interval '1 second') > clock_timestamp()
         ) AS retry_at
       FROM reservations`,
      [recipientKey, job.channel, config.cooldown],
    );
    if (limits.today >= config.cap) return noOp(client, id, 'CAP_EXCEEDED');
    if (limits.retry_at) throw busy(id, limits.retry_at);
  }
  const {
    rows: [created],
  } = await client.query<AttemptRow>(
    `INSERT INTO cloud_notification_attempts
       (notification_id, claim_id, owner_user_id, recipient_ref, channel,
        mode, blocked_provider, recipient_key, claimed_at, lease_until)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, time.now, time.now + ($9 * interval '1 second')
     FROM (SELECT clock_timestamp() AS now) time
     ON CONFLICT (claim_id) DO NOTHING RETURNING *`,
    [
      id,
      request.claimId,
      job.owner_user_id,
      delivery.recipientRef,
      job.channel,
      mode,
      blocked,
      mode === 'REAL' ? recipientKey : null,
      config.lease,
    ],
  );
  if (!created) throw conflict();
  return claimed(created, mode === 'REAL' ? delivery : dryRunDelivery(delivery));
}

function claimed(attempt: AttemptRow, delivery: Delivery): ClaimResponse {
  return {
    notificationId: attempt.notification_id,
    disposition: 'CLAIMED',
    attemptId: attempt.attempt_id,
    leaseUntil: attempt.lease_until.toISOString(),
    mode: attempt.mode,
    delivery,
    ...(attempt.blocked_provider ? { reason: 'BLOCKED_PROVIDER' } : {}),
  };
}

function busy(id: string, retryAt: Date): ConflictException {
  return new ConflictException({
    notificationId: id,
    disposition: 'BUSY',
    retryAt: retryAt.toISOString(),
  });
}

async function noOp(client: PoolClient, id: string, reason: ClaimReason): Promise<ClaimResponse> {
  await client.query(
    `INSERT INTO cloud_notification_claim_decisions (notification_id, reason) VALUES ($1, $2)
     ON CONFLICT (notification_id) DO NOTHING`,
    [id, reason],
  );
  await client.query(
    `UPDATE notifications SET status = CASE WHEN $2 = 'UNCERTAIN' THEN 'PENDING' ELSE 'SKIPPED' END::notification_status,
     error_code = $2, next_retry_at = NULL WHERE id = $1 AND status = 'PENDING'`,
    [id, reason],
  );
  return { notificationId: id, disposition: 'NO_OP', reason };
}
