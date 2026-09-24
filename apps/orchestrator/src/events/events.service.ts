import {
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';
import { TOKEN_SERVICE, type TokenService } from '../auth/auth.types';
import { MediaService } from '../media/media.service';
import { EscalationEngineService } from '../escalation/escalation-engine.service';
import {
  EventsRepository,
  type EventDetailRecord,
  type EventListItemRecord,
  type EventStatsRecords,
  type EventStatusHistoryRecord,
} from './events.repository';
import type { ListEventsQueryDto } from './dto/list-events-query.dto';
import type { EventSummaryDto, PaginatedEventsResponseDto } from './dto/event-summary-response.dto';
import type {
  AiResultItem,
  EventDetailDto,
  EventStatusHistoryEntry,
} from './dto/event-detail-response.dto';
import type { EventStatsResponseDto } from './dto/event-stats-response.dto';
import type { ConfirmEventDto, CloseEventDto } from './dto/confirm-event.dto';
import type { ConfirmationResponseDto } from './dto/confirmation-response.dto';
import { DEFAULT_STATS_WINDOW_HOURS } from './dto/get-event-stats-query.dto';

const PRESIGNED_URL_TTL_SECONDS = 900; // 15 phút (FR-EVT-07)
const STATUS_HISTORY_LIMIT = 50;
const STATS_GROUP_LIMIT = 20;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * `ai_results` nam trong cot JSONB nen phai kiem tra hinh dang truoc khi tin (FR-EVT-04).
 */
function toAiResultItems(rawResults: unknown): AiResultItem[] {
  if (!Array.isArray(rawResults)) {
    return [];
  }

  return rawResults.filter(isAiResultItem);
}

function isAiResultItem(item: unknown): item is AiResultItem {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Partial<AiResultItem>;
  return hasAiResultIdentity(candidate) && hasValidAiResultValue(candidate);
}

function hasAiResultIdentity(candidate: Partial<AiResultItem>): boolean {
  return (
    typeof candidate.resultId === 'string' &&
    typeof candidate.observationId === 'string' &&
    typeof candidate.revision === 'number' &&
    typeof candidate.module === 'string' &&
    typeof candidate.modelVersion === 'string' &&
    typeof candidate.processedAt === 'string'
  );
}

function hasValidAiResultValue(candidate: Partial<AiResultItem>): boolean {
  const hasValidLabel = candidate.label === null || typeof candidate.label === 'string';
  const hasValidStatus = candidate.status === 'SUCCESS' || candidate.status === 'ERROR';
  const hasValidConfidence =
    candidate.confidence === null ||
    (typeof candidate.confidence === 'number' &&
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0 &&
      candidate.confidence <= 1);
  return hasValidLabel && hasValidStatus && hasValidConfidence;
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly eventSubject = new Subject<MessageEvent>();

  constructor(
    private readonly eventsRepository: EventsRepository,
    private readonly mediaService: MediaService,
    private readonly escalationEngineService: EscalationEngineService,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
  ) {}

  /**
   * Lấy danh sách 20 sự kiện gần nhất có lọc và phân trang (US-06, US-21).
   */
  async listEvents(query: ListEventsQueryDto): Promise<PaginatedEventsResponseDto> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const { events, total } = await this.eventsRepository.listEvents({
      page,
      pageSize,
      eventType: query.eventType,
      status: query.status,
      priority: query.priority,
      cameraId: query.cameraId,
      zoneId: query.zoneId,
      from: query.from,
      to: query.to,
      isFalseAlarm: query.isFalseAlarm,
    });

    const data = await Promise.all(events.map((e) => this.toEventSummary(e)));
    const totalPages = Math.ceil(total / pageSize);

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  /**
   * Lấy chi tiết một sự kiện kèm media, kết quả AI và lịch sử trạng thái (US-21).
   */
  async getEvent(eventId: string): Promise<EventDetailDto> {
    const record = await this.eventsRepository.findEventDetailById(eventId);
    if (!record) {
      throw new NotFoundException({
        error: { code: 'EVENT_NOT_FOUND', message: `Không tìm thấy sự kiện ${eventId}.` },
      });
    }

    const [summary, media, statusHistory] = await Promise.all([
      this.toEventSummary(record),
      this.mediaService.listEventMediaWithUrls(eventId),
      this.eventsRepository.listStatusHistoryByEventId(eventId, STATUS_HISTORY_LIMIT),
    ]);

    return this.toEventDetail(record, summary, media, statusHistory);
  }

  /**
   * Xác nhận sự kiện ban đầu ("Tôi ổn" / "Cần giúp đỡ") - FR-ESC-03/04/09 (US-13).
   */
  async confirmEvent(
    eventId: string,
    actorUserId: string,
    dto: ConfirmEventDto,
  ): Promise<ConfirmationResponseDto> {
    const result = await this.escalationEngineService.confirmInitial(eventId, actorUserId, {
      response: dto.response,
      note: dto.note,
      commandId: dto.commandId,
      channel: 'DASHBOARD',
    });

    const summary = await this.eventsRepository.findEventSummaryById(eventId);
    if (summary) {
      const summaryDto = await this.toEventSummary(summary);
      this.emitEvent(summaryDto, 'event.updated');
    }

    return result;
  }

  /**
   * Đóng sự kiện khẩn cấp sau khi đã tiếp nhận và can thiệp - FR-ESC-04/09 (US-13 Phase EMERGENCY).
   */
  async closeEvent(
    eventId: string,
    actorUserId: string,
    dto: CloseEventDto,
  ): Promise<ConfirmationResponseDto> {
    const result = await this.escalationEngineService.closeEmergency(eventId, actorUserId, {
      note: dto.note,
      commandId: dto.commandId,
      channel: 'DASHBOARD',
    });

    const summary = await this.eventsRepository.findEventSummaryById(eventId);
    if (summary) {
      const summaryDto = await this.toEventSummary(summary);
      this.emitEvent(summaryDto, 'event.updated');
    }

    return result;
  }

  private toEventDetail(
    record: EventDetailRecord,
    summary: EventSummaryDto,
    media: EventDetailDto['media'],
    statusHistory: EventStatusHistoryRecord[],
  ): EventDetailDto {
    return {
      ...summary,
      source: record.source,
      trackId: record.track_id,
      aiLabel: record.ai_label,
      aiModelVersion: record.ai_model_version,
      aiProcessedAt: toIsoStringOrNull(record.ai_processed_at),
      aiResults: toAiResultItems(record.ai_results),
      aggregateVersion: Number(record.aggregate_version),
      retain: record.retain,
      correlationId: record.correlation_id,
      escalationDeadlineAt: toIsoStringOrNull(record.escalation_deadline_at),
      notifiedAt: toIsoStringOrNull(record.notified_at),
      escalatedAt: toIsoStringOrNull(record.escalated_at),
      resolvedAt: toIsoStringOrNull(record.resolved_at),
      closedAt: toIsoStringOrNull(record.closed_at),
      media,
      statusHistory: statusHistory.map((entry) => this.toStatusHistoryEntry(entry)),
      version: record.version ?? 1,
      ruleSnapshot: record.rule_snapshot as Record<string, unknown> | null,
      triggeringResults: toAiResultItems(record.triggering_results),
    };
  }

  private toStatusHistoryEntry(record: EventStatusHistoryRecord): EventStatusHistoryEntry {
    return {
      fromStatus: record.from_status ?? undefined,
      toStatus: record.to_status,
      reason: record.reason,
      actorType: record.actor_type as EventStatusHistoryEntry['actorType'],
      actorName: record.actor_name,
      channel: (record.channel ?? undefined) as EventStatusHistoryEntry['channel'],
      createdAt: record.created_at.toISOString(),
    };
  }

  /**
   * Số liệu tổng hợp cho các thẻ trên đầu dashboard (FR-DSH-01, US-06).
   */
  async getStats(windowHours: number = DEFAULT_STATS_WINDOW_HOURS): Promise<EventStatsResponseDto> {
    const since = new Date(Date.now() - windowHours * MILLISECONDS_PER_HOUR);
    const records = await this.eventsRepository.getEventStats(since, STATS_GROUP_LIMIT);
    return this.toEventStats(windowHours, records);
  }

  private toEventStats(windowHours: number, records: EventStatsRecords): EventStatsResponseDto {
    const { aggregate, cameras, latestPendingEvent } = records;

    return {
      windowHours,
      totalEvents: aggregate.total_events,
      personDetectedCount: aggregate.person_detected_count,
      pendingCount: aggregate.pending_count,
      resolvedCount: aggregate.resolved_count,
      falseAlarmCount: aggregate.false_alarm_count,
      cameraOnlineCount: cameras.online_count,
      cameraTotalCount: cameras.total_count,
      latestEventAt: toIsoStringOrNull(aggregate.latest_event_at),
      latestPendingEvent: latestPendingEvent
        ? {
            id: latestPendingEvent.id,
            eventType: latestPendingEvent.event_type,
            priority: latestPendingEvent.priority,
            cameraName: latestPendingEvent.camera_name,
            zoneName: latestPendingEvent.zone_name,
            detectedAt: latestPendingEvent.detected_at.toISOString(),
          }
        : null,
      byType: records.byType.map((row) => ({ eventType: row.event_type, count: row.count })),
      byPriority: records.byPriority.map((row) => ({
        priority: row.priority,
        count: row.count,
      })),
    };
  }

  /**
   * Chuyển đổi record database sang EventSummaryDto và sinh presigned URL cho thumbnail.
   */
  async toEventSummary(record: EventListItemRecord): Promise<EventSummaryDto> {
    let thumbnailUrl: string | null = null;
    if (record.thumbnail_object_key) {
      try {
        const presigned = await this.storageService.getPresignedUrl(
          record.thumbnail_object_key,
          PRESIGNED_URL_TTL_SECONDS,
        );
        thumbnailUrl = presigned.url;
      } catch (err) {
        this.logger.warn(
          `Không thể tạo presigned URL cho thumbnail ${record.thumbnail_object_key}`,
          err,
        );
      }
    }

    return {
      id: record.id,
      eventType: record.event_type,
      status: record.status,
      priority: record.priority,
      camera: record.camera_id
        ? { id: record.camera_id, name: record.camera_name ?? undefined }
        : null,
      zone: record.zone_id ? { id: record.zone_id, name: record.zone_name ?? undefined } : null,
      confidence: record.confidence !== null ? Number(record.confidence) : null,
      personStatus: record.person_status ?? undefined,
      matchedPersonName: record.matched_person_name ?? null,
      thumbnailUrl,
      isFalseAlarm: record.is_false_alarm,
      detectedAt: record.detected_at.toISOString(),
    };
  }

  /**
   * Phát sự kiện mới vào SSE stream khi Frigate/AI ghi nhận sự kiện (FR-DSH-02).
   */
  emitEvent(event: EventSummaryDto, eventType: string = 'event.created'): void {
    this.eventSubject.next({
      type: eventType,
      data: JSON.stringify(event),
    });
  }

  /**
   * Mở luồng SSE cho dashboard sau khi kiểm tra token (US-06).
   */
  streamEvents(token?: string): Observable<MessageEvent> {
    if (!token) {
      throw new UnauthorizedException({
        error: { code: 'UNAUTHORIZED', message: 'Thiếu token xác thực cho SSE stream.' },
      });
    }

    try {
      this.tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token cho SSE stream không hợp lệ hoặc đã hết hạn.',
        },
      });
    }

    return this.eventSubject.asObservable();
  }
}
