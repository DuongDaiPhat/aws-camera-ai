import type { CameraDebugStream } from '@/lib/cameras-client';

export type DetectionFrame = NonNullable<CameraDebugStream['detectionFrames']>[number];

/** Short, bounded compensation for telemetry age while the original live video keeps playing. */
export function liveDetectionsAt(
  frames: DetectionFrame[],
  now: number,
): DetectionFrame['detections'] {
  const latest = frames[frames.length - 1];
  if (!latest || now - latest.frameTime > 400) return [];
  if (now < latest.frameTime) return detectionsAt(frames, now);
  const previous = frames[frames.length - 2];
  const interval = previous ? latest.frameTime - previous.frameTime : 0;
  if (!previous || interval <= 0 || interval > 500) return latest.detections;
  const age = Math.min(now - latest.frameTime, interval, 120);
  const previousById = new Map(previous.detections.map((detection) => [detection.id, detection]));
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return latest.detections.map((detection) => {
    const before = detection.id ? previousById.get(detection.id) : undefined;
    if (!before) return detection;
    const [y, x, bottom, right] = detection.box;
    const [oldY, oldX, oldBottom, oldRight] = before.box;
    const width = right - x;
    const height = bottom - y;
    const dx = clamp(((x + right - oldX - oldRight) / 2 / interval) * age, width * 0.35);
    const dy = clamp(((y + bottom - oldY - oldBottom) / 2 / interval) * age, height * 0.2);
    const nextX = Math.max(0, Math.min(1 - width, x + dx));
    const nextY = Math.max(0, Math.min(1 - height, y + dy));
    return { ...detection, box: [nextY, nextX, nextY + height, nextX + width] };
  });
}

/** Interpolate only measured samples belonging to the same track, never predict ahead. */
export function detectionsAt(
  frames: DetectionFrame[],
  frameTime: number,
): DetectionFrame['detections'] {
  const index = frames.findIndex((frame) => frame.frameTime > frameTime);
  const before = index === -1 ? frames[frames.length - 1] : frames[index - 1];
  const after = index === -1 ? undefined : frames[index];
  if (!before || frameTime - before.frameTime > 400) return [];
  if (!after || after.frameTime - before.frameTime > 500) return before.detections;
  const fraction = (frameTime - before.frameTime) / (after.frameTime - before.frameTime);
  return before.detections.map((detection) => {
    const next = detection.id && after.detections.find((item) => item.id === detection.id);
    if (!next) return detection;
    return {
      ...detection,
      box: detection.box.map((value, i) => value + (next.box[i] - value) * fraction),
    };
  });
}
