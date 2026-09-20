import type {
  EventType,
  EventStatus,
  PriorityLevel,
  PersonStatus,
  components,
} from '@cam/contracts';

export type EventSummary = components['schemas']['EventSummary'];
export type PaginationMeta = components['schemas']['PaginatedResponse']['meta'];

export class EventCameraDto {
  id?: string;
  name?: string;
}

export class EventZoneDto {
  id?: string;
  name?: string;
}

export class EventSummaryDto {
  id!: string;
  eventType!: EventType;
  status!: EventStatus;
  priority!: PriorityLevel;
  camera?: EventCameraDto | null;
  zone?: EventZoneDto | null;
  confidence?: number | null;
  personStatus?: PersonStatus;
  matchedPersonName?: string | null;
  thumbnailUrl?: string | null;
  isFalseAlarm?: boolean;
  detectedAt!: string;
}

export class PaginationMetaDto {
  page!: number;
  pageSize!: number;
  total!: number;
  totalPages!: number;
}

export class PaginatedEventsResponseDto {
  data!: EventSummaryDto[];
  meta!: PaginationMetaDto;
}
