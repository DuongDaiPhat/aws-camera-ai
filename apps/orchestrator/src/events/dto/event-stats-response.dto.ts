import type { EventType, PriorityLevel } from '@cam/contracts';

export class EventTypeCountDto {
  eventType!: EventType;
  count!: number;
}

export class EventPriorityCountDto {
  priority!: PriorityLevel;
  count!: number;
}

export class LatestPendingEventDto {
  id!: string;
  eventType!: EventType;
  priority!: PriorityLevel;
  cameraName!: string | null;
  zoneName!: string | null;
  detectedAt!: string;
}

/**
 * So lieu tong hop cho cac the tren dau dashboard (openapi.yaml: EventStats, FR-DSH-01).
 */
export class EventStatsResponseDto {
  windowHours!: number;
  totalEvents!: number;
  personDetectedCount!: number;
  pendingCount!: number;
  resolvedCount!: number;
  falseAlarmCount!: number;
  cameraOnlineCount!: number;
  cameraTotalCount!: number;
  latestEventAt!: string | null;
  latestPendingEvent!: LatestPendingEventDto | null;
  byType!: EventTypeCountDto[];
  byPriority!: EventPriorityCountDto[];
}
