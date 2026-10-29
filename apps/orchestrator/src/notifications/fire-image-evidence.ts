import type { AiComponents } from '@cam/contracts';

type Detection = AiComponents['schemas']['FireDetection'];
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function boundingBox(box: unknown): box is Detection['boundingBox'] {
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

function detection(value: unknown): value is Detection {
  return (
    record(value) &&
    value.label === 'fire' &&
    unit(value.confidence) &&
    boundingBox(value.boundingBox)
  );
}

/** Old mixed-class incidents must not be delivered again as fire-only alerts. */
export function hasFireOnlyNotificationEvidence(results: unknown): boolean {
  return (
    Array.isArray(results) &&
    results.some((result: unknown) => {
      if (
        !record(result) ||
        result.module !== 'M3_FIRE' ||
        result.label !== 'FIRE_SMOKE_DETECTED' ||
        result.status !== 'SUCCESS' ||
        !record(result.metadata)
      )
        return false;
      const metadata = result.metadata;
      return (
        metadata.incidentConfidencePolicyVersion === 'fire-only-temporal-min-v1' &&
        Array.isArray(metadata.labels) &&
        metadata.labels.length === 1 &&
        metadata.labels[0] === 'fire' &&
        Array.isArray(metadata.detections) &&
        metadata.detections.length > 0 &&
        metadata.detections.every(detection)
      );
    })
  );
}

export function fireImageDetections(metadata: unknown, limit: number): Detection[] {
  if (
    !record(metadata) ||
    !Array.isArray(metadata.detections) ||
    typeof metadata.frameId !== 'string'
  )
    return [];
  return metadata.detections.filter(detection).slice(0, limit);
}

export function fireBoxFilter(items: readonly Detection[], thickness: number): string {
  return items
    .map(
      ({ boundingBox: box }) =>
        `drawbox=x=iw*${box.x.toFixed(6)}:y=ih*${box.y.toFixed(6)}:w=iw*${box.width.toFixed(6)}:h=ih*${box.height.toFixed(6)}:color=0xFF4937:t=${thickness}`,
    )
    .join(',');
}
