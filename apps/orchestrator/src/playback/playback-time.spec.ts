import { recordingDayBounds } from './playback-time';
describe('Camera-local recording days', () => {
  it('keeps the last selectable four-digit year ordered correctly', () => {
    const bounds = recordingDayBounds('9999-12-31', 'UTC');
    expect(bounds.end - bounds.start).toBe(86400);
  });
  it('uses Vietnam midnight rather than browser/UTC midnight', () => {
    const b = recordingDayBounds('2026-11-16', 'Asia/Ho_Chi_Minh');
    expect(new Date(b.start * 1000).toISOString()).toBe('2026-11-15T17:00:00.000Z');
    expect(b.end - b.start).toBe(86400);
  });
  it.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('preserves DST on %s', (date, hours) => {
    const b = recordingDayBounds(date, 'America/New_York');
    expect(b.end - b.start).toBe(hours * 3600);
  });
  it.each(['2026-02-30', '2026-13-01', 'not-a-date'])('rejects %s', (date) =>
    expect(() => recordingDayBounds(date, 'UTC')).toThrow(),
  );
});
