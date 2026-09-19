import { Inject, Injectable, Logger, MessageEvent, UnauthorizedException } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';
import { TOKEN_SERVICE, type TokenService } from '../auth/auth.types';
import { EventsRepository, type EventListItemRecord } from './events.repository';
import type { ListEventsQueryDto } from './dto/list-events-query.dto';
import type {
  EventSummaryDto,
  PaginatedEventsResponseDto,
} from './dto/event-summary-response.dto';

const PRESIGNED_URL_TTL_SECONDS = 900; // 15 phút (FR-EVT-07)

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly eventSubject = new Subject<MessageEvent>();

  constructor(
    private readonly eventsRepository: EventsRepository,
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
        this.logger.warn(`Không thể tạo presigned URL cho thumbnail ${record.thumbnail_object_key}`, err);
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
      confidence: record.confidence ? Number(record.confidence) : null,
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
        error: { code: 'INVALID_TOKEN', message: 'Token cho SSE stream không hợp lệ hoặc đã hết hạn.' },
      });
    }

    return this.eventSubject.asObservable();
  }
}
