import { describe, it, expect } from 'vitest';
import { recordingSessions, nextRecording, historicalBoxes } from './recording-sessions';
import type { RecordingSegment, PlaybackMetadata } from '@/types';
const segment = (id: string, start: number, end: number): RecordingSegment => ({
  id,
  startAt: new Date(start * 1000).toISOString(),
  endAt: new Date(end * 1000).toISOString(),
  durationSeconds: end - start,
  hasMotion: false,
});
describe('Continuous recording presentation', () => {
  it('adds hourly bookmarks for a full-day stream while preserving seek offsets', () => {
    const sessions = recordingSessions([segment('long', 0, 10800)]);
    expect(sessions).toHaveLength(3);
    expect(sessions.map((item) => item.startAt)).toEqual(
      [0, 3600, 7200].map((at) => new Date(at * 1000).toISOString()),
    );
  });
  it('groups adjacent storage chunks chronologically without hiding a real gap', () => {
    const sessions = recordingSessions([
      segment('c', 300, 400),
      segment('b', 120, 240),
      segment('a', 0, 120),
    ]);
    expect(sessions.map((s) => s.segments.map((i) => i.id))).toEqual([['a', 'b'], ['c']]);
  });
  it('only automatically advances to a contiguous interval', () => {
    const items = [segment('a', 0, 120), segment('b', 120, 240), segment('c', 250, 300)];
    expect(nextRecording(items, items[0]!)?.contiguous).toBe(true);
    expect(nextRecording(items, items[1]!)?.contiguous).toBe(false);
  });
  it('resumes at the already-played offset when the newest interval grows', () => {
    const next = nextRecording([segment('a', 0, 60)], segment('a', 0, 20));
    expect(next?.seekSeconds).toBe(20);
  });
});
describe('Timestamped historical boxes', () => {
  const box = {
    label: 'person' as const,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    confidence: 0.9,
  };
  const metadata: PlaybackMetadata = {
    toleranceMs: 600,
    events: [],
    frames: [
      { at: new Date(10000).toISOString(), boxes: [box] },
      { at: new Date(11000).toISOString(), boxes: [] },
    ],
  };
  it('shows saved geometry close to its recorded timestamp', () =>
    expect(historicalBoxes(metadata, 10200)).toEqual([box]));
  it('clears stale geometry and respects an analyzed empty frame', () => {
    expect(historicalBoxes(metadata, 13000)).toEqual([]);
    expect(historicalBoxes(metadata, 11000)).toEqual([]);
  });
  it('does not infer a negative result when metadata is missing', () =>
    expect(historicalBoxes(null, 10000)).toEqual([]));
});
