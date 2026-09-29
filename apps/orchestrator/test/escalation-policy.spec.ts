import {
  evaluateEscalationPolicy,
  isValidStatusTransition,
  type EscalationRuleLookup,
  type EscalationEvaluationInput,
} from '../src/escalation/escalation-policy';

describe('Escalation Policy (US-13)', () => {
  const baseRules = new Map<string, EscalationRuleLookup>([
    [
      'FIRE_SMOKE_DETECTED',
      {
        eventType: 'FIRE_SMOKE_DETECTED',
        priority: 'P0',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 30,
        skipLoggedOnly: true,
        notifyChannels: ['TELEGRAM'],
        escalateChannels: ['CONNECT_CALL'],
        maxEscalationLevel: 3,
        isEnabled: true,
        version: 1,
      },
    ],
    [
      'FALL_DETECTED',
      {
        eventType: 'FALL_DETECTED',
        priority: 'P1',
        tLow: 0.55,
        tHigh: 0.75,
        tWaitSeconds: 60,
        skipLoggedOnly: false,
        notifyChannels: ['TELEGRAM'],
        escalateChannels: ['CONNECT_CALL'],
        maxEscalationLevel: 3,
        isEnabled: true,
        version: 1,
      },
    ],
    [
      'UNKNOWN_PERSON',
      {
        eventType: 'UNKNOWN_PERSON',
        priority: 'P2',
        tLow: 0.6,
        tHigh: 0.8,
        tWaitSeconds: 120,
        skipLoggedOnly: false,
        notifyChannels: ['TELEGRAM'],
        escalateChannels: ['CONNECT_CALL'],
        maxEscalationLevel: 3,
        isEnabled: true,
        version: 1,
      },
    ],
    [
      'WELLNESS_TIMEOUT',
      {
        eventType: 'WELLNESS_TIMEOUT',
        priority: 'P2',
        tLow: null,
        tHigh: null,
        tWaitSeconds: 300,
        skipLoggedOnly: false,
        notifyChannels: ['TELEGRAM'],
        escalateChannels: ['CONNECT_CALL'],
        maxEscalationLevel: 3,
        isEnabled: true,
        version: 1,
      },
    ],
  ]);

  const detectedAt = new Date('2026-09-25T10:00:00Z');

  describe('evaluateEscalationPolicy', () => {
    it('PERSON_DETECTED khong kem nguy co luon danh gia la LOGGED_ONLY', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'PERSON_DETECTED',
        detectedAt,
        confidence: 0.95,
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('LOGGED_ONLY');
      expect(decision.deadlineAt).toBeNull();
      expect(decision.effectiveWaitSeconds).toBeNull();
    });

    it('confidence < T_low -> LOGGED_ONLY', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'FALL_DETECTED',
        detectedAt,
        confidence: 0.5, // T_low = 0.55
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('LOGGED_ONLY');
      expect(decision.effectiveWaitSeconds).toBeNull();
      expect(decision.deadlineAt).toBeNull();
    });

    it('T_low <= confidence < T_high -> NOTIFIED voi wait = T_wait (60s)', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'FALL_DETECTED',
        detectedAt,
        confidence: 0.65, // 0.55 <= 0.65 < 0.75
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('NOTIFIED');
      expect(decision.priority).toBe('P1');
      expect(decision.effectiveWaitSeconds).toBe(60);
      expect(decision.deadlineAt).toEqual(new Date('2026-09-25T10:01:00Z')); // 10:00:00 + 60s
    });

    it('confidence >= T_high -> NOTIFIED voi wait = max(1, ceil(T_wait/2)) = 30s', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'FALL_DETECTED',
        detectedAt,
        confidence: 0.85, // >= 0.75
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('NOTIFIED');
      expect(decision.effectiveWaitSeconds).toBe(30);
      expect(decision.deadlineAt).toEqual(new Date('2026-09-25T10:00:30Z'));
    });

    it('FIRE_SMOKE_DETECTED co skipLoggedOnly -> luon NOTIFIED voi 30s ke ca score thap', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'FIRE_SMOKE_DETECTED',
        detectedAt,
        confidence: 0.2, // Rat thap
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('NOTIFIED');
      expect(decision.priority).toBe('P0');
      expect(decision.effectiveWaitSeconds).toBe(30);
      expect(decision.deadlineAt).toEqual(new Date('2026-09-25T10:00:30Z'));
    });

    it('WELLNESS_TIMEOUT voi tLow va tHigh null -> luon NOTIFIED voi 300s', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'WELLNESS_TIMEOUT',
        detectedAt,
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('NOTIFIED');
      expect(decision.priority).toBe('P2');
      expect(decision.effectiveWaitSeconds).toBe(300);
      expect(decision.deadlineAt).toEqual(new Date('2026-09-25T10:05:00Z'));
    });

    it('xu ly tap nhieu candidates: chon deadline som nhat va priority cao nhat', () => {
      const input: EscalationEvaluationInput = {
        eventType: 'FALL_DETECTED',
        detectedAt,
        aiResults: [
          { module: 'M2A', label: 'FALL_DETECTED', confidence: 0.6 }, // 60s wait
          { module: 'M2A', label: 'FALL_DETECTED', confidence: 0.8 }, // 30s wait (high confidence)
        ],
      };
      const decision = evaluateEscalationPolicy(input, baseRules as any);

      expect(decision.targetStatus).toBe('NOTIFIED');
      expect(decision.effectiveWaitSeconds).toBe(30);
      expect(decision.triggeringResults).toHaveLength(2);
    });

    it('M4 P1 dưới T_low không che M1 P2 đã đạt T_low', () => {
      const rules = new Map(baseRules);
      rules.set('RESTRICTED_ZONE', {
        eventType: 'RESTRICTED_ZONE',
        priority: 'P1',
        tLow: 0.6,
        tHigh: 0.8,
        tWaitSeconds: 60,
        skipLoggedOnly: false,
        notifyChannels: ['TELEGRAM'],
        escalateChannels: ['CONNECT_CALL'],
        maxEscalationLevel: 3,
        isEnabled: true,
        version: 1,
      });
      const decision = evaluateEscalationPolicy(
        {
          eventType: 'RESTRICTED_ZONE',
          detectedAt,
          aiResults: [
            {
              eventType: 'RESTRICTED_ZONE',
              module: 'M4_ZONE',
              label: 'RESTRICTED_ZONE',
              confidence: 0.4,
            },
            { eventType: 'UNKNOWN_PERSON', module: 'M1_FACE', label: 'UNKNOWN', confidence: 0.7 },
          ],
        },
        rules as any,
      );

      expect(decision.targetStatus).toBe('NOTIFIED');
      expect(decision.triggeringEventType).toBe('UNKNOWN_PERSON');
      expect(decision.priority).toBe('P2');
      expect(decision.triggeringResults).toHaveLength(1);
    });

    it('rule bi vo hieu hoa (isEnabled = false) -> LOGGED_ONLY', () => {
      const disabledRules = new Map(baseRules);
      disabledRules.set('FALL_DETECTED', {
        ...baseRules.get('FALL_DETECTED')!,
        isEnabled: false,
      });

      const input: EscalationEvaluationInput = {
        eventType: 'FALL_DETECTED',
        detectedAt,
        confidence: 0.9,
      };
      const decision = evaluateEscalationPolicy(input, disabledRules as any);

      expect(decision.targetStatus).toBe('LOGGED_ONLY');
      expect(decision.effectiveWaitSeconds).toBeNull();
    });
  });

  describe('isValidStatusTransition', () => {
    it('cho phep cac buoc hop le theo state machine', () => {
      expect(isValidStatusTransition('DETECTED', 'NOTIFIED')).toBe(true);
      expect(isValidStatusTransition('DETECTED', 'LOGGED_ONLY')).toBe(true);
      expect(isValidStatusTransition('DETECTED', 'AI_FAILED')).toBe(true);
      expect(isValidStatusTransition('AI_FAILED', 'NOTIFIED')).toBe(true);
      expect(isValidStatusTransition('AI_FAILED', 'LOGGED_ONLY')).toBe(true);
      expect(isValidStatusTransition('LOGGED_ONLY', 'NOTIFIED')).toBe(true);
      expect(isValidStatusTransition('NOTIFIED', 'RESOLVED')).toBe(true);
      expect(isValidStatusTransition('NOTIFIED', 'ESCALATED')).toBe(true);
      expect(isValidStatusTransition('ESCALATED', 'CLOSED')).toBe(true);
    });

    it('tu choi cac buoc bi cam', () => {
      // Terminal states
      expect(isValidStatusTransition('RESOLVED', 'NOTIFIED')).toBe(false);
      expect(isValidStatusTransition('RESOLVED', 'CLOSED')).toBe(false);
      expect(isValidStatusTransition('CLOSED', 'NOTIFIED')).toBe(false);
      expect(isValidStatusTransition('CLOSED', 'RESOLVED')).toBe(false);

      // Downgrade
      expect(isValidStatusTransition('NOTIFIED', 'LOGGED_ONLY')).toBe(false);
      expect(isValidStatusTransition('ESCALATED', 'LOGGED_ONLY')).toBe(false);
      expect(isValidStatusTransition('ESCALATED', 'RESOLVED')).toBe(false); // IM_OK khong the huy emergency

      // Nhay coc khong hop le
      expect(isValidStatusTransition('DETECTED', 'CLOSED')).toBe(false);
      expect(isValidStatusTransition('DETECTED', 'RESOLVED')).toBe(false);
    });
  });
});
