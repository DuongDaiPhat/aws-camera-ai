import { ConfigService } from '@nestjs/config';
import type { components } from '@cam/contracts';
import type { WellnessScheduleRecord, WellnessCheckRunRecord } from './wellness.types';

export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sort(child)]),
    );
  };
  return JSON.stringify(sort(value));
}
export function wellnessInteger(
  config: ConfigService,
  key: string,
  fallback: number,
  max = 86400,
): number {
  const value = Number(config.get<string | number>(key) ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0 || value > max)
    throw new Error(`${key} must be a positive integer <= ${max}.`);
  return value;
}
export function scheduleResponse(
  row: WellnessScheduleRecord,
): components['schemas']['WellnessSchedule'] {
  return {
    id: row.id,
    residentUserId: row.resident_user_id,
    ownerUserId: row.owner_user_id ?? undefined,
    name: row.name,
    checkAt: row.check_at.slice(0, 5),
    daysOfWeek: row.days_of_week,
    lookbackHours: row.lookback_hours,
    graceSeconds: row.grace_seconds,
    cameraIds: row.camera_ids,
    timezone: row.timezone,
    isEnabled: row.is_enabled,
    version: row.version,
    configurationStatus: row.owner_user_id ? 'READY' : 'INVALID_CONFIG',
  };
}
export function checkResponse(row: WellnessCheckRunRecord): components['schemas']['WellnessCheck'] {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    residentUserId: row.resident_user_id,
    ownerUserId: row.owner_user_id,
    scheduledFor: row.scheduled_for.toISOString(),
    localDate: row.local_date.slice(0, 10),
    scheduleVersion: row.schedule_version,
    status: row.status,
    decisionReason: row.decision_reason,
    presenceState: row.presence_state,
    lookbackStartedAt: row.lookback_started_at.toISOString(),
    lookbackEndedAt: row.lookback_ended_at.toISOString(),
    lastActivityAt: row.last_activity_at?.toISOString() ?? null,
    graceSeconds: row.grace_seconds,
    eventId: row.event_id,
    eventStatus: (row.event_status ?? null) as components['schemas']['EventStatus'] | null,
    evaluatedAt: row.evaluated_at?.toISOString() ?? null,
    requestSentAt: row.request_sent_at?.toISOString() ?? null,
    confirmationDeadlineAt: row.confirmation_deadline_at?.toISOString() ?? null,
    deliveryDeadlineAt: row.delivery_deadline_at?.toISOString() ?? null,
  };
}
