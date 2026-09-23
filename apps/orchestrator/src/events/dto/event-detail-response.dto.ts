import type { components } from '@cam/contracts';
import { EventSummaryDto } from './event-summary-response.dto';

export type AiResultItem = components['schemas']['AiResultItem'];
export type EventStatusHistoryEntry = components['schemas']['EventStatusHistoryEntry'];
export type EventMedia = components['schemas']['EventMedia'];

/**
 * Chi tiet mot su kien — EventSummary cong them thong tin AI, moc thoi gian,
 * media va lich su trang thai (openapi.yaml: EventDetail).
 */
export class EventDetailDto extends EventSummaryDto {
  source!: string;
  trackId!: string | null;
  aiLabel!: string | null;
  aiModelVersion!: string | null;
  aiResults!: AiResultItem[];
  retain!: boolean;
  correlationId!: string;
  escalationDeadlineAt!: string | null;
  notifiedAt!: string | null;
  escalatedAt!: string | null;
  resolvedAt!: string | null;
  closedAt!: string | null;
  media!: EventMedia[];
  statusHistory!: EventStatusHistoryEntry[];
}
