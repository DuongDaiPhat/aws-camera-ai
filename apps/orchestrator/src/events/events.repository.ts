import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { EventType, EventStatus, PriorityLevel, PersonStatus } from '@cam/contracts';

export interface ListEventsFilters {
  page: number;
  pageSize: number;
  eventType?: EventType[];
  status?: EventStatus[];
  priority?: PriorityLevel[];
  cameraId?: string;
  zoneId?: string;
  from?: string;
  to?: string;
  isFalseAlarm?: boolean;
}

export interface EventListItemRecord {
  id: string;
  event_type: EventType;
  status: EventStatus;
  priority: PriorityLevel;
  confidence: number | null;
  person_status: PersonStatus | null;
  is_false_alarm: boolean;
  detected_at: Date;
  camera_id: string | null;
  camera_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  matched_person_name: string | null;
  thumbnail_object_key: string | null;
}

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
    const query = `
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
      RETURNING *;
    `;

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
      const res = await this.pool.query<EventRecord>(query, values);
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
   * Truy vấn danh sách sự kiện có lọc và phân trang (US-06, US-21).
   */
  async listEvents(
    filters: ListEventsFilters,
  ): Promise<{ events: EventListItemRecord[]; total: number }> {
    const { whereClause, params, nextIdx } = buildEventFilterConditions(filters);
    const countQuery = `SELECT COUNT(*)::int AS total FROM events e ${whereClause};`;
    const countRes = await this.pool.query<{ total: number }>(countQuery, params);
    const total = countRes.rows[0]?.total ?? 0;

    const offset = (filters.page - 1) * filters.pageSize;
    const dataParams = [...params, filters.pageSize, offset];
    const dataQuery = `
      SELECT
        e.id,
        e.event_type,
        e.status,
        e.priority,
        e.confidence,
        e.person_status,
        e.is_false_alarm,
        e.detected_at,
        c.id AS camera_id,
        c.name AS camera_name,
        z.id AS zone_id,
        z.name AS zone_name,
        kf.person_name AS matched_person_name,
        em.object_key AS thumbnail_object_key
      FROM events e
      LEFT JOIN cameras c ON e.camera_id = c.id
      LEFT JOIN zones z ON e.zone_id = z.id
      LEFT JOIN known_faces kf ON e.matched_known_face_id = kf.id
      LEFT JOIN LATERAL (
        SELECT object_key
        FROM event_media
        WHERE event_id = e.id AND media_type IN ('THUMBNAIL', 'SNAPSHOT')
        ORDER BY CASE WHEN media_type = 'THUMBNAIL' THEN 1 ELSE 2 END
        LIMIT 1
      ) em ON true
      ${whereClause}
      ORDER BY e.detected_at DESC
      LIMIT $${nextIdx} OFFSET $${nextIdx + 1};
    `;

    const dataRes = await this.pool.query<EventListItemRecord>(dataQuery, dataParams);
    return { events: dataRes.rows, total };
  }

  /**
   * Tra cứu 1 sự kiện kèm camera, zone, và thumbnail để gửi SSE.
   */
  async findEventSummaryById(id: string): Promise<EventListItemRecord | null> {
    const query = `
      SELECT
        e.id,
        e.event_type,
        e.status,
        e.priority,
        e.confidence,
        e.person_status,
        e.is_false_alarm,
        e.detected_at,
        c.id AS camera_id,
        c.name AS camera_name,
        z.id AS zone_id,
        z.name AS zone_name,
        kf.person_name AS matched_person_name,
        em.object_key AS thumbnail_object_key
      FROM events e
      LEFT JOIN cameras c ON e.camera_id = c.id
      LEFT JOIN zones z ON e.zone_id = z.id
      LEFT JOIN known_faces kf ON e.matched_known_face_id = kf.id
      LEFT JOIN LATERAL (
        SELECT object_key
        FROM event_media
        WHERE event_id = e.id AND media_type IN ('THUMBNAIL', 'SNAPSHOT')
        ORDER BY CASE WHEN media_type = 'THUMBNAIL' THEN 1 ELSE 2 END
        LIMIT 1
      ) em ON true
      WHERE e.id = $1
      LIMIT 1;
    `;
    const res = await this.pool.query<EventListItemRecord>(query, [id]);
    return res.rows[0] ?? null;
  }
}

export interface FilterConditionsResult {
  whereClause: string;
  params: unknown[];
  nextIdx: number;
}

interface FilterConditionHandler {
  check: (f: ListEventsFilters) => boolean;
  sql: (idx: number) => string;
  param: (f: ListEventsFilters) => unknown;
}

const FILTER_HANDLERS: FilterConditionHandler[] = [
  {
    check: (f) => Boolean(f.eventType?.length),
    sql: (i) => `e.event_type = ANY($${i})`,
    param: (f) => f.eventType,
  },
  {
    check: (f) => Boolean(f.status?.length),
    sql: (i) => `e.status = ANY($${i})`,
    param: (f) => f.status,
  },
  {
    check: (f) => Boolean(f.priority?.length),
    sql: (i) => `e.priority = ANY($${i})`,
    param: (f) => f.priority,
  },
  {
    check: (f) => Boolean(f.cameraId),
    sql: (i) => `e.camera_id = $${i}`,
    param: (f) => f.cameraId,
  },
  {
    check: (f) => Boolean(f.zoneId),
    sql: (i) => `e.zone_id = $${i}`,
    param: (f) => f.zoneId,
  },
  {
    check: (f) => Boolean(f.from),
    sql: (i) => `e.detected_at >= $${i}`,
    param: (f) => f.from,
  },
  {
    check: (f) => Boolean(f.to),
    sql: (i) => `e.detected_at <= $${i}`,
    param: (f) => f.to,
  },
  {
    check: (f) => f.isFalseAlarm !== undefined,
    sql: (i) => `e.is_false_alarm = $${i}`,
    param: (f) => f.isFalseAlarm,
  },
];

function buildEventFilterConditions(filters: ListEventsFilters): FilterConditionsResult {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const handler of FILTER_HANDLERS) {
    if (handler.check(filters)) {
      conditions.push(handler.sql(idx++));
      params.push(handler.param(filters));
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params, nextIdx: idx };
}
