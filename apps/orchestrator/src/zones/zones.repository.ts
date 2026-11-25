import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface ZoneRecord {
  id: string;
  camera_id: string;
  name: string;
  slug: string;
  zone_type: 'RESTRICTED' | 'REST_AREA' | 'NORMAL';
  polygon: number[][];
  min_dwell_seconds: number;
  active_from: string | null;
  active_to: string | null;
  is_enabled: boolean;
}

export interface ZoneValues {
  name: string;
  slug: string;
  zoneType: ZoneRecord['zone_type'];
  polygon: number[][];
  minDwellSeconds: number;
  activeFrom: string | null;
  activeTo: string | null;
  isEnabled: boolean;
}

export interface FrigateSyncJobRecord {
  id: string;
  camera_id: string;
  target_version: number;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  attempt_count: number;
}

const ZONE_COLUMNS = `
  id, camera_id, name, slug, zone_type, polygon, min_dwell_seconds,
  active_from::text, active_to::text, is_enabled
`;

@Injectable()
export class ZonesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async cameraExists(cameraId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM cameras WHERE id = $1 LIMIT 1', [cameraId]);
    return (result.rowCount ?? 0) > 0;
  }

  async listByCameraId(cameraId: string): Promise<ZoneRecord[]> {
    const result = await this.pool.query<ZoneRecord>(
      `SELECT ${ZONE_COLUMNS} FROM zones WHERE camera_id = $1 ORDER BY name ASC, id ASC LIMIT 500`,
      [cameraId],
    );
    return result.rows;
  }

  async findById(zoneId: string): Promise<ZoneRecord | null> {
    const result = await this.pool.query<ZoneRecord>(
      `SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1 LIMIT 1`,
      [zoneId],
    );
    return result.rows[0] ?? null;
  }

  async create(
    cameraId: string,
    values: ZoneValues,
  ): Promise<{ zone: ZoneRecord; version: number }> {
    return await this.inTransaction(async (client) => {
      await this.lockCamera(client, cameraId);
      const result = await client.query<ZoneRecord>(
        `INSERT INTO zones (
           camera_id, name, slug, zone_type, polygon, min_dwell_seconds,
           active_from, active_to, is_enabled
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::time, $8::time, $9)
         RETURNING ${ZONE_COLUMNS}`,
        [
          cameraId,
          values.name,
          values.slug,
          values.zoneType,
          JSON.stringify(values.polygon),
          values.minDwellSeconds,
          values.activeFrom,
          values.activeTo,
          values.isEnabled,
        ],
      );
      const version = await this.bumpVersionAndEnqueue(client, cameraId);
      return { zone: result.rows[0], version };
    });
  }

  async update(
    zoneId: string,
    values: Omit<ZoneValues, 'slug'>,
  ): Promise<{ zone: ZoneRecord; version: number } | null> {
    return await this.inTransaction(async (client) => {
      const existing = await client.query<ZoneRecord>(
        `SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1 FOR UPDATE`,
        [zoneId],
      );
      const current = existing.rows[0];
      if (!current) return null;
      await this.lockCamera(client, current.camera_id);
      const result = await client.query<ZoneRecord>(
        `UPDATE zones
         SET name = $2, zone_type = $3, polygon = $4::jsonb, min_dwell_seconds = $5,
             active_from = $6::time, active_to = $7::time, is_enabled = $8
         WHERE id = $1
         RETURNING ${ZONE_COLUMNS}`,
        [
          zoneId,
          values.name,
          values.zoneType,
          JSON.stringify(values.polygon),
          values.minDwellSeconds,
          values.activeFrom,
          values.activeTo,
          values.isEnabled,
        ],
      );
      const version = await this.bumpVersionAndEnqueue(client, current.camera_id);
      return { zone: result.rows[0], version };
    });
  }

  async delete(zoneId: string): Promise<{ cameraId: string; version: number } | null> {
    return await this.inTransaction(async (client) => {
      const existing = await client.query<{ camera_id: string }>(
        'SELECT camera_id FROM zones WHERE id = $1 FOR UPDATE',
        [zoneId],
      );
      const cameraId = existing.rows[0]?.camera_id;
      if (!cameraId) return null;
      await this.lockCamera(client, cameraId);
      await client.query('DELETE FROM zones WHERE id = $1', [zoneId]);
      const version = await this.bumpVersionAndEnqueue(client, cameraId);
      return { cameraId, version };
    });
  }

  async claimNextSyncJob(cameraId?: string): Promise<FrigateSyncJobRecord | null> {
    return await this.inTransaction(async (client) => {
      const values: unknown[] = [];
      const cameraCondition = cameraId ? 'AND camera_id = $1' : '';
      if (cameraId) values.push(cameraId);
      const result = await client.query<FrigateSyncJobRecord>(
        `SELECT id, camera_id, target_version, status, attempt_count
         FROM frigate_config_sync_jobs
         WHERE status = 'PENDING' AND next_attempt_at <= now() ${cameraCondition}
         ORDER BY next_attempt_at ASC, updated_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        values,
      );
      const job = result.rows[0];
      if (!job) return null;
      const claimed = await client.query<FrigateSyncJobRecord>(
        `UPDATE frigate_config_sync_jobs
         SET attempt_count = attempt_count + 1, next_attempt_at = now() + interval '30 seconds'
         WHERE id = $1
         RETURNING id, camera_id, target_version, status, attempt_count`,
        [job.id],
      );
      return claimed.rows[0];
    });
  }

  async completeSyncJob(job: FrigateSyncJobRecord): Promise<void> {
    await this.pool.query(
      `UPDATE frigate_config_sync_jobs
       SET status = 'SYNCED', last_error_code = NULL, last_error_message = NULL
       WHERE id = $1 AND target_version = $2`,
      [job.id, job.target_version],
    );
  }

  async failSyncJob(
    job: FrigateSyncJobRecord,
    errorCode: string,
    errorMessage: string,
    maxAttempts: number,
    retryDelaySeconds: number,
  ): Promise<void> {
    const isTerminal = job.attempt_count >= maxAttempts;
    await this.pool.query(
      `UPDATE frigate_config_sync_jobs
       SET status = $3::frigate_sync_status_enum,
           next_attempt_at = now() + ($4 * interval '1 second'),
           last_error_code = $5,
           last_error_message = $6
       WHERE id = $1 AND target_version = $2`,
      [
        job.id,
        job.target_version,
        isTerminal ? 'FAILED' : 'PENDING',
        retryDelaySeconds,
        errorCode,
        errorMessage,
      ],
    );
  }

  async retrySync(cameraId: string): Promise<number | null> {
    const result = await this.pool.query<{ target_version: number }>(
      `UPDATE frigate_config_sync_jobs
       SET status = 'PENDING', attempt_count = 0, next_attempt_at = now(),
           last_error_code = NULL, last_error_message = NULL
       WHERE camera_id = $1
       RETURNING target_version`,
      [cameraId],
    );
    return result.rows[0]?.target_version ?? null;
  }

  private async lockCamera(client: PoolClient, cameraId: string): Promise<void> {
    await client.query('SELECT id FROM cameras WHERE id = $1 FOR UPDATE', [cameraId]);
  }

  private async bumpVersionAndEnqueue(client: PoolClient, cameraId: string): Promise<number> {
    const versionResult = await client.query<{ config_version: number }>(
      `INSERT INTO camera_frigate_settings (
         camera_id, detect_width, detect_height, detect_fps,
         config_version, applied_version, sync_status
       ) VALUES ($1, 1280, 720, 5, 2, 0, 'PENDING')
       ON CONFLICT (camera_id) DO UPDATE SET
         config_version = camera_frigate_settings.config_version + 1,
         sync_status = 'PENDING', sync_error_code = NULL, sync_error_message = NULL
       RETURNING config_version`,
      [cameraId],
    );
    const version = versionResult.rows[0].config_version;
    await client.query(
      `INSERT INTO frigate_config_sync_jobs (camera_id, target_version, status)
       VALUES ($1, $2, 'PENDING')
       ON CONFLICT (camera_id) DO UPDATE SET
         target_version = EXCLUDED.target_version, status = 'PENDING', attempt_count = 0,
         next_attempt_at = now(), last_error_code = NULL, last_error_message = NULL`,
      [cameraId, version],
    );
    return version;
  }

  private async inTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
