import { isSystemAdmin } from '../auth/system-admin';
import { playbackLimit } from './playback-config';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import type { ArchiveCamera, PlaybackActor } from './playback.types';
@Injectable()
export class PlaybackRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  async cameras(actor: PlaybackActor, cameraId: string | null = null): Promise<ArchiveCamera[]> {
    const result = await this.db.query<ArchiveCamera>(
      `SELECT c.id, c.name, c.slug, c.timezone AS "timeZone", c.is_enabled AS "isEnabled",
      COALESCE(f.recording_enabled, false) AS "recordingEnabled", c.retention_days AS "retentionDays"
    FROM cameras c JOIN devices d ON d.id=c.device_id
    LEFT JOIN camera_frigate_settings f ON f.camera_id=c.id
    WHERE ($3::uuid IS NULL OR c.id=$3::uuid) AND
      ($1::boolean OR shares_camera_household($2::uuid,d.owner_user_id))
    ORDER BY c.created_at, c.id LIMIT $4`,
      [
        isSystemAdmin(actor),
        actor.sub,
        cameraId,
        playbackLimit(this.config, 'PLAYBACK_MAX_CAMERAS', 1000),
      ],
    );
    return result.rows;
  }
}
