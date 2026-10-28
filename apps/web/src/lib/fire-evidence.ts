import type { AiComponents } from '@cam/contracts';
import type { EventDetail } from '@/types';

export type FireDetection = AiComponents['schemas']['FireDetection'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function boundingBox(box: unknown): box is FireDetection['boundingBox'] {
  if (!record(box)) return false;
  return (
    unit(box.x) &&
    unit(box.y) &&
    unit(box.width) &&
    unit(box.height) &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1.000001 &&
    box.y + box.height <= 1.000001
  );
}

function detection(value: unknown): value is FireDetection {
  return (
    record(value) &&
    (value.label === 'fire' || value.label === 'smoke') &&
    unit(value.confidence) &&
    boundingBox(value.boundingBox)
  );
}

function frameCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 3 && value <= 60;
}

function windowSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function fireEvidence(detail: EventDetail | null) {
  const result = detail?.aiResults?.find(
    (item) => item.module === 'M3_FIRE' && item.label === 'FIRE_SMOKE_DETECTED',
  );
  const metadata = result?.metadata;
  if (!record(metadata)) return null;
  const detections: unknown = metadata.detections;
  const count = metadata.consecutiveFrames;
  const window = metadata.windowSeconds;
  if (!Array.isArray(detections) || !frameCount(count) || !windowSeconds(window)) return null;
  return { detections: detections.filter(detection).slice(0, 100), count, window };
}
