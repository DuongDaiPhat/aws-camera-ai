import type { components } from '@cam/contracts';
export type PlaybackBox = components['schemas']['PlaybackBox'];
export interface ArchiveFrame {
  slug: string;
  at: number;
  boxes: unknown[];
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function normalizedBox(
  value: unknown,
  label: PlaybackBox['label'],
  confidence: unknown,
): PlaybackBox | null {
  if (
    !isRecord(value) ||
    !unit(value.x) ||
    !unit(value.y) ||
    !unit(value.width) ||
    !unit(value.height) ||
    value.width <= 0 ||
    value.height <= 0 ||
    value.x + value.width > 1 ||
    value.y + value.height > 1 ||
    !unit(confidence)
  )
    return null;
  return { label, x: value.x, y: value.y, width: value.width, height: value.height, confidence };
}
export function archiveFrame(value: unknown, now: number, maxAgeMs: number): ArchiveFrame | null {
  if (
    !isRecord(value) ||
    typeof value.camera !== 'string' ||
    !/^([a-z][a-z0-9_]{2,63})$/.test(value.camera) ||
    typeof value.frameTime !== 'number' ||
    !Number.isFinite(value.frameTime) ||
    !Array.isArray(value.objects)
  )
    return null;
  const at =
    value.frameTime < 1e11 ? Math.round(value.frameTime * 1000) : Math.round(value.frameTime);
  if (at < now - maxAgeMs || at > now) return null;
  return { slug: value.camera, at, boxes: value.objects.slice(0, 100) };
}
export function personBoxes(
  frame: ArchiveFrame,
  width: number,
  height: number,
  toleranceMs: number,
): PlaybackBox[] {
  if (width <= 0 || height <= 0) return [];
  return frame.boxes.flatMap((raw) => {
    if (
      !isRecord(raw) ||
      raw.label !== 'person' ||
      !Array.isArray(raw.box) ||
      raw.box.length !== 4 ||
      !raw.box.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      typeof raw.observedAt !== 'number'
    )
      return [];
    const observed = raw.observedAt < 1e11 ? raw.observedAt * 1000 : raw.observedAt;
    if (Math.abs(observed - frame.at) > toleranceMs) return [];
    const [x1, y1, x2, y2] = raw.box as number[];
    const box = normalizedBox(
      { x: x1 / width, y: y1 / height, width: (x2 - x1) / width, height: (y2 - y1) / height },
      'person',
      raw.score,
    );
    return box ? [box] : [];
  });
}
