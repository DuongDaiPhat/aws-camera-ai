import { describe, expect, it } from 'vitest';
import {
  alertEmphasis,
  canInterruptFire,
  nextUnreviewedFire,
  fireReviewKey,
  reconcileFireReceipts,
  rememberFireAttention,
} from './fire-alerts';
import { notificationState } from './notification-state';
import { toUIEventItem } from './events-client';

const NOW = Date.parse('2026-10-27T10:00:00Z');
function event(
  id: string,
  status: 'NOTIFIED' | 'ESCALATED' | 'RESOLVED' = 'NOTIFIED',
  at = NOW - 60000,
  cameraId = 'camera-a',
  confidence = 0.51,
) {
  return toUIEventItem({
    id,
    status,
    confidence,
    eventType: 'FIRE_SMOKE_DETECTED',
    priority: 'P0',
    camera: { id: cameraId, name: cameraId },
    detectedAt: new Date(at).toISOString(),
    escalationDeadlineAt: new Date(at + 900000).toISOString(),
  });
}

describe('fire attention policy', () => {
  it('uses confirmed urgency without equating confidence with fire size', () => {
    expect(nextUnreviewedFire([event('low')], [], NOW)?.id).toBe('low');
    expect(
      nextUnreviewedFire([event('high', 'NOTIFIED', undefined, undefined, 0.99)], [], NOW)?.id,
    ).toBe('high');
  });
  it('allows interruption through hour three even after escalation', () => {
    const nine = Date.parse('2026-10-27T02:00:00Z');
    const noon = Date.parse('2026-10-27T05:00:00Z');
    const alert = { ...event('nine', 'ESCALATED', nine), escalationDeadlineAt: null };
    expect(canInterruptFire(alert, noon - 1)).toBe(true);
    expect(canInterruptFire(alert, noon)).toBe(false);
    expect(alertEmphasis(alert, noon)).toBeUndefined();
    expect(notificationState(alert, noon)).toBe('done');
    expect(alert.status).toBe('ESCALATED');
    expect(nextUnreviewedFire([alert], [], noon)).toBeNull();
  });
  it('applies an eight-hour window to P1/P2 and stops priority when manually handled', () => {
    const at = NOW - 8 * 60 * 60 * 1000;
    for (const priority of ['P1', 'P2'] as const) {
      const alert = { ...event('other', 'ESCALATED', at), priority };
      expect(alertEmphasis(alert, NOW - 1)).toBe('priority');
      expect(notificationState(alert, NOW - 1)).toBe('pending');
      expect(alertEmphasis(alert, NOW)).toBeUndefined();
      expect(notificationState(alert, NOW)).toBe('done');
      expect(alertEmphasis({ ...alert, status: 'RESOLVED' }, NOW - 1)).toBeUndefined();
    }
    expect(
      notificationState({ ...event('info', 'NOTIFIED', at), status: 'LOGGED_ONLY' }, NOW),
    ).toBe('logged');
  });
  it('ignores terminal, future and malformed timestamps', () => {
    expect(
      nextUnreviewedFire(
        [
          event('safe', 'RESOLVED'),
          event('future', 'NOTIFIED', NOW + 1),
          { ...event('invalid'), detectedAt: 'invalid' },
        ],
        [],
        NOW,
      ),
    ).toBeNull();
  });
  it('prioritizes an actionable P0 alert even when it is not fire', () => {
    const oldEscalated = event('escalated', 'ESCALATED', NOW - 10800001, 'b');
    const fall = { ...event('fall'), eventType: 'FALL_DETECTED' as const };
    expect(nextUnreviewedFire([oldEscalated, fall], [], NOW)?.id).toBe('fall');
    expect(canInterruptFire(fall, NOW)).toBe(false);
    expect(alertEmphasis(fall, NOW)).toBe('urgent');
  });
  it('never reopens the same event after escalation or persisted-state restoration', () => {
    const first = event('same');
    const receipts = rememberFireAttention([first], first, [], NOW);
    const restored = JSON.parse(JSON.stringify(receipts));
    const escalated = { ...first, status: 'ESCALATED' as const };
    expect(fireReviewKey(first)).toBe(fireReviewKey(escalated));
    expect(nextUnreviewedFire([escalated], restored, NOW)).toBeNull();
  });
  it('groups nearby events on the same camera into one interruption', () => {
    const first = event('first', 'NOTIFIED', NOW - 240000);
    const second = event('second');
    const receipts = rememberFireAttention([first], first, [], NOW);
    expect(nextUnreviewedFire([second], receipts, NOW)).toBeNull();
    expect(
      nextUnreviewedFire([event('other-camera', 'NOTIFIED', undefined, 'b')], receipts, NOW)?.id,
    ).toBe('other-camera');
    expect(
      nextUnreviewedFire([event('later', 'NOTIFIED', NOW + 60001)], receipts, NOW + 60001)?.id,
    ).toBe('later');
  });
  it('extends the episode through a chain of continued detections', () => {
    const first = event('first', 'NOTIFIED', NOW - 600000);
    const middle = event('middle', 'NOTIFIED', NOW - 360000);
    const latest = event('latest', 'NOTIFIED', NOW - 120000);
    const receipts = rememberFireAttention([first], first, [], NOW);
    const extended = reconcileFireReceipts([middle, latest], receipts, NOW);
    expect(nextUnreviewedFire([latest], extended, NOW)).toBeNull();
    expect(extended[0]?.eventIds).toContain('latest');
  });
});
