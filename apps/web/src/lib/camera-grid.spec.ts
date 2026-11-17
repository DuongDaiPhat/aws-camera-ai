import { describe, it, expect } from 'vitest';
import { cameraGrid } from './camera-grid';
describe('Camera grid selection', () => {
  const cameras = Array.from({ length: 4 }, (_, i) => ({ id: String(i + 1) }));
  it.each([1, 2, 4, 6, 8])('pins the selected camera first with %s requested slots', (size) => {
    const grid = cameraGrid(cameras, '4', size, 0);
    expect(grid.visible[0]?.id).toBe('4');
    expect(new Set(grid.visible.map((c) => c.id)).size).toBe(grid.visible.length);
  });
  it('reports the shortfall and does not duplicate sources', () => {
    const grid = cameraGrid(cameras, null, 6, 0);
    expect(grid.visible).toHaveLength(4);
    expect(grid.shortage).toBe(true);
  });
  it('preserves saved priority until the user explicitly chooses a camera', () =>
    expect(cameraGrid([...cameras].reverse(), null, 2, 0).visible.map((c) => c.id)).toEqual([
      '4',
      '3',
    ]));
});
