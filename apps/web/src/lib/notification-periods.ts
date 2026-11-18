export const NOTIFICATION_STATES = [
  { value: 'pending', label: 'Chưa xử lý' },
  { value: 'logged', label: 'Chỉ ghi nhận' },
  { value: 'done', label: 'Đã xử lý' },
] as const;

export type NotificationState = 'all' | (typeof NOTIFICATION_STATES)[number]['value'];
export type Bounds = { from?: number; to: number };
export type ClockRange = { from: string; to: string };
const SECOND = 1000;

export function dayStart(now: number, daysAgo = 0): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysAgo).getTime();
}

export function todayWindow(now: number, hours = 0): Required<Bounds> {
  const from = dayStart(now);
  if (hours === 0) return { from, to: dayStart(now, -1) - 1 };
  const currentSecond = Math.floor(now / SECOND) * SECOND;
  return { from: Math.max(from, currentSecond - hours * 3600 * SECOND), to: currentSecond + 999 };
}

export function archiveWindow(now: number, days: number): Bounds {
  return { from: days === 0 ? undefined : dayStart(now, days), to: dayStart(now) - 1 };
}

export const notificationClock = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function timeOnDay(start: number, clock: string) {
  const parts = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(clock);
  if (!parts) return NaN;
  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  const seconds = Number(parts[3]);
  if (hours >= 24 || minutes >= 60 || seconds >= 60) return NaN;
  return new Date(start).setHours(hours, minutes, seconds, 0);
}

export function manualWindow(
  start: number,
  window: Required<Bounds>,
  values: ClockRange,
): { bounds: Required<Bounds> } | { error: string } {
  const from = timeOnDay(start, values.from);
  const to = timeOnDay(start, values.to);
  if (!Number.isFinite(from) || !Number.isFinite(to))
    return { error: 'Nhập giờ theo định dạng 24 giờ.' };
  if (from > to) return { error: 'Giờ kết thúc phải cùng lúc hoặc sau giờ bắt đầu.' };
  if (from < window.from || to > window.to) {
    return { error: 'Chọn giờ nằm trong khoảng của bộ lọc hiện tại.' };
  }
  return { bounds: { from, to: Math.min(window.to, to + 999) } };
}

export function notificationQuery(
  bounds: Bounds,
  pageSize: number,
  eventType = '',
  state: NotificationState = 'all',
): string {
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    to: new Date(bounds.to).toISOString().replace('.999Z', '.999999Z'),
  });
  if (bounds.from !== undefined) params.set('from', new Date(bounds.from).toISOString());
  if (eventType) params.set('eventType', eventType);
  if (state !== 'all') params.set('notificationState', state);
  return params.toString();
}
