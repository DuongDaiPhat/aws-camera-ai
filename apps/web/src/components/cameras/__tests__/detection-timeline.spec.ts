import { describe, expect, it } from 'vitest';
import { detectionsAt, liveDetectionsAt } from '../live/detection-timeline';

describe('detectionsAt', () => {
  const person = (id: string, x: number) => ({
    id,
    label: 'person',
    confidence: 0.9,
    box: [0.1, x, 0.9, x + 0.1],
  });
  const frames = [
    { frameTime: 1000, detections: [person('a', 0.1), person('b', 0.7)] },
    { frameTime: 1200, detections: [person('b', 0.5), person('a', 0.3)] },
    { frameTime: 1400, detections: [] },
  ];

  it('matches box to displayed frame time, interpolating by track ID rather than array index', () => {
    const result = detectionsAt(frames, 1100);
    expect(result[0].id).toBe('a');
    expect(result[0].box[1]).toBeCloseTo(0.2);
    expect(result[1].box[1]).toBeCloseTo(0.6);
  });

  it('does not predict motion beyond received samples, or paint future/stale boxes', () => {
    expect(detectionsAt(frames, 900)).toEqual([]);
    expect(detectionsAt(frames, 1400)).toEqual([]);
    expect(detectionsAt(frames.slice(0, 2), 2000)).toEqual([]);
    expect(detectionsAt(frames.slice(0, 2), 1250)[0].box).toEqual(frames[1].detections[0].box);
  });

  it('compensates only the measured age of a moving track, without a fixed lead', () => {
    const samples = frames.slice(0, 2);
    expect(liveDetectionsAt(samples, 1200)[0].box).toEqual(samples[1].detections[0].box);
    const personA = liveDetectionsAt(samples, 1220).find((item) => item.id === 'a');
    expect(personA?.box[1]).toBeCloseTo(0.32);
  });

  it('stops immediately on a stationary sample and clears lost tracks', () => {
    const samples = [frames[0], frames[1], { frameTime: 1300, detections: frames[1].detections }];
    expect(liveDetectionsAt(samples, 1350)[0].box).toEqual(frames[1].detections[0].box);
    expect(liveDetectionsAt(frames, 1450)).toEqual([]);
    expect(liveDetectionsAt(samples, 2000)).toEqual([]);
  });

  it('bounds prediction and never carries motion over to a new person or camera', () => {
    const samples = frames.slice(0, 2);
    const projected = liveDetectionsAt(samples, 1350).find((item) => item.id === 'a');
    expect(projected!.box[1] - 0.3).toBeLessThanOrEqual(0.0351);
    const newPerson = { frameTime: 1300, detections: [person('new', 0.9)] };
    expect(liveDetectionsAt([...samples, newPerson], 1320)[0].box).toEqual(
      newPerson.detections[0].box,
    );
  });

  it('uses the latest direction immediately when a person turns around', () => {
    const turning = [
      { frameTime: 1000, detections: [person('a', 0.2)] },
      { frameTime: 1100, detections: [person('a', 0.3)] },
      { frameTime: 1200, detections: [person('a', 0.28)] },
    ];
    expect(liveDetectionsAt(turning, 1250)[0].box[1]).toBeCloseTo(0.27);
  });
});
