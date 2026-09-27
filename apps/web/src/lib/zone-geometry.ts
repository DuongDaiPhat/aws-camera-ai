export type ZonePoint = [number, number];

const EPSILON = 1e-9;

function orientation(a: ZonePoint, b: ZonePoint, c: ZonePoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function intersects(a: ZonePoint, b: ZonePoint, c: ZonePoint, d: ZonePoint): boolean {
  const values = [
    orientation(a, b, c),
    orientation(a, b, d),
    orientation(c, d, a),
    orientation(c, d, b),
  ];
  return values[0] * values[1] <= EPSILON && values[2] * values[3] <= EPSILON;
}

export function getPolygonError(points: ZonePoint[]): string | null {
  if (points.length < 3) return 'Cần ít nhất 3 đỉnh.';
  if (
    points.some(
      ([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1,
    )
  ) {
    return 'Tọa độ phải nằm trong ảnh.';
  }
  if (new Set(points.map(([x, y]) => `${x}:${y}`)).size !== points.length) {
    return 'Các đỉnh không được trùng nhau.';
  }
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (Math.abs(area) <= EPSILON) return 'Các đỉnh phải tạo thành một vùng có diện tích.';
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const firstNext = (first + 1) % points.length;
      const secondNext = (second + 1) % points.length;
      if (firstNext === second || secondNext === first) continue;
      if (intersects(points[first], points[firstNext], points[second], points[secondNext])) {
        return 'Polygon không được tự cắt.';
      }
    }
  }
  return null;
}

export function suggestZoneSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = /^[a-z]/.test(slug) ? slug : `zone_${slug}`;
  return safe.length >= 3 ? safe.slice(0, 64) : 'zone_moi';
}
