import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { EventType, EventStatus, PriorityLevel } from '@cam/contracts';

const CREATE_EVENT_QUERY = `
  INSERT INTO events (
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
    detected_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    COALESCE($11, gen_random_uuid()),
    $12
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id,
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
            updated_at;
`;

export interface CameraRecord {
  id: string;
  name: string;
  slug: string;
  rtsp_url?: string;
}

export interface ZoneRecord {
  id: string;
  camera_id: string;
  name: string;
  slug: string;
}

export interface CreateEventInput {
  cameraId: string | null;
  zoneId: string | null;
  eventType: EventType;
  status?: EventStatus;
  priority?: PriorityLevel;
  source?: string;
  trackId: string;
  dedupKey: string;
  confidence: number;
  aiResults?: unknown[];
  correlationId?: string;
  detectedAt: Date;
}

export interface EventRecord {
  id: string;
  camera_id: string | null;
  zone_id: string | null;
  event_type: EventType;
  status: EventStatus;
  priority: PriorityLevel;
  source: string;
  track_id: string | null;
  dedup_key: string | null;
  confidence: number | null;
  ai_results: unknown[];
  correlation_id: string;
  detected_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateEventInput {
  eventId: string;
  cameraId: string | null;
  zoneId: string | null;
  eventType: EventType;
  priority: PriorityLevel;
  confidence: number;
}

@Injectable()
export class EventsRepository {
  private readonly logger = new Logger(EventsRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Tra cứu camera theo slug (do Frigate gửi `after.camera` dạng slug).
   */
  async findCameraBySlug(slug: string): Promise<CameraRecord | null> {
    const query = `
      SELECT id, name, slug
      FROM cameras
      WHERE slug = $1 AND is_enabled = true
      LIMIT 1;
    `;
    const res = await this.pool.query<CameraRecord>(query, [slug]);
    return res.rows[0] ?? null;
  }

  /**
   * Tra cứu zone theo camera_id và slug của zone.
   */
  async findZoneByCameraAndSlug(cameraId: string, zoneSlug: string): Promise<ZoneRecord | null> {
    const query = `
      SELECT id, camera_id, name, slug
      FROM zones
      WHERE camera_id = $1 AND slug = $2 AND is_enabled = true
      LIMIT 1;
    `;
    const res = await this.pool.query<ZoneRecord>(query, [cameraId, zoneSlug]);
    return res.rows[0] ?? null;
  }

  /**
   * Chèn sự kiện vào bảng `events`.
   * Khử trùng lặp bằng `ON CONFLICT (dedup_key) DO NOTHING`.
   * Trả về EventRecord nếu tạo mới thành công, null nếu bị trùng lặp (deduplicated).
   */
  async createEvent(input: CreateEventInput): Promise<EventRecord | null> {
    const values = [
      input.cameraId,
      input.zoneId,
      input.eventType,
      input.status ?? 'DETECTED',
      input.priority ?? 'P3',
      input.source ?? 'FRIGATE',
      input.trackId,
      input.dedupKey,
      input.confidence,
      JSON.stringify(input.aiResults ?? []),
      input.correlationId ?? null,
      input.detectedAt,
    ];

    try {
      const res = await this.pool.query<EventRecord>(CREATE_EVENT_QUERY, values);
      if (res.rows.length === 0) {
        // Bị trùng lặp theo dedup_key
        return null;
      }
      return res.rows[0];
    } catch (error) {
      this.logger.error(
        `Lỗi khi ghi event vào PostgreSQL (dedupKey: ${input.dedupKey}, trackId: ${input.trackId})`,
        error,
      );
      throw error;
    }
  }

  /**
   * Tra cứu event Frigate theo dedup_key ổn định của track.
   */
  async findEventByDedupKey(dedupKey: string): Promise<EventRecord | null> {
    const query = `
      SELECT id,
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
      FROM events
      WHERE dedup_key = $1
      LIMIT 1;
    `;

    const result = await this.pool.query<EventRecord>(query, [dedupKey]);
    return result.rows[0] ?? null;
  }

  /**
   * Đồng bộ dữ liệu mới nhất của một track vào event đã tồn tại.
   */
  async updateEvent(input: UpdateEventInput): Promise<EventRecord | null> {
    const query = `
      UPDATE events
      SET camera_id = COALESCE(camera_id, $2),
          zone_id = COALESCE($3, zone_id),
          event_type = $4,
          priority = $5,
          confidence = CASE
            WHEN confidence IS NULL THEN $6
            ELSE GREATEST(confidence, $6)
          END
      WHERE id = $1
      RETURNING id,
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
                updated_at;
    `;

    const values = [
      input.eventId,
      input.cameraId,
      input.zoneId,
      input.eventType,
      input.priority,
      input.confidence,
    ];
    const result = await this.pool.query<EventRecord>(query, values);
    return result.rows[0] ?? null;
  }
}
