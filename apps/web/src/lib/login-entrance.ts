// A short-lived, one-use visual cue. It never contains authentication data.
const KEY = 'cameraai.login-entrance';
const MAX_AGE = 120_000;
let fallback: string | null = null;

export function markLoginEntrance(): void {
  const value = JSON.stringify({
    at: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  fallback = value;
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    /* Client-side navigation can use the in-memory cue. */
  }
}

export function consumeLoginEntrance(): string | null {
  let value = fallback;
  fallback = null;
  try {
    value = sessionStorage.getItem(KEY) ?? value;
    sessionStorage.removeItem(KEY);
  } catch {
    /* Fall back to memory when storage is unavailable. */
  }
  try {
    const record: unknown = JSON.parse(value ?? 'null');
    if (!record || typeof record !== 'object') return null;
    const { at, id } = record as Record<string, unknown>;
    return typeof at === 'number' &&
      typeof id === 'string' &&
      Date.now() >= at &&
      Date.now() - at <= MAX_AGE
      ? id
      : null;
  } catch {
    return null;
  }
}
