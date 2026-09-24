import { describe, expect, it } from 'vitest';
import {
  formatPolygonPoints,
  getPolygonCenter,
  isPointInPolygon,
} from './geometry-utils';

describe('geometry-utils', () => {
  // Hình vuông từ (0.1, 0.1) tới (0.9, 0.9)
  const squarePolygon = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ];

  describe('isPointInPolygon (Frigate foot-point ray-casting)', () => {
    it('tra ve true khi diem nam ben trong da giac', () => {
      const insidePoint: [number, number] = [0.5, 0.5];
      expect(isPointInPolygon(insidePoint, squarePolygon)).toBe(true);
    });

    it('tra ve false khi diem nam ngoai da giac', () => {
      const outsidePoint: [number, number] = [0.05, 0.05];
      expect(isPointInPolygon(outsidePoint, squarePolygon)).toBe(false);
    });

    it('tra ve false khi da giac co it hon 3 dinh', () => {
      expect(isPointInPolygon([0.5, 0.5], [[0, 0], [1, 1]])).toBe(false);
      expect(isPointInPolygon([0.5, 0.5], [])).toBe(false);
    });
  });

  describe('formatPolygonPoints', () => {
    it('chuyen doi toa do normalized sang chuoi SVG points', () => {
      const points = formatPolygonPoints([[0.1, 0.2], [0.5, 0.8]], 1000, 500);
      expect(points).toBe('100.0,100.0 500.0,400.0');
    });

    it('tra ve chuoi rong khi mang toa do rong', () => {
      expect(formatPolygonPoints([])).toBe('');
    });
  });

  describe('getPolygonCenter', () => {
    it('tinh toan dung toa do trung tam cua da giac', () => {
      const center = getPolygonCenter(squarePolygon, 1000, 1000);
      expect(center.x).toBeCloseTo(500);
      expect(center.y).toBeCloseTo(500);
    });
  });
});
