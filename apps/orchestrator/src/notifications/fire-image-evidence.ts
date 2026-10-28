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
    (value.label === 'fire' || value.label === 'smoke') &&
    unit(value.confidence) &&
    boundingBox(value.boundingBox)
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
      ({ label, boundingBox: box }) =>
        `drawbox=x=iw*${box.x.toFixed(6)}:y=ih*${box.y.toFixed(6)}:w=iw*${box.width.toFixed(6)}:h=ih*${box.height.toFixed(6)}:color=${label === 'fire' ? '0xFF4937' : '0xFACC15'}:t=${thickness}`,
    )
    .join(',');
}
