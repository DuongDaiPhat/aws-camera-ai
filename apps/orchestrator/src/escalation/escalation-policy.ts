import type { EventType, PriorityLevel, EventStatus, NotificationChannel } from '@cam/contracts';
import { computeEffectiveHighWaitSeconds } from '../escalation-rules/escalation-rule-policy';

export interface AiCandidateResult {
  eventType?: EventType;
  resultId?: string;
  observationId?: string;
  processedAt?: string;
  module: string;
  label: string;
  confidence: number | null;
  modelVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface EscalationRuleLookup {
  eventType: EventType;
  priority: PriorityLevel;
  tLow: number | null;
  tHigh: number | null;
  tWaitSeconds: number;
  skipLoggedOnly: boolean;
  notifyChannels: NotificationChannel[];
  escalateChannels: NotificationChannel[];
  maxEscalationLevel: number;
  isEnabled: boolean;
  version: number;
}

export interface EscalationEvaluationInput {
  eventType: EventType;
  detectedAt: Date;
  currentStatus?: EventStatus;
  aiResults?: AiCandidateResult[];
  confidence?: number | null;
  aiLabel?: string | null;
}

export interface EscalationDecision {
  targetStatus: EventStatus;
  triggeringEventType: EventType | null;
  priority: PriorityLevel;
  effectiveWaitSeconds: number | null;
  deadlineAt: Date | null;
  ruleSnapshot: Record<string, unknown> | null;
  triggeringResults: AiCandidateResult[];
  reason: string;
}

/**
 * Ma tran do uu tien priority rank (P0 la cao nhat)
 */
export const PRIORITY_RANK: Record<PriorityLevel, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/**
 * Kiem tra tinh hop le cua chuyen doi trang thai state machine (US-13 Section 4)
 */
export function isValidStatusTransition(fromStatus: EventStatus, toStatus: EventStatus): boolean {
  if (fromStatus === toStatus) {
    return true;
  }

  // Terminal states khong bao gio duoc phep mo lai
  if (fromStatus === 'RESOLVED' || fromStatus === 'CLOSED') {
    return false;
  }

  switch (fromStatus) {
    case 'DETECTED':
      return toStatus === 'LOGGED_ONLY' || toStatus === 'NOTIFIED' || toStatus === 'AI_FAILED';

    case 'AI_FAILED':
      return toStatus === 'LOGGED_ONLY' || toStatus === 'NOTIFIED';

    case 'LOGGED_ONLY':
      // Chi duoc nang len NOTIFIED khi co observation/revision moi hop le
      return toStatus === 'NOTIFIED';

    case 'NOTIFIED':
      // RESOLVED khi IM_OK; ESCALATED khi NEED_HELP hoac timeout deadline
      return toStatus === 'RESOLVED' || toStatus === 'ESCALATED';

    case 'ESCALATED':
      // Chi co the chuyen sang CLOSED khi co xac nhan emergency hop le
      return toStatus === 'CLOSED';

    default:
      return false;
  }
}

interface QualifiedCandidate {
  candidate: AiCandidateResult;
  effectiveWait: number;
  rule: EscalationRuleLookup;
}

function candidatesForInput(
  input: EscalationEvaluationInput,
  currentRule: EscalationRuleLookup | undefined,
): AiCandidateResult[] {
  if (input.aiResults?.length) return input.aiResults;
  if (input.eventType === 'PERSON_DETECTED') return [];
  if (
    input.confidence === undefined &&
    !currentRule?.skipLoggedOnly &&
    currentRule?.tLow !== null
  ) {
    return [];
  }
  return [
    {
      eventType: input.eventType,
      module: 'DIRECT',
      label: input.aiLabel ?? input.eventType,
      confidence: input.confidence ?? null,
    },
  ];
}

function qualifyCandidate(
  candidate: AiCandidateResult,
  eventType: EventType,
  rulesMap: Map<EventType, EscalationRuleLookup>,
): QualifiedCandidate | null {
  const rule = rulesMap.get(candidate.eventType ?? eventType);
  if (!rule?.isEnabled || rule.eventType === 'PERSON_DETECTED') return null;
  if (rule.skipLoggedOnly || (rule.tLow === null && rule.tHigh === null)) {
    return { candidate, effectiveWait: rule.tWaitSeconds, rule };
  }
  if (!hasQualifyingScore(candidate.confidence, rule.tLow)) return null;
  const effectiveWait =
    rule.tHigh !== null && candidate.confidence >= rule.tHigh
      ? computeEffectiveHighWaitSeconds(rule.tWaitSeconds)
      : rule.tWaitSeconds;
  return { candidate, effectiveWait, rule };
}

function hasQualifyingScore(confidence: number | null, tLow: number | null): confidence is number {
  return confidence !== null && confidence !== undefined && tLow !== null && confidence >= tLow;
}

/** Pure policy danh gia nguong va quyet dinh phan ung (US-13 Section 3). */
export function evaluateEscalationPolicy(
  input: EscalationEvaluationInput,
  rulesMap: Map<EventType, EscalationRuleLookup>,
): EscalationDecision {
  const currentRule = rulesMap.get(input.eventType);
  // US-11/US-13: moi nhan dung rule cua chinh no, khong dung rule cua nhan dai dien.
  const triggeringCandidates = candidatesForInput(input, currentRule)
    .map((candidate) => qualifyCandidate(candidate, input.eventType, rulesMap))
    .filter((candidate): candidate is QualifiedCandidate => candidate !== null);

  if (triggeringCandidates.length === 0) {
    return {
      targetStatus: 'LOGGED_ONLY',
      triggeringEventType: null,
      priority: currentRule?.priority ?? 'P3',
      effectiveWaitSeconds: null,
      deadlineAt: null,
      ruleSnapshot: currentRule ? { ...currentRule } : null,
      triggeringResults: [],
      reason: 'Không có kết quả hợp lệ đạt ngưỡng cảnh báo, chỉ ghi log',
    };
  }

  // Uu tien muc nguy co cao nhat; neu bang nhau chon deadline som nhat.
  triggeringCandidates.sort((a, b) => {
    const priorityDifference = PRIORITY_RANK[a.rule.priority] - PRIORITY_RANK[b.rule.priority];
    return priorityDifference !== 0 ? priorityDifference : a.effectiveWait - b.effectiveWait;
  });

  const dominant = triggeringCandidates[0];
  const deadlineAt = new Date(input.detectedAt.getTime() + dominant.effectiveWait * 1000);

  return {
    targetStatus: 'NOTIFIED',
    triggeringEventType: dominant.rule.eventType,
    priority: dominant.rule.priority,
    effectiveWaitSeconds: dominant.effectiveWait,
    deadlineAt,
    ruleSnapshot: {
      eventType: dominant.rule.eventType,
      priority: dominant.rule.priority,
      tLow: dominant.rule.tLow,
      tHigh: dominant.rule.tHigh,
      tWaitSeconds: dominant.rule.tWaitSeconds,
      effectiveWaitSeconds: dominant.effectiveWait,
      version: dominant.rule.version,
    },
    triggeringResults: triggeringCandidates.map((t) => t.candidate),
    reason: `Đạt ngưỡng cảnh báo: ${dominant.effectiveWait}s chờ phản hồi`,
  };
}
