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

/** Cac trang thai con cho nguoi dung xu ly (FR-DSH-01). */
export const PENDING_EVENT_STATUSES: EventStatus[] = ['DETECTED', 'NOTIFIED', 'ESCALATED'];

/** Cac trang thai da khep lai. */
export const CLOSED_EVENT_STATUSES: EventStatus[] = ['RESOLVED', 'CLOSED'];

/** Cac loai su kien sinh ra tu viec nhin thay nguoi (US-03). */
export const PERSON_EVENT_TYPES: EventType[] = [
  'PERSON_DETECTED',
  'UNKNOWN_PERSON',
  'RESTRICTED_ZONE',
];

export interface EventDetailRecord extends EventListItemRecord {
  source: string;
  track_id: string | null;
  ai_label: string | null;
  ai_model_version: string | null;
  ai_results: unknown[];
  retain: boolean;
  correlation_id: string;
  escalation_deadline_at: Date | null;
  notified_at: Date | null;
  escalated_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
}

export interface EventStatusHistoryRecord {
  from_status: EventStatus | null;
  to_status: EventStatus;
  reason: string | null;
  actor_type: string;
  actor_name: string | null;
  channel: string | null;
  created_at: Date;
}

export interface EventStatsAggregateRecord {
  total_events: number;
  person_detected_count: number;
  pending_count: number;
  resolved_count: number;
  false_alarm_count: number;
  latest_event_at: Date | null;
}

export interface EventTypeCountRecord {
  event_type: EventType;
  count: number;
}

export interface EventPriorityCountRecord {
  priority: PriorityLevel;
  count: number;
}

export interface CameraAvailabilityRecord {
  online_count: number;
  total_count: number;
}

export interface LatestPendingEventRecord {
  id: string;
  event_type: EventType;
  priority: PriorityLevel;
  camera_name: string | null;
  zone_name: string | null;
  detected_at: Date;
}

export interface EventStatsRecords {
  aggregate: EventStatsAggregateRecord;
  byType: EventTypeCountRecord[];
  byPriority: EventPriorityCountRecord[];
  cameras: CameraAvailabilityRecord;
  latestPendingEvent: LatestPendingEventRecord | null;
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

/** Cot dung chung cho moi truy van tra ve EventSummary (US-06). */
const EVENT_SUMMARY_PROJECTION = `
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
`;

/**
 * Nguon du lieu dung chung cho EventSummary.
 * LATERAL uu tien THUMBNAIL truoc SNAPSHOT de the su kien tai anh nhe hon.
 */
const EVENT_SUMMARY_SOURCE = `
  FROM events e
  LEFT JOIN cameras c ON c.id = e.camera_id
  LEFT JOIN zones z ON z.id = e.zone_id
  LEFT JOIN known_faces kf ON kf.id = e.matched_known_face_id
  LEFT JOIN LATERAL (
    SELECT object_key
    FROM event_media
    WHERE event_id = e.id AND media_type IN ('THUMBNAIL', 'SNAPSHOT')
    ORDER BY CASE WHEN media_type = 'THUMBNAIL' THEN 1 ELSE 2 END
    LIMIT 1
  ) em ON true
`;

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
      SELECT ${EVENT_SUMMARY_PROJECTION}
      ${EVENT_SUMMARY_SOURCE}
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
      SELECT ${EVENT_SUMMARY_PROJECTION}
      ${EVENT_SUMMARY_SOURCE}
      WHERE e.id = $1
      LIMIT 1;
    `;
    const res = await this.pool.query<EventListItemRecord>(query, [id]);
    return res.rows[0] ?? null;
  }

  /**
   * Tra cuu day du mot su kien de dung cho man hinh chi tiet (US-21).
   */
  async findEventDetailById(id: string): Promise<EventDetailRecord | null> {
    const query = `
      SELECT ${EVENT_SUMMARY_PROJECTION},
             e.source,
             e.track_id,
             e.ai_label,
             e.ai_model_version,
             e.ai_results,
             e.retain,
             e.correlation_id,
             e.escalation_deadline_at,
             e.notified_at,
             e.escalated_at,
             e.resolved_at,
             e.closed_at
      ${EVENT_SUMMARY_SOURCE}
      WHERE e.id = $1
      LIMIT 1;
    `;
    const res = await this.pool.query<EventDetailRecord>(query, [id]);
    return res.rows[0] ?? null;
  }

  /**
   * Lich su chuyen trang thai cua mot su kien (FR-EVT-05).
   */
  async listStatusHistoryByEventId(
    eventId: string,
    limit: number,
  ): Promise<EventStatusHistoryRecord[]> {
    const query = `
      SELECT h.from_status,
             h.to_status,
             h.reason,
             h.actor_type,
             u.full_name AS actor_name,
             h.channel,
             h.created_at
      FROM event_status_history h
      LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE h.event_id = $1
      ORDER BY h.created_at ASC
      LIMIT $2;
    `;
    const res = await this.pool.query<EventStatusHistoryRecord>(query, [eventId, limit]);
    return res.rows;
  }

  /**
   * Dem so lieu tong hop cho dashboard trong cua so `since` -> hien tai (FR-DSH-01).
   * Cac truy van doc lap nen chay song song de dashboard tai nhanh.
   */
  async getEventStats(since: Date, groupLimit: number): Promise<EventStatsRecords> {
    const [aggregate, byType, byPriority, cameras, latestPendingEvent] = await Promise.all([
      this.aggregateEventStats(since),
      this.countEventsByType(since, groupLimit),
      this.countEventsByPriority(since, groupLimit),
      this.countCameraAvailability(),
      this.findLatestPendingEvent(since),
    ]);

    return { aggregate, byType, byPriority, cameras, latestPendingEvent };
  }

  private async aggregateEventStats(since: Date): Promise<EventStatsAggregateRecord> {
    const query = `
      SELECT COUNT(*)::int AS total_events,
             COUNT(*) FILTER (WHERE event_type = ANY($2))::int AS person_detected_count,
             COUNT(*) FILTER (WHERE status = ANY($3))::int AS pending_count,
             COUNT(*) FILTER (WHERE status = ANY($4))::int AS resolved_count,
             COUNT(*) FILTER (WHERE is_false_alarm)::int AS false_alarm_count,
             MAX(detected_at) AS latest_event_at
      FROM events
      WHERE detected_at >= $1;
    `;
    const res = await this.pool.query<EventStatsAggregateRecord>(query, [
      since,
      PERSON_EVENT_TYPES,
      PENDING_EVENT_STATUSES,
      CLOSED_EVENT_STATUSES,
    ]);

    return (
      res.rows[0] ?? {
        total_events: 0,
        person_detected_count: 0,
        pending_count: 0,
        resolved_count: 0,
        false_alarm_count: 0,
        latest_event_at: null,
      }
    );
  }

  private async countEventsByType(since: Date, limit: number): Promise<EventTypeCountRecord[]> {
    const query = `
      SELECT event_type, COUNT(*)::int AS count
      FROM events
      WHERE detected_at >= $1
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT $2;
    `;
    const res = await this.pool.query<EventTypeCountRecord>(query, [since, limit]);
    return res.rows;
  }

  private async countEventsByPriority(
    since: Date,
    limit: number,
  ): Promise<EventPriorityCountRecord[]> {
    const query = `
      SELECT priority, COUNT(*)::int AS count
      FROM events
      WHERE detected_at >= $1
      GROUP BY priority
      ORDER BY priority ASC
      LIMIT $2;
    `;
    const res = await this.pool.query<EventPriorityCountRecord>(query, [since, limit]);
    return res.rows;
  }

  private async countCameraAvailability(): Promise<CameraAvailabilityRecord> {
    const query = `
      SELECT COUNT(*)::int AS total_count,
             COUNT(*) FILTER (WHERE c.is_enabled AND d.status = 'ONLINE')::int AS online_count
      FROM cameras c
      JOIN devices d ON d.id = c.device_id;
    `;
    const res = await this.pool.query<CameraAvailabilityRecord>(query);
    return res.rows[0] ?? { online_count: 0, total_count: 0 };
  }

  private async findLatestPendingEvent(since: Date): Promise<LatestPendingEventRecord | null> {
    const query = `
      SELECT e.id,
             e.event_type,
             e.priority,
             c.name AS camera_name,
             z.name AS zone_name,
             e.detected_at
      FROM events e
      LEFT JOIN cameras c ON c.id = e.camera_id
      LEFT JOIN zones z ON z.id = e.zone_id
      WHERE e.detected_at >= $1 AND e.status = ANY($2)
      ORDER BY e.priority ASC, e.detected_at DESC
      LIMIT 1;
    `;
    const res = await this.pool.query<LatestPendingEventRecord>(query, [
      since,
      PENDING_EVENT_STATUSES,
    ]);
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
