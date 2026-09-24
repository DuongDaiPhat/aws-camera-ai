import type { EventStatus, EventType, PersonStatus, PriorityLevel } from '@cam/contracts';

export const AI_MODULES = [
  'M1_FACE',
  'M2A_FALL',
  'M2B_POSTURE',
  'M3_FIRE',
  'M4_ZONE',
  'M5_WELLNESS',
] as const;

export type AiModule = (typeof AI_MODULES)[number];
export type AiResultDisposition = 'ACCEPTED' | 'DUPLICATE' | 'STALE';

export interface NormalizedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiResultError {
  code: string;
  message: string;
}

export interface AiResultProjectionItem {
  resultId: string;
  observationId: string;
  revision: number;
  module: AiModule;
  label: string | null;
  confidence: number | null;
  modelVersion: string;
  processedAt: string;
  status: 'SUCCESS' | 'ERROR';
  error: AiResultError | null;
  boundingBox: NormalizedBoundingBox | null;
  metadata: Record<string, unknown>;
}

export interface ValidatedAiResultSubmission {
  schemaVersion: 1;
  resultId: string;
  requestId: string | null;
  eventId: string;
  observationId: string;
  revision: number;
  module: AiModule;
  modelVersion: string;
  processedAt: string;
  personStatus: PersonStatus | null;
  matchedKnownFaceId: string | null;
  results: AiResultProjectionItem[];
  error: AiResultError | null;
}

export interface EscalationRulePriority {
  eventType: EventType;
  priority: PriorityLevel;
}

export interface AiEventAggregateState {
  eventType: EventType;
  status: EventStatus;
  priority: PriorityLevel;
  aiLabel: string | null;
  confidence: number | null;
  aiModelVersion: string | null;
  aiProcessedAt: string | null;
  aiResults: AiResultProjectionItem[];
}

export interface AiEventProjection {
  eventType: EventType;
  priority: PriorityLevel;
  aiLabel: string | null;
  confidence: number | null;
  aiModelVersion: string | null;
  aiProcessedAt: string | null;
  aiResults: AiResultProjectionItem[];
  candidates: AiRiskCandidate[];
}

export interface AiRiskCandidate {
  resultId: string;
  observationId: string;
  module: AiModule;
  label: string;
  eventType: Exclude<EventType, 'PERSON_DETECTED'>;
  confidence: number | null;
  modelVersion: string;
  processedAt: string;
}

export interface ApplyAiResultResult {
  resultId: string;
  disposition: AiResultDisposition;
  aggregateVersion: number;
  eventId: string;
  correlationId: string;
}
