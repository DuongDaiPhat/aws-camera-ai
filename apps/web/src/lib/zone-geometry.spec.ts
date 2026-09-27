import { describe, expect, it } from 'vitest';
import { getPolygonError, suggestZoneSlug } from './zone-geometry';

describe('zone geometry', () => {
  it('chap nhan polygon hop le', () => {
    expect(
      getPolygonError([
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.9],
      ]),
    ).toBeNull();
  });

  it('tu choi polygon thang hang va tu cat', () => {
    expect(
      getPolygonError([
        [0, 0],
        [0.5, 0.5],
        [1, 1],
      ]),
    ).not.toBeNull();
    expect(
      getPolygonError([
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ]),
    ).not.toBeNull();
  });

  it('sinh slug khong dau cho ten tieng Viet', () => {
    expect(suggestZoneSlug('Bếp tầng 1')).toBe('bep_tang_1');
  });
});
