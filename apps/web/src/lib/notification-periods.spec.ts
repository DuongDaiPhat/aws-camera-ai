import { expect, it } from 'vitest';
import {
  archiveWindow,
  manualWindow,
  notificationQuery,
  todayWindow,
} from './notification-periods';

it('clamps the last 12 hours to today just after local midnight and keeps history disjoint', () => {
  const midnight = new Date(2026, 0, 1).getTime();
  const now = new Date(2026, 0, 1, 0, 1).getTime();
  expect(todayWindow(now, 12)).toEqual({ from: midnight, to: now + 999 });
  expect(archiveWindow(now, 1)).toEqual({
    from: new Date(2025, 11, 31).getTime(),
    to: midnight - 1,
  });
});

it('includes the entire chosen final second without passing the day boundary', () => {
  const start = new Date(2026, 3, 12).getTime();
  const bounds = todayWindow(start);
  const result = manualWindow(start, bounds, { from: '23:59:59', to: '23:59:59' });
  expect(result).toEqual({ bounds: { from: bounds.to - 999, to: bounds.to } });
  const params = new URLSearchParams(notificationQuery(bounds, 1));
  expect(params.get('to')?.endsWith('.999999Z')).toBe(true);
});
