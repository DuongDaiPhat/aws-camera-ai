import { queuePlayback } from './playback-queue';
import { apiFetch, apiFetchBlob } from './api-client';
import type { PlaybackCamera, PlaybackMetadata, RecordingDay, RecordingSegment } from '@/types';
export function listPlaybackCameras(signal: AbortSignal) {
  return apiFetch<{ data: PlaybackCamera[] }>('/playback/cameras', { signal });
}
export function getRecordingDay(cameraId: string, date: string, signal: AbortSignal) {
  return apiFetch<RecordingDay>(
    '/playback/cameras/' + cameraId + '/recordings?date=' + encodeURIComponent(date),
    { signal, cache: 'no-store' },
  );
}
export function getRecordingClip(cameraId: string, segment: RecordingSegment, signal: AbortSignal) {
  const query = new URLSearchParams({ startAt: segment.startAt, endAt: segment.endAt });
  return queuePlayback(
    () => apiFetchBlob('/playback/cameras/' + cameraId + '/clip?' + query, { signal }),
    signal,
  );
}
export function localDateKey(date: Date): string {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}
export function recordingTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
// Compare wall-clock time in the camera timezone, including days with repeated DST hours.
export function findRecordingAt(segments: RecordingSegment[], time: string, timeZone: string) {
  const [hour, minute, second = '0'] = time.split(':');
  const target = Number(hour) * 3600 + Number(minute) * 60 + Number(second);
  const toSecond = (iso: string) => {
    const [h, m, s] = recordingTime(iso, timeZone).split(':').map(Number);
    return h * 3600 + m * 60 + s;
  };
  for (const segment of segments) {
    const start = toSecond(segment.startAt) + new Date(segment.startAt).getUTCMilliseconds() / 1000,
      end = start + segment.durationSeconds;
    if (target >= start && target < end) return { segment, seekSeconds: target - start };
  }
  return null;
}

export function getPlaybackMetadata(
  cameraId: string,
  segment: RecordingSegment,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ startAt: segment.startAt, endAt: segment.endAt });
  return apiFetch<PlaybackMetadata>('/playback/cameras/' + cameraId + '/metadata?' + query, {
    signal,
  });
}
