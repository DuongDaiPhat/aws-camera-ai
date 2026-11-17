import { archiveFrame, personBoxes } from './playback-frame.codec';
describe('Recording geometry ingestion', () => {
  const now = 1794900000000;
  const raw = {
    camera: 'cam_test',
    frameTime: now / 1000,
    objects: [{ label: 'person', score: 0.9, box: [128, 72, 640, 432], observedAt: now / 1000 }],
  };
  it('normalizes real frame geometry for later playback', () => {
    const frame = archiveFrame(raw, now, 3000);
    expect(frame).not.toBeNull();
    if (!frame) throw Error('Missing frame');
    expect(personBoxes(frame, 1280, 720, 600)).toEqual([
      { label: 'person', x: 0.1, y: 0.1, width: 0.4, height: 0.5, confidence: 0.9 },
    ]);
  });
  it('rejects stale or future frame timestamps rather than adding live boxes to old video', () => {
    expect(archiveFrame({ ...raw, frameTime: (now - 4000) / 1000 }, now, 3000)).toBeNull();
    expect(archiveFrame({ ...raw, frameTime: (now + 1000) / 1000 }, now, 3000)).toBeNull();
  });
  it('does not store stale or impossible person geometry', () => {
    const frame = archiveFrame(
      { ...raw, objects: [{ ...raw.objects[0], box: [0, 0, 1500, 200] }] },
      now,
      3000,
    );
    if (!frame) throw Error('Missing frame');
    expect(personBoxes(frame, 1280, 720, 600)).toEqual([]);
  });
});
