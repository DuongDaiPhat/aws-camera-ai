import {
  computeEffectiveHighWaitSeconds,
  validateThresholdUpdate,
} from '../src/escalation-rules/escalation-rule-policy';

describe('EscalationRulePolicy (US-15, US-13)', () => {
  describe('computeEffectiveHighWaitSeconds', () => {
    it.each([
      [1, 1],
      [2, 1],
      [3, 2],
      [30, 15],
      [60, 30],
      [120, 60],
      [300, 150],
      [3600, 1800],
    ])('với tWaitSeconds = %d giây, trả về %d giây', (tWait, expected) => {
      expect(computeEffectiveHighWaitSeconds(tWait)).toBe(expected);
    });
  });

  describe('validateThresholdUpdate', () => {
    it('chấp nhận cấu hình hợp lệ thông thường', () => {
      const result = validateThresholdUpdate({
        eventType: 'FIRE_SMOKE_DETECTED',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 30,
      });
      expect(result.isValid).toBe(true);
    });

    it('chấp nhận biên T_low = 0 và T_high = 1', () => {
      const result = validateThresholdUpdate({
        eventType: 'FALL_DETECTED',
        tLow: 0,
        tHigh: 1,
        tWaitSeconds: 60,
      });
      expect(result.isValid).toBe(true);
    });

    it('chấp nhận biên T_low == T_high', () => {
      const result = validateThresholdUpdate({
        eventType: 'RESTRICTED_ZONE',
        tLow: 0.75,
        tHigh: 0.75,
        tWaitSeconds: 60,
      });
      expect(result.isValid).toBe(true);
    });

    it('từ chối khi T_low > T_high với mã INVALID_THRESHOLD', () => {
      const result = validateThresholdUpdate({
        eventType: 'UNKNOWN_PERSON',
        tLow: 0.85,
        tHigh: 0.6,
        tWaitSeconds: 120,
      });
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('INVALID_THRESHOLD');
      expect(result.message).toContain('Ngưỡng thấp phải nhỏ hơn hoặc bằng ngưỡng cao');
    });

    it('từ chối khi ngưỡng ngoài khoảng 0 đến 1', () => {
      const resultNegative = validateThresholdUpdate({
        eventType: 'UNKNOWN_PERSON',
        tLow: -0.01,
        tHigh: 0.8,
        tWaitSeconds: 120,
      });
      expect(resultNegative.isValid).toBe(false);
      expect(resultNegative.errorCode).toBe('INVALID_THRESHOLD');

      const resultOver = validateThresholdUpdate({
        eventType: 'UNKNOWN_PERSON',
        tLow: 0.5,
        tHigh: 1.05,
        tWaitSeconds: 120,
      });
      expect(resultOver.isValid).toBe(false);
      expect(resultOver.errorCode).toBe('INVALID_THRESHOLD');
    });

    it('từ chối rule có confidence nhưng thiếu 1 hoặc cả 2 ngưỡng với THRESHOLD_REQUIRED', () => {
      const resultOne = validateThresholdUpdate({
        eventType: 'FALL_DETECTED',
        tLow: 0.5,
        tHigh: null,
        tWaitSeconds: 60,
      });
      expect(resultOne.isValid).toBe(false);
      expect(resultOne.errorCode).toBe('THRESHOLD_REQUIRED');

      const resultBoth = validateThresholdUpdate({
        eventType: 'FALL_DETECTED',
        tLow: null,
        tHigh: null,
        tWaitSeconds: 60,
      });
      expect(resultBoth.isValid).toBe(false);
      expect(resultBoth.errorCode).toBe('THRESHOLD_REQUIRED');
    });

    it('chấp nhận WELLNESS_TIMEOUT khi cả hai ngưỡng đều là null', () => {
      const result = validateThresholdUpdate({
        eventType: 'WELLNESS_TIMEOUT',
        tLow: null,
        tHigh: null,
        tWaitSeconds: 300,
      });
      expect(result.isValid).toBe(true);
    });

    it('từ chối WELLNESS_TIMEOUT nếu truyền ngưỡng với THRESHOLD_NOT_APPLICABLE', () => {
      const result = validateThresholdUpdate({
        eventType: 'WELLNESS_TIMEOUT',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 300,
      });
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('THRESHOLD_NOT_APPLICABLE');
      expect(result.message).toContain('không sử dụng confidence');
    });

    it.each([0, -1, 3601, 10.5, NaN])(
      'từ chối tWaitSeconds không hợp lệ (%p) với INVALID_WAIT_SECONDS',
      (invalidWait) => {
        const result = validateThresholdUpdate({
          eventType: 'FIRE_SMOKE_DETECTED',
          tLow: 0.5,
          tHigh: 0.7,
          tWaitSeconds: invalidWait,
        });
        expect(result.isValid).toBe(false);
        expect(result.errorCode).toBe('INVALID_WAIT_SECONDS');
      },
    );

    it.each([1, 60, 3600])('chấp nhận tWaitSeconds tại biên hợp lệ (%d)', (validWait) => {
      const result = validateThresholdUpdate({
        eventType: 'FIRE_SMOKE_DETECTED',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: validWait,
      });
      expect(result.isValid).toBe(true);
    });

    it('từ chối loại sự kiện không thuộc danh sách quản lý hoặc PERSON_DETECTED với RULE_NOT_FOUND', () => {
      const resultUnknown = validateThresholdUpdate({
        eventType: 'RANDOM_EVENT',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 60,
      });
      expect(resultUnknown.isValid).toBe(false);
      expect(resultUnknown.errorCode).toBe('RULE_NOT_FOUND');

      const resultInternal = validateThresholdUpdate({
        eventType: 'PERSON_DETECTED',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 60,
      });
      expect(resultInternal.isValid).toBe(false);
      expect(resultInternal.errorCode).toBe('RULE_NOT_FOUND');
    });
  });
});
