import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import { wellnessInteger } from './wellness-policy';
import type { WellnessObservationDto } from './dto';
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
  readonly presenceTtlSeconds: number;
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() config: ConfigService = new ConfigService(),
  ) {
    this.presenceTtlSeconds = wellnessInteger(config, 'WELLNESS_PRESENCE_TTL_SECONDS', 86400);
  }

  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async databaseNow(client?: PoolClient): Promise<Date> {
    return (await (client ?? this.pool).query<{ now: Date }>('SELECT clock_timestamp() AS now'))
      .rows[0].now;
  }

  async enabledCameraIds(owner: string, ids: string[], client?: PoolClient): Promise<string[]> {
    const result = await (client ?? this.pool).query<{ id: string }>(
      `SELECT c.id FROM cameras c JOIN devices d ON d.id=c.device_id
      WHERE d.owner_user_id=$1 AND c.is_enabled AND (cardinality($2::uuid[])=0 OR c.id=ANY($2::uuid[])) ORDER BY c.id`,
      [owner, ids],
    );
    return result.rows.map((row) => row.id);
  }

  async timezoneExists(timezone: string, client?: PoolClient): Promise<boolean> {
    return (
      (
        await (client ?? this.pool).query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [
          timezone,
        ])
      ).rows.length > 0
    );
  }

  async residentCanReceive(resident: string, client?: PoolClient): Promise<boolean> {
    return (
      (
        await (client ?? this.pool).query(
          `SELECT 1 FROM users WHERE id=$1 AND is_active
      AND telegram_user_id IS NOT NULL AND telegram_chat_id IS NOT NULL AND telegram_linked_at IS NOT NULL`,
          [resident],
        )
      ).rows.length > 0
    );
  }

  async verifyObservationSource(
    dto: WellnessObservationDto,
    client: PoolClient,
  ): Promise<Record<string, unknown> | null> {
    const res = await client.query(
      `SELECT s.evidence FROM resident_wellness_source_evidence s
      JOIN resident_wellness_track_links l ON l.camera_id=s.camera_id AND l.source_session_id=s.source_session_id AND l.track_id=s.track_id
      JOIN cameras c ON c.id=s.camera_id JOIN devices d ON d.id=c.device_id
      JOIN known_faces k ON k.id=l.known_face_id JOIN users u ON u.id=l.resident_user_id
      JOIN events e ON e.id=l.identity_event_id
      WHERE s.observation_id=$1 AND d.owner_user_id=$2 AND l.owner_user_id=$2 AND l.resident_user_id=$3
        AND k.id=$4 AND e.id=$5 AND c.id=$6 AND s.source_session_id=$7 AND s.track_id=$8
        AND s.kind=$9 AND s.observed_at=$10 AND k.is_active AND u.is_active AND c.is_enabled
        AND k.linked_user_id=$3 AND k.owner_user_id=$2 AND e.camera_id=c.id AND e.track_id=s.track_id
        AND e.person_status='KNOWN' AND e.matched_known_face_id=k.id
        AND s.observed_at BETWEEN l.observed_at AND l.valid_until
        AND ($9='MOTION' OR s.evidence->'directionalEvidence'=$11::jsonb)`,
      [
        dto.observationId,
        dto.ownerUserId,
        dto.residentUserId,
        dto.knownFaceId,
        dto.identityEventId,
        dto.cameraId,
        dto.sourceSessionId,
        dto.trackId,
        dto.kind,
        new Date(dto.observedAt),
        JSON.stringify(dto.directionalEvidence ?? null),
      ],
    );
    return res.rows[0]?.evidence ?? null;
  }

  async enqueueEventUpdate(eventId: string, client: PoolClient): Promise<void> {
    await client.query(
      `INSERT INTO outbox_messages(event_id,aggregate_version,message_type,payload)
      SELECT id,aggregate_version,'event.updated','{}'::jsonb FROM events WHERE id=$1
      ON CONFLICT(event_id,aggregate_version,message_type) DO NOTHING`,
      [eventId],
    );
  }

  async escalateWellness(
    eventId: string,
    owner: string,
    reason: string,
    client: PoolClient,
  ): Promise<void> {
    const changed = await client.query(
      `UPDATE events SET status='ESCALATED',escalated_at=clock_timestamp(),
      escalation_deadline_at=NULL,version=version+1,aggregate_version=aggregate_version+1
      WHERE id=$1 AND status='NOTIFIED' RETURNING id`,
      [eventId],
    );
    if (!changed.rowCount) return;
    if (reason !== 'RESIDENT_REQUESTED_HELP')
      await client.query(
        `INSERT INTO event_status_history(event_id,from_status,to_status,reason,actor_type)
      VALUES($1,'NOTIFIED','ESCALATED',$2,'SYSTEM')`,
        [eventId, reason],
      );
    await client.query(
      `INSERT INTO notifications(event_id,recipient_user_id,channel,status,escalation_level,payload)
      VALUES($1,$2,'TELEGRAM','PENDING',1,jsonb_build_object('reason',$3::text,'priority','P2'))`,
      [eventId, owner, reason],
    );
    await client.query(
      `INSERT INTO notifications(event_id,emergency_contact_id,channel,status,escalation_level,payload)
      SELECT $1,id,'CONNECT_CALL','PENDING',priority_order,jsonb_build_object('reason',$3::text,'priority','P2')
      FROM emergency_contacts WHERE owner_user_id=$2 AND is_enabled AND is_verified`,
      [eventId, owner, reason],
    );
    await this.enqueueEventUpdate(eventId, client);
  }

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
      WITH latest AS (
        SELECT kind,observed_at FROM resident_wellness_observations
        WHERE owner_user_id=$1 AND resident_user_id=$2 AND observed_at <= $3
          AND received_at<=clock_timestamp() AND observed_at>$3::timestamptz-($4::int*interval '1 second')
        ORDER BY observed_at DESC FETCH FIRST 1 ROW WITH TIES
      ) SELECT CASE WHEN count(DISTINCT (kind='DEPARTURE'))>1 THEN 'UNKNOWN'
                    WHEN bool_and(kind='DEPARTURE') THEN 'AWAY' ELSE 'HOME' END AS state,
               max(observed_at) AS observed_at,max(observed_at)+($4::int*interval '1 second') AS valid_until
        FROM latest HAVING count(*)>0`;
    const res = await db.query(sql, [ownerUserId, residentUserId, asOf, this.presenceTtlSeconds]);
    if (res.rows.length === 0) return 'UNKNOWN';

    const row = res.rows[0];
    if (new Date(row.valid_until) <= asOf || new Date(row.observed_at) > asOf) {
      return 'UNKNOWN';
    }
    return row.state as WellnessPresenceState;
  }

  async updatePresence(presence: WellnessPresenceRecord, client?: PoolClient): Promise<boolean> {
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
      WHERE EXCLUDED.observed_at > resident_wellness_presence.observed_at
    `;
    const result = await db.query(sql, [
      presence.owner_user_id,
      presence.resident_user_id,
      presence.state,
      presence.observation_id,
      presence.observed_at,
      presence.valid_until,
    ]);
    return result.rowCount === 1;
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
      'received_at <= clock_timestamp()',
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
    await db.query(`UPDATE wellness_schedules SET last_checked_at = $2 WHERE id = $1`, [
      scheduleId,
      checkedAt,
    ]);
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
      evaluatedAt?: Date;
    },
    client: PoolClient,
  ): Promise<void> {
    const fields = [
      'status = $3',
      'decision_reason = $4',
      'evaluated_at = $5',
      'leased_until = NULL',
      'lease_token = NULL',
      'updated_at = now()',
    ];
    const params: unknown[] = [
      runId,
      leaseToken,
      status,
      options.decisionReason ?? null,
      options.evaluatedAt ?? (await this.databaseNow(client)),
    ];

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
      WHERE id = $1 AND lease_token = $2 AND status='PROCESSING'
    `;
    const result = await client.query(sql, params);
    if (result.rowCount !== 1)
      throw new Error('Wellness run lease no longer belongs to this worker.');
  }

  async recordDeliverySuccess(
    eventId: string,
    sentAt: Date,
    _graceSeconds: number,
    client: PoolClient,
  ): Promise<boolean> {
    const sql = `
      UPDATE wellness_check_runs
      SET request_sent_at = $2::timestamptz,
          confirmation_deadline_at = $2::timestamptz + grace_seconds * INTERVAL '1 second',
          updated_at = now()
      WHERE event_id = $1 AND request_sent_at IS NULL
        AND EXISTS(SELECT 1 FROM events e WHERE e.id=$1 AND e.status='NOTIFIED')
        AND EXISTS(SELECT 1 FROM notifications n WHERE n.event_id=$1 AND n.status='SENT'
          AND n.escalation_level=0 AND n.sent_at=$2::timestamptz
          AND n.recipient_user_id=wellness_check_runs.resident_user_id)
      RETURNING id
    `;
    const res = await client.query(sql, [eventId, sentAt]);
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

  async materializeOccurrences(lookbackSeconds: number, batchSize: number): Promise<number> {
    let total = 0;
    const schedules = await this.getActiveEnabledSchedules();
    const ordered = schedules.sort(
      (a, b) => (a.last_materialized_at?.getTime() ?? 0) - (b.last_materialized_at?.getTime() ?? 0),
    );
    for (const schedule of ordered.slice(0, batchSize)) {
      total += await this.transaction(async (client) => {
        const locked = await client.query(
          'SELECT id FROM wellness_schedules WHERE id=$1 FOR UPDATE SKIP LOCKED',
          [schedule.id],
        );
        if (!locked.rows.length) return 0;
        const current = await this.getScheduleById(schedule.id, client);
        if (!current?.is_enabled || !current.owner_user_id) return 0;
        if (
          !(await this.verifyResidentHouseholdLink(
            current.owner_user_id,
            current.resident_user_id,
            client,
          )) ||
          !(await this.residentCanReceive(current.resident_user_id, client))
        )
          return 0;
        const now = await this.databaseNow(client);
        const floor = new Date(
          Math.max(
            current.activation_started_at.getTime(),
            current.last_materialized_at?.getTime() ?? 0,
            now.getTime() - lookbackSeconds * 1000,
          ),
        );
        const cameraIds = await this.enabledCameraIds(
          current.owner_user_id,
          current.camera_ids,
          client,
        );
        const due = await client.query<{ local_date: string; scheduled_for: Date }>(
          `WITH days AS (
          SELECT (($1::timestamptz AT TIME ZONE $3)::date+n)::date AS day FROM generate_series(0,
            ($2::timestamptz AT TIME ZONE $3)::date-($1::timestamptz AT TIME ZONE $3)::date) AS n
        ) SELECT to_char(day,'YYYY-MM-DD') AS local_date,(day+$4::time) AT TIME ZONE $3 AS scheduled_for
          FROM days WHERE EXTRACT(isodow FROM day)::int=ANY($5::int[])
            AND (day+$4::time) AT TIME ZONE $3 BETWEEN $1 AND $2 ORDER BY day`,
          [floor, now, current.timezone, current.check_at, current.days_of_week],
        );
        let count = 0;
        for (const occurrence of due.rows) {
          if (
            await this.insertCheckRunIfNotExists(
              {
                scheduleId: current.id,
                ownerUserId: current.owner_user_id,
                residentUserId: current.resident_user_id,
                localDate: occurrence.local_date,
                scheduledFor: occurrence.scheduled_for,
                scheduleVersion: current.version,
                scheduleSnapshot: {
                  name: current.name,
                  checkAt: current.check_at,
                  timezone: current.timezone,
                  daysOfWeek: current.days_of_week,
                  lookbackHours: current.lookback_hours,
                  graceSeconds: current.grace_seconds,
                  cameraIds,
                },
                lookbackStartedAt: new Date(
                  occurrence.scheduled_for.getTime() - current.lookback_hours * 3600000,
                ),
                lookbackEndedAt: occurrence.scheduled_for,
                graceSeconds: current.grace_seconds,
                availableAt: occurrence.scheduled_for,
              },
              client,
            )
          )
            count++;
        }
        await client.query('UPDATE wellness_schedules SET last_materialized_at=$2 WHERE id=$1', [
          current.id,
          now,
        ]);
        return count;
      });
    }
    return total;
  }

  async retryRun(runId: string, leaseToken: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE wellness_check_runs SET status='PENDING',lease_token=NULL,leased_until=NULL,
      available_at=clock_timestamp()+LEAST(60,2^LEAST(attempt_count,5)) * interval '1 second',last_error=$3
      WHERE id=$1 AND status='PROCESSING' AND lease_token=$2`,
      [runId, leaseToken, error.slice(0, 500)],
    );
  }

  async processWellnessTimeouts(batchSize: number): Promise<void> {
    await this.transaction(async (client) => {
      const events = await client.query<{ id: string; wellness_owner_user_id: string }>(
        `SELECT e.id,e.wellness_owner_user_id
        FROM events e JOIN wellness_check_runs r ON r.event_id=e.id
        WHERE e.event_type='WELLNESS_TIMEOUT' AND e.status='NOTIFIED'
          AND (e.escalation_deadline_at<=clock_timestamp() OR
            (r.request_sent_at IS NULL AND r.delivery_deadline_at<=clock_timestamp()))
        ORDER BY e.detected_at LIMIT $1 FOR UPDATE OF e SKIP LOCKED`,
        [batchSize],
      );
      for (const event of events.rows) {
        const run = (
          await client.query<WellnessCheckRunRecord>(
            'SELECT * FROM wellness_check_runs WHERE event_id=$1 FOR UPDATE',
            [event.id],
          )
        ).rows[0];
        const now = await this.databaseNow(client);
        if (
          run.request_sent_at &&
          run.confirmation_deadline_at &&
          now >= run.confirmation_deadline_at
        )
          await this.escalateWellness(event.id, event.wellness_owner_user_id, 'TIMEOUT', client);
        else if (
          !run.request_sent_at &&
          run.delivery_deadline_at &&
          now >= run.delivery_deadline_at
        )
          await this.escalateWellness(
            event.id,
            event.wellness_owner_user_id,
            'DELIVERY_FAILED',
            client,
          );
      }
    });
  }
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
      local_date:
        row.local_date instanceof Date
          ? `${row.local_date.getFullYear()}-${String(row.local_date.getMonth() + 1).padStart(2, '0')}-${String(row.local_date.getDate()).padStart(2, '0')}`
          : String(row.local_date),
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
