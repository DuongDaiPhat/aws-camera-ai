import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { type Envelope, type NotificationJob, parseEnvelope } from '../cloud-queue/queue-contract';
import { DatabaseService } from '../database/database.service';
import { claimNotification, matchesJob, notificationJobSelect } from './notification-claim';
import { readNotificationConfig } from './notification-cloud.config';
import type {
  AttemptRow,
  ClaimRequest,
  JobRow,
  OutcomeEnvelope,
  OutcomeReceipt,
} from './notification-cloud.types';

const SAFE_OUTCOME_REASONS = new Set([
  'BLOCKED_PROVIDER',
  'LAB_DRY_RUN',
  'SENDER_DRY_RUN',
  'LEASE_EXPIRED',
  'LAMBDA_TIME_BUDGET',
]);

const mismatch = () =>
  new ConflictException('Notification outcome does not match the claimed attempt');

@Injectable()
export class NotificationCloudService {
  private readonly config;

  constructor(
    config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.config = readNotificationConfig(config);
  }

  async enqueueIntent(client: PoolClient, id: string, automaticContact = false): Promise<void> {
    if (this.config.driver === 'local') return;
    const {
      rows: [intent],
    } = await client.query<NotificationJob & { driver: string }>(
      `SELECT n.id AS "notificationId", e.id AS "eventId", d.owner_user_id AS "ownerScopeId",
         e.version AS "expectedEventVersion", n.channel, mode.notification_driver AS driver
       FROM notifications n JOIN events e ON e.id = n.event_id
       JOIN cameras c ON c.id = e.camera_id JOIN devices d ON d.id = c.device_id
       JOIN cloud_transport_mode mode ON mode.singleton
       WHERE n.id = $1 AND n.status = 'PENDING'
         AND n.channel IN ('SNS_EMAIL', 'SNS_SMS', 'CONNECT_CALL')`,
      [id],
    );
    // Camera-less legacy intents have no device owner to fence a cloud job.
    if (!intent) return;
    const { driver, ...payload } = intent;
    if (driver !== this.config.driver)
      throw new Error('Notification driver differs from the database');
    if (automaticContact) {
      await client.query(
        `UPDATE notifications SET
          emergency_contact_id = (
            SELECT id FROM emergency_contacts
            WHERE owner_user_id = $2 AND is_enabled AND is_verified
            ORDER BY priority_order, id LIMIT 1
          ),
          payload = payload || '{"cloudContactRequired":true}'::jsonb
         WHERE id = $1 AND channel = 'CONNECT_CALL'`,
        [id, payload.ownerScopeId],
      );
    }
    await this.enqueueNotification(client, payload);
  }

  async enqueueNotification(client: PoolClient, input: NotificationJob): Promise<void> {
    if (this.config.driver !== 'sqs') throw new Error('Notification SQS transport not enabled');
    const envelope = parseEnvelope({
      schemaVersion: 1,
      type: 'notification.job',
      messageId: input.notificationId,
      correlationId: input.eventId,
      occurredAt: new Date().toISOString(),
      payload: input,
    });
    const inserted = await client.query(
      `INSERT INTO cloud_jobs(id, event_id, kind, owner_user_id, camera_id, envelope, status)
       SELECT n.id, e.id, 'notification.job', d.owner_user_id, c.id, $5, 'PENDING'
       FROM notifications n JOIN events e ON e.id = n.event_id
       JOIN cameras c ON c.id = e.camera_id JOIN devices d ON d.id = c.device_id
       JOIN cloud_transport_mode mode ON mode.singleton AND mode.notification_driver = 'sqs'
       WHERE n.id = $1 AND e.id = $2 AND d.owner_user_id = $3 AND e.version = $4
         AND n.channel = $6 AND n.status = 'PENDING'
       RETURNING id`,
      [
        input.notificationId,
        input.eventId,
        input.ownerScopeId,
        input.expectedEventVersion,
        envelope,
        input.channel,
      ],
    );
    if (inserted.rowCount !== 1)
      throw new Error('Notification intent owner, channel or version mismatch');
    await client.query("UPDATE notifications SET delivery_driver = 'sqs' WHERE id = $1", [
      input.notificationId,
    ]);
  }

  async context(id: string) {
    const {
      rows: [job],
    } = await this.db.query<JobRow>(
      `${notificationJobSelect}
       FROM cloud_jobs j JOIN notifications n ON n.id = j.id
       WHERE j.id = $1 AND j.kind = 'notification.job' AND j.envelope IS NOT NULL`,
      [id],
    );
    if (!job || !matchesJob(id, job)) throw new NotFoundException('Notification job not found');
    return { envelope: job.envelope, cached_result: job.cached_result };
  }

  claim(id: string, request: ClaimRequest) {
    return this.db.transaction((client) => claimNotification(client, this.config, id, request));
  }

  async cacheResult(id: string, value: unknown): Promise<OutcomeEnvelope> {
    const envelope = this.outcomeEnvelope(value);
    this.checkPath(id, envelope);
    return this.db.transaction(async (client) => {
      const job = await this.lockOutcomeJob(client, envelope);
      return this.cacheLocked(client, job, envelope);
    });
  }

  async applyResult(message: Envelope): Promise<OutcomeReceipt> {
    const envelope = this.outcomeEnvelope(message);
    return this.db.transaction(async (client) => {
      const job = await this.lockOutcomeJob(client, envelope);
      const cached = job.cached_result;
      if (!cached || !isDeepStrictEqual(cached, envelope)) throw mismatch();
      return this.applyLocked(client, cached);
    });
  }

  async submitOutcome(id: string, value: unknown): Promise<OutcomeReceipt> {
    const payload = value as Partial<OutcomeEnvelope['payload']> | null;
    const envelope = this.outcomeEnvelope({
      schemaVersion: 1,
      type: 'notification.outcome',
      messageId: payload?.outcomeId,
      correlationId: payload?.eventId,
      occurredAt: new Date().toISOString(),
      payload,
    });
    this.checkPath(id, envelope);
    return this.db.transaction(async (client) => {
      const job = await this.lockOutcomeJob(client, envelope);
      // HTTP fallback carries only the payload. Preserve the timestamp of a
      // canonical envelope already persisted by the worker.
      const canonical =
        job.cached_result && isDeepStrictEqual(job.cached_result.payload, envelope.payload)
          ? job.cached_result
          : envelope;
      const cached = await this.cacheLocked(client, job, canonical);
      return this.applyLocked(client, cached);
    });
  }

  private outcomeEnvelope(value: unknown): OutcomeEnvelope {
    try {
      const message = parseEnvelope(value);
      if (message.type === 'notification.outcome') return message;
    } catch {
      throw new BadRequestException('Invalid notification outcome contract');
    }
    throw new BadRequestException('Invalid notification outcome contract');
  }

  private checkPath(id: string, envelope: OutcomeEnvelope): void {
    if (id !== envelope.payload.notificationId) {
      throw new BadRequestException('Notification outcome does not match the request path');
    }
  }

  private async lockOutcomeJob(client: PoolClient, envelope: OutcomeEnvelope): Promise<JobRow> {
    const p = envelope.payload;
    const {
      rows: [job],
    } = await client.query<JobRow>(
      `${notificationJobSelect}
       FROM cloud_jobs j JOIN notifications n ON n.id = j.id
       WHERE j.id = $1 AND j.kind = 'notification.job' AND j.envelope IS NOT NULL
       FOR UPDATE OF j, n`,
      [p.notificationId],
    );
    if (!job) throw new NotFoundException('Notification job not found');
    if (
      !matchesJob(p.notificationId, job) ||
      job.event_id !== p.eventId ||
      job.owner_user_id !== p.ownerScopeId
    )
      throw mismatch();

    const {
      rows: [attempt],
    } = await client.query<AttemptRow>(
      'SELECT * FROM cloud_notification_attempts WHERE attempt_id = $1',
      [p.attemptId],
    );
    if (
      !attempt ||
      attempt.notification_id !== p.notificationId ||
      attempt.owner_user_id !== p.ownerScopeId ||
      attempt.channel !== job.channel ||
      (attempt.mode === 'DRY_RUN' && p.providerCalled) ||
      (!p.providerCalled && p.providerId !== null) ||
      (p.status === 'PROVIDER_ACCEPTED' && !p.providerId?.trim())
    )
      throw mismatch();
    return job;
  }

  private async cacheLocked(
    client: PoolClient,
    job: JobRow,
    envelope: OutcomeEnvelope,
  ): Promise<OutcomeEnvelope> {
    if (job.cached_result) {
      if (!isDeepStrictEqual(job.cached_result, envelope)) throw mismatch();
      return job.cached_result;
    }
    // A receipt and a cached-but-unpublished outcome both reserve this outcome ID.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('notification-outcome/' || $1, 0))",
      [envelope.messageId],
    );
    const {
      rows: [reservation],
    } = await client.query<{ collision: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM cloud_result_receipts WHERE id = $1 AND envelope <> $2::jsonb
       ) OR EXISTS (
         SELECT 1 FROM cloud_jobs WHERE kind = 'notification.job' AND cached_result IS NOT NULL
           AND (cached_result->>'messageId') = $1::uuid::text AND id <> $3
       ) AS collision`,
      [envelope.messageId, envelope, envelope.payload.notificationId],
    );
    if (reservation.collision) throw mismatch();
    await client.query('UPDATE cloud_jobs SET cached_result = $2 WHERE id = $1', [
      envelope.payload.notificationId,
      envelope,
    ]);
    return envelope;
  }

  private async applyLocked(client: PoolClient, message: OutcomeEnvelope): Promise<OutcomeReceipt> {
    const p = message.payload;
    const receipt = await client.query(
      `INSERT INTO cloud_result_receipts(id, job_id, envelope, disposition)
       VALUES ($1, $2, $3, 'ACCEPTED') ON CONFLICT (id) DO NOTHING RETURNING id`,
      [p.outcomeId, p.notificationId, message],
    );
    if (receipt.rowCount === 0) {
      const {
        rows: [same],
      } = await client.query<{ identical: boolean }>(
        'SELECT envelope = $2::jsonb AND job_id = $3 AS identical FROM cloud_result_receipts WHERE id = $1',
        [p.outcomeId, message, p.notificationId],
      );
      if (!same?.identical) throw mismatch();
      return { outcomeId: p.outcomeId, disposition: 'DUPLICATE' };
    }
    await client.query(
      `INSERT INTO cloud_notification_outcomes
        (outcome_id, notification_id, attempt_id, status, provider_called, provider_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        p.outcomeId,
        p.notificationId,
        p.attemptId,
        p.status,
        p.providerCalled,
        p.providerId,
        p.reason,
      ],
    );
    const status = {
      DRY_RUN: 'SKIPPED',
      PROVIDER_ACCEPTED: 'SENT',
      FAILED: 'FAILED',
      UNCERTAIN: 'PENDING',
    }[p.status];
    const errorCode =
      (p.status === 'DRY_RUN' || p.status === 'FAILED') &&
      p.reason !== null &&
      SAFE_OUTCOME_REASONS.has(p.reason)
        ? p.reason
        : p.status;
    await client.query(
      `UPDATE notifications
       SET status = $2::notification_status, provider_message_id = $3, error_code = $4, error_message = NULL,
         sent_at = CASE WHEN $2::notification_status = 'SENT' THEN clock_timestamp() ELSE NULL END,
         failed_at = CASE WHEN $2::notification_status = 'FAILED' THEN clock_timestamp() ELSE NULL END,
         attempt_count = greatest(attempt_count, 1), next_retry_at = NULL
       WHERE id = $1`,
      [p.notificationId, status, p.providerId, errorCode],
    );
    if (p.status === 'UNCERTAIN') {
      await client.query(
        `UPDATE cloud_notification_attempts SET uncertain_at = COALESCE(uncertain_at, clock_timestamp())
         WHERE attempt_id = $1`,
        [p.attemptId],
      );
    }
    return { outcomeId: p.outcomeId, disposition: 'ACCEPTED' };
  }
}
