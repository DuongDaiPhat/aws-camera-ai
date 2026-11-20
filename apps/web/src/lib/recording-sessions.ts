import type { RecordingSegment, PlaybackMetadata } from '@/types';
export interface RecordingSession {
  id: string;
  startAt: string;
  endAt: string;
  segments: RecordingSegment[];
}
// Adjacent encoder files can be separated by a frame boundary, not a source outage.
const CONTIGUOUS_MS = 500;
const END_GROWTH_MS = 1;
export function recordingSessions(
  segments: RecordingSegment[],
  timeZone = 'UTC',
): RecordingSession[] {
  const sessions: RecordingSession[] = [];
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    minute: '2-digit',
    second: '2-digit',
  });
  for (const segment of [...segments].sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
  )) {
    let at = Date.parse(segment.startAt);
    const end = Date.parse(segment.endAt);
    while (at < end) {
      const parts = formatter.formatToParts(at);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0),
        second = Number(parts.find((part) => part.type === 'second')?.value ?? 0);
      const hourStart = at - (minute * 60 + second) * 1000 - new Date(at).getUTCMilliseconds(),
        to = Math.min(end, hourStart + 3600000);
      const previous = sessions.at(-1);
      const piece = {
        ...segment,
        startAt: new Date(at).toISOString(),
        endAt: new Date(to).toISOString(),
        durationSeconds: (to - at) / 1000,
      };
      // Hour bookmarks are navigation within continuous footage, never invented recording gaps.
      if (
        previous &&
        Date.parse(piece.startAt) <= Date.parse(previous.endAt) + CONTIGUOUS_MS &&
        Date.parse(previous.startAt) >= hourStart
      ) {
        previous.endAt = piece.endAt;
        previous.segments.push(piece);
      } else
        sessions.push({
          id: piece.startAt,
          startAt: piece.startAt,
          endAt: piece.endAt,
          segments: [piece],
        });
      at = to;
    }
  }
  return sessions;
}
export function nextRecording(segments: RecordingSegment[], current: RecordingSegment) {
  const end = Date.parse(current.endAt);
  const continuation = segments.find(
    (item) => Date.parse(item.startAt) <= end && Date.parse(item.endAt) > end + END_GROWTH_MS,
  );
  if (continuation)
    return {
      segment: continuation,
      seekSeconds: (end - Date.parse(continuation.startAt)) / 1000,
      contiguous: true,
    };
  const segment = segments.find(
    (item) => Date.parse(item.startAt) >= end - CONTIGUOUS_MS && item.id !== current.id,
  );
  return segment
    ? { segment, seekSeconds: 0, contiguous: Date.parse(segment.startAt) - end <= CONTIGUOUS_MS }
    : null;
}
export function historicalBoxes(metadata: PlaybackMetadata | null, at: number) {
  if (!metadata) return [];
  // Person samples and confirmed incident frames have independent clocks; never keep a stale box.
  const nearest = metadata.frames
    .filter((frame) => frame.boxes.every((box) => box.label === 'person'))
    .reduce<PlaybackMetadata['frames'][number] | null>(
      (best, frame) =>
        Math.abs(Date.parse(frame.at) - at) < Math.abs((best ? Date.parse(best.at) : Infinity) - at)
          ? frame
          : best,
      null,
    );
  const people =
    nearest && Math.abs(Date.parse(nearest.at) - at) <= metadata.toleranceMs ? nearest.boxes : [];
  const incidents = metadata.frames
    .filter(
      (frame) =>
        frame.boxes.some((box) => box.label !== 'person') &&
        Math.abs(Date.parse(frame.at) - at) <= metadata.toleranceMs,
    )
    .flatMap((frame) => frame.boxes);
  return [...people, ...incidents];
}

export function recordingDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return total + ' giây';
  const hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60);
  return (
    [hours ? hours + ' giờ' : '', minutes ? minutes + ' phút' : ''].filter(Boolean).join(' ') ||
    '1 phút'
  );
}
