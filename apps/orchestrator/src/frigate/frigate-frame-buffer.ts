export interface FrameObject {
  id: string;
  label: string;
  score: number;
  box: number[];
  observedAt: number;
}

export interface TrackingFrame {
  frameTime: number;
  objects: FrameObject[];
}

const MAX_AGE_MS = 3000;
const MAX_FRAMES = 60;

function toMilliseconds(val: number): number {
  return val < 1e11 ? Math.round(val * 1000) : Math.round(val);
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
    ) {
      return;
    }
    const frameTime = toMilliseconds(sample.frameTime);
    if (frameTime < now - MAX_AGE_MS || frameTime > now + 1000) {
      console.warn(
        `[PERSON_DEBUG][BUFFER_RECEIVE] camera=${sample.camera} frameTime=${frameTime} receivedAt=${now} action=DROP reason=out_of_window`,
      );
      return;
    }
    const frames = this.cameras.get(sample.camera) ?? [];
    if (frames.length && frames[frames.length - 1].frameTime >= frameTime) {
      console.warn(
        `[PERSON_DEBUG][BUFFER_RECEIVE] camera=${sample.camera} frameTime=${frameTime} receivedAt=${now} action=DROP reason=out_of_order_or_duplicate`,
      );
      return;
    }
    if (!frames.length && this.cameras.size >= 128) return;

    const validObjects: FrameObject[] = [];
    for (const raw of sample.objects) {
      const parsed = this.parseObject(raw, frameTime, sample.camera, now);
      if (parsed) {
        validObjects.push(parsed);
      }
    }

    frames.push({ frameTime, objects: validObjects.slice(0, 100) });
    this.cameras.set(sample.camera, frames.slice(-MAX_FRAMES));
  }

  get(slug: string, now = Date.now()): TrackingFrame[] {
    this.prune(now);
    return this.cameras.get(slug) ?? [];
  }

  clear(slug: string): void {
    this.cameras.delete(slug);
  }

  private parseObject(
    raw: unknown,
    frameTimeMs: number,
    camera: string,
    now: number,
  ): FrameObject | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : undefined;
    const label = obj.label;
    const score = obj.score;
    const box = obj.box;

    if (
      !id ||
      label !== 'person' ||
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1 ||
      !Array.isArray(box) ||
      box.length !== 4 ||
      !box.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ||
      (box[2] as number) < (box[0] as number) ||
      (box[3] as number) < (box[1] as number)
    ) {
      if (label === 'person') {
        console.warn(
          `[PERSON_DEBUG][BUFFER_RECEIVE] camera=${camera} objectId=${id ?? 'unknown'} frameTime=${frameTimeMs} receivedAt=${now} action=DROP reason=malformed_geometry`,
        );
      }
      return null;
    }

    const rawObserved =
      typeof obj.observedAt === 'number'
        ? obj.observedAt
        : typeof obj.frame_time === 'number'
          ? obj.frame_time
          : undefined;

    if (rawObserved === undefined || !Number.isFinite(rawObserved)) {
      console.warn(
        `[PERSON_DEBUG][BUFFER_RECEIVE] camera=${camera} objectId=${id} frameTime=${frameTimeMs} receivedAt=${now} action=DROP reason=missing_observed_at`,
      );
      return null;
    }

    const observedAtMs = toMilliseconds(rawObserved);
    if (observedAtMs > frameTimeMs + 50) {
      console.warn(
        `[PERSON_DEBUG][BUFFER_RECEIVE] camera=${camera} objectId=${id} frameTime=${frameTimeMs} observedAt=${observedAtMs} receivedAt=${now} action=DROP reason=future_observed_at`,
      );
      return null;
    }

    console.warn(
      `[PERSON_DEBUG][BUFFER_RECEIVE] camera=${camera} objectId=${id} frameTime=${frameTimeMs} observedAt=${observedAtMs} receivedAt=${now} action=ACCEPT`,
    );

    return {
      id,
      label: 'person',
      score,
      box: box as number[],
      observedAt: observedAtMs,
    };
  }

  private prune(now: number): void {
    for (const [slug, frames] of this.cameras) {
      const fresh = frames.filter((frame) => frame.frameTime >= now - MAX_AGE_MS);
      if (fresh.length) this.cameras.set(slug, fresh);
      else this.cameras.delete(slug);
    }
  }
}
