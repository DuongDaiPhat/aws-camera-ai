import { fireBoxFilter, fireImageDetections } from '../src/notifications/fire-image-evidence';

const box = {
  label: 'fire',
  confidence: 0.73,
  boundingBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
};
describe('fire photo evidence', () => {
  it('uses normalized whole-image coordinates and distinct fire/smoke colors', () => {
    const items = fireImageDetections(
      { frameId: 'frame', detections: [box, { ...box, label: 'smoke' }] },
      32,
    );
    expect(fireBoxFilter(items, 5)).toContain(
      'x=iw*0.200000:y=ih*0.300000:w=iw*0.400000:h=ih*0.500000:color=0xFF4937',
    );
    expect(fireBoxFilter(items, 5)).toContain('color=0xFACC15');
  });
  it('rejects malformed/out-of-frame evidence instead of drawing a fabricated region', () => {
    expect(
      fireImageDetections(
        {
          frameId: 'frame',
          detections: [
            { ...box, boundingBox: { ...box.boundingBox, x: 0.9 } },
            { ...box, label: 'person' },
          ],
        },
        32,
      ),
    ).toEqual([]);
    expect(fireImageDetections({ detections: [box] }, 32)).toEqual([]);
  });
});
