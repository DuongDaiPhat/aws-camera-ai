import type { RecordingSegment } from '@/types';

export interface TimeRange {
  start: number;
  end: number;
}
export const ENCODER_GAP_MS = 500;
export const SECOND = 1000;
export const HOUR = 3600000;

export function recordingCoverage(segments: RecordingSegment[]): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const segment of [...segments].sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
  )) {
    const start = Date.parse(segment.startAt),
      end = Date.parse(segment.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end + ENCODER_GAP_MS)
      previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}

export function recordingAt(segments: RecordingSegment[], at: number) {
  const exact = segments.find(
    (segment) => Date.parse(segment.startAt) <= at && at < Date.parse(segment.endAt),
  );
  if (exact) return exact;
  // A sub-frame encoder boundary is part of continuous coverage, not a real outage.
  return (
    segments.find(
      (segment) =>
        Date.parse(segment.startAt) > at &&
        Date.parse(segment.startAt) - at <= ENCODER_GAP_MS &&
        segments.some(
          (previous) =>
            Date.parse(previous.endAt) <= at && at - Date.parse(previous.endAt) <= ENCODER_GAP_MS,
        ),
    ) ?? null
  );
}

export function clampTime(at: number, range: TimeRange) {
  return Math.max(range.start, Math.min(range.end - 1, at));
}

export function zoomRange(bounds: TimeRange, center: number, duration: number): TimeRange {
  const span = Math.min(bounds.end - bounds.start, duration);
  const start = Math.max(bounds.start, Math.min(bounds.end - span, center - span / 2));
  return { start, end: start + span };
}

export function timelinePercent(at: number, range: TimeRange) {
  return Math.max(0, Math.min(100, ((at - range.start) / (range.end - range.start)) * 100));
}

function wallSeconds(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return number('hour') * 3600 + number('minute') * 60 + number('second');
}

// Derive candidates from the server's actual day bounds; DST days need not be 24 hours.
export function wallTimeToEpoch(value: string, bounds: TimeRange, timeZone: string): number | null {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const [hours, minutes, seconds = 0] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const desired = hours * 3600 + minutes * 60 + seconds;
  for (let sample = bounds.start; sample < bounds.end; sample += HOUR) {
    const candidate = sample + (desired - wallSeconds(sample, timeZone)) * SECOND;
    if (
      candidate >= bounds.start &&
      candidate < bounds.end &&
      wallSeconds(candidate, timeZone) === desired
    )
      return candidate;
  }
  return null;
}
