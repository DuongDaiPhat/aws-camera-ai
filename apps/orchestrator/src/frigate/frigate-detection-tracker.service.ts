import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readPositiveConfigNumber } from '../config/env-config';
import type { FrigateEventAfterDto } from '../ingestion/dto/frigate-event.dto';
import { FrigateFrameBuffer, type FrameObject } from './frigate-frame-buffer';

export interface ActiveFrigateDetection {
  id: string;
  canonicalTrackId?: string;
  label: string;
  confidence: number;
  box: number[];
  currentZones: string[];
  updatedAt: number;
}

export interface StabilizedFrameObject extends FrameObject {
  canonicalTrackId?: string;
}

interface CanonicalTrackEntry {
  canonicalTrackId: string;
  updatedAt: number;
}

const MAX_CANONICAL_TRACKS_PER_CAMERA = 512;

function toMilliseconds(val: number): number {
  return val < 1e11 ? Math.round(val * 1000) : Math.round(val);
}

class CanonicalPreservingFrameBuffer extends FrigateFrameBuffer {
  constructor(
    private readonly onFrameAccepted: (
      cameraSlug: string,
      frameTimeMs: number,
      objects: Array<{ id: string; canonicalTrackId: string }>,
      now: number,
    ) => void,
  ) {
    super();
  }

  override accept(value: unknown, now = Date.now()): void {
    super.accept(value, now);
    if (!value || typeof value !== 'object') return;
    const sample = value as { camera?: unknown; frameTime?: unknown; objects?: unknown };
    if (
      typeof sample.camera !== 'string' ||
      typeof sample.frameTime !== 'number' ||
      !Number.isFinite(sample.frameTime) ||
      !Array.isArray(sample.objects)
    ) {
      return;
    }

    const canonicalMappings: Array<{ id: string; canonicalTrackId: string }> = [];
    for (const raw of sample.objects) {
      if (!raw || typeof raw !== 'object') continue;
      const obj = raw as Record<string, unknown>;
      if (
        obj.label === 'person' &&
        typeof obj.id === 'string' &&
        obj.id.length > 0 &&
        typeof obj.canonicalTrackId === 'string' &&
        obj.canonicalTrackId.trim().length > 0
      ) {
        canonicalMappings.push({ id: obj.id, canonicalTrackId: obj.canonicalTrackId.trim() });
      }
    }
    if (canonicalMappings.length === 0) return;

    const frameTimeMs = toMilliseconds(sample.frameTime);
    const storedFrames = super.get(sample.camera, now);
    const matchedFrame = storedFrames.find((frame) => frame.frameTime === frameTimeMs);
    if (matchedFrame) {
      const byId = new Map(canonicalMappings.map((item) => [item.id, item.canonicalTrackId]));
      for (const frameObj of matchedFrame.objects) {
        const canonicalTrackId = byId.get(frameObj.id);
        if (canonicalTrackId) {
          (frameObj as StabilizedFrameObject).canonicalTrackId = canonicalTrackId;
        }
      }
    }

    this.onFrameAccepted(sample.camera, frameTimeMs, canonicalMappings, now);
  }
}

@Injectable()
export class FrigateDetectionTrackerService {
  readonly frames: FrigateFrameBuffer;
  private readonly detectionsByCamera = new Map<string, Map<string, ActiveFrigateDetection>>();
  private readonly canonicalTrackIdsByCamera = new Map<string, Map<string, CanonicalTrackEntry>>();
  private readonly ttlMs: number;
  private readonly canonicalTtlMs: number;

  constructor(configService: ConfigService) {
    // Frigate gui heartbeat 1.0s cho nguoi thuc su da di chuyen.
    // TTL 8s bao dam giu nguyen box khi nguoi dung yen lau, dong thoi
    // tu dong don sach ghost box sau 8s neu webcam bi tat dot ngot.
    this.ttlMs = readPositiveConfigNumber(configService, 'CAMERA_DETECTION_TTL_MS', 8_000);
    this.canonicalTtlMs = Math.max(this.ttlMs, 60_000);
    this.frames = new CanonicalPreservingFrameBuffer((cameraSlug, _frameTimeMs, mappings, now) => {
      this.recordCanonicalTrackIds(cameraSlug, mappings, now);
    });
  }

  acceptFrame(payload: unknown, now = Date.now()): void {
    this.frames.accept(payload, now);
  }

  clearCamera(cameraSlug: string): void {
    this.frames.clear(cameraSlug);
    this.detectionsByCamera.delete(cameraSlug);
    this.canonicalTrackIdsByCamera.delete(cameraSlug);
  }

  getCanonicalTrackId(cameraSlug: string, trackId: string, now = Date.now()): string | undefined {
    this.removeExpiredCanonicalTrackIds(cameraSlug, now);
    return this.canonicalTrackIdsByCamera.get(cameraSlug)?.get(trackId)?.canonicalTrackId;
  }

  resolveCanonicalTrackId(cameraSlug: string, trackId: string, now = Date.now()): string {
    return this.getCanonicalTrackId(cameraSlug, trackId, now) ?? trackId;
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

    const rawCanonical = (after as unknown as Record<string, unknown>).canonicalTrackId;
    const explicitCanonical =
      typeof rawCanonical === 'string' && rawCanonical.trim().length > 0
        ? rawCanonical.trim()
        : undefined;
    if (explicitCanonical) {
      this.recordCanonicalTrackIds(
        after.camera,
        [{ id: after.id, canonicalTrackId: explicitCanonical }],
        Date.now(),
      );
    }
    const canonicalTrackId = explicitCanonical ?? this.getCanonicalTrackId(after.camera, after.id);

    const next = cameraDetections ?? new Map<string, ActiveFrigateDetection>();
    next.set(after.id, {
      id: after.id,
      ...(canonicalTrackId ? { canonicalTrackId } : {}),
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

  private recordCanonicalTrackIds(
    cameraSlug: string,
    mappings: Array<{ id: string; canonicalTrackId: string }>,
    now: number,
  ): void {
    this.removeExpiredCanonicalTrackIds(cameraSlug, now);
    const map =
      this.canonicalTrackIdsByCamera.get(cameraSlug) ?? new Map<string, CanonicalTrackEntry>();
    for (const { id, canonicalTrackId } of mappings) {
      map.delete(id);
      map.set(id, { canonicalTrackId, updatedAt: now });
    }
    while (map.size > MAX_CANONICAL_TRACKS_PER_CAMERA) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
    this.canonicalTrackIdsByCamera.set(cameraSlug, map);
  }

  private removeExpiredCanonicalTrackIds(cameraSlug: string, now: number): void {
    const map = this.canonicalTrackIdsByCamera.get(cameraSlug);
    if (!map) return;
    const expiresBefore = now - this.canonicalTtlMs;
    for (const [trackId, entry] of map) {
      if (entry.updatedAt < expiresBefore) {
        map.delete(trackId);
      }
    }
    if (map.size === 0) {
      this.canonicalTrackIdsByCamera.delete(cameraSlug);
    }
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
