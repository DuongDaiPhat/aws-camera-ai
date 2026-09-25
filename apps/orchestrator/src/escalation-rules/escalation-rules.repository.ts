import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import type { EventType, PriorityLevel, NotificationChannel } from '@cam/contracts';

export interface EscalationRuleRecord {
  id: string;
  event_type: EventType;
  priority: PriorityLevel;
  t_low: string | null;
  t_high: string | null;
  t_wait_seconds: number;
  skip_logged_only: boolean;
  notify_channels: NotificationChannel[];
  escalate_channels: NotificationChannel[];
  max_escalation_level: number;
  is_enabled: boolean;
  version: number;
  updated_at: Date;
  updated_by_name: string | null;
}

export interface UpdateThresholdsParams {
  eventType: string;
  tLow: number | null;
  tHigh: number | null;
  tWaitSeconds: number;
  expectedVersion: number;
  actorUserId: string;
  clientIp?: string | null;
  userAgent?: string | null;
  correlationId?: string;
}

export class RuleNotFoundError extends Error {
  constructor(message = 'Không tìm thấy cấu hình cho loại sự kiện.') {
    super(message);
    this.name = 'RuleNotFoundError';
  }
}

export class RuleVersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    message = 'Cấu hình đã thay đổi. Hãy tải lại trước khi lưu.',
  ) {
    super(message);
    this.name = 'RuleVersionConflictError';
  }
}

@Injectable()
export class EscalationRulesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(): Promise<EscalationRuleRecord[]> {
    const query = `
      SELECT
        er.id,
        er.event_type,
        er.priority,
        er.t_low,
        er.t_high,
        er.t_wait_seconds,
        er.skip_logged_only,
        er.notify_channels,
        er.escalate_channels,
        er.max_escalation_level,
        er.is_enabled,
        er.version,
        er.updated_at,
        u.full_name as updated_by_name
      FROM escalation_rules er
      LEFT JOIN users u ON u.id = er.updated_by_user_id
      ORDER BY
        CASE er.priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        er.event_type ASC;
    `;
    const result = await this.pool.query<EscalationRuleRecord>(query);
    return result.rows;
  }

  async findByEventType(eventType: string): Promise<EscalationRuleRecord | null> {
    const query = `
      SELECT
        er.id,
        er.event_type,
        er.priority,
        er.t_low,
        er.t_high,
        er.t_wait_seconds,
        er.skip_logged_only,
        er.notify_channels,
        er.escalate_channels,
        er.max_escalation_level,
        er.is_enabled,
        er.version,
        er.updated_at,
        u.full_name as updated_by_name
      FROM escalation_rules er
      LEFT JOIN users u ON u.id = er.updated_by_user_id
      WHERE er.event_type::text = $1;
    `;
    const result = await this.pool.query<EscalationRuleRecord>(query, [eventType]);
    return result.rows[0] ?? null;
  }

  async updateThresholdsAtomic(params: UpdateThresholdsParams): Promise<EscalationRuleRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Khóa dòng để tránh race conditions (FR-ADM-03, optimistic locking)
      const selectQuery = `
        SELECT id, event_type, version, t_low, t_high, t_wait_seconds
        FROM escalation_rules
        WHERE event_type::text = $1
        FOR UPDATE;
      `;
      const currentRes = await client.query<{
        id: string;
        event_type: string;
        version: number;
        t_low: string | null;
        t_high: string | null;
        t_wait_seconds: number;
      }>(selectQuery, [params.eventType]);

      if (currentRes.rows.length === 0) {
        throw new RuleNotFoundError();
      }

      const current = currentRes.rows[0];
      if (current.version !== params.expectedVersion) {
        throw new RuleVersionConflictError(current.version);
      }

      const updateQuery = `
        UPDATE escalation_rules
        SET
          t_low = $1,
          t_high = $2,
          t_wait_seconds = $3,
          updated_by_user_id = $4,
          version = version + 1
        WHERE event_type::text = $5 AND version = $6
        RETURNING
          id,
          event_type,
          priority,
          t_low,
          t_high,
          t_wait_seconds,
          skip_logged_only,
          notify_channels,
          escalate_channels,
          max_escalation_level,
          is_enabled,
          version,
          updated_at;
      `;
      const updateRes = await client.query<EscalationRuleRecord>(updateQuery, [
        params.tLow,
        params.tHigh,
        params.tWaitSeconds,
        params.actorUserId,
        params.eventType,
        params.expectedVersion,
      ]);

      if (updateRes.rows.length === 0) {
        throw new RuleVersionConflictError(current.version);
      }

      const updated = updateRes.rows[0];

      // Ghi audit log theo đúng chuẩn (FR-LOG-01, Plan section 6)
      const auditQuery = `
        INSERT INTO audit_logs (
          actor_user_id,
          action,
          entity_type,
          entity_id,
          ip_address,
          user_agent,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7);
      `;

      const auditMetadata = {
        eventType: params.eventType,
        version: updated.version,
        before: {
          tLow: current.t_low !== null ? Number(current.t_low) : null,
          tHigh: current.t_high !== null ? Number(current.t_high) : null,
          tWaitSeconds: current.t_wait_seconds,
        },
        after: {
          tLow: params.tLow,
          tHigh: params.tHigh,
          tWaitSeconds: params.tWaitSeconds,
        },
        correlationId: params.correlationId ?? null,
      };

      await client.query(auditQuery, [
        params.actorUserId,
        'ESCALATION_RULE_UPDATED',
        'escalation_rules',
        updated.id,
        params.clientIp || null,
        params.userAgent || null,
        JSON.stringify(auditMetadata),
      ]);

      await client.query('COMMIT');

      // Lấy tên actor vừa cập nhật để phản hồi
      const userRes = await this.pool.query<{ full_name: string }>(
        `SELECT full_name FROM users WHERE id = $1`,
        [params.actorUserId],
      );
      updated.updated_by_name = userRes.rows[0]?.full_name ?? null;

      return updated;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
