import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import type { UserRole } from '@cam/contracts';
import type {
  WellnessScheduleRecord,
  WellnessCheckRunRecord,
  WellnessObservationRecord,
  WellnessPresenceRecord,
  WellnessCheckRunStatus,
  WellnessPresenceState,
} from './wellness.types';

export interface CreateScheduleInput {
  ownerUserId: string;
  residentUserId: string;
  name: string;
  checkAt: string;
  daysOfWeek: number[];
  lookbackHours: number;
  graceSeconds: number;
  cameraIds: string[];
  timezone: string;
  isEnabled: boolean;
}

export interface UpdateScheduleInput {
  residentUserId?: string;
  name?: string;
  checkAt?: string;
  daysOfWeek?: number[];
  lookbackHours?: number;
  graceSeconds?: number;
  cameraIds?: string[];
  timezone?: string;
  isEnabled?: boolean;
}

@Injectable()
export class WellnessRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getPoolClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  // -------------------------------------------------------------
  // SCHEDULES
  // -------------------------------------------------------------

  async listSchedules(
    actorUserId: string,
    actorRole: UserRole,
    residentUserIdFilter?: string,
    client?: PoolClient,
  ): Promise<WellnessScheduleRecord[]> {
    const db = client ?? this.pool;
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];

    if (actorRole === 'ADMIN') {
      if (residentUserIdFilter) {
        params.push(residentUserIdFilter);
        conditions.push(`resident_user_id = $${params.length}`);
      }
    } else if (actorRole === 'CAREGIVER') {
      params.push(actorUserId);
      conditions.push(`owner_user_id = $${params.length}`);
      if (residentUserIdFilter) {
        params.push(residentUserIdFilter);
        conditions.push(`resident_user_id = $${params.length}`);
      }
    } else {
      // Role VIEWER (Resident): chỉ xem lịch của chính mình
      params.push(actorUserId);
      conditions.push(`resident_user_id = $${params.length}`);
    }

    const sql = `
      SELECT id, owner_user_id, resident_user_id, name, check_at, days_of_week,
             lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
             version, activation_started_at, last_materialized_at, last_checked_at,
             deleted_at, created_at, updated_at
      FROM wellness_schedules
      WHERE ${conditions.join(' AND ')}
      ORDER BY check_at ASC, created_at ASC
    `;

    const res = await db.query(sql, params);
    return res.rows.map(this.mapScheduleRow);
  }

  async getScheduleById(
    scheduleId: string,
    client?: PoolClient,
  ): Promise<WellnessScheduleRecord | null> {
    const db = client ?? this.pool;
    const sql = `
      SELECT id, owner_user_id, resident_user_id, name, check_at, days_of_week,
             lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
             version, activation_started_at, last_materialized_at, last_checked_at,
             deleted_at, created_at, updated_at
      FROM wellness_schedules
      WHERE id = $1 AND deleted_at IS NULL
    `;
    const res = await db.query(sql, [scheduleId]);
    if (res.rows.length === 0) return null;
    return this.mapScheduleRow(res.rows[0]);
  }

  async findConflictingSchedule(
    residentUserId: string,
    checkAt: string,
    excludeScheduleId?: string,
    client?: PoolClient,
  ): Promise<WellnessScheduleRecord | null> {
    const db = client ?? this.pool;
    const sql = `
      SELECT id, owner_user_id, resident_user_id, name, check_at, days_of_week,
             lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
             version, activation_started_at, last_materialized_at, last_checked_at,
             deleted_at, created_at, updated_at
      FROM wellness_schedules
      WHERE resident_user_id = $1 AND check_at = $2 AND deleted_at IS NULL
        AND ($3::uuid IS NULL OR id != $3::uuid)
      LIMIT 1
    `;
    const res = await db.query(sql, [residentUserId, checkAt, excludeScheduleId ?? null]);
    if (res.rows.length === 0) return null;
    return this.mapScheduleRow(res.rows[0]);
  }

  async createSchedule(
    input: CreateScheduleInput,
    client?: PoolClient,
  ): Promise<WellnessScheduleRecord> {
    const db = client ?? this.pool;
    const sql = `
      INSERT INTO wellness_schedules (
        owner_user_id, resident_user_id, name, check_at, days_of_week,
        lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
        version, activation_started_at, last_materialized_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        1, now(), now()
      )
      RETURNING id, owner_user_id, resident_user_id, name, check_at, days_of_week,
                lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
                version, activation_started_at, last_materialized_at, last_checked_at,
                deleted_at, created_at, updated_at
    `;
    const res = await db.query(sql, [
      input.ownerUserId,
      input.residentUserId,
      input.name,
      input.checkAt,
      input.daysOfWeek,
      input.lookbackHours,
      input.graceSeconds,
      input.cameraIds,
      input.timezone,
      input.isEnabled,
    ]);
    return this.mapScheduleRow(res.rows[0]);
  }

  async updateSchedule(
    scheduleId: string,
    input: UpdateScheduleInput,
    client?: PoolClient,
  ): Promise<WellnessScheduleRecord | null> {
    const db = client ?? this.pool;
    const fields: string[] = ['version = version + 1', 'updated_at = now()'];
    const params: unknown[] = [scheduleId];

    if (input.residentUserId !== undefined) {
      params.push(input.residentUserId);
      fields.push(`resident_user_id = $${params.length}`);
    }
    if (input.name !== undefined) {
      params.push(input.name);
      fields.push(`name = $${params.length}`);
    }
    if (input.checkAt !== undefined) {
      params.push(input.checkAt);
      fields.push(`check_at = $${params.length}`);
    }
    if (input.daysOfWeek !== undefined) {
      params.push(input.daysOfWeek);
      fields.push(`days_of_week = $${params.length}`);
    }
    if (input.lookbackHours !== undefined) {
      params.push(input.lookbackHours);
      fields.push(`lookback_hours = $${params.length}`);
    }
    if (input.graceSeconds !== undefined) {
      params.push(input.graceSeconds);
      fields.push(`grace_seconds = $${params.length}`);
    }
    if (input.cameraIds !== undefined) {
      params.push(input.cameraIds);
      fields.push(`camera_ids = $${params.length}`);
    }
    if (input.timezone !== undefined) {
      params.push(input.timezone);
      fields.push(`timezone = $${params.length}`);
    }
    if (input.isEnabled !== undefined) {
      params.push(input.isEnabled);
      fields.push(`is_enabled = $${params.length}`);
      if (input.isEnabled) {
        fields.push(`activation_started_at = now()`);
      }
    }

    const sql = `
      UPDATE wellness_schedules
      SET ${fields.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, owner_user_id, resident_user_id, name, check_at, days_of_week,
                lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
                version, activation_started_at, last_materialized_at, last_checked_at,
                deleted_at, created_at, updated_at
    `;
    const res = await db.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.mapScheduleRow(res.rows[0]);
  }

  async deleteSchedule(scheduleId: string, client?: PoolClient): Promise<boolean> {
    const db = client ?? this.pool;
    const sql = `
      UPDATE wellness_schedules
      SET deleted_at = now(), updated_at = now(), is_enabled = false
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;
    const res = await db.query(sql, [scheduleId]);
    return res.rows.length > 0;
  }

  async verifyResidentHouseholdLink(
    ownerUserId: string,
    residentUserId: string,
    client?: PoolClient,
  ): Promise<boolean> {
    const db = client ?? this.pool;
    const sql = `
      SELECT 1 FROM users u
      WHERE u.id = $1 AND u.is_active = true
        AND (
          EXISTS (
            SELECT 1 FROM known_faces kf
            WHERE kf.owner_user_id = $2 AND kf.linked_user_id = $1 AND kf.is_active = true
          )
          OR u.role = 'VIEWER'
        )
    `;
    const res = await db.query(sql, [residentUserId, ownerUserId]);
    return res.rows.length > 0;
  }

  // -------------------------------------------------------------
  // OBSERVATIONS & PRESENCE
  // -------------------------------------------------------------

  async findObservationById(
    observationId: string,
    client?: PoolClient,
  ): Promise<WellnessObservationRecord | null> {
    const db = client ?? this.pool;
    const sql = `
      SELECT observation_id, owner_user_id, resident_user_id, known_face_id,
             camera_id, identity_event_id, source_session_id, track_id,
             kind, observed_at, received_at, payload_hash, evidence
      FROM resident_wellness_observations
      WHERE observation_id = $1
    `;
    const res = await db.query(sql, [observationId]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async saveObservation(obs: WellnessObservationRecord, client?: PoolClient): Promise<void> {
    const db = client ?? this.pool;
    const sql = `
      INSERT INTO resident_wellness_observations (
        observation_id, owner_user_id, resident_user_id, known_face_id,
        camera_id, identity_event_id, source_session_id, track_id,
        kind, observed_at, received_at, payload_hash, evidence
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12, $13
      )
    `;
    await db.query(sql, [
      obs.observation_id,
      obs.owner_user_id,
      obs.resident_user_id,
      obs.known_face_id,
      obs.camera_id,
      obs.identity_event_id,
      obs.source_session_id,
      obs.track_id,
      obs.kind,
      obs.observed_at,
      obs.received_at,
      obs.payload_hash,
      obs.evidence,
    ]);
  }

  async getPresenceState(
    ownerUserId: string,
    residentUserId: string,
    asOf: Date,
    client?: PoolClient,
  ): Promise<WellnessPresenceState> {
    const db = client ?? this.pool;
    const sql = `
      SELECT state, valid_until, observed_at
      FROM resident_wellness_presence
      WHERE owner_user_id = $1 AND resident_user_id = $2
    `;
    const res = await db.query(sql, [ownerUserId, residentUserId]);
    if (res.rows.length === 0) return 'UNKNOWN';

    const row = res.rows[0];
    if (new Date(row.valid_until) < asOf) {
      return 'UNKNOWN';
    }
    return row.state as WellnessPresenceState;
  }

  async updatePresence(presence: WellnessPresenceRecord, client?: PoolClient): Promise<void> {
    const db = client ?? this.pool;
    const sql = `
      INSERT INTO resident_wellness_presence (
        owner_user_id, resident_user_id, state, observation_id,
        observed_at, valid_until, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (owner_user_id, resident_user_id) DO UPDATE
      SET state = EXCLUDED.state,
          observation_id = EXCLUDED.observation_id,
          observed_at = EXCLUDED.observed_at,
          valid_until = EXCLUDED.valid_until,
          updated_at = now()
      WHERE EXCLUDED.observed_at >= resident_wellness_presence.observed_at
    `;
    await db.query(sql, [
      presence.owner_user_id,
      presence.resident_user_id,
      presence.state,
      presence.observation_id,
      presence.observed_at,
      presence.valid_until,
    ]);
  }

  async findActivityInWindow(
    ownerUserId: string,
    residentUserId: string,
    cameraIds: string[],
    windowStart: Date,
    windowEnd: Date,
    client?: PoolClient,
  ): Promise<Date | null> {
    const db = client ?? this.pool;
    const conditions = [
      'owner_user_id = $1',
      'resident_user_id = $2',
      "kind IN ('MOTION', 'ARRIVAL')",
      'observed_at >= $3',
      'observed_at <= $4',
    ];
    const params: unknown[] = [ownerUserId, residentUserId, windowStart, windowEnd];

    if (cameraIds.length > 0) {
      params.push(cameraIds);
      conditions.push(`camera_id = ANY($${params.length}::uuid[])`);
    }

    const sql = `
      SELECT observed_at
      FROM resident_wellness_observations
      WHERE ${conditions.join(' AND ')}
      ORDER BY observed_at DESC
      LIMIT 1
    `;
    const res = await db.query(sql, params);
    if (res.rows.length === 0) return null;
    return new Date(res.rows[0].observed_at);
  }

  async hasActiveUnresolvedWellnessEvent(
    ownerUserId: string,
    residentUserId: string,
    client?: PoolClient,
  ): Promise<string | null> {
    const db = client ?? this.pool;
    const sql = `
      SELECT id
      FROM events
      WHERE wellness_owner_user_id = $1
        AND wellness_resident_user_id = $2
        AND event_type = 'WELLNESS_TIMEOUT'
        AND status IN ('DETECTED', 'NOTIFIED', 'ESCALATED')
      LIMIT 1
    `;
    const res = await db.query(sql, [ownerUserId, residentUserId]);
    if (res.rows.length === 0) return null;
    return res.rows[0].id;
  }

  // -------------------------------------------------------------
  // RUNS / CHECKS
  // -------------------------------------------------------------

  async listChecks(
    actorUserId: string,
    actorRole: UserRole,
    filters: {
      residentUserId?: string;
      scheduleId?: string;
      page: number;
      pageSize: number;
    },
    client?: PoolClient,
  ): Promise<{ data: WellnessCheckRunRecord[]; total: number }> {
    const db = client ?? this.pool;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (actorRole === 'CAREGIVER') {
      params.push(actorUserId);
      conditions.push(`r.owner_user_id = $${params.length}`);
    } else if (actorRole === 'VIEWER') {
      params.push(actorUserId);
      conditions.push(`r.resident_user_id = $${params.length}`);
    }

    if (filters.residentUserId) {
      params.push(filters.residentUserId);
      conditions.push(`r.resident_user_id = $${params.length}`);
    }
    if (filters.scheduleId) {
      params.push(filters.scheduleId);
      conditions.push(`r.schedule_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT count(*)::int AS total FROM wellness_check_runs r ${whereClause}`;
    const countRes = await db.query(countSql, params);
    const total = countRes.rows[0]?.total ?? 0;

    const offset = (filters.page - 1) * filters.pageSize;
    params.push(filters.pageSize, offset);

    const querySql = `
      SELECT r.*, e.status AS event_status
      FROM wellness_check_runs r
      LEFT JOIN events e ON e.id = r.event_id
      ${whereClause}
      ORDER BY r.scheduled_for DESC, r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const res = await db.query(querySql, params);
    return {
      data: res.rows.map(this.mapRunRow),
      total,
    };
  }

  async getCheckById(checkId: string, client?: PoolClient): Promise<WellnessCheckRunRecord | null> {
    const db = client ?? this.pool;
    const sql = `
      SELECT r.*, e.status AS event_status
      FROM wellness_check_runs r
      LEFT JOIN events e ON e.id = r.event_id
      WHERE r.id = $1
    `;
    const res = await db.query(sql, [checkId]);
    if (res.rows.length === 0) return null;
    return this.mapRunRow(res.rows[0]);
  }

  async getCheckByEventId(
    eventId: string,
    client?: PoolClient,
  ): Promise<WellnessCheckRunRecord | null> {
    const db = client ?? this.pool;
    const sql = `
      SELECT r.*, e.status AS event_status
      FROM wellness_check_runs r
      LEFT JOIN events e ON e.id = r.event_id
      WHERE r.event_id = $1
    `;
    const res = await db.query(sql, [eventId]);
    if (res.rows.length === 0) return null;
    return this.mapRunRow(res.rows[0]);
  }

  async getActiveEnabledSchedules(client?: PoolClient): Promise<WellnessScheduleRecord[]> {
    const db = client ?? this.pool;
    const sql = `
      SELECT id, owner_user_id, resident_user_id, name, check_at, days_of_week,
             lookback_hours, grace_seconds, camera_ids, timezone, is_enabled,
             version, activation_started_at, last_materialized_at, last_checked_at,
             deleted_at, created_at, updated_at
      FROM wellness_schedules
      WHERE is_enabled = true AND deleted_at IS NULL AND owner_user_id IS NOT NULL
    `;
    const res = await db.query(sql);
    return res.rows.map(this.mapScheduleRow);
  }

  async insertCheckRunIfNotExists(
    run: {
      scheduleId: string;
      ownerUserId: string;
      residentUserId: string;
      localDate: string;
      scheduledFor: Date;
      scheduleVersion: number;
      scheduleSnapshot: Record<string, unknown>;
      lookbackStartedAt: Date;
      lookbackEndedAt: Date;
      graceSeconds: number;
      availableAt: Date;
    },
    client?: PoolClient,
  ): Promise<boolean> {
    const db = client ?? this.pool;
    const sql = `
      INSERT INTO wellness_check_runs (
        schedule_id, owner_user_id, resident_user_id, local_date,
        scheduled_for, schedule_version, schedule_snapshot,
        lookback_started_at, lookback_ended_at, grace_seconds, available_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11
      )
      ON CONFLICT (schedule_id, local_date) DO NOTHING
      RETURNING id
    `;
    const res = await db.query(sql, [
      run.scheduleId,
      run.ownerUserId,
      run.residentUserId,
      run.localDate,
      run.scheduledFor,
      run.scheduleVersion,
      run.scheduleSnapshot,
      run.lookbackStartedAt,
      run.lookbackEndedAt,
      run.graceSeconds,
      run.availableAt,
    ]);
    return res.rows.length > 0;
  }

  async updateScheduleLastCheckedAt(
    scheduleId: string,
    checkedAt: Date,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.pool;
    await db.query(
      `UPDATE wellness_schedules SET last_checked_at = $2, last_materialized_at = $2 WHERE id = $1`,
      [scheduleId, checkedAt],
    );
  }

  async claimPendingRuns(
    limit: number,
    leaseSeconds: number,
    client: PoolClient,
  ): Promise<WellnessCheckRunRecord[]> {
    const sql = `
      WITH claimable AS (
        SELECT id
        FROM wellness_check_runs
        WHERE status = 'PENDING' AND available_at <= now()
        ORDER BY scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE wellness_check_runs r
      SET status = 'PROCESSING',
          leased_until = now() + ($2 * INTERVAL '1 second'),
          lease_token = gen_random_uuid(),
          attempt_count = attempt_count + 1,
          updated_at = now()
      FROM claimable
      WHERE r.id = claimable.id
      RETURNING r.*
    `;
    const res = await client.query(sql, [limit, leaseSeconds]);
    return res.rows.map(this.mapRunRow);
  }

  async reclaimExpiredLeases(client?: PoolClient): Promise<number> {
    const db = client ?? this.pool;
    const sql = `
      UPDATE wellness_check_runs
      SET status = 'PENDING',
          leased_until = NULL,
          lease_token = NULL,
          updated_at = now()
      WHERE status = 'PROCESSING' AND leased_until < now()
      RETURNING id
    `;
    const res = await db.query(sql);
    return res.rows.length;
  }

  async updateRunDecision(
    runId: string,
    leaseToken: string,
    status: WellnessCheckRunStatus,
    options: {
      decisionReason?: string | null;
      eventId?: string | null;
      lastActivityAt?: Date | null;
      presenceState?: WellnessPresenceState;
      deliveryDeadlineAt?: Date | null;
    },
    client: PoolClient,
  ): Promise<void> {
    const fields = [
      'status = $3',
      'decision_reason = $4',
      'evaluated_at = now()',
      'leased_until = NULL',
      'lease_token = NULL',
      'updated_at = now()',
    ];
    const params: unknown[] = [runId, leaseToken, status, options.decisionReason ?? null];

    if (options.eventId) {
      params.push(options.eventId);
      fields.push(`event_id = $${params.length}`);
    }
    if (options.lastActivityAt) {
      params.push(options.lastActivityAt);
      fields.push(`last_activity_at = $${params.length}`);
    }
    if (options.presenceState) {
      params.push(options.presenceState);
      fields.push(`presence_state = $${params.length}`);
    }
    if (options.deliveryDeadlineAt) {
      params.push(options.deliveryDeadlineAt);
      fields.push(`delivery_deadline_at = $${params.length}`);
    }

    const sql = `
      UPDATE wellness_check_runs
      SET ${fields.join(', ')}
      WHERE id = $1 AND lease_token = $2
    `;
    await client.query(sql, params);
  }

  async recordDeliverySuccess(
    eventId: string,
    sentAt: Date,
    graceSeconds: number,
    client: PoolClient,
  ): Promise<boolean> {
    const sql = `
      UPDATE wellness_check_runs
      SET request_sent_at = $2,
          confirmation_deadline_at = $2 + ($3 * INTERVAL '1 second'),
          updated_at = now()
      WHERE event_id = $1 AND request_sent_at IS NULL
      RETURNING id
    `;
    const res = await client.query(sql, [eventId, sentAt, graceSeconds]);
    return res.rows.length > 0;
  }

  async findDueDeliveryTimeouts(
    batchSize: number,
    client: PoolClient,
  ): Promise<WellnessCheckRunRecord[]> {
    const sql = `
      SELECT r.*, e.status AS event_status
      FROM wellness_check_runs r
      JOIN events e ON e.id = r.event_id
      WHERE r.status = 'ALERT_CREATED'
        AND r.request_sent_at IS NULL
        AND r.delivery_deadline_at IS NOT NULL
        AND r.delivery_deadline_at <= now()
        AND e.status = 'NOTIFIED'
      ORDER BY r.delivery_deadline_at ASC
      FOR UPDATE OF e, r SKIP LOCKED
      LIMIT $1
    `;
    const res = await client.query(sql, [batchSize]);
    return res.rows.map(this.mapRunRow);
  }

  // -------------------------------------------------------------
  // MAPPERS
  // -------------------------------------------------------------

  private mapScheduleRow(row: Record<string, unknown>): WellnessScheduleRecord {
    return {
      id: String(row.id),
      owner_user_id: row.owner_user_id ? String(row.owner_user_id) : null,
      resident_user_id: String(row.resident_user_id),
      name: String(row.name),
      check_at: String(row.check_at),
      days_of_week: Array.isArray(row.days_of_week) ? (row.days_of_week as number[]) : [],
      lookback_hours: Number(row.lookback_hours),
      grace_seconds: Number(row.grace_seconds),
      camera_ids: Array.isArray(row.camera_ids) ? (row.camera_ids as string[]) : [],
      timezone: String(row.timezone),
      is_enabled: Boolean(row.is_enabled),
      version: Number(row.version),
      activation_started_at: new Date(row.activation_started_at as string),
      last_materialized_at: row.last_materialized_at
        ? new Date(row.last_materialized_at as string)
        : null,
      last_checked_at: row.last_checked_at ? new Date(row.last_checked_at as string) : null,
      deleted_at: row.deleted_at ? new Date(row.deleted_at as string) : null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapRunRow(row: Record<string, unknown>): WellnessCheckRunRecord {
    return {
      id: String(row.id),
      schedule_id: String(row.schedule_id),
      owner_user_id: String(row.owner_user_id),
      resident_user_id: String(row.resident_user_id),
      local_date: String(row.local_date),
      scheduled_for: new Date(row.scheduled_for as string),
      schedule_version: Number(row.schedule_version),
      schedule_snapshot: (row.schedule_snapshot as Record<string, unknown>) ?? {},
      lookback_started_at: new Date(row.lookback_started_at as string),
      lookback_ended_at: new Date(row.lookback_ended_at as string),
      last_activity_at: row.last_activity_at ? new Date(row.last_activity_at as string) : null,
      presence_state: (row.presence_state as WellnessPresenceState) ?? 'UNKNOWN',
      presence_observation_id: row.presence_observation_id
        ? String(row.presence_observation_id)
        : null,
      grace_seconds: Number(row.grace_seconds),
      status: row.status as WellnessCheckRunStatus,
      decision_reason: row.decision_reason ? String(row.decision_reason) : null,
      evaluated_at: row.evaluated_at ? new Date(row.evaluated_at as string) : null,
      event_id: row.event_id ? String(row.event_id) : null,
      request_sent_at: row.request_sent_at ? new Date(row.request_sent_at as string) : null,
      confirmation_deadline_at: row.confirmation_deadline_at
        ? new Date(row.confirmation_deadline_at as string)
        : null,
      delivery_deadline_at: row.delivery_deadline_at
        ? new Date(row.delivery_deadline_at as string)
        : null,
      attempt_count: Number(row.attempt_count),
      available_at: new Date(row.available_at as string),
      leased_until: row.leased_until ? new Date(row.leased_until as string) : null,
      lease_token: row.lease_token ? String(row.lease_token) : null,
      last_error: row.last_error ? String(row.last_error) : null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      event_status: row.event_status ? String(row.event_status) : null,
    };
  }
}
