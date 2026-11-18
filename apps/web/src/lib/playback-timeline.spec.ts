import { describe, expect, it } from 'vitest';
import type { RecordingSegment } from '@/types';
import {
  recordingAt,
  recordingCoverage,
  timelinePercent,
  wallTimeToEpoch,
  zoomRange,
  HOUR,
} from './playback-timeline';
const segment = (id: string, start: number, end: number): RecordingSegment => ({
  id,
  startAt: new Date(start).toISOString(),
  endAt: new Date(end).toISOString(),
  durationSeconds: (end - start) / 1000,
  hasMotion: false,
});
describe('surveillance coverage and seeking', () => {
  it('merges encoder boundaries and overlaps but keeps real outages blank', () => {
    expect(
      recordingCoverage([
        segment('c', 20000, 30000),
        segment('a', 0, 10000),
        segment('b', 10078, 18000),
        segment('d', 25000, 40000),
      ]),
    ).toEqual([
      { start: 0, end: 18000 },
      { start: 20000, end: 40000 },
    ]);
  });
  it('does not reuse an old video frame when seeking into an outage', () => {
    const clips = [segment('a', 0, 10000), segment('b', 12000, 20000)];
    expect(recordingAt(clips, 11000)).toBeNull();
    expect(recordingAt(clips, 15000)?.id).toBe('b');
    expect(recordingAt(clips, 20000)).toBeNull();
  });
  it('resolves sub-frame encoder boundaries without pretending a real gap is covered', () => {
    const clips = [segment('a', 0, 10000), segment('b', 10078, 20000)];
    expect(recordingAt(clips, 10020)?.id).toBe('b');
  });
  it('keeps zoom inside the real camera day bounds', () => {
    const bounds = { start: 0, end: 23 * HOUR };
    expect(zoomRange(bounds, HOUR / 4, 6 * HOUR)).toEqual({ start: 0, end: 6 * HOUR });
    expect(zoomRange(bounds, 23 * HOUR, 6 * HOUR)).toEqual({ start: 17 * HOUR, end: 23 * HOUR });
    expect(timelinePercent(-100, bounds)).toBe(0);
    expect(timelinePercent(24 * HOUR, bounds)).toBe(100);
  });
  it('converts entered camera time, independently of the browser timezone', () => {
    const bounds = {
      start: Date.parse('2026-11-17T17:00:00Z'),
      end: Date.parse('2026-11-18T17:00:00Z'),
    };
    expect(wallTimeToEpoch('10:25:30', bounds, 'Asia/Ho_Chi_Minh')).toBe(
      Date.parse('2026-11-18T03:25:30Z'),
    );
    expect(wallTimeToEpoch('25:00', bounds, 'Asia/Ho_Chi_Minh')).toBeNull();
    expect(wallTimeToEpoch('10:90', bounds, 'Asia/Ho_Chi_Minh')).toBeNull();
  });
  it('rejects nonexistent daylight-saving times on a 23-hour day', () => {
    const bounds = {
      start: Date.parse('2026-03-08T05:00:00Z'),
      end: Date.parse('2026-03-09T04:00:00Z'),
    };
    expect(wallTimeToEpoch('02:30', bounds, 'America/New_York')).toBeNull();
    expect(wallTimeToEpoch('03:30', bounds, 'America/New_York')).toBe(
      Date.parse('2026-03-08T07:30:00Z'),
    );
  });
  it('uses the first occurrence when the camera day repeats an hour', () => {
    const bounds = {
      start: Date.parse('2026-11-01T04:00:00Z'),
      end: Date.parse('2026-11-02T05:00:00Z'),
    };
    expect(wallTimeToEpoch('01:30', bounds, 'America/New_York')).toBe(
      Date.parse('2026-11-01T05:30:00Z'),
    );
    expect(wallTimeToEpoch('23:59:59', bounds, 'America/New_York')).toBe(bounds.end - 1000);
  });
});
