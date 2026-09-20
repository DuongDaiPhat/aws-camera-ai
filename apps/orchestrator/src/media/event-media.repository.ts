import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { MediaType } from '@cam/contracts';
import { EventRecord } from '../events/events.repository';

const EVENT_MEDIA_COLUMNS = `
  id,
  event_id,
  media_type,
  storage_provider,
  bucket,
  object_key,
  content_type,
  size_bytes,
  width,
  height,
  duration_ms,
  checksum_sha256,
  expires_at,
  created_at
`;

const EVENT_COLUMNS = `
  id,
  camera_id,
  zone_id,
  event_type,
  status,
  priority,
  source,
  track_id,
  dedup_key,
  confidence,
  ai_results,
  correlation_id,
  detected_at,
  created_at,
  updated_at
`;

export interface CreateEventMediaInput {
  eventId: string;
  mediaType: MediaType;
  storageProvider?: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes?: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  checksumSha256?: string | null;
  expiresAt?: Date | null;
}

export interface EventMediaRecord {
  id: string;
  event_id: string;
  media_type: MediaType;
  storage_provider: string;
  bucket: string;
  object_key: string;
  content_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  checksum_sha256: string | null;
  expires_at: Date | null;
  created_at: Date;
}

@Injectable()
export class EventMediaRepository {
  private readonly logger = new Logger(EventMediaRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Lưu bản ghi media mới vào bảng event_media.
   */
  async createEventMedia(input: CreateEventMediaInput): Promise<EventMediaRecord> {
    const query = `
      INSERT INTO event_media (
        event_id,
        media_type,
        storage_provider,
        bucket,
        object_key,
        content_type,
        size_bytes,
        width,
        height,
        duration_ms,
        checksum_sha256,
        expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (storage_provider, bucket, object_key) DO UPDATE
      SET size_bytes = EXCLUDED.size_bytes,
          duration_ms = EXCLUDED.duration_ms
      RETURNING ${EVENT_MEDIA_COLUMNS};
    `;

    const values = [
      input.eventId,
      input.mediaType,
      input.storageProvider ?? 'MINIO',
      input.bucket,
      input.objectKey,
      input.contentType,
      input.sizeBytes ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      input.checksumSha256 ?? null,
      input.expiresAt ?? null,
    ];

    try {
      const res = await this.pool.query<EventMediaRecord>(query, values);
      return res.rows[0];
    } catch (error) {
      this.logger.error(
        `Lỗi khi lưu event_media (eventId: ${input.eventId}, objectKey: ${input.objectKey})`,
        error,
      );
      throw error;
    }
  }

  /**
   * Lấy danh sách media của một sự kiện theo eventId.
   */
  async findMediaByEventId(eventId: string, limit: number): Promise<EventMediaRecord[]> {
    const query = `
      SELECT ${EVENT_MEDIA_COLUMNS}
      FROM event_media
      WHERE event_id = $1
      ORDER BY created_at ASC
      LIMIT $2;
    `;

    const res = await this.pool.query<EventMediaRecord>(query, [eventId, limit]);
    return res.rows;
  }

  async findMediaByEventIdAndType(
    eventId: string,
    mediaType: MediaType,
  ): Promise<EventMediaRecord | null> {
    const query = `
      SELECT ${EVENT_MEDIA_COLUMNS}
      FROM event_media
      WHERE event_id = $1 AND media_type = $2
      ORDER BY created_at ASC
      LIMIT 1;
    `;

    const result = await this.pool.query<EventMediaRecord>(query, [eventId, mediaType]);
    return result.rows[0] ?? null;
  }

  /**
   * Tra cứu sự kiện theo trackId (phục vụ gắn clip video khi track kết thúc).
   */
  async findEventByTrackId(trackId: string): Promise<EventRecord | null> {
    const query = `
      SELECT ${EVENT_COLUMNS}
      FROM events
      WHERE track_id = $1
      ORDER BY detected_at DESC
      LIMIT 1;
    `;

    const res = await this.pool.query<EventRecord>(query, [trackId]);
    return res.rows[0] ?? null;
  }

  /**
   * Tra cứu sự kiện theo eventId.
   */
  async findEventById(eventId: string): Promise<EventRecord | null> {
    const query = `
      SELECT ${EVENT_COLUMNS}
      FROM events
      WHERE id = $1
      LIMIT 1;
    `;

    const res = await this.pool.query<EventRecord>(query, [eventId]);
    return res.rows[0] ?? null;
  }
}
