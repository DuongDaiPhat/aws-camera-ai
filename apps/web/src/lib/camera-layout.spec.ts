import { expect, it } from 'vitest';
import {
  availableCameraLayout,
  cameraLayoutOptions,
  cameraLayoutPresets,
  isCameraLayout,
} from './camera-layout';

it.each([
  [0, [1]],
  [1, [1]],
  [2, [1, 2]],
  [3, [1, 2, 4]],
  [5, [1, 2, 4, 6]],
  [8, [1, 2, 4, 6, 8]],
  [9, [1, 2, 4, 6, 8, 10]],
  [13, [1, 2, 4, 6, 8, 10, 12, 14]],
])('offers presets through the next even size for %i cameras', (count, expected) => {
  expect(cameraLayoutPresets(count as number)).toEqual(expected);
  expect(cameraLayoutOptions(count as number).at(-1)).toEqual({
    value: 'custom',
    label: 'Tùy chỉnh',
  });
});
it('adapts temporarily unavailable presets without changing custom layouts', () => {
  expect(availableCameraLayout('10', 3)).toBe('4');
  expect(availableCameraLayout('10', 10)).toBe('10');
  expect(availableCameraLayout('custom', 3)).toBe('custom');
  expect(availableCameraLayout('2', 0)).toBe('1');
  for (const valid of ['1', '2', '10', '24', 'custom']) expect(isCameraLayout(valid)).toBe(true);
  for (const invalid of ['0', '3', '-2', '2.5', '08', 'NaN', 'Infinity'])
    expect(isCameraLayout(invalid)).toBe(false);
});
