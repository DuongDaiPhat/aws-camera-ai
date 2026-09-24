import type { EventType, PriorityLevel } from '@cam/contracts';
import type {
  AiEventAggregateState,
  AiEventProjection,
  AiResultProjectionItem,
  AiRiskCandidate,
  EscalationRulePriority,
} from './ai-result.types';

const PRIORITY_RANK: Record<PriorityLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED']);
const LATCHED_STATUSES = new Set(['NOTIFIED', 'ESCALATED']);

const LABEL_TO_EVENT_TYPE: Readonly<Record<string, Exclude<EventType, 'PERSON_DETECTED'>>> = {
  UNKNOWN: 'UNKNOWN_PERSON',
  RESTRICTED_ZONE: 'RESTRICTED_ZONE',
  FALL_DETECTED: 'FALL_DETECTED',
  FIRE_SMOKE_DETECTED: 'FIRE_SMOKE_DETECTED',
  WELLNESS_TIMEOUT: 'WELLNESS_TIMEOUT',
};

function mergeResults(
  existingResults: AiResultProjectionItem[],
  incomingResults: AiResultProjectionItem[],
): AiResultProjectionItem[] {
  if (incomingResults.length === 0) return existingResults;
  const incomingIdentity = incomingResults[0];
  const retainedResults = existingResults.filter(
    (item) =>
      item.module !== incomingIdentity.module ||
      item.observationId !== incomingIdentity.observationId,
  );
  return [...retainedResults, ...incomingResults].sort((left, right) =>
    [left.module, left.observationId, left.resultId]
      .join(':')
      .localeCompare([right.module, right.observationId, right.resultId].join(':')),
  );
}

function toCandidates(
  results: AiResultProjectionItem[],
  priorityByEventType: Map<EventType, PriorityLevel>,
): Array<AiRiskCandidate & { priority: PriorityLevel }> {
  return results.flatMap((result) => {
    if (result.status !== 'SUCCESS' || !result.label) return [];
    const eventType = LABEL_TO_EVENT_TYPE[result.label];
    if (!eventType) return [];
    const priority = priorityByEventType.get(eventType);
    if (!priority) return [];
    return [{ ...result, label: result.label, eventType, priority }];
  });
}

function chooseRepresentative(
  candidates: Array<AiRiskCandidate & { priority: PriorityLevel }>,
  currentEventType: EventType,
): (AiRiskCandidate & { priority: PriorityLevel }) | null {
  if (candidates.length === 0) return null;
  const bestRank = Math.min(...candidates.map((candidate) => PRIORITY_RANK[candidate.priority]));
  const tiedCandidates = candidates.filter(
    (candidate) => PRIORITY_RANK[candidate.priority] === bestRank,
  );
  const currentRepresentative = tiedCandidates.find(
    (candidate) => candidate.eventType === currentEventType,
  );
  if (currentRepresentative) return currentRepresentative;

  return [...tiedCandidates].sort((left, right) =>
    [left.eventType, left.module, left.observationId]
      .join(':')
      .localeCompare([right.eventType, right.module, right.observationId].join(':')),
  )[0];
}

function latestFaceResult(results: AiResultProjectionItem[]): AiResultProjectionItem | null {
  const faceResults = results.filter(
    (result) => result.module === 'M1_FACE' && result.status === 'SUCCESS',
  );
  return (
    [...faceResults].sort((left, right) => {
      const timeDifference = Date.parse(right.processedAt) - Date.parse(left.processedAt);
      return timeDifference !== 0 ? timeDifference : right.revision - left.revision;
    })[0] ?? null
  );
}

function shouldLatchRisk(state: AiEventAggregateState, hasRepresentative: boolean): boolean {
  const isProtectedStatus =
    LATCHED_STATUSES.has(state.status) || TERMINAL_STATUSES.has(state.status);
  return isProtectedStatus && state.eventType !== 'PERSON_DETECTED' && !hasRepresentative;
}

function latchedProjection(
  state: AiEventAggregateState,
  aiResults: AiResultProjectionItem[],
  candidates: AiRiskCandidate[],
): AiEventProjection {
  return {
    eventType: state.eventType,
    priority: state.priority,
    aiLabel: state.aiLabel,
    confidence: state.confidence,
    aiModelVersion: state.aiModelVersion,
    aiProcessedAt: state.aiProcessedAt,
    aiResults,
    candidates,
  };
}

/**
 * US-11: tong hop projection mot cach thuan, de thu tu M1/M4 den khong lam doi ket qua.
 */
export function aggregateAiResult(
  state: AiEventAggregateState,
  incomingResults: AiResultProjectionItem[],
  rules: EscalationRulePriority[],
): AiEventProjection {
  const aiResults = mergeResults(state.aiResults, incomingResults);
  const priorityByEventType = new Map(
    rules.map((rule) => [rule.eventType, rule.priority] as const),
  );
  const candidatesWithPriority = toCandidates(aiResults, priorityByEventType);
  const representative = chooseRepresentative(candidatesWithPriority, state.eventType);
  if (shouldLatchRisk(state, Boolean(representative))) {
    return latchedProjection(state, aiResults, candidatesWithPriority);
  }

  if (representative) {
    return {
      eventType: representative.eventType,
      priority: representative.priority,
      aiLabel: representative.label,
      confidence: representative.confidence,
      aiModelVersion: representative.modelVersion,
      aiProcessedAt: representative.processedAt,
      aiResults,
      candidates: candidatesWithPriority,
    };
  }

  const faceResult = latestFaceResult(aiResults);
  return {
    eventType: 'PERSON_DETECTED',
    priority: 'P3',
    aiLabel: faceResult?.label ?? null,
    confidence: faceResult?.confidence ?? null,
    aiModelVersion: faceResult?.modelVersion ?? null,
    aiProcessedAt: faceResult?.processedAt ?? null,
    aiResults,
    candidates: [],
  };
}
