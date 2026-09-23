import type { components } from '@cam/contracts';

export type Schema = components['schemas'];
export type EventType = Schema['EventType'];
export type EventStatus = Schema['EventStatus'];
export type Priority = Schema['PriorityLevel'];
export type Channel = Schema['NotificationChannel'];

/**
 * Internal application ports for the five vertical slices.
 * HTTP payloads are generated from OpenAPI; these commands are in-process only.
 * IDs are stable across retries. State/history/deadline/intent commit atomically.
 * Network calls run outside that transaction.
 */
export type CameraSourceType = Schema['CameraSourceType'];
export type CameraRuntimeStatus = Schema['CameraRuntimeStatus'];

export interface CameraContextV1 {
  schemaVersion: 1;
  cameraId: string;
  deviceId: string;
  slug: string;
  name: string;
  timezone: string;
  detectWidth: number;
  detectHeight: number;
  fps: number;
  isEnabled: boolean;
  detectionEnabled: boolean;
  sourceType: CameraSourceType;
  runtimeStatus: CameraRuntimeStatus;
  configVersion: number;
}

export type CameraPreviewV1 = Schema['CameraPreview'];

export interface ApplyFrigateConfigCommandV1 {
  schemaVersion: 1;
  commandId: string;
  cameraId: string;
  expectedConfigVersion: number;
  reason: 'CAMERA_CHANGED' | 'ZONE_CHANGED';
  requestedAt: string;
}

/** Version conflicts reject before apply; FAILED never means the runtime accepted the config. */
export interface ApplyFrigateConfigResultV1 {
  cameraId: string;
  configVersion: number;
  status: 'APPLIED' | 'NO_CHANGE' | 'FAILED';
  appliedAt: string | null;
  errorCode: string | null;
}

export interface CameraConfigPortV1 {
  getCameraContext(cameraId: string): Promise<CameraContextV1>;
  getPreview(cameraId: string): Promise<CameraPreviewV1>;
  applyConfiguration(command: ApplyFrigateConfigCommandV1): Promise<ApplyFrigateConfigResultV1>;
}

export type CandidateClassification = 'RISK' | 'NON_RISK' | 'UNDETERMINED' | 'TECHNICAL_FAILURE';

export interface EscalationCandidateV1 {
  resultId: string;
  module: Schema['AiResultItem']['module'];
  label: string;
  eventType: Exclude<EventType, 'PERSON_DETECTED'> | null;
  classification: CandidateClassification;
  confidence: number | null;
  modelVersion: string | null;
  processedAt: string;
  errorCode: string | null;
}

/** evaluationId is stable for eventId/aggregateVersion; stale replay cannot reopen terminal events. */
export interface EvaluateEventCommandV1 {
  schemaVersion: 1;
  evaluationId: string;
  eventId: string;
  aggregateVersion: number;
  detectedAt: string;
  candidates: EscalationCandidateV1[];
}

export interface EscalationRuleSnapshotV1 {
  eventType: EventType;
  version: number;
  priority: Priority;
  tLow: number | null;
  tHigh: number | null;
  tWaitSeconds: number;
  effectiveWaitSeconds: number;
  skipLoggedOnly: boolean;
  notifyChannels: Channel[];
  escalateChannels: Channel[];
}

export interface EvaluateEventResultV1 {
  evaluationId: string;
  eventId: string;
  eventVersion: number;
  previousStatus: EventStatus;
  status: EventStatus;
  priority: Priority;
  triggeringResultIds: string[];
  ruleSnapshots: EscalationRuleSnapshotV1[];
  escalationDeadlineAt: string | null;
  transitionId: string | null;
}

/**
 * Actor comes from verified server context, exactly one actor ID is populated.
 * Server assigns respondedAt. First authoritative confirmation wins per phase.
 */
export interface ConfirmEventCommandV1 {
  schemaVersion: 1;
  commandId: string;
  eventId: string;
  response: Schema['ConfirmationResponse'];
  actorUserId: string | null;
  emergencyContactId: string | null;
  channel: 'DASHBOARD' | 'TELEGRAM' | 'CONNECT_CALL';
  notificationId: string | null;
  sourceMessageId: string | null;
  note: string | null;
}

export interface ConfirmEventResultV1 {
  accepted: boolean;
  reason: 'ACCEPTED' | 'ALREADY_CONFIRMED' | 'INVALID_STATE' | 'FORBIDDEN';
  confirmationId: string | null;
  eventId: string;
  canonicalStatus: EventStatus;
  confirmedByName: string | null;
  respondedAt: string | null;
}

export interface EscalationPortV1 {
  evaluate(command: EvaluateEventCommandV1): Promise<EvaluateEventResultV1>;
  confirm(command: ConfirmEventCommandV1): Promise<ConfirmEventResultV1>;
}

/**
 * Exactly one recipient ID is populated. Deduplicate by transition/recipient/channel/level.
 * Persist with the state transition. Retry delivery separately without resetting deadline.
 */
export interface NotificationIntentV1 {
  schemaVersion: 1;
  notificationId: string;
  eventId: string;
  eventVersion: number;
  transitionId: string;
  recipientUserId: string | null;
  emergencyContactId: string | null;
  channel: 'TELEGRAM';
  escalationLevel: number;
  priority: Priority;
  eventSnapshot: {
    eventType: EventType;
    cameraName: string | null;
    zoneName: string | null;
    detectedAt: string;
    timezone: string;
    snapshotMediaId: string | null;
  };
  deliveryPolicy: {
    maxAttempts: 4;
    backoffSeconds: [2, 4, 8];
  };
  createdAt: string;
}

/** One authoritative result per ID/payload; replay is safe, changed payload conflicts. */
export interface AiResultApplicationPort {
  submit(
    payload: Schema['FaceResultSubmission'] | Schema['ZoneResultSubmission'],
  ): Promise<{ resultId: string; disposition: 'ACCEPTED' | 'DUPLICATE' | 'STALE' }>;
}
