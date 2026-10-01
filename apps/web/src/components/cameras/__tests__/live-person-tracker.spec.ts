import { describe, expect, it } from 'vitest';
import { LivePersonTracker, STREAM_STALE_MS, TRACK_HOLD_MS } from '../live/live-person-tracker';
import { personBoxFitForSource } from '../live/use-live-person-detections';

const detection = (x: number, width = 0.2, id = 'person-a', observedAt?: number) => ({
  id,
  label: 'person',
  confidence: 0.93,
  box: [0.1, x, 0.9, x + width],
  observedAt,
});
const frame = (frameTime: number, detections = [detection(0.3)]) => ({
  frameTime,
  detections: detections.map((d) => ({
    ...d,
    observedAt: d.observedAt !== undefined ? d.observedAt : frameTime,
  })),
});

describe('LivePersonTracker', () => {
  it('keeps a box through a brief missed detection, then removes a person who really left', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    // Short missed detection (67ms): track is still retained
    tracker.update([frame(1067, [])]);
    expect(tracker.get(1120)).toHaveLength(1);

    // Person reappears before TRACK_HOLD_MS
    tracker.update([frame(1134)]);
    expect(tracker.get(1140)[0].id).toBe('person-a');

    // Missed detection within hold window
    tracker.update([frame(1300, [])]);
    expect(tracker.get(1300)).toHaveLength(1);

    // After TRACK_HOLD_MS elapsed since lastSeen(1134)
    const expiredTime = 1134 + TRACK_HOLD_MS + 50;
    tracker.update([frame(expiredTime, [])]);
    expect(tracker.get(expiredTime)).toEqual([]);
  });

  it('does not blink during a short transport gap but expires disconnected cameras', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    // Within transport window
    expect(tracker.get(1200)).toHaveLength(1);
    // Beyond STREAM_STALE_MS (750ms): stream considered disconnected
    expect(tracker.get(1000 + STREAM_STALE_MS + 50)).toEqual([]);
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
    expect(first).toBeLessThanOrEqual(0.5);
    // Rapid settling due to fast adaptive tau
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

  it('renders fast movement at the measured position on the next animation frame', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    tracker.get(1066);
    tracker.update([frame(1067, [detection(0.5, 0.24)])]);

    const moved = tracker.get(1082)[0];
    expect(moved.x).toBeCloseTo(0.5, 6);
    expect(moved.width).toBeCloseTo(0.24, 6);

    // A rapid direction change must not keep following the previous target.
    tracker.update([frame(1134, [detection(0.22, 0.18)])]);
    const reversed = tracker.get(1149)[0];
    expect(reversed.x).toBeCloseTo(0.22, 6);
    expect(reversed.width).toBeCloseTo(0.18, 6);
    // Never predict beyond the detector's last measured position.
    expect(tracker.get(1250)[0].x).toBeCloseTo(0.22, 6);
  });

  it('keeps the newest position when fast motion and a stop arrive in one batch', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    tracker.get(1066);
    tracker.update([frame(1067, [detection(0.5)]), frame(1134, [detection(0.5)])]);

    expect(tracker.get(1149)[0].x).toBeCloseTo(0.5, 6);
  });

  it('updates vertical movement for a small person without waiting between 5 FPS samples', () => {
    const tracker = new LivePersonTracker();
    const person = { ...detection(0.3, 0.05), box: [0.1, 0.3, 0.2, 0.35] };
    tracker.update([frame(1000, [person])]);
    tracker.get(1199);
    tracker.update([frame(1200, [{ ...person, box: [0.16, 0.3, 0.26, 0.35] }])]);

    const moved = tracker.get(1216)[0];
    expect(moved.y).toBeCloseTo(0.16, 6);
    expect(moved.height).toBeCloseTo(0.1, 6);
    expect(tracker.get(1350)[0].y).toBeCloseTo(0.16, 6);
  });

  it('does not leave a duplicate ghost when the detector changes ID at the same location', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000)]);
    const before = tracker.get(1050)[0];
    tracker.update([frame(1067, [detection(0.33, 0.24, 'replacement')])]);
    const result = tracker.get(1100);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('replacement');
    expect(Math.abs(result[0].x - before.x)).toBeLessThan(0.05);
    expect(Math.abs(result[0].width - before.width)).toBeLessThan(0.05);
  });

  it('reassociates fast-moving person when ID changes without duplicate ghost boxes', () => {
    const tracker = new LivePersonTracker();
    // Person A starts at x = 0.2
    tracker.update([frame(1000, [detection(0.2, 0.2, 'id-1')])]);
    expect(tracker.get(1000)).toHaveLength(1);

    // In next frame (200ms at 5 FPS), person moves to x = 0.38 and detector re-IDs to id-2
    tracker.update([frame(1200, [detection(0.38, 0.2, 'id-2')])]);
    const afterMove = tracker.get(1200);

    // Crucial: exactly ONE box exists (ownership transferred to id-2, no ghost at 0.2)
    expect(afterMove).toHaveLength(1);
    expect(afterMove[0].id).toBe('id-2');
  });

  it('keeps independent people separate and does not merge them', () => {
    const tracker = new LivePersonTracker();
    tracker.update([
      frame(1000, [detection(0.1, 0.15, 'person-a'), detection(0.65, 0.15, 'person-b')]),
    ]);
    tracker.update([
      frame(1067, [detection(0.12, 0.15, 'person-a'), detection(0.67, 0.15, 'person-b')]),
    ]);
    expect(tracker.get(1100)).toHaveLength(2);
    tracker.clear();
    expect(tracker.get(1100)).toEqual([]);
  });

  it('preserves two distinct people walking near each other without merging into one', () => {
    const tracker = new LivePersonTracker();
    // Two people standing adjacent: Person 1 at x=0.25..0.4, Person 2 at x=0.48..0.63
    tracker.update([
      frame(1000, [detection(0.25, 0.15, 'person-1'), detection(0.48, 0.15, 'person-2')]),
    ]);
    expect(tracker.get(1000)).toHaveLength(2);

    // Both step forward slightly
    tracker.update([
      frame(1200, [detection(0.27, 0.15, 'person-1'), detection(0.5, 0.15, 'person-2')]),
    ]);
    const people = tracker.get(1200);
    expect(people).toHaveLength(2);
    const ids = people.map((p) => p.id).sort();
    expect(ids).toEqual(['person-1', 'person-2']);
  });

  it('standardizes video-file box fit to 1:1 without arbitrary shrinking', () => {
    const tracker = new LivePersonTracker();
    tracker.update([frame(1000, [detection(0.3, 0.2)])]);

    const live = tracker.get(1000)[0];
    const videoFile = tracker.get(1000, personBoxFitForSource('VIDEO_FILE'))[0];

    expect(videoFile.width).toBe(live.width);
    expect(videoFile.height).toBe(live.height);
    expect(videoFile.x).toBe(live.x);
    expect(videoFile.y).toBe(live.y);
  });

  it('applies 1:1 fitting across all source types', () => {
    expect(personBoxFitForSource('VIDEO_FILE')).toEqual({ width: 1, height: 1 });
    expect(personBoxFitForSource('BROWSER_WEBCAM')).toEqual({ width: 1, height: 1 });
    expect(personBoxFitForSource('RTSP')).toEqual({ width: 1, height: 1 });
    expect(personBoxFitForSource(undefined)).toEqual({ width: 1, height: 1 });
  });

  it('expires track after TRACK_HOLD_MS from observedAt when newer frames carry the same stale observation', () => {
    const tracker = new LivePersonTracker();
    // Frame at 1000 with observedAt = 1000
    tracker.update([frame(1000, [detection(0.3, 0.2, 'person-a', 1000)])]);
    expect(tracker.get(1000)).toHaveLength(1);

    // Newer frames at 1100, 1200 with the SAME observedAt = 1000 (coasting / duplicate observation)
    tracker.update([frame(1100, [detection(0.3, 0.2, 'person-a', 1000)])]);
    tracker.update([frame(1200, [detection(0.3, 0.2, 'person-a', 1000)])]);

    // Before TRACK_HOLD_MS from observedAt 1000: track still held
    expect(tracker.get(1000 + TRACK_HOLD_MS - 50)).toHaveLength(1);

    // After TRACK_HOLD_MS from observedAt 1000:
    // Newer frameTime (1200) does NOT extend the track lifetime!
    expect(tracker.get(1000 + TRACK_HOLD_MS + 50)).toEqual([]);
  });

  it('extends track lifetime when a genuinely new observation arrives', () => {
    const tracker = new LivePersonTracker();
    // Initial frame with observedAt = 1000
    tracker.update([frame(1000, [detection(0.3, 0.2, 'person-a', 1000)])]);

    // Genuinely new observation at 1200
    tracker.update([frame(1200, [detection(0.32, 0.2, 'person-a', 1200)])]);

    // Before TRACK_HOLD_MS from observedAt 1200: track still active
    expect(tracker.get(1200 + TRACK_HOLD_MS - 50)).toHaveLength(1);

    // After TRACK_HOLD_MS from 1200: track expires
    expect(tracker.get(1200 + TRACK_HOLD_MS + 50)).toEqual([]);
  });
});
