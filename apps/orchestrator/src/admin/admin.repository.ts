import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type {
  ListAuditLogsQueryDto,
  ServicePlan,
  UpdateHouseholdQuotaDto,
  UpdateResourceLimitsDto,
  UpdateSystemSettingsDto,
} from './admin.dto';

export interface AdminOverviewCounts {
  householdCount: number;
  totalAccounts: number;
  activeAccounts: number;
  inactiveAccounts: number;
  adminAccounts: number;
  totalCameras: number;
  enabledCameras: number;
  disabledCameras: number;
  storageUsedBytes: number;
  allocatedStorageQuotaGb: number;
  recordingErrors24h: number;
  aiErrors24h: number;
  notificationErrors24h: number;
}

export interface HouseholdAdminRow {
  ownerId: string;
  ownerEmail: string;
  ownerFullName: string;
  ownerRole: string;
  ownerActive: boolean;
  memberCount: number;
  cameraCount: number;
  enabledCameraCount: number;
  storageUsedBytes: number;
  maxCameras: number;
  storageQuotaGb: number;
  retentionDays: number;
  servicePlan: string;
  createdAt: string;
}

export interface SystemSettingsRow {
  defaultMaxCameras: number;
  defaultStorageQuotaGb: number;
  allowedRetentionDays: number[];
  defaultRetentionDays: number;
  sessionTimeoutMinutes: number;
  requireMfaForAdmin: boolean;
  allowSelfSignup: boolean;
  maxLoginAttempts: number;
  aiConfidenceFloor: number;
  maxUploadMb: number;
  updatedAt: string;
}

export interface AdminOverviewTrendPoint {
  date: string;
  storageAddedBytes: number;
  errorsCount: number;
  notificationTotal: number;
  notificationSuccessRate: number;
}

export interface ServiceChannelMetric {
  channel: string;
  sent24h: number;
  failed24h: number;
  pending24h: number;
}

export interface TechnicalIncidentItem {
  id: string;
  subsystem: 'RECORDING' | 'AI' | 'NOTIFICATION';
  code: string;
  summary: string;
  occurredAt: string;
}

export interface AuditLogItem {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorFullName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAccountSummary {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
}

@Injectable()
export class AdminRepository {
  constructor(private readonly db: DatabaseService) {}

  async getOverviewCounts(): Promise<AdminOverviewCounts> {
    const [accountsRes, camerasRes, storageRes, errorsRes] = await Promise.all([
      this.db.query<{
        household_count: number;
        total_accounts: number;
        active_accounts: number;
        inactive_accounts: number;
        admin_accounts: number;
      }>(`
        SELECT
          COUNT(DISTINCT COALESCE(household_owner_id, id)) FILTER (WHERE role <> 'ADMIN')::int AS household_count,
          COUNT(*)::int AS total_accounts,
          COUNT(*) FILTER (WHERE is_active)::int AS active_accounts,
          COUNT(*) FILTER (WHERE NOT is_active)::int AS inactive_accounts,
          COUNT(*) FILTER (WHERE role = 'ADMIN')::int AS admin_accounts
        FROM users
      `),
      this.db.query<{
        total_cameras: number;
        enabled_cameras: number;
        disabled_cameras: number;
      }>(`
        SELECT
          COUNT(*)::int AS total_cameras,
          COUNT(*) FILTER (WHERE is_enabled)::int AS enabled_cameras,
          COUNT(*) FILTER (WHERE NOT is_enabled)::int AS disabled_cameras
        FROM cameras
      `),
      this.db.query<{
        used_bytes: string;
        allocated_gb: string;
      }>(`
        SELECT
          COALESCE((SELECT SUM(size_bytes) FROM event_media), 0)::text AS used_bytes,
          COALESCE((SELECT SUM(storage_quota_gb) FROM household_settings), 0)::text AS allocated_gb
      `),
      this.db.query<{
        recording_errors: number;
        ai_errors: number;
        notification_errors: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM frigate_config_sync_jobs WHERE status = 'FAILED' AND updated_at >= now() - interval '24 hours') AS recording_errors,
          (SELECT COUNT(*)::int FROM events WHERE status = 'AI_FAILED' AND created_at >= now() - interval '24 hours') AS ai_errors,
          (SELECT COUNT(*)::int FROM notifications WHERE status = 'FAILED' AND updated_at >= now() - interval '24 hours') AS notification_errors
      `),
    ]);

    const acc = accountsRes.rows[0];
    const cam = camerasRes.rows[0];
    const sto = storageRes.rows[0];
    const err = errorsRes.rows[0];

    return {
      householdCount: acc?.household_count ?? 0,
      totalAccounts: acc?.total_accounts ?? 0,
      activeAccounts: acc?.active_accounts ?? 0,
      inactiveAccounts: acc?.inactive_accounts ?? 0,
      adminAccounts: acc?.admin_accounts ?? 0,
      totalCameras: cam?.total_cameras ?? 0,
      enabledCameras: cam?.enabled_cameras ?? 0,
      disabledCameras: cam?.disabled_cameras ?? 0,
      storageUsedBytes: Number(sto?.used_bytes ?? 0),
      allocatedStorageQuotaGb: Number(sto?.allocated_gb ?? 0),
      recordingErrors24h: err?.recording_errors ?? 0,
      aiErrors24h: err?.ai_errors ?? 0,
      notificationErrors24h: err?.notification_errors ?? 0,
    };
  }

  async getOverviewTrends(days = 7): Promise<AdminOverviewTrendPoint[]> {
    const res = await this.db.query<{
      day: Date;
      storage_added_bytes: string;
      errors_count: number;
      notification_total: number;
      notification_sent: number;
    }>(
      `
      WITH days AS (
        SELECT generate_series(
          (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - ($1::int - 1),
          (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
          interval '1 day'
        )::date AS day
      ),
      media_daily AS (
        SELECT
          (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          COALESCE(SUM(size_bytes), 0) AS bytes
        FROM event_media
        WHERE created_at >= now() - ($1::int || ' days')::interval
        GROUP BY 1
      ),
      ai_err_daily AS (
        SELECT
          (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          COUNT(*)::int AS cnt
        FROM events
        WHERE status = 'AI_FAILED'
          AND created_at >= now() - ($1::int || ' days')::interval
        GROUP BY 1
      ),
      notif_daily AS (
        SELECT
          (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status IN ('SENT', 'CONFIRMED'))::int AS sent,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
        FROM notifications
        WHERE created_at >= now() - ($1::int || ' days')::interval
        GROUP BY 1
      )
      SELECT
        d.day,
        COALESCE(m.bytes, 0)::text AS storage_added_bytes,
        (COALESCE(a.cnt, 0) + COALESCE(n.failed, 0))::int AS errors_count,
        COALESCE(n.total, 0)::int AS notification_total,
        COALESCE(n.sent, 0)::int AS notification_sent
      FROM days d
      LEFT JOIN media_daily m ON m.day = d.day
      LEFT JOIN ai_err_daily a ON a.day = d.day
      LEFT JOIN notif_daily n ON n.day = d.day
      ORDER BY d.day ASC
      `,
      [days],
    );

    return res.rows.map((row) => {
      const rate =
        row.notification_total > 0
          ? Math.round((row.notification_sent / row.notification_total) * 100)
          : 100;
      return {
        date: row.day.toISOString().slice(0, 10),
        storageAddedBytes: Number(row.storage_added_bytes ?? 0),
        errorsCount: row.errors_count,
        notificationTotal: row.notification_total,
        notificationSuccessRate: rate,
      };
    });
  }

  async listHouseholds(): Promise<HouseholdAdminRow[]> {
    const settings = await this.getSystemSettings();
    const res = await this.db.query<{
      owner_id: string;
      owner_email: string;
      owner_full_name: string;
      owner_role: string;
      owner_active: boolean;
      member_count: number;
      camera_count: number;
      enabled_camera_count: number;
      storage_used_bytes: string;
      max_cameras: number | null;
      storage_quota_gb: number | null;
      retention_days: number | null;
      service_plan: string | null;
      created_at: Date;
    }>(`
      WITH household_roots AS (
        SELECT
          u.id AS owner_id,
          u.email AS owner_email,
          u.full_name AS owner_full_name,
          u.role AS owner_role,
          u.is_active AS owner_active,
          u.created_at
        FROM users u
        WHERE u.household_owner_id IS NULL
      ),
      member_counts AS (
        SELECT
          COALESCE(household_owner_id, id) AS owner_id,
          COUNT(*)::int AS member_count
        FROM users
        GROUP BY COALESCE(household_owner_id, id)
      ),
      camera_counts AS (
        SELECT
          d.owner_user_id AS owner_id,
          COUNT(c.id)::int AS camera_count,
          COUNT(c.id) FILTER (WHERE c.is_enabled)::int AS enabled_camera_count
        FROM devices d
        LEFT JOIN cameras c ON c.device_id = d.id
        GROUP BY d.owner_user_id
      ),
      storage_usage AS (
        SELECT
          d.owner_user_id AS owner_id,
          COALESCE(SUM(em.size_bytes), 0)::text AS used_bytes
        FROM devices d
        JOIN cameras c ON c.device_id = d.id
        JOIN events e ON e.camera_id = c.id
        JOIN event_media em ON em.event_id = e.id
        GROUP BY d.owner_user_id
      )
      SELECT
        hr.owner_id,
        hr.owner_email,
        hr.owner_full_name,
        hr.owner_role,
        hr.owner_active,
        COALESCE(mc.member_count, 1) AS member_count,
        COALESCE(cc.camera_count, 0) AS camera_count,
        COALESCE(cc.enabled_camera_count, 0) AS enabled_camera_count,
        COALESCE(su.used_bytes, '0') AS storage_used_bytes,
        hs.max_cameras,
        hs.storage_quota_gb,
        hs.retention_days,
        hs.service_plan,
        hr.created_at
      FROM household_roots hr
      LEFT JOIN member_counts mc ON mc.owner_id = hr.owner_id
      LEFT JOIN camera_counts cc ON cc.owner_id = hr.owner_id
      LEFT JOIN storage_usage su ON su.owner_id = hr.owner_id
      LEFT JOIN household_settings hs ON hs.owner_user_id = hr.owner_id
      ORDER BY (hr.owner_role = 'ADMIN') ASC, hr.created_at DESC
    `);

    return res.rows.map((row) => ({
      ownerId: row.owner_id,
      ownerEmail: row.owner_email,
      ownerFullName: row.owner_full_name,
      ownerRole: row.owner_role,
      ownerActive: row.owner_active,
      memberCount: row.member_count,
      cameraCount: row.camera_count,
      enabledCameraCount: row.enabled_camera_count,
      storageUsedBytes: Number(row.storage_used_bytes ?? 0),
      maxCameras: row.max_cameras ?? settings.defaultMaxCameras,
      storageQuotaGb: row.storage_quota_gb ?? settings.defaultStorageQuotaGb,
      retentionDays: row.retention_days ?? settings.defaultRetentionDays,
      servicePlan: row.service_plan ?? 'STANDARD',
      createdAt: row.created_at.toISOString(),
    }));
  }

  async updateUserActiveStatus(
    actorId: string,
    targetUserId: string,
    isActive: boolean,
  ): Promise<{ id: string; email: string; isActive: boolean } | null> {
    return this.db.transaction(async (client) => {
      const updated = await client.query<{ id: string; email: string; is_active: boolean }>(
        `UPDATE users
         SET is_active = $2, updated_at = now()
         WHERE id = $1
         RETURNING id, email, is_active`,
        [targetUserId, isActive],
      );
      const row = updated.rows[0];
      if (!row) return null;

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'user', $3, $4::jsonb)`,
        [
          actorId,
          isActive ? 'USER_ACTIVATED' : 'USER_SUSPENDED',
          targetUserId,
          JSON.stringify({ isActive }),
        ],
      );

      return { id: row.id, email: row.email, isActive: row.is_active };
    });
  }

  async updateHouseholdQuota(
    actorId: string,
    ownerId: string,
    dto: UpdateHouseholdQuotaDto,
  ): Promise<{
    ownerId: string;
    maxCameras: number;
    storageQuotaGb: number;
    retentionDays: number;
    servicePlan: ServicePlan;
  } | null> {
    return this.db.transaction(async (client) => {
      const ownerExists = await client.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [
        ownerId,
      ]);
      if (ownerExists.rows.length === 0) return null;

      const defaults = await this.getSystemSettings();
      const upsert = await client.query<{
        owner_user_id: string;
        max_cameras: number;
        storage_quota_gb: number;
        retention_days: number;
        service_plan: ServicePlan;
      }>(
        `INSERT INTO household_settings (owner_user_id, max_cameras, storage_quota_gb, retention_days, service_plan)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_user_id) DO UPDATE SET
           max_cameras = COALESCE($6, household_settings.max_cameras),
           storage_quota_gb = COALESCE($7, household_settings.storage_quota_gb),
           retention_days = COALESCE($8, household_settings.retention_days),
           service_plan = COALESCE($9, household_settings.service_plan),
           updated_at = now()
         RETURNING owner_user_id, max_cameras, storage_quota_gb, retention_days, service_plan`,
        [
          ownerId,
          dto.maxCameras ?? defaults.defaultMaxCameras,
          dto.storageQuotaGb ?? defaults.defaultStorageQuotaGb,
          dto.retentionDays ?? defaults.defaultRetentionDays,
          dto.servicePlan ?? 'STANDARD',
          dto.maxCameras ?? null,
          dto.storageQuotaGb ?? null,
          dto.retentionDays ?? null,
          dto.servicePlan ?? null,
        ],
      );

      const saved = upsert.rows[0];
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'HOUSEHOLD_QUOTA_UPDATED', 'household_settings', $2, $3::jsonb)`,
        [
          actorId,
          ownerId,
          JSON.stringify({
            maxCameras: saved.max_cameras,
            storageQuotaGb: saved.storage_quota_gb,
            retentionDays: saved.retention_days,
            servicePlan: saved.service_plan,
          }),
        ],
      );

      return {
        ownerId: saved.owner_user_id,
        maxCameras: saved.max_cameras,
        storageQuotaGb: saved.storage_quota_gb,
        retentionDays: saved.retention_days,
        servicePlan: saved.service_plan,
      };
    });
  }

  async getServiceDiagnostics(
    incidentPage = 1,
    incidentPageSize = 5,
  ): Promise<{
    frigateSync: { pending: number; synced: number; failed: number };
    notificationChannels: ServiceChannelMetric[];
    incidents: {
      items: TechnicalIncidentItem[];
      total: number;
      page: number;
      pageSize: number;
    };
  }> {
    const offset = (incidentPage - 1) * incidentPageSize;
    const incidentsCte = `
      WITH all_incidents AS (
        SELECT id::text, 'RECORDING'::text AS subsystem,
               COALESCE(last_error_code, 'FRIGATE_SYNC_FAILED') AS code,
               'Lỗi đồng bộ cấu hình ghi hình Frigate' AS summary,
               updated_at AS occurred_at
        FROM frigate_config_sync_jobs
        WHERE status = 'FAILED'
        UNION ALL
        SELECT id::text, 'AI'::text AS subsystem,
               'AI_PROCESSING_FAILED' AS code,
               'Lỗi xử lý suy luận AI trên sự kiện' AS summary,
               created_at AS occurred_at
        FROM events
        WHERE status = 'AI_FAILED'
        UNION ALL
        SELECT id::text, 'NOTIFICATION'::text AS subsystem,
               COALESCE(error_code, 'DELIVERY_FAILED') AS code,
               'Lỗi gửi thông báo qua kênh ' || channel::text AS summary,
               COALESCE(failed_at, updated_at) AS occurred_at
        FROM notifications
        WHERE status = 'FAILED'
      )
    `;

    const [frigateRes, notifRes, incidentsCountRes, incidentsRes] = await Promise.all([
      this.db.query<{
        pending: number;
        synced: number;
        failed: number;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'SYNCED')::int AS synced,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
        FROM frigate_config_sync_jobs
      `),
      this.db.query<{
        channel: string;
        sent_24h: number;
        failed_24h: number;
        pending_24h: number;
      }>(`
        SELECT
          channel::text AS channel,
          COUNT(*) FILTER (WHERE status IN ('SENT', 'CONFIRMED'))::int AS sent_24h,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_24h,
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_24h
        FROM notifications
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY channel
        ORDER BY channel
      `),
      this.db.query<{ total: number }>(
        `${incidentsCte} SELECT COUNT(*)::int AS total FROM all_incidents`,
      ),
      this.db.query<{
        id: string;
        subsystem: 'RECORDING' | 'AI' | 'NOTIFICATION';
        code: string;
        summary: string;
        occurred_at: Date;
      }>(
        `${incidentsCte}
         SELECT id, subsystem, code, summary, occurred_at
         FROM all_incidents
         ORDER BY occurred_at DESC
         LIMIT $1 OFFSET $2`,
        [incidentPageSize, offset],
      ),
    ]);

    const frig = frigateRes.rows[0];
    return {
      frigateSync: {
        pending: frig?.pending ?? 0,
        synced: frig?.synced ?? 0,
        failed: frig?.failed ?? 0,
      },
      notificationChannels: notifRes.rows.map((r) => ({
        channel: r.channel,
        sent24h: r.sent_24h,
        failed24h: r.failed_24h,
        pending24h: r.pending_24h,
      })),
      incidents: {
        items: incidentsRes.rows.map((r) => ({
          id: r.id,
          subsystem: r.subsystem,
          code: r.code,
          summary: r.summary,
          occurredAt: r.occurred_at.toISOString(),
        })),
        total: incidentsCountRes.rows[0]?.total ?? 0,
        page: incidentPage,
        pageSize: incidentPageSize,
      },
    };
  }

  async getSystemSettings(): Promise<SystemSettingsRow> {
    const res = await this.db.query<{
      default_max_cameras: number;
      default_storage_quota_gb: number;
      allowed_retention_days: number[];
      default_retention_days: number;
      session_timeout_minutes: number;
      require_mfa_for_admin: boolean;
      allow_self_signup: boolean;
      max_login_attempts: number;
      ai_confidence_floor: string;
      max_upload_mb: number;
      updated_at: Date;
    }>(`SELECT * FROM system_settings WHERE id = 1`);

    const row = res.rows[0];
    if (!row) {
      return {
        defaultMaxCameras: 8,
        defaultStorageQuotaGb: 100,
        allowedRetentionDays: [7, 14, 30, 60, 90],
        defaultRetentionDays: 30,
        sessionTimeoutMinutes: 60,
        requireMfaForAdmin: false,
        allowSelfSignup: false,
        maxLoginAttempts: 5,
        aiConfidenceFloor: 0.5,
        maxUploadMb: 10,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      defaultMaxCameras: row.default_max_cameras,
      defaultStorageQuotaGb: row.default_storage_quota_gb,
      allowedRetentionDays: row.allowed_retention_days,
      defaultRetentionDays: row.default_retention_days,
      sessionTimeoutMinutes: row.session_timeout_minutes,
      requireMfaForAdmin: row.require_mfa_for_admin,
      allowSelfSignup: row.allow_self_signup,
      maxLoginAttempts: row.max_login_attempts,
      aiConfidenceFloor: Number(row.ai_confidence_floor),
      maxUploadMb: row.max_upload_mb,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async updateResourceLimits(
    actorId: string,
    dto: UpdateResourceLimitsDto,
  ): Promise<SystemSettingsRow> {
    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE system_settings SET
          default_max_cameras = COALESCE($1, default_max_cameras),
          default_storage_quota_gb = COALESCE($2, default_storage_quota_gb),
          default_retention_days = COALESCE($3, default_retention_days),
          allowed_retention_days = COALESCE($4, allowed_retention_days),
          updated_at = now(),
          updated_by_user_id = $5
         WHERE id = 1`,
        [
          dto.defaultMaxCameras ?? null,
          dto.defaultStorageQuotaGb ?? null,
          dto.defaultRetentionDays ?? null,
          dto.allowedRetentionDays ?? null,
          actorId,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'RESOURCE_LIMITS_UPDATED', 'system_settings', '1', $2::jsonb)`,
        [actorId, JSON.stringify(dto)],
      );

      return this.getSystemSettings();
    });
  }

  async updateSystemSettings(
    actorId: string,
    dto: UpdateSystemSettingsDto,
  ): Promise<SystemSettingsRow> {
    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE system_settings SET
          session_timeout_minutes = COALESCE($1, session_timeout_minutes),
          require_mfa_for_admin = COALESCE($2, require_mfa_for_admin),
          allow_self_signup = COALESCE($3, allow_self_signup),
          max_login_attempts = COALESCE($4, max_login_attempts),
          ai_confidence_floor = COALESCE($5, ai_confidence_floor),
          max_upload_mb = COALESCE($6, max_upload_mb),
          updated_at = now(),
          updated_by_user_id = $7
         WHERE id = 1`,
        [
          dto.sessionTimeoutMinutes ?? null,
          dto.requireMfaForAdmin ?? null,
          dto.allowSelfSignup ?? null,
          dto.maxLoginAttempts ?? null,
          dto.aiConfidenceFloor ?? null,
          dto.maxUploadMb ?? null,
          actorId,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'SYSTEM_SETTINGS_UPDATED', 'system_settings', '1', $2::jsonb)`,
        [actorId, JSON.stringify(dto)],
      );

      return this.getSystemSettings();
    });
  }

  async listAuditLogs(query: ListAuditLogsQueryDto): Promise<{
    items: AuditLogItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.action) {
      params.push(query.action);
      conditions.push(`al.action = $${params.length}`);
    }
    if (query.entityType) {
      params.push(query.entityType);
      conditions.push(`al.entity_type = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      const idx = params.length;
      conditions.push(
        `(al.action ILIKE $${idx} OR al.entity_type ILIKE $${idx} OR COALESCE(u.email::text, '') ILIKE $${idx} OR COALESCE(u.full_name, '') ILIKE $${idx})`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;

    const countRes = await this.db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ${whereClause}`,
      params,
    );

    const listParams = [...params, query.pageSize, offset];
    const rowsRes = await this.db.query<{
      id: string;
      actor_user_id: string | null;
      actor_email: string | null;
      actor_full_name: string | null;
      actor_role: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      ip_address: string | null;
      metadata: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT
        al.id::text AS id,
        al.actor_user_id::text AS actor_user_id,
        u.email::text AS actor_email,
        u.full_name AS actor_full_name,
        u.role::text AS actor_role,
        al.action,
        al.entity_type,
        al.entity_id::text AS entity_id,
        al.ip_address::text AS ip_address,
        al.metadata,
        al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    return {
      items: rowsRes.rows.map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor_email,
        actorFullName: row.actor_full_name,
        actorRole: row.actor_role,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        ipAddress: row.ip_address,
        metadata: row.metadata ?? {},
        createdAt: row.created_at.toISOString(),
      })),
      total: countRes.rows[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listAdminAccounts(): Promise<AdminAccountSummary[]> {
    const res = await this.db.query<{
      id: string;
      email: string;
      full_name: string;
      is_active: boolean;
      created_at: Date;
    }>(`
      SELECT id::text, email::text, full_name, is_active, created_at
      FROM users
      WHERE role = 'ADMIN'
      ORDER BY created_at ASC
    `);

    return res.rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      isActive: r.is_active,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
