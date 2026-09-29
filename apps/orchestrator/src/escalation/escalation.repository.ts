import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import type {
  EventType,
  EventStatus,
  PriorityLevel,
  NotificationChannel,
  ConfirmationResponse,
  ConfirmationPhase,
  NotificationStatus,
} from '@cam/contracts';

export type ActorType = 'SYSTEM' | 'USER' | 'SCHEDULER' | 'EMERGENCY_CONTACT';

export interface EventRecord {
  id: string;
  event_type: EventType;
  status: EventStatus;
  priority: PriorityLevel;
  confidence: string | null;
  ai_label: string | null;
  ai_results: unknown[];
  version: number;
  detected_at: Date;
  escalation_deadline_at: Date | null;
  notified_at: Date | null;
  escalated_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  rule_snapshot: Record<string, unknown> | null;
  triggering_results: unknown[];
}

export interface ConfirmationRecord {
  id: string;
  event_id: string;
  user_id: string | null;
  emergency_contact_id: string | null;
  channel: NotificationChannel;
  response: ConfirmationResponse;
  phase: ConfirmationPhase;
  is_authoritative: boolean;
  note: string | null;
  responded_at: Date;
  confirmed_by_name?: string | null;
}

export class EventNotFoundError extends Error {
  constructor(message = 'Không tìm thấy sự kiện') {
    super(message);
    this.name = 'EventNotFoundError';
  }
}

export class EventVersionConflictError extends Error {
  constructor(message = 'Sự kiện đã bị thay đổi bởi phiên khác') {
    super(message);
    this.name = 'EventVersionConflictError';
  }
}

@Injectable()
export class EscalationRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getPoolClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async findEventForUpdate(client: PoolClient, eventId: string): Promise<EventRecord | null> {
    const query = `
      SELECT
        id, event_type, status, priority, confidence, ai_label, ai_results,
        version, detected_at, escalation_deadline_at, notified_at, escalated_at,
        resolved_at, closed_at, rule_snapshot, triggering_results
      FROM events
      WHERE id = $1
      FOR UPDATE;
    `;
    const res = await client.query<EventRecord>(query, [eventId]);
    return res.rows[0] ?? null;
  }

  async updateEventStatus(
    client: PoolClient,
    eventId: string,
    expectedVersion: number,
    updates: {
      status: EventStatus;
      priority?: PriorityLevel;
      notifiedAt?: Date;
      escalationDeadlineAt?: Date | null;
      escalatedAt?: Date;
      resolvedAt?: Date;
      closedAt?: Date;
      ruleSnapshot?: Record<string, unknown> | null;
      triggeringResults?: unknown[];
    },
  ): Promise<EventRecord> {
    const query = `
      UPDATE events
      SET
        status = $1,
        priority = COALESCE($2, priority),
        notified_at = COALESCE($3, notified_at),
        escalation_deadline_at = $4,
        escalated_at = COALESCE($5, escalated_at),
        resolved_at = COALESCE($6, resolved_at),
        closed_at = COALESCE($7, closed_at),
        rule_snapshot = COALESCE($8, rule_snapshot),
        triggering_results = COALESCE($9, triggering_results),
        version = version + 1
      WHERE id = $10 AND version = $11
      RETURNING
        id, event_type, status, priority, confidence, ai_label, ai_results,
        version, detected_at, escalation_deadline_at, notified_at, escalated_at,
        resolved_at, closed_at, rule_snapshot, triggering_results;
    `;

    const res = await client.query<EventRecord>(query, [
      updates.status,
      updates.priority ?? null,
      updates.notifiedAt ?? null,
      updates.escalationDeadlineAt ?? null,
      updates.escalatedAt ?? null,
      updates.resolvedAt ?? null,
      updates.closedAt ?? null,
      updates.ruleSnapshot ? JSON.stringify(updates.ruleSnapshot) : null,
      updates.triggeringResults ? JSON.stringify(updates.triggeringResults) : null,
      eventId,
      expectedVersion,
    ]);

    if (res.rows.length === 0) {
      throw new EventVersionConflictError();
    }
    return res.rows[0];
  }

  async createStatusHistory(
    client: PoolClient,
    data: {
      eventId: string;
      fromStatus: EventStatus | null;
      toStatus: EventStatus;
      reason?: string | null;
      actorType: ActorType;
      actorUserId?: string | null;
      channel?: NotificationChannel | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const query = `
      INSERT INTO event_status_history (
        event_id, from_status, to_status, reason, actor_type,
        actor_user_id, channel, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
    `;
    await client.query(query, [
      data.eventId,
      data.fromStatus,
      data.toStatus,
      data.reason ?? null,
      data.actorType,
      data.actorUserId ?? null,
      data.channel ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]);
  }

  async createConfirmation(
    client: PoolClient,
    data: {
      eventId: string;
      notificationId?: string | null;
      userId?: string | null;
      emergencyContactId?: string | null;
      channel: NotificationChannel;
      response: ConfirmationResponse;
      phase: ConfirmationPhase;
      isAuthoritative: boolean;
      note?: string | null;
      sourceMessageId?: string | null;
    },
  ): Promise<ConfirmationRecord> {
    const query = `
      INSERT INTO confirmations (
        event_id, notification_id, user_id, emergency_contact_id,
        channel, response, phase, is_authoritative, note, source_message_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, event_id, user_id, emergency_contact_id, channel, response, phase, is_authoritative, note, responded_at;
    `;
    const res = await client.query<ConfirmationRecord>(query, [
      data.eventId,
      data.notificationId ?? null,
      data.userId ?? null,
      data.emergencyContactId ?? null,
      data.channel,
      data.response,
      data.phase,
      data.isAuthoritative,
      data.note ?? null,
      data.sourceMessageId ?? null,
    ]);

    const created = res.rows[0];
    if (data.userId) {
      const userRes = await client.query<{ full_name: string }>(
        `SELECT full_name FROM users WHERE id = $1`,
        [data.userId],
      );
      created.confirmed_by_name = userRes.rows[0]?.full_name ?? null;
    }
    return created;
  }

  async findAuthoritativeConfirmation(
    client: PoolClient,
    eventId: string,
    phase: ConfirmationPhase,
  ): Promise<ConfirmationRecord | null> {
    const query = `
      SELECT
        c.id, c.event_id, c.user_id, c.emergency_contact_id, c.channel,
        c.response, c.phase, c.is_authoritative, c.note, c.responded_at,
        u.full_name as confirmed_by_name
      FROM confirmations c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.event_id = $1 AND c.phase = $2 AND c.is_authoritative = TRUE;
    `;
    const res = await client.query<ConfirmationRecord>(query, [eventId, phase]);
    return res.rows[0] ?? null;
  }

  async createNotificationIntent(
    client: PoolClient,
    data: {
      eventId: string;
      recipientUserId?: string | null;
      emergencyContactId?: string | null;
      channel: NotificationChannel;
      status: NotificationStatus;
      escalationLevel: number;
      payload?: Record<string, unknown>;
    },
  ): Promise<string> {
    const query = `
      INSERT INTO notifications (
        event_id, recipient_user_id, emergency_contact_id, channel,
        status, escalation_level, payload
      ) VALUES (
        $1,
        COALESCE($2::uuid, (
          SELECT d.owner_user_id
          FROM events e
          JOIN cameras c ON c.id = e.camera_id
          JOIN devices d ON d.id = c.device_id
          WHERE e.id = $1
        )),
        $3, $4, $5, $6, $7
      )
      RETURNING id;
    `;
    const res = await client.query<{ id: string }>(query, [
      data.eventId,
      data.recipientUserId ?? null,
      data.emergencyContactId ?? null,
      data.channel,
      data.status,
      data.escalationLevel,
      JSON.stringify(data.payload ?? {}),
    ]);
    return res.rows[0].id;
  }

  async findDueEventsForEscalation(client: PoolClient, limit: number): Promise<EventRecord[]> {
    const query = `
      SELECT
        id, event_type, status, priority, confidence, ai_label, ai_results,
        version, detected_at, escalation_deadline_at, notified_at, escalated_at,
        resolved_at, closed_at, rule_snapshot, triggering_results
      FROM events
      WHERE status = 'NOTIFIED'
        AND escalation_deadline_at IS NOT NULL
        AND escalation_deadline_at <= now()
      ORDER BY
        CASE priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        escalation_deadline_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED;
    `;
    const res = await client.query<EventRecord>(query, [limit]);
    return res.rows;
  }
}
