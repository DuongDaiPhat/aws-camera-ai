import {
  faceBelongsToPerson,
  type PersonCropContext,
} from '../src/face-recognition/face-person-association';

describe('face/person association', () => {
  const context: PersonCropContext = {
    capturedAt: 1000,
    trackId: 'left',
    cropRegion: { x: 0, y: 0, width: 1, height: 1 },
    persons: [
      { trackId: 'left', boundingBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.8 } },
      { trackId: 'right', boundingBox: { x: 0.35, y: 0.1, width: 0.4, height: 0.8 } },
    ],
  };
  it('does not assign the right persons face to an overlapping left body crop', () => {
    const rightFace = { x: 0.5, y: 0.15, width: 0.1, height: 0.1 };
    expect(faceBelongsToPerson(context, rightFace)).toBe(false);
    expect(faceBelongsToPerson({ ...context, trackId: 'right' }, rightFace)).toBe(true);
  });
  it('waits when two head positions are ambiguous', () => {
    const face = { x: 0.375, y: 0.15, width: 0.1, height: 0.1 };
    expect(faceBelongsToPerson(context, face)).toBe(false);
    expect(faceBelongsToPerson({ ...context, trackId: 'right' }, face)).toBe(false);
  });
  it('maps a face inside a padded person crop back into the source frame', () => {
    expect(
      faceBelongsToPerson(
        { ...context, cropRegion: { x: 0.1, y: 0.1, width: 0.4, height: 0.8 } },
        { x: 0.375, y: 0.0625, width: 0.25, height: 0.125 },
      ),
    ).toBe(true);
  });
});
