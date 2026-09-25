import type { components, operations, paths } from '@cam/contracts';
import type {
  EventType,
  EventStatus,
  PriorityLevel,
  UserRole,
  ConfirmationResponse,
} from '@cam/contracts';

export type { components, operations, paths };
export type { EventType, EventStatus, PriorityLevel, UserRole, ConfirmationResponse };

export type EventSummary = components['schemas']['EventSummary'];
export type EventDetail = components['schemas']['EventDetail'];
export type EventMedia = components['schemas']['EventMedia'];
export type EventStats = components['schemas']['EventStats'];
export type AiResultItem = components['schemas']['AiResultItem'];

export type AiTagColor = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

export interface UIEventItem extends EventSummary {
  cameraCode: string;
  aiTag: string;
  aiTagColor?: AiTagColor;
  note?: string;
  relativeTimeText: string;
}

export type FilterTabKey = 'ALL' | 'URGENT' | 'SAFE' | 'INFO';

export interface FilterTabCounts {
  all: number;
  urgent: number;
  safe: number;
  info: number;
}

export interface MetricCardData {
  title: string;
  value: string | number;
  description: string;
  icon: 'alert-triangle' | 'clock' | 'activity' | 'shield-check';
  badgeColor?: 'danger' | 'warning' | 'success' | 'info';
  statusLabel?: string;
  statusType?: 'danger' | 'warning' | 'success' | 'info';
}

export type CurrentUser = components['schemas']['User'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type AuthTokens = components['schemas']['AuthTokens'];

export type Camera = components['schemas']['Camera'];
export type CameraSourceType = components['schemas']['CameraSourceType'];
export type CameraRuntimeStatus = components['schemas']['CameraRuntimeStatus'];
export type CameraSourceDetail = components['schemas']['CameraSourceDetail'];
export type CameraPreview = components['schemas']['CameraPreview'];
export type CameraFrigateSettings = components['schemas']['CameraFrigateSettings'];
export type UpdateCameraRequest = components['schemas']['UpdateCameraRequest'];
export type UpdateCameraStateRequest = components['schemas']['UpdateCameraStateRequest'];
export type UpdateCameraSourceRequest = components['schemas']['UpdateCameraSourceRequest'];
export type RtspConnectionTestRequest = components['schemas']['RtspConnectionTestRequest'];
export type RtspConnectionTestResult = components['schemas']['RtspConnectionTestResult'];
