import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import type { CameraSourceRuntimeStatus } from '../cameras/cameras.types';

export interface ActiveVideoSourceItem {
  cameraId: string;
  slug: string;
  videoObjectKey: string;
  videoLoop: boolean;
}

@Injectable()
export class CameraSourcesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async updateRuntimeStatus(
    cameraId: string,
    status: CameraSourceRuntimeStatus,
    pid?: number | null,
    error?: { code?: string; message?: string },
  ): Promise<void> {
    const query = `
      UPDATE camera_sources
      SET status = $1::camera_source_status_enum,
          process_id = CASE WHEN $1::camera_source_status_enum IN ('STOPPED', 'OFFLINE', 'FAILED') THEN NULL ELSE COALESCE($2, process_id) END,
          last_error_code = $3,
          last_error_message = $4,
          started_at = CASE WHEN $1::camera_source_status_enum = 'ONLINE' THEN now() ELSE started_at END,
          stopped_at = CASE WHEN $1::camera_source_status_enum IN ('STOPPED', 'OFFLINE', 'FAILED') THEN now() ELSE stopped_at END,
          updated_at = now()
      WHERE camera_id = $5
    `;

    await this.pool.query(query, [
      status,
      pid ? String(pid) : null,
      error?.code ?? null,
      error?.message ?? null,
      cameraId,
    ]);
  }

  async findActiveVideoSources(): Promise<ActiveVideoSourceItem[]> {
    const query = `
      SELECT 
        c.id AS camera_id,
        c.slug,
        s.video_object_key,
        s.video_loop
      FROM cameras c
      JOIN camera_sources s ON s.camera_id = c.id
      WHERE c.is_enabled = true
        AND s.source_type = 'VIDEO_FILE'
        AND s.video_object_key IS NOT NULL
    `;

    const result = await this.pool.query<{
      camera_id: string;
      slug: string;
      video_object_key: string;
      video_loop: boolean;
    }>(query);

    return result.rows.map((r) => ({
      cameraId: r.camera_id,
      slug: r.slug,
      videoObjectKey: r.video_object_key,
      videoLoop: r.video_loop ?? true,
    }));
  }

  async isEnabledMediaPath(slug: string, action: string): Promise<boolean> {
    const result = await this.pool.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM cameras c
         JOIN camera_sources s ON s.camera_id = c.id
         WHERE c.slug = $1 AND c.is_enabled = true
           AND (
             ($2 = 'read' AND s.source_type IN ('VIDEO_FILE', 'BROWSER_WEBCAM', 'RTSP'))
             OR ($2 = 'publish' AND s.source_type IN ('VIDEO_FILE', 'BROWSER_WEBCAM', 'RTSP'))
             OR ($2 = 'publish_browser' AND s.source_type = 'BROWSER_WEBCAM')
           )
       ) AS allowed`,
      [slug, action],
    );
    return result.rows[0]?.allowed ?? false;
  }
}
