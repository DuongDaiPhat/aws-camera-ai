export interface FrameObject {
  id: string;
  label: string;
  score: number;
  box: number[];
}

export interface TrackingFrame {
  frameTime: number;
  objects: FrameObject[];
}

const MAX_AGE_MS = 3000;
const MAX_FRAMES = 60;

function validObject(value: unknown): value is FrameObject {
  if (!value || typeof value !== 'object') return false;
  const object = value as FrameObject;
  return (
    typeof object.id === 'string' &&
    object.label === 'person' &&
    Number.isFinite(object.score) &&
    object.score >= 0 &&
    object.score <= 1 &&
    Array.isArray(object.box) &&
    object.box.length === 4 &&
    object.box.every((n) => Number.isFinite(n) && n >= 0) &&
    object.box[2] >= object.box[0] &&
    object.box[3] >= object.box[1]
  );
}

/** Bounded per-frame telemetry. Event snapshots must never enter this buffer. */
export class FrigateFrameBuffer {
  private readonly cameras = new Map<string, TrackingFrame[]>();

  accept(value: unknown, now = Date.now()): void {
    this.prune(now);
    if (!value || typeof value !== 'object') return;
    const sample = value as { camera?: unknown; frameTime?: unknown; objects?: unknown };
    if (
      typeof sample.camera !== 'string' ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(sample.camera) ||
      typeof sample.frameTime !== 'number' ||
      !Number.isFinite(sample.frameTime) ||
      !Array.isArray(sample.objects)
    )
      return;
    const frameTime = sample.frameTime * 1000;
    if (frameTime < now - MAX_AGE_MS || frameTime > now + 1000) return;
    const frames = this.cameras.get(sample.camera) ?? [];
    if (frames.length && frames[frames.length - 1].frameTime >= frameTime) return;
    if (!frames.length && this.cameras.size >= 128) return;
    frames.push({ frameTime, objects: sample.objects.filter(validObject).slice(0, 100) });
    this.cameras.set(sample.camera, frames.slice(-MAX_FRAMES));
  }

  get(slug: string, now = Date.now()): TrackingFrame[] {
    this.prune(now);
    return this.cameras.get(slug) ?? [];
  }

  clear(slug: string): void {
    this.cameras.delete(slug);
  }

  private prune(now: number): void {
    for (const [slug, frames] of this.cameras) {
      const fresh = frames.filter((frame) => frame.frameTime >= now - MAX_AGE_MS);
      if (fresh.length) this.cameras.set(slug, fresh);
      else this.cameras.delete(slug);
    }
  }
}
