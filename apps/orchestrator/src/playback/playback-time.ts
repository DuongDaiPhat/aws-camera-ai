import { BadRequestException } from '@nestjs/common';
const DAY_MS = 86_400_000;
export function dateInZone(epoch: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epoch);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return value('year').padStart(4, '0') + '-' + value('month') + '-' + value('day');
}
// Search for the first instant of a calendar day. This preserves 23/25-hour DST days.
export function recordingDayBounds(date: string, timeZone: string): { start: number; end: number } {
  const utc = Date.parse(date + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(utc) ||
    new Date(utc).toISOString().slice(0, 10) !== date
  )
    throw new BadRequestException('Ngày không hợp lệ.');
  const order = (key: string): number => {
    const [year, month, day] = key.split('-').map(Number);
    return year * 10000 + month * 100 + day;
  };
  const firstInstant = (key: string, center: number): number => {
    let low = center - 2 * DAY_MS,
      high = center + 2 * DAY_MS;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (order(dateInZone(mid, timeZone)) < order(key)) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const start = firstInstant(date, utc);
  if (dateInZone(start, timeZone) !== date)
    throw new BadRequestException('Ngày này không tồn tại trong múi giờ camera.');
  const followingDay = new Date(utc + DAY_MS);
  const next =
    followingDay.getUTCFullYear() +
    '-' +
    String(followingDay.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(followingDay.getUTCDate()).padStart(2, '0');
  return { start: start / 1000, end: firstInstant(next, utc + DAY_MS) / 1000 };
}
