/** Browser polling budgets; media URLs expire independently of event state. */
function milliseconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 1000 ? parsed : fallback;
}

export const FIRE_DETAIL_REFRESH_MS = milliseconds(
  process.env.NEXT_PUBLIC_FIRE_DETAIL_REFRESH_MS,
  30000,
);
export const FIRE_DETAIL_RETRY_MS = milliseconds(
  process.env.NEXT_PUBLIC_FIRE_DETAIL_RETRY_MS,
  3000,
);
export const FIRE_ATTENTION_POLL_MS = milliseconds(
  process.env.NEXT_PUBLIC_FIRE_ATTENTION_POLL_MS,
  10000,
);
export const EVENTS_REFRESH_MS = milliseconds(process.env.NEXT_PUBLIC_EVENTS_REFRESH_MS, 60000);
export const FIRE_ATTENTION_MAX_AGE_MS = milliseconds(
  process.env.NEXT_PUBLIC_FIRE_ATTENTION_MAX_AGE_MS,
  3 * 60 * 60 * 1000,
);
export const FIRE_ATTENTION_EPISODE_GAP_MS = milliseconds(
  process.env.NEXT_PUBLIC_FIRE_ATTENTION_EPISODE_GAP_MS,
  5 * 60 * 1000,
);
export const FIRE_EMERGENCY_PHONE = '114';
