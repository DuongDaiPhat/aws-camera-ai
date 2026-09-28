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
      sample(10, [{ id: 'a', label: 'person', score: 0.9, box: [1, 2, 30, 40] }]),
      10_100,
    );
    buffer.accept(sample(10.2), 10_300);
    buffer.accept(sample(10.1), 10_300);
    expect(buffer.get('cam_test', 10_400).map((f) => f.frameTime)).toEqual([10_000, 10_200]);
    expect(buffer.get('cam_test', 10_400)[1].objects).toEqual([]);
  });

  it('rejects malformed, future and stale samples and expires disconnected cameras', () => {
    const buffer = new FrigateFrameBuffer();
    buffer.accept(sample(1), 10_000);
    buffer.accept(sample(20), 10_000);
    buffer.accept({ camera: '../other', frameTime: 10, objects: [] }, 10_000);
    expect(buffer.get('cam_test', 10_000)).toEqual([]);
    buffer.accept(sample(10, [{ id: 'a', label: 'person', score: 0.9, box: [1, 2, 3] }]), 10_000);
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
});
