import { Injectable, Logger } from '@nestjs/common';
import { ZonesRepository } from '../../zones/zones.repository';
import type { NormalizedBBox } from '../dto/pose-frame.dto';

/**
 * Thuật toán Ray-Casting kiểm tra một điểm (px, py) có nằm trong đa giác polygon [[x, y], ...] hay không.
 * Điểm trên cạnh hoặc đỉnh được tính là nằm trong đa giác.
 */
export function isPointInPolygon(px: number, py: number, polygon: number[][]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const numPoints = polygon.length;

  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    // Kiểm tra xem điểm có nằm trên cạnh đoạn thẳng (xi, yi) - (xj, yj) không
    const onSegment =
      Math.abs((px - xi) * (yj - yi) - (py - yi) * (xj - xi)) < 1e-7 &&
      px >= Math.min(xi, xj) - 1e-7 &&
      px <= Math.max(xi, xj) + 1e-7 &&
      py >= Math.min(yi, yj) - 1e-7 &&
      py <= Math.max(yi, yj) + 1e-7;

    if (onSegment) {
      return true;
    }

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

@Injectable()
export class RestAreaEvaluator {
  private readonly logger = new Logger(RestAreaEvaluator.name);

  constructor(private readonly zonesRepository: ZonesRepository) {}

  /**
   * Đánh giá người có đang nằm trong Vùng nghỉ (REST_AREA) hay không (AC17-3).
   * Điểm neo là tâm điểm của bounding box người: (x + width/2, y + height/2).
   */
  async isPersonInRestArea(cameraId: string, bbox: NormalizedBBox): Promise<boolean> {
    try {
      const zones = await this.zonesRepository.listByCameraId(cameraId);
      const restAreaZones = zones.filter(
        (z) =>
          z.zone_type === 'REST_AREA' &&
          z.is_enabled &&
          Array.isArray(z.polygon) &&
          z.polygon.length >= 3,
      );

      if (restAreaZones.length === 0) {
        return false;
      }

      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;

      for (const zone of restAreaZones) {
        if (isPointInPolygon(centerX, centerY, zone.polygon)) {
          this.logger.debug(
            `Người tại tâm (${centerX.toFixed(3)}, ${centerY.toFixed(3)}) nằm trong REST_AREA "${zone.name}" (${zone.id})`,
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Lỗi khi kiểm tra REST_AREA cho camera ${cameraId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // M2a fail-closed theo spec: không coi lỗi DB là ngoài vùng nghỉ để tránh cảnh báo sai
      throw error;
    }
  }
}
