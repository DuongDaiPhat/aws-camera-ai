import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import type { EventRecord } from './escalation.repository';
import type {
  DeadlineCommandPayload,
  DeadlineDisposition,
  DeadlineReason,
} from './dto/deadline-command.dto';

export interface LockedEventWithClock extends EventRecord {
  deadline_version: number;
  db_now: Date;
}

export interface DeadlineReceiptRecord {
  command_id: string;
  event_id: string;
  deadline_version: number;
  expected_deadline_at: Date;
  payload_hash: string;
  payload: DeadlineCommandPayload;
  disposition: DeadlineDisposition;
  reason: DeadlineReason;
  aggregate_version: number;
  notification_id: string | null;
  processed_at: Date;
}

export type DeadlineDispatchStatus = 'PENDING' | 'STARTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface DeadlineDispatchRecord {
  command_id: string;
  event_id: string;
  deadline_version: number;
  expected_deadline_at: Date;
  execution_name: string;
  state_machine_arn: string;
  execution_arn: string | null;
  status: DeadlineDispatchStatus;
  attempts: number;
  available_at: Date;
  last_error: string | null;
  started_at: Date | null;
  reconciled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DispatchEventState {
  id: string;
  status: EventRecord['status'];
  deadline_version: number;
  escalation_deadline_at: Date | null;
  has_receipt: boolean;
}

@Injectable()
export class DeadlineRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async assertLocalDriverSafe(): Promise<void> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM deadline_workflow_dispatches d JOIN events e ON e.id = d.event_id
       WHERE d.status IN ('PENDING', 'STARTED', 'FAILED')
         AND e.status = 'NOTIFIED' AND e.escalation_deadline_at IS NOT NULL
         AND e.deadline_version = d.deadline_version;`,
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'DEADLINE_DRIVER=local blocked: drain/reconcile active cloud deadlines before switching driver',
      );
    }
  }

  async getPoolClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async findEventForUpdateWithClock(
    client: PoolClient,
    eventId: string,
  ): Promise<LockedEventWithClock | null> {
    const res = await client.query<LockedEventWithClock>(
      `SELECT
         id, event_type, status, priority, confidence, ai_label, ai_results,
         version, deadline_version, detected_at, escalation_deadline_at,
         notified_at, escalated_at, resolved_at, closed_at,
         rule_snapshot, triggering_results,
         now() AS db_now
       FROM events
       WHERE id = $1
       FOR UPDATE;`,
      [eventId],
    );
    return res.rows[0] ?? null;
  }

  async findReceiptByCommandId(
    client: PoolClient,
    commandId: string,
  ): Promise<DeadlineReceiptRecord | null> {
    const res = await client.query<DeadlineReceiptRecord>(
      `SELECT
         command_id, event_id, deadline_version, expected_deadline_at,
         payload_hash, payload, disposition, reason,
         aggregate_version, notification_id, processed_at
       FROM deadline_command_receipts
       WHERE command_id = $1;`,
      [commandId],
    );
    return res.rows[0] ?? null;
  }

  async findReceiptByCommandIdReadOnly(commandId: string): Promise<DeadlineReceiptRecord | null> {
    const res = await this.pool.query<DeadlineReceiptRecord>(
      `SELECT
         command_id, event_id, deadline_version, expected_deadline_at,
         payload_hash, payload, disposition, reason,
         aggregate_version, notification_id, processed_at
       FROM deadline_command_receipts
       WHERE command_id = $1;`,
      [commandId],
    );
    return res.rows[0] ?? null;
  }

  async insertReceipt(
    client: PoolClient,
    input: {
      commandId: string;
      eventId: string;
      deadlineVersion: number;
      expectedDeadlineAt: Date;
      payloadHash: string;
      payload: DeadlineCommandPayload;
      disposition: DeadlineDisposition;
      reason: DeadlineReason;
      aggregateVersion: number;
      notificationId: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO deadline_command_receipts (
         command_id, event_id, deadline_version, expected_deadline_at,
         payload_hash, payload, disposition, reason,
         aggregate_version, notification_id
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10);`,
      [
        input.commandId,
        input.eventId,
        input.deadlineVersion,
        input.expectedDeadlineAt,
        input.payloadHash,
        JSON.stringify(input.payload),
        input.disposition,
        input.reason,
        input.aggregateVersion,
        input.notificationId,
      ],
    );
  }

  async enqueueDispatch(
    client: PoolClient,
    input: {
      eventId: string;
      deadlineVersion: number;
      expectedDeadlineAt: Date;
      stateMachineArn: string;
      commandId?: string;
    },
  ): Promise<DeadlineDispatchRecord | null> {
    const commandId = input.commandId ?? randomUUID();
    const executionName = `deadline-${commandId}`;
    const res = await client.query<DeadlineDispatchRecord>(
      `INSERT INTO deadline_workflow_dispatches (
         command_id, event_id, deadline_version, expected_deadline_at,
         execution_name, state_machine_arn, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       ON CONFLICT (event_id, deadline_version) DO NOTHING
       RETURNING *;`,
      [
        commandId,
        input.eventId,
        input.deadlineVersion,
        input.expectedDeadlineAt,
        executionName,
        input.stateMachineArn,
      ],
    );
    return res.rows[0] ?? null;
  }

  async adoptPendingLocalDeadlines(stateMachineArn: string, limit = 50): Promise<number> {
    const res = await this.pool.query<{ command_id: string }>(
      `WITH candidates AS (
         SELECT
           gen_random_uuid() AS command_id,
           e.id AS event_id,
           e.deadline_version,
           e.escalation_deadline_at
         FROM events e
         WHERE e.status = 'NOTIFIED'
           AND e.event_type <> 'WELLNESS_TIMEOUT'
           AND e.escalation_deadline_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM deadline_workflow_dispatches d
             WHERE d.event_id = e.id AND d.deadline_version = e.deadline_version
           )
         ORDER BY e.escalation_deadline_at ASC
         LIMIT $2
       )
       INSERT INTO deadline_workflow_dispatches (
         command_id, event_id, deadline_version, expected_deadline_at,
         execution_name, state_machine_arn, status
       )
       SELECT
         c.command_id,
         c.event_id,
         c.deadline_version,
         c.escalation_deadline_at,
         'deadline-' || c.command_id::text,
         $1,
         'PENDING'
       FROM candidates c
       ON CONFLICT (event_id, deadline_version) DO NOTHING
       RETURNING command_id;`,
      [stateMachineArn, limit],
    );
    return res.rowCount ?? 0;
  }

  async cancelPendingDispatchesForEvent(client: PoolClient, eventId: string): Promise<number> {
    const res = await client.query(
      `UPDATE deadline_workflow_dispatches
       SET status = 'CANCELLED', reconciled_at = now()
       WHERE event_id = $1 AND status = 'PENDING';`,
      [eventId],
    );
    return res.rowCount ?? 0;
  }

  async markDispatchCompletedByCommandId(client: PoolClient, commandId: string): Promise<void> {
    await client.query(
      `UPDATE deadline_workflow_dispatches
       SET status = 'COMPLETED', last_error = NULL, reconciled_at = now()
       WHERE command_id = $1 AND status IN ('PENDING', 'STARTED', 'FAILED');`,
      [commandId],
    );
  }

  async claimNextPendingDispatch(
    leaseSeconds = 30,
  ): Promise<{ dispatch: DeadlineDispatchRecord; eventState: DispatchEventState } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<DeadlineDispatchRecord>(
        `SELECT *
         FROM deadline_workflow_dispatches
         WHERE status = 'PENDING' AND available_at <= now()
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED;`,
      );
      const dispatch = selected.rows[0];
      if (!dispatch) {
        await client.query('COMMIT');
        return null;
      }

      const stateRes = await client.query<DispatchEventState>(
        `SELECT
           e.id,
           e.status,
           e.deadline_version,
           e.escalation_deadline_at,
           EXISTS (
             SELECT 1 FROM deadline_command_receipts r WHERE r.command_id = $2
           ) AS has_receipt
         FROM events e
         WHERE e.id = $1;`,
        [dispatch.event_id, dispatch.command_id],
      );
      const eventState = stateRes.rows[0];
      if (!eventState) {
        await client.query(
          `UPDATE deadline_workflow_dispatches
           SET status = 'CANCELLED', reconciled_at = now()
           WHERE command_id = $1;`,
          [dispatch.command_id],
        );
        await client.query('COMMIT');
        return null;
      }

      if (eventState.has_receipt) {
        await client.query(
          `UPDATE deadline_workflow_dispatches
           SET status = 'COMPLETED', last_error = NULL, reconciled_at = now()
           WHERE command_id = $1;`,
          [dispatch.command_id],
        );
        await client.query('COMMIT');
        return null;
      }

      if (
        eventState.status !== 'NOTIFIED' ||
        eventState.escalation_deadline_at === null ||
        eventState.deadline_version !== dispatch.deadline_version
      ) {
        await client.query(
          `UPDATE deadline_workflow_dispatches
           SET status = 'CANCELLED', reconciled_at = now()
           WHERE command_id = $1;`,
          [dispatch.command_id],
        );
        await client.query('COMMIT');
        return null;
      }

      await client.query(
        `UPDATE deadline_workflow_dispatches
         SET available_at = now() + ($2 * interval '1 second')
         WHERE command_id = $1;`,
        [dispatch.command_id, leaseSeconds],
      );
      await client.query('COMMIT');
      return { dispatch, eventState };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDispatchStarted(commandId: string, executionArn: string): Promise<void> {
    await this.pool.query(
      `UPDATE deadline_workflow_dispatches
       SET status = 'STARTED',
           execution_arn = $2,
           started_at = COALESCE(started_at, now()),
           last_error = NULL,
           reconciled_at = now()
       WHERE command_id = $1 AND status IN ('PENDING', 'STARTED');`,
      [commandId, executionArn],
    );
  }

  async markDispatchCompleted(commandId: string, executionArn?: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE deadline_workflow_dispatches
       SET status = 'COMPLETED',
           execution_arn = COALESCE($2, execution_arn),
           last_error = NULL,
           reconciled_at = now()
       WHERE command_id = $1;`,
      [commandId, executionArn ?? null],
    );
  }

  async markDispatchFailed(
    commandId: string,
    reason: string,
    executionArn?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE deadline_workflow_dispatches
       SET status = 'FAILED',
           execution_arn = COALESCE($3, execution_arn),
           last_error = $2,
           reconciled_at = now()
       WHERE command_id = $1;`,
      [commandId, reason, executionArn ?? null],
    );
  }

  async recordDispatchRetryOrFail(
    commandId: string,
    reason: string,
    maxAttempts: number,
  ): Promise<{ attempts: number; failed: boolean }> {
    const res = await this.pool.query<{ attempts: number; status: DeadlineDispatchStatus }>(
      `UPDATE deadline_workflow_dispatches
       SET attempts = attempts + 1,
           status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END,
           last_error = $2,
           available_at = now() + (LEAST(300, 5 * POWER(2, LEAST(attempts, 6))) * interval '1 second'),
           reconciled_at = now()
       WHERE command_id = $1 AND status = 'PENDING'
       RETURNING attempts, status;`,
      [commandId, reason, maxAttempts],
    );
    const row = res.rows[0];
    return {
      attempts: row?.attempts ?? maxAttempts,
      failed: row?.status === 'FAILED',
    };
  }

  async touchReconciledAt(commandId: string): Promise<void> {
    await this.pool.query(
      `UPDATE deadline_workflow_dispatches
       SET reconciled_at = now(), available_at = now() + interval '30 seconds'
       WHERE command_id = $1;`,
      [commandId],
    );
  }

  async getDispatchEventState(
    eventId: string,
    commandId: string,
  ): Promise<DispatchEventState | null> {
    const res = await this.pool.query<DispatchEventState>(
      `SELECT
         e.id,
         e.status,
         e.deadline_version,
         e.escalation_deadline_at,
         EXISTS (
           SELECT 1 FROM deadline_command_receipts r WHERE r.command_id = $2
         ) AS has_receipt
       FROM events e
       WHERE e.id = $1;`,
      [eventId, commandId],
    );
    return res.rows[0] ?? null;
  }

  async findStartedDispatchesForReconcile(
    limit = 20,
    graceSeconds = 30,
  ): Promise<DeadlineDispatchRecord[]> {
    const res = await this.pool.query<DeadlineDispatchRecord>(
      `SELECT d.*
       FROM deadline_workflow_dispatches d
       JOIN events e ON e.id = d.event_id
       WHERE d.status IN ('STARTED', 'FAILED')
         AND d.available_at <= now()
         AND (
           d.expected_deadline_at <= now() - ($2 * interval '1 second')
           OR e.status <> 'NOTIFIED'
           OR e.deadline_version <> d.deadline_version
           OR EXISTS (
             SELECT 1 FROM deadline_command_receipts r WHERE r.command_id = d.command_id
           )
         )
       ORDER BY d.reconciled_at ASC NULLS FIRST, d.expected_deadline_at ASC
       LIMIT $1;`,
      [limit, graceSeconds],
    );
    return res.rows;
  }
}
