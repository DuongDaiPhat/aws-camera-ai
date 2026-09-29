import type { EscalationRule } from './escalation-rules-client';

export const MIN_WAIT_SECONDS = 1;
export const MAX_WAIT_SECONDS = 3600;
export const WAIT_PRESETS = [
  { seconds: 30, label: '30 giây' },
  { seconds: 60, label: '1 phút' },
  { seconds: 120, label: '2 phút' },
  { seconds: 300, label: '5 phút' },
  { seconds: 600, label: '10 phút' },
] as const;

export function isValidWaitSeconds(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= MIN_WAIT_SECONDS && seconds <= MAX_WAIT_SECONDS;
}

export function usesShortenedWait(rule: EscalationRule): boolean {
  // US-13: FIRE skipLoggedOnly và WELLNESS không rút ngắn theo confidence.
  return !rule.skipLoggedOnly && typeof rule.tLow === 'number' && typeof rule.tHigh === 'number';
}

export function previewEffectiveWait(rule: EscalationRule, seconds: number): number | null {
  if (!isValidWaitSeconds(seconds)) return null;
  return usesShortenedWait(rule)
    ? isValidHighWaitSeconds(rule.highWaitSeconds, seconds)
      ? (rule.highWaitSeconds ?? null)
      : null
    : seconds;
}

export function isValidHighWaitSeconds(
  seconds: number | null | undefined,
  tWaitSeconds: number,
): boolean {
  return (
    typeof seconds === 'number' &&
    Number.isInteger(seconds) &&
    seconds >= 0 &&
    seconds < tWaitSeconds
  );
}
