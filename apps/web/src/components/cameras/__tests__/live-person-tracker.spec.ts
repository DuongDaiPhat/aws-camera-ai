import { describe, expect, it } from 'vitest';
import { LivePersonTracker } from '../live/live-person-tracker';
import { personBoxFitForSource } from '../live/use-live-person-detections';

const detection = (x: number, width = 0.2, id = 'person-a') => ({
  id,
  label: 'person',
  confidence: 0.93,
  box: [0.1, x, 0.9, x + width],
});
const frame = (frameTime: number, detections = [detection(0.3)]) => ({ frameTime, detections });

describe('LivePersonTracker', () => {
  it('keeps a box through a brief missed detection, then removes a person who really left', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    tracker.update([frame(1067, [])]);
    expect(tracker.get(1120)).toHaveLength(1);
    tracker.update([frame(1134)]);
    expect(tracker.get(1140)[0].id).toBe('person-a');
    tracker.update([frame(1734, [])]);
    expect(tracker.get(1734)).toHaveLength(1);
    tracker.update([frame(2135, [])]);
    expect(tracker.get(2135)).toEqual([]);
  });

  it('does not blink during a short transport gap but expires disconnected cameras', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    expect(tracker.get(1800)).toHaveLength(1);
    expect(tracker.get(2300)).toEqual([]);
  });

  it('attenuates alternating detector jitter while a person is stationary', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    const centers: number[] = [];
    const widths: number[] = [];
    for (let i = 1; i <= 20; i++) {
      const shift = i % 2 ? 0.008 : -0.008;
      const width = i % 2 ? 0.22 : 0.18;
      tracker.update([frame(1000 + i * 67, [detection(0.4 + shift - width / 2, width)])]);
      const person = tracker.get(1000 + i * 67)[0];
      centers.push(person.x + person.width / 2);
      widths.push(person.width);
    }
    expect(Math.max(...centers.slice(4)) - Math.min(...centers.slice(4))).toBeLessThan(0.004);
    expect(Math.max(...widths.slice(4)) - Math.min(...widths.slice(4))).toBeLessThan(0.012);
  });

  it('animates a large movement quickly instead of jumping or chasing for a long time', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    tracker.update([frame(1067, [detection(0.5)])]);
    const first = tracker.get(1067)[0].x;
    expect(first).toBeGreaterThan(0.3);
    expect(first).toBeLessThan(0.5);
    expect(tracker.get(1167)[0].x).toBeGreaterThan(0.485);
  });

  it('does not restart filtering on duplicate polls or replay out-of-order frames', () => {
    const tracker = new LivePersonTracker();
    const initial = frame(1000);
    const next = frame(1067, [detection(0.31)]);
    tracker.update([initial, next]);
    const first = tracker.get(1070);
    for (let i = 0; i < 10; i++) tracker.update([initial, next]);
    tracker.update([frame(1030, [detection(0.9)])]);
    const afterDuplicates = tracker.get(1100);
    expect(afterDuplicates[0].x).toBeGreaterThanOrEqual(first[0].x);
    expect(afterDuplicates[0].x).toBeLessThan(0.31);
  });

  it('does not leave a duplicate ghost when the detector changes ID at the same location', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    const before = tracker.get(1050)[0];
    tracker.update([frame(1067, [detection(0.33, 0.24, 'replacement')])]);
    const result = tracker.get(1100);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('replacement');
    expect(Math.abs(result[0].x - before.x)).toBeLessThan(0.03);
    expect(Math.abs(result[0].width - before.width)).toBeLessThan(0.03);
  });

  it('keeps independent people separate and clears all state on reset', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000, [detection(0.1), detection(0.7, 0.2, 'person-b')])]);
    tracker.update([frame(1067, [detection(0.72, 0.2, 'person-b'), detection(0.12)])]);
    expect(tracker.get(1100)).toHaveLength(2);
    tracker.clear();
    expect(tracker.get(1100)).toEqual([]);
  });

  it('fits video-file boxes around the same center without changing the live box', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000, [detection(0.3, 0.2)])]);

    const live = tracker.get(1000)[0];
    const videoFile = tracker.get(1000, { width: 0.78, height: 0.94 })[0];

    expect(tracker.get(1000, { width: 1, height: 1 })[0]).toEqual(live);
    expect(videoFile.width).toBeCloseTo(live.width * 0.78);
    expect(videoFile.height).toBeCloseTo(live.height * 0.94);
    expect(videoFile.x + videoFile.width / 2).toBeCloseTo(live.x + live.width / 2);
    expect(videoFile.y + videoFile.height / 2).toBeCloseTo(live.y + live.height / 2);
  });

  it('applies fitting only to video files and preserves every live source', () => {
    expect(personBoxFitForSource('VIDEO_FILE')).toEqual({ width: 0.78, height: 0.94 });
    expect(personBoxFitForSource('BROWSER_WEBCAM')).toEqual({ width: 1, height: 1 });
    expect(personBoxFitForSource('RTSP')).toEqual({ width: 1, height: 1 });
    expect(personBoxFitForSource(undefined)).toEqual({ width: 1, height: 1 });
  });
});
