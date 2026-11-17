import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { PlaybackBox } from './playback-frame.codec';
interface CameraGeometry {
  id: string;
  slug: string;
  width: number;
  height: number;
}
export interface StoredFrame {
  at: Date;
  boxes: PlaybackBox[];
}
export interface HistoricalEvent {
  id: string;
  event_type: string;
  detected_at: Date;
  ai_results: unknown;
}
@Injectable()
export class PlaybackFramesRepository {
  constructor(private readonly db: DatabaseService) {}
  async cameras(limit: number): Promise<CameraGeometry[]> {
    return (
      await this.db.query<CameraGeometry>(
        'SELECT c.id,c.slug,COALESCE(f.detect_width,c.detect_width) AS width,COALESCE(f.detect_height,c.detect_height) AS height FROM cameras c LEFT JOIN camera_frigate_settings f ON f.camera_id=c.id ORDER BY c.id LIMIT $1',
        [limit],
      )
    ).rows;
  }
  async insert(cameraId: string, at: number, boxes: PlaybackBox[]): Promise<void> {
    await this.db.query(
      'INSERT INTO playback_frames(camera_id,observed_at,boxes) VALUES($1,to_timestamp($2/1000.0),$3::jsonb) ON CONFLICT DO NOTHING',
      [cameraId, at, JSON.stringify(boxes)],
    );
  }
  async prune(days: number, limit: number): Promise<void> {
    await this.db.query(
      'DELETE FROM playback_frames WHERE (camera_id,observed_at) IN (SELECT camera_id,observed_at FROM playback_frames WHERE observed_at<now()-$1*make_interval(days=>1) ORDER BY observed_at LIMIT $2)',
      [days, limit],
    );
  }
  async frames(
    cameraId: string,
    start: number,
    end: number,
    limit: number,
  ): Promise<StoredFrame[]> {
    return (
      await this.db.query<StoredFrame>(
        'SELECT observed_at AS at, boxes FROM playback_frames WHERE camera_id=$1 AND observed_at>=to_timestamp($2/1000.0) AND observed_at<=to_timestamp($3/1000.0) ORDER BY observed_at LIMIT $4',
        [cameraId, start, end, limit],
      )
    ).rows;
  }
  async events(
    cameraId: string,
    start: number,
    end: number,
    limit: number,
  ): Promise<HistoricalEvent[]> {
    return (
      await this.db.query<HistoricalEvent>(
        'SELECT id,event_type,detected_at,ai_results FROM events WHERE camera_id=$1 AND detected_at>=to_timestamp($2/1000.0) AND detected_at<=to_timestamp($3/1000.0) ORDER BY detected_at LIMIT $4',
        [cameraId, start, end, limit],
      )
    ).rows;
  }
}
