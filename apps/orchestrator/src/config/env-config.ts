import type { ConfigService } from '@nestjs/config';

/** Reads a positive numeric env var, falling back when unset, blank, or non-positive. */
export function readPositiveConfigNumber(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Reads a non-empty string env var, falling back when unset or whitespace-only. */
export function readNonEmptyConfigString(
  config: ConfigService,
  key: string,
  fallback: string,
): string {
  const raw = config.get<string>(key);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : fallback;
}
