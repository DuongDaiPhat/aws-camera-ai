import type { UIEventItem } from '@/types';
import { isPriorityNotification, notificationExpiresAt } from './notification-state';
import { FIRE_ATTENTION_MAX_AGE_MS, FIRE_ATTENTION_EPISODE_GAP_MS } from './fire-ui-config';

export interface FireAttentionReceipt {
  cameraId: string;
  eventIds: string[];
  firstDetectedAt: number;
  lastDetectedAt: number;
  shownAt: number;
}
interface FireEpisode extends FireAttentionReceipt {
  event: UIEventItem;
}

function isPendingPriority(event: UIEventItem): boolean {
  return !event.isFalseAlarm && ['DETECTED', 'NOTIFIED', 'ESCALATED'].includes(event.status);
}

export function isActiveFire(event: UIEventItem): boolean {
  return (
    event.eventType === 'FIRE_SMOKE_DETECTED' && event.priority === 'P0' && isPendingPriority(event)
  );
}

/**
 * Active fire events require mandatory operator handling and cannot be dismissed or
 * suppressed by earlier receipts while the operator still has an available resolution action.
 */
export function isMandatoryFireAlert(event: UIEventItem, canCloseEmergency = true): boolean {
  if (!isActiveFire(event)) return false;
  if (event.status === 'DETECTED' || event.status === 'NOTIFIED') return true;
  return event.status === 'ESCALATED' && canCloseEmergency;
}

export function nextMandatoryFire(
  events: UIEventItem[],
  now = Date.now(),
  canCloseEmergency = true,
): UIEventItem | null {
  return (
    events
      .filter(
        (event) =>
          isMandatoryFireAlert(event, canCloseEmergency) && canInterruptCriticalAlert(event, now),
      )
      .sort(
        (a, b) =>
          (criticalAlertDeadline(a) ?? Infinity) - (criticalAlertDeadline(b) ?? Infinity) ||
          Date.parse(b.detectedAt) - Date.parse(a.detectedAt),
      )[0] ?? null
  );
}

export function criticalAlertDeadline(event: UIEventItem): number | null {
  if (event.priority !== 'P0' || !isPendingPriority(event)) return null;
  const until = notificationExpiresAt(event);
  return Number.isFinite(until) ? until : null;
}

export function canInterruptCriticalAlert(event: UIEventItem, now = Date.now()): boolean {
  const deadline = criticalAlertDeadline(event);
  return deadline !== null && Date.parse(event.detectedAt) <= now && now < deadline;
}

export function canInterruptFire(event: UIEventItem, now = Date.now()): boolean {
  return isActiveFire(event) && canInterruptCriticalAlert(event, now);
}

export function alertEmphasis(
  event: UIEventItem,
  now = Date.now(),
): 'urgent' | 'priority' | undefined {
  if (!isPriorityNotification(event, now)) return undefined;
  return event.priority === 'P0' ? 'urgent' : 'priority';
}

export function alertEmphasisRank(event: UIEventItem, now: number): number {
  if (!isPriorityNotification(event, now)) return 0;
  return event.priority === 'P0' ? 3 : event.priority === 'P1' ? 2 : 1;
}

/** An escalation update does not create a new incident or reopen its interruption. */
export function fireReviewKey(event: UIEventItem): string {
  return event.id;
}

function overlaps(a: FireAttentionReceipt, b: FireAttentionReceipt): boolean {
  return (
    a.eventIds.some((id) => b.eventIds.includes(id)) ||
    (a.cameraId === b.cameraId &&
      a.firstDetectedAt <= b.lastDetectedAt + FIRE_ATTENTION_EPISODE_GAP_MS &&
      b.firstDetectedAt <= a.lastDetectedAt + FIRE_ATTENTION_EPISODE_GAP_MS)
  );
}

function fireEpisodes(events: UIEventItem[], now: number): FireEpisode[] {
  const episodes: FireEpisode[] = [];
  const ordered = events
    .filter((event) => canInterruptCriticalAlert(event, now))
    .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
  for (const event of ordered) {
    const at = Date.parse(event.detectedAt);
    const next: FireEpisode = {
      cameraId:
        (event.eventType === 'FIRE_SMOKE_DETECTED' ? event.camera?.id : undefined) ??
        `event:${event.id}`,
      eventIds: [event.id],
      firstDetectedAt: at,
      lastDetectedAt: at,
      shownAt: now,
      event,
    };
    const prior = episodes.find((episode) => overlaps(episode, next));
    if (!prior) {
      episodes.push(next);
      continue;
    }
    prior.eventIds.push(event.id);
    prior.lastDetectedAt = at;
    if (criticalAlertDeadline(event)! < criticalAlertDeadline(prior.event)!) prior.event = event;
  }
  return episodes;
}

/** Extend known episodes so continued detections do not reopen an interruption. */
export function reconcileFireReceipts(
  events: UIEventItem[],
  receipts: readonly FireAttentionReceipt[],
  now = Date.now(),
): FireAttentionReceipt[] {
  const episodes = fireEpisodes(events, now);
  return receipts
    .filter(
      (receipt) =>
        receipt.lastDetectedAt >= now - FIRE_ATTENTION_MAX_AGE_MS - FIRE_ATTENTION_EPISODE_GAP_MS ||
        episodes.some((episode) => overlaps(episode, receipt)),
    )
    .map((receipt) => {
      const matches = episodes.filter((episode) => overlaps(episode, receipt));
      return {
        ...receipt,
        eventIds: [...new Set([...receipt.eventIds, ...matches.flatMap((item) => item.eventIds)])],
        firstDetectedAt: Math.min(
          receipt.firstDetectedAt,
          ...matches.map((item) => item.firstDetectedAt),
        ),
        lastDetectedAt: Math.max(
          receipt.lastDetectedAt,
          ...matches.map((item) => item.lastDetectedAt),
        ),
      };
    });
}

export function nextUnreviewedFire(
  events: UIEventItem[],
  receipts: readonly FireAttentionReceipt[],
  now = Date.now(),
): UIEventItem | null {
  return (
    fireEpisodes(events, now)
      .filter((episode) => !receipts.some((receipt) => overlaps(episode, receipt)))
      .sort(
        (a, b) =>
          criticalAlertDeadline(a.event)! - criticalAlertDeadline(b.event)! ||
          b.lastDetectedAt - a.lastDetectedAt,
      )[0]?.event ?? null
  );
}

export function rememberFireAttention(
  events: UIEventItem[],
  event: UIEventItem,
  receipts: readonly FireAttentionReceipt[],
  now = Date.now(),
): FireAttentionReceipt[] {
  const episode = fireEpisodes(events, now).find((item) => item.eventIds.includes(event.id));
  const retained = reconcileFireReceipts(events, receipts, now);
  if (!episode || retained.some((receipt) => overlaps(receipt, episode))) return retained;
  const { event: _event, ...receipt } = episode;
  return [...retained, receipt];
}
