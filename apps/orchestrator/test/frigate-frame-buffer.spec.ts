import { FrigateFrameBuffer } from '../src/frigate/frigate-frame-buffer';

describe('FrigateFrameBuffer', () => {
  const sample = (time: number, objects: unknown[] = []) => ({
    camera: 'cam_test',
    frameTime: time,
    objects,
  });

  it('preserves ordered frame timestamps including empty frames after a person leaves', () => {
    const buffer = new FrigateFrameBuffer();
    buffer.accept(
      sample(10, [{ id: 'a', label: 'person', score: 0.9, box: [1, 2, 30, 40], observedAt: 9.9 }]),
      10_100,
    );
    buffer.accept(sample(10.2), 10_300);
    buffer.accept(sample(10.1), 10_300);
    expect(buffer.get('cam_test', 10_400).map((f) => f.frameTime)).toEqual([10_000, 10_200]);
    expect(buffer.get('cam_test', 10_400)[0].objects[0].observedAt).toBe(9900);
    expect(buffer.get('cam_test', 10_400)[1].objects).toEqual([]);
  });

  it('rejects malformed, future and stale samples and expires disconnected cameras', () => {
    const buffer = new FrigateFrameBuffer();
    buffer.accept(sample(1), 10_000);
    buffer.accept(sample(20), 10_000);
    buffer.accept({ camera: '../other', frameTime: 10, objects: [] }, 10_000);
    expect(buffer.get('cam_test', 10_000)).toEqual([]);
    buffer.accept(
      sample(10, [{ id: 'a', label: 'person', score: 0.9, box: [1, 2, 3], observedAt: 10 }]),
      10_000,
    );
    expect(buffer.get('cam_test', 10_000)[0].objects).toEqual([]);
    expect(buffer.get('cam_test', 14_000)).toEqual([]);
  });

  it('bounds retained frames and clears a disabled camera', () => {
    const buffer = new FrigateFrameBuffer();
    for (let i = 0; i < 200; i++) buffer.accept(sample(10 + i / 100), 12_000);
    expect(buffer.get('cam_test', 12_000).length).toBeLessThanOrEqual(60);
    buffer.clear('cam_test');
    expect(buffer.get('cam_test', 12_000)).toEqual([]);
  });

  it('normalizes incoming seconds to milliseconds for frameTime and observedAt', () => {
    const buffer = new FrigateFrameBuffer();
    buffer.accept(
      {
        camera: 'cam_test',
        frameTime: 123.5,
        objects: [
          {
            id: 'p1',
            label: 'person',
            score: 0.95,
            box: [10, 20, 100, 200],
            observedAt: 123.4,
          },
        ],
      },
      124_000,
    );
    const frames = buffer.get('cam_test', 124_000);
    expect(frames).toHaveLength(1);
    expect(frames[0].frameTime).toBe(123500);
    expect(frames[0].objects[0].observedAt).toBe(123400);
  });

  it('drops objects with missing or future observedAt', () => {
    const buffer = new FrigateFrameBuffer();
    buffer.accept(
      {
        camera: 'cam_test',
        frameTime: 10,
        objects: [
          { id: 'p_no_obs', label: 'person', score: 0.9, box: [1, 2, 30, 40] },
          { id: 'p_future', label: 'person', score: 0.9, box: [1, 2, 30, 40], observedAt: 10.2 },
        ],
      },
      10_100,
    );
    expect(buffer.get('cam_test', 10_100)[0].objects).toEqual([]);
  });
});
