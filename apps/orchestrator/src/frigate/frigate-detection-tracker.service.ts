import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FrigateEventAfterDto } from '../ingestion/dto/frigate-event.dto';

export interface ActiveFrigateDetection {
  id: string;
  label: string;
  confidence: number;
  box: number[];
  currentZones: string[];
  updatedAt: number;
}

@Injectable()
export class FrigateDetectionTrackerService {
  private readonly detectionsByCamera = new Map<string, Map<string, ActiveFrigateDetection>>();
  private readonly ttlMs: number;

  constructor(configService: ConfigService) {
    this.ttlMs = Number(configService.get('CAMERA_DETECTION_TTL_MS', 10_000));
  }

  track(type: 'new' | 'update' | 'end', after: FrigateEventAfterDto): void {
    if (after.label !== 'person') return;

    const cameraDetections = this.detectionsByCamera.get(after.camera);
    if (type === 'end') {
      cameraDetections?.delete(after.id);
      if (cameraDetections?.size === 0) this.detectionsByCamera.delete(after.camera);
      return;
    }

    if (
      !after.box ||
      after.box.length !== 4 ||
      after.box.some((value) => !Number.isFinite(value))
    ) {
      return;
    }

    const next = cameraDetections ?? new Map<string, ActiveFrigateDetection>();
    next.set(after.id, {
      id: after.id,
      label: after.label,
      confidence: after.score,
      box: [...after.box],
      currentZones: [...(after.current_zones ?? [])],
      updatedAt: Date.now(),
    });
    this.detectionsByCamera.set(after.camera, next);
  }

  getActiveDetections(cameraSlug: string): ActiveFrigateDetection[] {
    this.removeExpired(cameraSlug);
    return [...(this.detectionsByCamera.get(cameraSlug)?.values() ?? [])];
  }

  getActiveZones(cameraSlug: string): string[] {
    return [
      ...new Set(
        this.getActiveDetections(cameraSlug).flatMap((detection) => detection.currentZones),
      ),
    ];
  }

  private removeExpired(cameraSlug: string): void {
    const cameraDetections = this.detectionsByCamera.get(cameraSlug);
    if (!cameraDetections) return;

    const expiresBefore = Date.now() - this.ttlMs;
    for (const [trackId, detection] of cameraDetections) {
      if (detection.updatedAt < expiresBefore) cameraDetections.delete(trackId);
    }
    if (cameraDetections.size === 0) this.detectionsByCamera.delete(cameraSlug);
  }
}
