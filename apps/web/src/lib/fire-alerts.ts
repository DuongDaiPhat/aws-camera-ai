import type { UIEventItem } from '@/types';
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

export function isActiveFire(event: UIEventItem): boolean {
  return (
    event.eventType === 'FIRE_SMOKE_DETECTED' &&
    event.priority === 'P0' &&
    ['DETECTED', 'NOTIFIED', 'ESCALATED'].includes(event.status)
  );
}

export function canInterruptFire(event: UIEventItem, now = Date.now()): boolean {
  const age = now - Date.parse(event.detectedAt);
  return isActiveFire(event) && age >= 0 && age < FIRE_ATTENTION_MAX_AGE_MS;
}

/** An escalation update does not create a new fire episode. */
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
    .filter((event) => canInterruptFire(event, now))
    .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
  for (const event of ordered) {
    const at = Date.parse(event.detectedAt);
    const next: FireEpisode = {
      cameraId: event.camera?.id ?? `event:${event.id}`,
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
    if (event.status === 'ESCALATED' || prior.event.status !== 'ESCALATED') prior.event = event;
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
      (item) =>
        item.lastDetectedAt >= now - FIRE_ATTENTION_MAX_AGE_MS - FIRE_ATTENTION_EPISODE_GAP_MS,
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
          Number(b.event.status === 'ESCALATED') - Number(a.event.status === 'ESCALATED') ||
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
  return [
    ...retained,
    {
      cameraId: episode.cameraId,
      eventIds: episode.eventIds,
      firstDetectedAt: episode.firstDetectedAt,
      lastDetectedAt: episode.lastDetectedAt,
      shownAt: now,
    },
  ];
}
