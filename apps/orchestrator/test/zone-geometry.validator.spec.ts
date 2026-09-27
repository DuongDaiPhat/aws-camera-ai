import { getZonePolygonError } from '../src/zones/zone-geometry.validator';

describe('getZonePolygonError', () => {
  it('chap nhan polygon hop le trong khoang chuan hoa', () => {
    expect(
      getZonePolygonError([
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ]),
    ).toBeNull();
  });

  it.each([
    [
      'duoi ba dinh',
      [
        [0, 0],
        [1, 1],
      ],
    ],
    [
      'ngoai khoang',
      [
        [-0.1, 0],
        [1, 0],
        [0, 1],
      ],
    ],
    [
      'thang hang',
      [
        [0, 0],
        [0.5, 0.5],
        [1, 1],
      ],
    ],
    [
      'tu cat',
      [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ],
    ],
    [
      'trung dinh',
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
    ],
  ])('tu choi polygon %s', (_name, polygon) => {
    expect(getZonePolygonError(polygon)).not.toBeNull();
  });
});
