import { describe, expect, it } from 'vitest';
import type { EscalationRule } from './escalation-rules-client';
import {
  isValidWaitSeconds,
  isValidHighWaitSeconds,
  previewEffectiveWait,
  WAIT_PRESETS,
} from './escalation-wait-settings';

const rule: EscalationRule = {
  eventType: 'RESTRICTED_ZONE',
  priority: 'P1',
  tLow: 0.6,
  tHigh: 0.8,
  tWaitSeconds: 60,
  highWaitSeconds: 17,
  skipLoggedOnly: false,
  isEnabled: true,
};

describe('Xem trước thời gian chờ US-13', () => {
  it.each([1, 30, 60, 300, 3600])('chấp nhận số nguyên hợp lệ %s giây', (seconds) => {
    expect(isValidWaitSeconds(seconds)).toBe(true);
  });
  it.each([0, -1, 3601, 1.5, NaN, Infinity])('từ chối thời gian không hợp lệ %s', (seconds) => {
    expect(isValidWaitSeconds(seconds)).toBe(false);
    expect(previewEffectiveWait(rule, seconds)).toBeNull();
  });
  it('giữ đúng số nhập tay, không tự chia đôi khi đổi thời gian cơ sở', () => {
    expect(previewEffectiveWait(rule, 300)).toBe(17);
    expect(previewEffectiveWait(rule, 61)).toBe(17);
    expect(previewEffectiveWait(rule, 1)).toBeNull();
    expect(previewEffectiveWait({ ...rule, highWaitSeconds: 0 }, 1)).toBe(0);
  });
  it.each([null, undefined, -1, 60, 61, 1.5, NaN, Infinity])(
    'từ chối nhánh khẩn cấp không hợp lệ %s',
    (seconds) => {
      expect(isValidHighWaitSeconds(seconds, 60)).toBe(false);
    },
  );
  it.each([0, 17, 59])('chấp nhận nhánh khẩn cấp nhỏ hơn T_wait: %s', (seconds) => {
    expect(isValidHighWaitSeconds(seconds, 60)).toBe(true);
  });
  it('không rút ngắn rule skipLoggedOnly và WELLNESS', () => {
    expect(
      previewEffectiveWait({ ...rule, eventType: 'FIRE_SMOKE_DETECTED', skipLoggedOnly: true }, 30),
    ).toBe(30);
    expect(
      previewEffectiveWait(
        { ...rule, eventType: 'WELLNESS_TIMEOUT', tLow: null, tHigh: null },
        300,
      ),
    ).toBe(300);
  });
  it('mọi nút chọn nhanh nằm trong giới hạn API', () => {
    expect(WAIT_PRESETS.every((preset) => isValidWaitSeconds(preset.seconds))).toBe(true);
  });
});
