import { describe, it, expect } from 'vitest';
import { findRecordingAt, localDateKey } from './playback-client';
import type { RecordingSegment } from '@/types';
const segments: RecordingSegment[] = [
  {
    id: 'first',
    startAt: '2026-11-16T15:07:50.000Z',
    endAt: '2026-11-16T15:08:00.000Z',
    durationSeconds: 10,
    hasMotion: true,
  },
  {
    id: 'next',
    startAt: '2026-11-16T15:08:03.000Z',
    endAt: '2026-11-16T15:08:13.000Z',
    durationSeconds: 10,
    hasMotion: false,
  },
];
describe('Finding historical footage', () => {
  it('finds the camera-local time with an offset into the recording', () => {
    expect(findRecordingAt(segments, '22:07:55', 'Asia/Ho_Chi_Minh')).toEqual({
      segment: segments[0],
      seekSeconds: 5,
    });
  });
  it('keeps a gap empty instead of silently jumping ahead', () => {
    expect(findRecordingAt(segments, '22:08:01', 'Asia/Ho_Chi_Minh')).toBeNull();
  });
  it('does not treat an exclusive end as recorded', () => {
    expect(findRecordingAt(segments, '22:08:00', 'Asia/Ho_Chi_Minh')).toBeNull();
  });
  it('keeps the chosen calendar date independent of UTC conversion', () => {
    expect(localDateKey(new Date(2026, 10, 16, 0))).toBe('2026-11-16');
  });
});
