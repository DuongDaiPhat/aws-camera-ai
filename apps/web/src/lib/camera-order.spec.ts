import { describe, expect, it } from 'vitest';
import { moveCamera, reconcileCameraOrder } from './camera-order';

describe('saved camera order with a changing catalog', () => {
  it('drops stale/duplicate preferences and appends newly accessible cameras', () => {
    expect(reconcileCameraOrder(['a', 'b', 'c'], ['b', 'deleted', 'b', 'a'])).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
  it('moves in both directions and ignores a foreign drag target', () => {
    expect(moveCamera(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveCamera(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveCamera(['a', 'b'], 'foreign', 'a')).toEqual(['a', 'b']);
  });
});
