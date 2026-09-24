import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import type {
  CameraAggregateRecord,
  CameraFrigateSettingsRecord,
  CameraRecord,
  CameraSourceRecord,
} from './cameras.types';

@Injectable()
export class CamerasRepository {
  private readonly logger = new Logger(CamerasRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(filter?: {
    deviceId?: string;
    isEnabled?: boolean;
  }): Promise<CameraAggregateRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.deviceId) {
      values.push(filter.deviceId);
      conditions.push(`c.device_id = $${values.length}`);
    }

    if (filter?.isEnabled !== undefined) {
      values.push(filter.isEnabled);
      conditions.push(`c.is_enabled = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        c.id, c.device_id, c.name, c.slug, c.rtsp_url, c.detect_width, c.detect_height,
        c.fps, c.timezone, c.is_enabled, c.detection_enabled, c.retention_days,
        c.created_at, c.updated_at,
        s.id AS source_id,
        s.source_type AS source_type_val,
        s.rtsp_url AS source_rtsp_url,
        s.video_object_key AS source_video_key,
        s.video_original_name AS source_video_name,
        s.video_loop AS source_video_loop,
        s.transport AS source_transport,
        s.status AS source_status,
        s.last_error_code AS source_error_code,
        s.last_error_message AS source_error_msg,
        f.config_version,
        f.applied_version,
        f.sync_status,
        f.sync_error_code,
        f.sync_error_message,
        (SELECT COUNT(*)::int FROM zones z WHERE z.camera_id = c.id) AS zone_count
      FROM cameras c
      LEFT JOIN camera_sources s ON s.camera_id = c.id
      LEFT JOIN camera_frigate_settings f ON f.camera_id = c.id
      ${whereClause}
      ORDER BY c.created_at ASC
    `;

    const result = await this.pool.query<CameraAggregateRecord>(query, values);
    return result.rows;
  }

  async findById(id: string): Promise<CameraAggregateRecord | null> {
    const query = `
      SELECT 
        c.id, c.device_id, c.name, c.slug, c.rtsp_url, c.detect_width, c.detect_height,
        c.fps, c.timezone, c.is_enabled, c.detection_enabled, c.retention_days,
        c.created_at, c.updated_at,
        s.id AS source_id,
        s.source_type AS source_type_val,
        s.rtsp_url AS source_rtsp_url,
        s.video_object_key AS source_video_key,
        s.video_original_name AS source_video_name,
        s.video_loop AS source_video_loop,
        s.transport AS source_transport,
        s.status AS source_status,
        s.last_error_code AS source_error_code,
        s.last_error_message AS source_error_msg,
        f.config_version,
        f.applied_version,
        f.sync_status,
        f.sync_error_code,
        f.sync_error_message,
        (SELECT COUNT(*)::int FROM zones z WHERE z.camera_id = c.id) AS zone_count
      FROM cameras c
      LEFT JOIN camera_sources s ON s.camera_id = c.id
      LEFT JOIN camera_frigate_settings f ON f.camera_id = c.id
      WHERE c.id = $1
    `;

    const result = await this.pool.query<CameraAggregateRecord>(query, [id]);
    return result.rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<CameraAggregateRecord | null> {
    const query = `
      SELECT 
        c.id, c.device_id, c.name, c.slug, c.rtsp_url, c.detect_width, c.detect_height,
        c.fps, c.timezone, c.is_enabled, c.detection_enabled, c.retention_days,
        c.created_at, c.updated_at,
        s.id AS source_id,
        s.source_type AS source_type_val,
        s.rtsp_url AS source_rtsp_url,
        s.video_object_key AS source_video_key,
        s.video_original_name AS source_video_name,
        s.video_loop AS source_video_loop,
        s.transport AS source_transport,
        s.status AS source_status,
        s.last_error_code AS source_error_code,
        s.last_error_message AS source_error_msg,
        f.config_version,
        f.applied_version,
        f.sync_status,
        f.sync_error_code,
        f.sync_error_message,
        (SELECT COUNT(*)::int FROM zones z WHERE z.camera_id = c.id) AS zone_count
      FROM cameras c
      LEFT JOIN camera_sources s ON s.camera_id = c.id
      LEFT JOIN camera_frigate_settings f ON f.camera_id = c.id
      WHERE c.slug = $1
    `;

    const result = await this.pool.query<CameraAggregateRecord>(query, [slug]);
    return result.rows[0] ?? null;
  }

  async updateState(id: string, isEnabled: boolean): Promise<CameraAggregateRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`UPDATE cameras SET is_enabled = $1, updated_at = now() WHERE id = $2`, [
        isEnabled,
        id,
      ]);

      // Cập nhật trạng thái nguồn phát tương ứng
      const newSourceStatus = isEnabled ? 'ONLINE' : 'STOPPED';
      await client.query(
        `UPDATE camera_sources 
         SET status = $1, 
             stopped_at = CASE WHEN $2 = false THEN now() ELSE stopped_at END,
             started_at = CASE WHEN $2 = true THEN now() ELSE started_at END,
             updated_at = now() 
         WHERE camera_id = $3`,
        [newSourceStatus, isEnabled, id],
      );

      await client.query('COMMIT');
      return await this.findById(id);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Lỗi khi cập nhật camera state (${id}):`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, patch: Partial<CameraRecord>): Promise<CameraAggregateRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      values.push(patch.name);
      fields.push(`name = $${values.length}`);
    }
    if (patch.rtsp_url !== undefined) {
      values.push(patch.rtsp_url);
      fields.push(`rtsp_url = $${values.length}`);
    }
    if (patch.fps !== undefined) {
      values.push(patch.fps);
      fields.push(`fps = $${values.length}`);
    }
    if (patch.is_enabled !== undefined) {
      values.push(patch.is_enabled);
      fields.push(`is_enabled = $${values.length}`);
    }
    if (patch.detection_enabled !== undefined) {
      values.push(patch.detection_enabled);
      fields.push(`detection_enabled = $${values.length}`);
    }
    if (patch.retention_days !== undefined) {
      values.push(patch.retention_days);
      fields.push(`retention_days = $${values.length}`);
    }

    if (fields.length === 0) return await this.findById(id);

    values.push(id);
    const query = `
      UPDATE cameras
      SET ${fields.join(', ')}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING id
    `;

    const result = await this.pool.query(query, values);
    if (result.rowCount === 0) return null;

    return await this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM cameras WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async findSourceByCameraId(cameraId: string): Promise<CameraSourceRecord | null> {
    const query = `SELECT * FROM camera_sources WHERE camera_id = $1`;
    const result = await this.pool.query<CameraSourceRecord>(query, [cameraId]);
    return result.rows[0] ?? null;
  }

  async upsertSource(
    cameraId: string,
    data: Partial<CameraSourceRecord>,
  ): Promise<CameraSourceRecord> {
    const query = `
      INSERT INTO camera_sources (
        camera_id, source_type, rtsp_url, video_object_key, 
        video_original_name, video_loop, transport, webcam_device_label, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (camera_id) DO UPDATE SET
        source_type = COALESCE(EXCLUDED.source_type, camera_sources.source_type),
        rtsp_url = COALESCE(EXCLUDED.rtsp_url, camera_sources.rtsp_url),
        video_object_key = COALESCE(EXCLUDED.video_object_key, camera_sources.video_object_key),
        video_original_name = COALESCE(EXCLUDED.video_original_name, camera_sources.video_original_name),
        video_loop = COALESCE(EXCLUDED.video_loop, camera_sources.video_loop),
        transport = COALESCE(EXCLUDED.transport, camera_sources.transport),
        webcam_device_label = COALESCE(EXCLUDED.webcam_device_label, camera_sources.webcam_device_label),
        status = COALESCE(EXCLUDED.status, camera_sources.status),
        updated_at = now()
      RETURNING *
    `;

    const values = [
      cameraId,
      data.source_type ?? 'RTSP',
      data.rtsp_url ?? null,
      data.video_object_key ?? null,
      data.video_original_name ?? null,
      data.video_loop ?? true,
      data.transport ?? 'TCP',
      data.webcam_device_label ?? null,
      data.status ?? 'NOT_CONFIGURED',
    ];

    const result = await this.pool.query<CameraSourceRecord>(query, values);
    return result.rows[0];
  }

  async findFrigateSettingsByCameraId(
    cameraId: string,
  ): Promise<CameraFrigateSettingsRecord | null> {
    const query = `SELECT * FROM camera_frigate_settings WHERE camera_id = $1`;
    const result = await this.pool.query<CameraFrigateSettingsRecord>(query, [cameraId]);
    return result.rows[0] ?? null;
  }

  async updateFrigateSettings(
    cameraId: string,
    patch: Partial<CameraFrigateSettingsRecord>,
  ): Promise<CameraFrigateSettingsRecord> {
    const query = `
      INSERT INTO camera_frigate_settings (
        camera_id, detect_width, detect_height, detect_fps,
        config_version, applied_version, sync_status
      ) VALUES ($1, 1280, 720, 5, 1, 0, 'PENDING')
      ON CONFLICT (camera_id) DO UPDATE SET
        config_version = COALESCE($6, camera_frigate_settings.config_version),
        sync_status = $2::frigate_sync_status_enum,
        sync_error_code = $3,
        sync_error_message = $4,
        applied_version = COALESCE($5, camera_frigate_settings.applied_version),
        updated_at = now()
      RETURNING *
    `;

    const values = [
      cameraId,
      patch.sync_status ?? 'PENDING',
      patch.sync_error_code ?? null,
      patch.sync_error_message ?? null,
      patch.applied_version ?? null,
      patch.config_version ?? null,
    ];

    const result = await this.pool.query<CameraFrigateSettingsRecord>(query, values);
    return result.rows[0];
  }

  async bumpFrigateConfigVersion(cameraId: string): Promise<number> {
    const result = await this.pool.query<{ config_version: number }>(
      `INSERT INTO camera_frigate_settings (camera_id, detect_width, detect_height, detect_fps, config_version, applied_version, sync_status)
       VALUES ($1, 1280, 720, 5, 2, 0, 'PENDING')
       ON CONFLICT (camera_id) DO UPDATE SET
         config_version = camera_frigate_settings.config_version + 1,
         sync_status = 'PENDING', sync_error_code = NULL, sync_error_message = NULL, updated_at = now()
       RETURNING config_version`,
      [cameraId],
    );
    return result.rows[0].config_version;
  }

  async findLatestSnapshotKey(cameraId: string): Promise<string | null> {
    const query = `
      SELECT em.object_key 
      FROM event_media em
      JOIN events e ON e.id = em.event_id
      WHERE e.camera_id = $1 AND em.media_type = 'SNAPSHOT'
      ORDER BY em.created_at DESC
      LIMIT 1
    `;
    const result = await this.pool.query<{ object_key: string }>(query, [cameraId]);
    return result.rows[0]?.object_key ?? null;
  }

  async findZonesByCameraId(cameraId: string): Promise<
    Array<{
      id: string;
      cameraId: string;
      name: string;
      slug: string;
      zoneType: string;
      polygon: number[][];
      isEnabled: boolean;
    }>
  > {
    const query = `
      SELECT id, camera_id AS "cameraId", name, slug, zone_type AS "zoneType", polygon, is_enabled AS "isEnabled"
      FROM zones
      WHERE camera_id = $1
      ORDER BY name ASC
    `;
    const result = await this.pool.query(query, [cameraId]);
    return result.rows;
  }
}
