import type { DetectedPerson } from '../debug/PersonBoxLayer';
import type { DetectionFrame } from './detection-timeline';

type Detection = DetectionFrame['detections'][number];
interface Geometry {
  cx: number;
  cy: number;
  width: number;
  height: number;
}
interface Track {
  detection: Detection;
  target: Geometry;
  display: Geometry;
  confidence: number;
  lastSeen: number;
  lastRendered: number;
}

export interface PersonBoxFit {
  width: number;
  height: number;
}

const TRACK_HOLD_MS = 900;
const STREAM_STALE_MS = 1200;
const ORIGINAL_BOX_FIT: PersonBoxFit = { width: 1, height: 1 };

function geometry(box: number[]): Geometry {
  return {
    cx: (box[1] + box[3]) / 2,
    cy: (box[0] + box[2]) / 2,
    width: box[3] - box[1],
    height: box[2] - box[0],
  };
}

function overlap(a: number[], b: number[]): number {
  const intersection =
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])) *
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const area = (box: number[]) => (box[3] - box[1]) * (box[2] - box[0]);
  return intersection / Math.max(area(a) + area(b) - intersection, Number.EPSILON);
}

function smoothAxis(current: number, next: number, scale: number, dt: number): number {
  const error = next - current;
  const deadband = Math.max(0.003, Math.min(0.012, scale * 0.035));
  if (Math.abs(error) <= deadband) return current;
  const adjustedError = error - Math.sign(error) * deadband;
  const relativeError = Math.abs(error) / Math.max(scale, 0.01);
  const tau = relativeError > 0.35 ? 12 : relativeError > 0.12 ? 35 : 110;
  const alpha = 1 - Math.exp(-dt / tau);
  return current + adjustedError * alpha;
}

function smoothSize(current: number, next: number, dt: number): number {
  const error = next - current;
  const deadband = Math.max(0.004, current * 0.04);
  if (Math.abs(error) <= deadband) return current;
  const adjustedError = error - Math.sign(error) * deadband;
  const alpha = 1 - Math.exp(-dt / (Math.abs(error) > current * 0.3 ? 45 : 180));
  return current + adjustedError * alpha;
}

function updateTrack(track: Track, detection: Detection, time: number): void {
  const raw = geometry(detection.box);
  const dt = Math.max(1, Math.min(time - track.lastSeen, 250));
  const scale = Math.min(raw.width, raw.height);
  track.target = {
    cx: smoothAxis(track.target.cx, raw.cx, scale, dt),
    cy: smoothAxis(track.target.cy, raw.cy, scale, dt),
    width: smoothSize(track.target.width, raw.width, dt),
    height: smoothSize(track.target.height, raw.height, dt),
  };
  track.confidence += (detection.confidence - track.confidence) * 0.2;
  track.detection = detection;
  track.lastSeen = time;
}

function animateTrack(track: Track, now: number): void {
  const dt = Math.max(0, Math.min(now - track.lastRendered, 100));
  if (dt === 0) return;
  const distance = Math.hypot(
    track.target.cx - track.display.cx,
    track.target.cy - track.display.cy,
  );
  const scale = Math.max(0.01, Math.min(track.target.width, track.target.height));
  const tau = distance > scale * 0.2 ? 32 : 55;
  const alpha = 1 - Math.exp(-dt / tau);
  track.display = {
    cx: track.display.cx + (track.target.cx - track.display.cx) * alpha,
    cy: track.display.cy + (track.target.cy - track.display.cy) * alpha,
    width: track.display.width + (track.target.width - track.display.width) * alpha,
    height: track.display.height + (track.target.height - track.display.height) * alpha,
  };
  track.lastRendered = now;
}

function isValidDetection(item: Detection): boolean {
  return Boolean(
    item.id &&
      item.label === 'person' &&
      item.box.length === 4 &&
      item.box.every(Number.isFinite) &&
      item.box[3] > item.box[1] &&
      item.box[2] > item.box[0],
  );
}

/** Persistent display state with track hysteresis and short 60 FPS settling. */
export class LivePersonTracker {
  private readonly tracks = new Map<string, Track>();
  private frameTime = -Infinity;

  clear(): void {
    this.tracks.clear();
    this.frameTime = -Infinity;
  }

  update(frames: DetectionFrame[]): void {
    for (const frame of frames) {
      if (frame.frameTime <= this.frameTime) continue;
      this.frameTime = frame.frameTime;
      const detections = frame.detections.filter(isValidDetection);
      const matched = new Set<Track>();

      for (const detection of detections) {
        const id = detection.id!;
        let key = id;
        let track = this.tracks.get(id);
        if (!track || matched.has(track)) {
          let bestOverlap = 0;
          for (const [candidateKey, candidate] of this.tracks) {
            if (matched.has(candidate)) continue;
            const candidateOverlap = overlap(detection.box, candidate.detection.box);
            if (candidateOverlap > bestOverlap) {
              bestOverlap = candidateOverlap;
              key = candidateKey;
              track = candidate;
            }
          }
          if (bestOverlap < 0.25) track = undefined;
        }

        if (track) {
          if (key !== id) {
            this.tracks.delete(key);
            this.tracks.set(id, track);
          }
          updateTrack(track, detection, frame.frameTime);
          matched.add(track);
        } else {
          const initial = geometry(detection.box);
          const created: Track = {
            detection,
            target: initial,
            display: initial,
            confidence: detection.confidence,
            lastSeen: frame.frameTime,
            lastRendered: frame.frameTime,
          };
          this.tracks.set(id, created);
          matched.add(created);
        }
      }

      for (const [id, track] of this.tracks) {
        if (frame.frameTime - track.lastSeen > TRACK_HOLD_MS) this.tracks.delete(id);
      }
    }
  }

  get(now: number, fit: PersonBoxFit = ORIGINAL_BOX_FIT): DetectedPerson[] {
    if (now - this.frameTime > STREAM_STALE_MS) {
      this.tracks.clear();
      return [];
    }
    const people: DetectedPerson[] = [];
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen > TRACK_HOLD_MS) {
        this.tracks.delete(id);
        continue;
      }
      animateTrack(track, now);
      const box = track.display;
      const fitWidth = Number.isFinite(fit.width) && fit.width > 0 ? Math.min(1, fit.width) : 1;
      const fitHeight =
        Number.isFinite(fit.height) && fit.height > 0 ? Math.min(1, fit.height) : 1;
      const fittedWidth = box.width * fitWidth;
      const fittedHeight = box.height * fitHeight;
      people.push({
        id: track.detection.id,
        label: track.detection.label,
        confidence: track.confidence,
        x: Math.max(0, Math.min(1 - fittedWidth, box.cx - fittedWidth / 2)),
        y: Math.max(0, Math.min(1 - fittedHeight, box.cy - fittedHeight / 2)),
        width: fittedWidth,
        height: fittedHeight,
      });
    }
    return people;
  }
}
