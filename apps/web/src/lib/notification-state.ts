import type { UIEventItem } from '@/types';
import type { NotificationState } from './notification-periods';
import { FIRE_ATTENTION_MAX_AGE_MS } from './fire-ui-config';

const OTHER_NOTIFICATION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function notificationExpiresAt(event: UIEventItem): number {
  const lifetime =
    event.priority === 'P0' ? FIRE_ATTENTION_MAX_AGE_MS : OTHER_NOTIFICATION_MAX_AGE_MS;
  return Date.parse(event.detectedAt) + lifetime;
}

export function notificationState(
  event: UIEventItem,
  now = Date.now(),
): Exclude<NotificationState, 'all'> {
  if (event.status === 'LOGGED_ONLY') return 'logged';
  if (
    event.status === 'RESOLVED' ||
    event.status === 'CLOSED' ||
    event.isFalseAlarm ||
    now >= notificationExpiresAt(event)
  )
    return 'done';
  return 'pending';
}

export function isPriorityNotification(event: UIEventItem, now = Date.now()): boolean {
  return (
    event.priority !== 'P3' &&
    Date.parse(event.detectedAt) <= now &&
    event.status !== 'AI_FAILED' &&
    notificationState(event, now) === 'pending'
  );
}

export function nextNotificationExpiry(events: UIEventItem[], now: number): number {
  return events.reduce((next, event) => {
    if (notificationState(event, now) !== 'pending') return next;
    const expiry = notificationExpiresAt(event);
    return expiry > now ? Math.min(next, expiry) : next;
  }, Infinity);
}
