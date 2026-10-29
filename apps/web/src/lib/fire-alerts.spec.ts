import { describe, expect, it } from 'vitest';
import {
  canInterruptFire,
  nextUnreviewedFire,
  fireReviewKey,
  reconcileFireReceipts,
  rememberFireAttention,
} from './fire-alerts';
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
  });
}

describe('fire attention policy', () => {
  it('uses confirmed urgency without equating confidence with fire size', () => {
    expect(nextUnreviewedFire([event('low')], [], NOW)?.id).toBe('low');
    expect(
      nextUnreviewedFire([event('high', 'NOTIFIED', undefined, undefined, 0.99)], [], NOW)?.id,
    ).toBe('high');
  });
  it('allows a 09:00 fire until 12:00, then never interrupts again for that event', () => {
    const atNine = event('nine', 'ESCALATED', Date.parse('2026-10-27T02:00:00Z'));
    expect(canInterruptFire(atNine, Date.parse('2026-10-27T04:59:59.999Z'))).toBe(true);
    expect(canInterruptFire(atNine, Date.parse('2026-10-27T05:00:00Z'))).toBe(false);
    expect(nextUnreviewedFire([atNine], [], Date.parse('2026-10-27T13:00:00Z'))).toBeNull();
    expect(atNine.status).toBe('ESCALATED');
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
  it('prioritizes escalated fresh incidents over other cameras', () => {
    expect(
      nextUnreviewedFire([event('waiting'), event('urgent', 'ESCALATED', undefined, 'b')], [], NOW)
        ?.id,
    ).toBe('urgent');
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
