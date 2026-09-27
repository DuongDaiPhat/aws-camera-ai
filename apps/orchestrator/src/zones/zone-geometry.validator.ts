import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

export type ZonePoint = [number, number];

const AREA_EPSILON = 1e-9;

function orientation(a: ZonePoint, b: ZonePoint, c: ZonePoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: ZonePoint, b: ZonePoint, p: ZonePoint): boolean {
  return (
    Math.abs(orientation(a, b, p)) <= AREA_EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - AREA_EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + AREA_EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - AREA_EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + AREA_EPSILON
  );
}

function segmentsIntersect(a: ZonePoint, b: ZonePoint, c: ZonePoint, d: ZonePoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);

  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function getZonePolygonError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) {
    return 'Polygon phải có ít nhất ba đỉnh.';
  }

  const points: ZonePoint[] = [];
  const seen = new Set<string>();
  for (const rawPoint of value) {
    if (
      !Array.isArray(rawPoint) ||
      rawPoint.length !== 2 ||
      rawPoint.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
    ) {
      return 'Mỗi đỉnh polygon phải gồm đúng hai tọa độ số [x, y].';
    }
    const point: ZonePoint = [rawPoint[0], rawPoint[1]];
    if (point[0] < 0 || point[0] > 1 || point[1] < 0 || point[1] > 1) {
      return 'Tọa độ polygon phải nằm trong khoảng từ 0 đến 1.';
    }
    const key = `${point[0]}:${point[1]}`;
    if (seen.has(key)) return 'Polygon không được chứa đỉnh trùng nhau.';
    seen.add(key);
    points.push(point);
  }

  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    doubledArea +=
      points[index][0] * points[nextIndex][1] - points[nextIndex][0] * points[index][1];
  }
  if (Math.abs(doubledArea) <= AREA_EPSILON) {
    return 'Polygon phải có diện tích lớn hơn không.';
  }

  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      const adjacent =
        first === second || firstNext === second || secondNext === first || first === secondNext;
      if (adjacent) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return 'Polygon không được tự cắt.';
      }
    }
  }

  return null;
}

@ValidatorConstraint({ name: 'validZonePolygon', async: false })
export class ZonePolygonConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return getZonePolygonError(value) === null;
  }

  defaultMessage(): string {
    return 'Polygon không hợp lệ.';
  }
}
