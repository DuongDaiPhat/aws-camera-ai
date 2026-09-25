import type {
  EventType,
  PriorityLevel,
  EventStatus,
  NotificationChannel,
} from '@cam/contracts';
import { computeEffectiveHighWaitSeconds } from '../escalation-rules/escalation-rule-policy';

export interface AiCandidateResult {
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

/**
 * Pure policy danh gia nguong va quyet dinh phan ung (US-13 Section 3)
 */
export function evaluateEscalationPolicy(
  input: EscalationEvaluationInput,
  rulesMap: Map<EventType, EscalationRuleLookup>,
): EscalationDecision {
  const currentRule = rulesMap.get(input.eventType);

  // 1. Truong hop PERSON_DETECTED khong kem nguy co -> luon LOGGED_ONLY
  if (input.eventType === 'PERSON_DETECTED') {
    return {
      targetStatus: 'LOGGED_ONLY',
      priority: currentRule?.priority ?? 'P3',
      effectiveWaitSeconds: null,
      deadlineAt: null,
      ruleSnapshot: currentRule ? { ...currentRule } : null,
      triggeringResults: [],
      reason: 'PERSON_DETECTED không có nhãn nguy cơ, chỉ ghi log',
    };
  }

  if (!currentRule || !currentRule.isEnabled) {
    return {
      targetStatus: 'LOGGED_ONLY',
      priority: currentRule?.priority ?? 'P3',
      effectiveWaitSeconds: null,
      deadlineAt: null,
      ruleSnapshot: currentRule ? { ...currentRule } : null,
      triggeringResults: [],
      reason: !currentRule ? 'Không tìm thấy rule cấu hình' : 'Rule đã bị vô hiệu hóa',
    };
  }

  // 2. Chuan bi tap candidates tu aiResults hoac tu direct event confidence/label
  const candidates: AiCandidateResult[] =
    input.aiResults && input.aiResults.length > 0
      ? input.aiResults
      : input.confidence !== undefined
        ? [
            {
              module: 'DIRECT',
              label: input.aiLabel ?? input.eventType,
              confidence: input.confidence,
            },
          ]
        : [];

  // 3. Rule dac biet: skip_logged_only (vi du: FIRE_SMOKE_DETECTED)
  if (currentRule.skipLoggedOnly) {
    const effectiveWait = currentRule.tWaitSeconds;
    const deadlineAt = new Date(input.detectedAt.getTime() + effectiveWait * 1000);
    return {
      targetStatus: 'NOTIFIED',
      priority: currentRule.priority,
      effectiveWaitSeconds: effectiveWait,
      deadlineAt,
      ruleSnapshot: {
        eventType: currentRule.eventType,
        priority: currentRule.priority,
        tLow: currentRule.tLow,
        tHigh: currentRule.tHigh,
        tWaitSeconds: currentRule.tWaitSeconds,
        effectiveWaitSeconds: effectiveWait,
        version: currentRule.version,
      },
      triggeringResults: candidates,
      reason: 'Sự kiện khẩn cấp skip_logged_only kích hoạt thông báo ngay',
    };
  }

  // 4. Rule dac biet: WELLNESS_TIMEOUT (tLow va tHigh luon null)
  if (currentRule.tLow === null && currentRule.tHigh === null) {
    const effectiveWait = currentRule.tWaitSeconds;
    const deadlineAt = new Date(input.detectedAt.getTime() + effectiveWait * 1000);
    return {
      targetStatus: 'NOTIFIED',
      priority: currentRule.priority,
      effectiveWaitSeconds: effectiveWait,
      deadlineAt,
      ruleSnapshot: {
        eventType: currentRule.eventType,
        priority: currentRule.priority,
        tLow: null,
        tHigh: null,
        tWaitSeconds: currentRule.tWaitSeconds,
        effectiveWaitSeconds: effectiveWait,
        version: currentRule.version,
      },
      triggeringResults: candidates,
      reason: 'Sự kiện kiểm tra định kỳ không dùng ngưỡng confidence',
    };
  }

  // 5. Danh gia tung candidate theo nguong
  const triggeringCandidates: {
    candidate: AiCandidateResult;
    effectiveWait: number;
    rule: EscalationRuleLookup;
  }[] = [];

  for (const c of candidates) {
    if (c.confidence === null || c.confidence === undefined) {
      continue;
    }

    const tLow = currentRule.tLow!;
    const tHigh = currentRule.tHigh!;

    if (c.confidence < tLow) {
      // Duoi nguong toi thieu -> khong kich hoat
      continue;
    }

    let wait = currentRule.tWaitSeconds;
    if (c.confidence >= tHigh) {
      wait = computeEffectiveHighWaitSeconds(currentRule.tWaitSeconds);
    }

    triggeringCandidates.push({
      candidate: c,
      effectiveWait: wait,
      rule: currentRule,
    });
  }

  // 6. Neu khong co candidate nao vuot qua tLow -> LOGGED_ONLY
  if (triggeringCandidates.length === 0) {
    return {
      targetStatus: 'LOGGED_ONLY',
      priority: currentRule.priority,
      effectiveWaitSeconds: null,
      deadlineAt: null,
      ruleSnapshot: {
        eventType: currentRule.eventType,
        priority: currentRule.priority,
        tLow: currentRule.tLow,
        tHigh: currentRule.tHigh,
        tWaitSeconds: currentRule.tWaitSeconds,
        version: currentRule.version,
      },
      triggeringResults: [],
      reason: 'Confidence dưới ngưỡng tối thiểu (T_low), chỉ ghi log',
    };
  }

  // 7. Chon candidate co deadline som nhat va priority cao nhat
  triggeringCandidates.sort((a, b) => {
    if (a.effectiveWait !== b.effectiveWait) {
      return a.effectiveWait - b.effectiveWait; // Deadline som hon xep truoc
    }
    return PRIORITY_RANK[a.rule.priority] - PRIORITY_RANK[b.rule.priority];
  });

  const dominant = triggeringCandidates[0];
  const deadlineAt = new Date(input.detectedAt.getTime() + dominant.effectiveWait * 1000);

  return {
    targetStatus: 'NOTIFIED',
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
