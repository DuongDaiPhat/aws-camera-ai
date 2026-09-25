/**
 * Thuật toán Ray-casting kiểm tra một điểm (foot-point) có nằm trong đa giác (polygon) hay không.
 * Tương thích với thuật toán tính toán kích hoạt zone của Frigate NVR.
 */
export function isPointInPolygon(point: [number, number], polygon: number[][]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Định dạng mảng tọa độ chuẩn hóa [0..1] sang chuỗi points cho thẻ SVG <polygon>.
 */
export function formatPolygonPoints(polygon: number[][], width = 1000, height = 562.5): string {
  if (!polygon || polygon.length === 0) return '';
  return polygon.map(([x, y]) => `${(x * width).toFixed(1)},${(y * height).toFixed(1)}`).join(' ');
}

/**
 * Tính toán tọa độ trung tâm của đa giác để gắn nhãn (badge) vùng giám sát.
 */
export function getPolygonCenter(
  polygon: number[][],
  width = 1000,
  height = 562.5,
): { x: number; y: number } {
  if (!polygon || polygon.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of polygon) {
    sumX += x;
    sumY += y;
  }
  return {
    x: (sumX / polygon.length) * width,
    y: (sumY / polygon.length) * height,
  };
}
