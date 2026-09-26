/**
 * Cac gia tri liet ke dung chung o CA runtime FE va BE.
 * Phai khop 1-1 voi ENUM trong Postgres (db/migrations/0001_init.sql)
 * va voi `components.schemas` trong api/openapi.yaml.
 * Doi mot cho thi phai doi du ba cho — checklist nay nam trong mau PR.
 */

export const USER_ROLES = ['ADMIN', 'CAREGIVER', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EVENT_TYPES = [
  'PERSON_DETECTED',
  'UNKNOWN_PERSON',
  'RESTRICTED_ZONE',
  'FALL_DETECTED',
  'FIRE_SMOKE_DETECTED',
  'WELLNESS_TIMEOUT',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = [
  'DETECTED',
  'LOGGED_ONLY',
  'NOTIFIED',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
  'AI_FAILED',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const PRIORITY_LEVELS = ['P0', 'P1', 'P2', 'P3'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const PERSON_STATUSES = ['KNOWN', 'UNKNOWN', 'UNDETERMINED'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

export const ZONE_TYPES = ['RESTRICTED', 'REST_AREA', 'NORMAL'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const NOTIFICATION_CHANNELS = [
  'TELEGRAM',
  'SNS_EMAIL',
  'SNS_SMS',
  'CONNECT_CALL',
  'DASHBOARD',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CONFIRMED', 'SKIPPED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const CONFIRMATION_RESPONSES = ['IM_OK', 'NEED_HELP', 'ACKNOWLEDGED'] as const;
export type ConfirmationResponse = (typeof CONFIRMATION_RESPONSES)[number];

export const CONFIRMATION_PHASES = ['INITIAL', 'EMERGENCY'] as const;
export type ConfirmationPhase = (typeof CONFIRMATION_PHASES)[number];

export const MEDIA_TYPES = ['SNAPSHOT', 'CLIP', 'THUMBNAIL'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Mac dinh theo bang trong US-15; DB la nguon su that khi he thong dang chay. */
export const DEFAULT_ESCALATION_RULES: Record<
  EventType,
  { priority: PriorityLevel; tLow: number | null; tHigh: number | null; tWaitSeconds: number }
> = {
  FIRE_SMOKE_DETECTED: { priority: 'P0', tLow: 0.5, tHigh: 0.7, tWaitSeconds: 30 },
  FALL_DETECTED: { priority: 'P1', tLow: 0.55, tHigh: 0.75, tWaitSeconds: 60 },
  RESTRICTED_ZONE: { priority: 'P1', tLow: 0.6, tHigh: 0.8, tWaitSeconds: 60 },
  UNKNOWN_PERSON: { priority: 'P2', tLow: 0.6, tHigh: 0.8, tWaitSeconds: 120 },
  WELLNESS_TIMEOUT: { priority: 'P2', tLow: null, tHigh: null, tWaitSeconds: 300 },
  PERSON_DETECTED: { priority: 'P3', tLow: null, tHigh: null, tWaitSeconds: 0 },
};

export const CAMERA_SOURCE_TYPES = ['RTSP', 'BROWSER_WEBCAM', 'VIDEO_FILE'] as const;
export type CameraSourceType = (typeof CAMERA_SOURCE_TYPES)[number];

export const CAMERA_RUNTIME_STATUSES = [
  'ONLINE',
  'OFFLINE',
  'STARTING',
  'FAILED',
  'DISABLED',
] as const;
export type CameraRuntimeStatus = (typeof CAMERA_RUNTIME_STATUSES)[number];

export const CAMERA_SOURCE_RUNTIME_STATUSES = [
  'NOT_CONFIGURED',
  'STARTING',
  'ONLINE',
  'OFFLINE',
  'FAILED',
  'STOPPED',
] as const;
export type CameraSourceRuntimeStatus = (typeof CAMERA_SOURCE_RUNTIME_STATUSES)[number];

export const FRIGATE_SYNC_STATUSES = ['PENDING', 'SYNCED', 'FAILED'] as const;
export type FrigateSyncStatus = (typeof FRIGATE_SYNC_STATUSES)[number];
