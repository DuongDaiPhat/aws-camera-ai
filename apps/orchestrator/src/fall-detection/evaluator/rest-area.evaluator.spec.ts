import { isPointInPolygon, RestAreaEvaluator } from './rest-area.evaluator';
import type { ZonesRepository, ZoneRecord } from '../../zones/zones.repository';

describe('RestAreaEvaluator and isPointInPolygon', () => {
  describe('isPointInPolygon', () => {
    // Đa giác hình chữ nhật chuẩn từ (0.2, 0.2) đến (0.8, 0.8)
    const squarePolygon: number[][] = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ];

    it('returns true when point is strictly inside the polygon', () => {
      // Arrange & Act
      const inside = isPointInPolygon(0.5, 0.5, squarePolygon);

      // Assert
      expect(inside).toBe(true);
    });

    it('returns false when point is outside the polygon', () => {
      // Arrange & Act
      const outside = isPointInPolygon(0.1, 0.5, squarePolygon);

      // Assert
      expect(outside).toBe(false);
    });

    it('returns true when point is on the boundary of the polygon', () => {
      // Arrange & Act
      const onEdge = isPointInPolygon(0.5, 0.2, squarePolygon);

      // Assert
      expect(onEdge).toBe(true);
    });

    it('returns false when polygon has fewer than 3 vertices', () => {
      // Arrange & Act
      const invalidPolygon = [[0.1, 0.1], [0.2, 0.2]];

      // Assert
      expect(isPointInPolygon(0.15, 0.15, invalidPolygon)).toBe(false);
    });
  });

  describe('RestAreaEvaluator.isPersonInRestArea (AC17-3)', () => {
    let evaluator: RestAreaEvaluator;
    let mockZonesRepo: jest.Mocked<ZonesRepository>;

    beforeEach(() => {
      mockZonesRepo = {
        listByCameraId: jest.fn(),
      } as unknown as jest.Mocked<ZonesRepository>;

      evaluator = new RestAreaEvaluator(mockZonesRepo);
    });

    const createZone = (overrides: Partial<ZoneRecord> = {}): ZoneRecord => ({
      id: 'zone-1',
      camera_id: 'cam-1',
      name: 'Giường ngủ',
      slug: 'giuong-ngu',
      zone_type: 'REST_AREA',
      polygon: [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.8, 0.8],
        [0.2, 0.8],
      ],
      min_dwell_seconds: 0,
      active_from: null,
      active_to: null,
      is_enabled: true,
      ...overrides,
    });

    it('returns true when person center falls inside enabled REST_AREA', async () => {
      // Arrange
      mockZonesRepo.listByCameraId.mockResolvedValue([createZone()]);
      // Bounding box tâm tại (0.3 + 0.2/2 = 0.4, 0.3 + 0.2/2 = 0.4)
      const bbox = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 };

      // Act
      const result = await evaluator.isPersonInRestArea('cam-1', bbox);

      // Assert
      expect(result).toBe(true);
    });

    it('returns false when person center is outside REST_AREA', async () => {
      // Arrange
      mockZonesRepo.listByCameraId.mockResolvedValue([createZone()]);
      // Bounding box tâm tại (0.05, 0.05)
      const bbox = { x: 0.0, y: 0.0, width: 0.1, height: 0.1 };

      // Act
      const result = await evaluator.isPersonInRestArea('cam-1', bbox);

      // Assert
      expect(result).toBe(false);
    });

    it('ignores disabled REST_AREA zones', async () => {
      // Arrange
      mockZonesRepo.listByCameraId.mockResolvedValue([createZone({ is_enabled: false })]);
      const bbox = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 };

      // Act
      const result = await evaluator.isPersonInRestArea('cam-1', bbox);

      // Assert
      expect(result).toBe(false);
    });

    it('ignores non-REST_AREA zones such as RESTRICTED or NORMAL', async () => {
      // Arrange
      mockZonesRepo.listByCameraId.mockResolvedValue([
        createZone({ zone_type: 'RESTRICTED' }),
        createZone({ zone_type: 'NORMAL' }),
      ]);
      const bbox = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 };

      // Act
      const result = await evaluator.isPersonInRestArea('cam-1', bbox);

      // Assert
      expect(result).toBe(false);
    });

    it('fails closed and returns false if repository throws an error', async () => {
      // Arrange
      mockZonesRepo.listByCameraId.mockRejectedValue(new Error('Database offline'));
      const bbox = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 };

      // Act
      const result = await evaluator.isPersonInRestArea('cam-1', bbox);

      // Assert
      expect(result).toBe(false);
    });
  });
});
