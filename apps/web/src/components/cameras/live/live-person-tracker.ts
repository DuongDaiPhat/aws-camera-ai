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

export const TRACK_HOLD_MS = 450;
export const STREAM_STALE_MS = 1000;
const ORIGINAL_BOX_FIT: PersonBoxFit = { width: 1, height: 1 };

function geometry(box: number[]): Geometry {
  return {
    cx: (box[1] + box[3]) / 2,
    cy: (box[0] + box[2]) / 2,
    width: Math.max(0.001, box[3] - box[1]),
    height: Math.max(0.001, box[2] - box[0]),
  };
}

function overlap(a: number[], b: number[]): number {
  const intersection =
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])) *
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const area = (box: number[]) => (box[3] - box[1]) * (box[2] - box[0]);
  return intersection / Math.max(area(a) + area(b) - intersection, Number.EPSILON);
}

/**
 * Score candidate track for matching an unmatched detection.
 * Considers IoU, center distance normalized by person scale, and area ratio.
 * Gating conditions prevent merging two distinct people or matching distant objects.
 */
function scoreCandidateMatch(
  detGeom: Geometry,
  detBox: number[],
  track: Track,
): { score: number; valid: boolean } {
  const candGeom = track.target;
  const candBox = track.detection.box;
  const iou = overlap(detBox, candBox);

  const centerDist = Math.hypot(detGeom.cx - candGeom.cx, detGeom.cy - candGeom.cy);
  const detDiag = Math.hypot(detGeom.width, detGeom.height);
  const candDiag = Math.hypot(candGeom.width, candGeom.height);
  const scale = Math.max(detDiag, candDiag, 0.05);
  const normalizedDist = centerDist / scale;

  const detArea = detGeom.width * detGeom.height;
  const candArea = candGeom.width * candGeom.height;
  const areaRatio = Math.max(detArea, candArea) / Math.max(Math.min(detArea, candArea), 1e-4);

  // Gating criteria:
  // 1. High IoU (>= 0.10) OR
  // 2. Center distance is within adaptive gate AND area ratio is reasonable (0.4 .. 2.5)
  const isAdaptiveNear = normalizedDist <= 1.4 && centerDist <= 0.35 && areaRatio <= 2.5;
  const valid = iou >= 0.1 || isAdaptiveNear;

  if (!valid) {
    return { score: -Infinity, valid: false };
  }

  const score = iou * 3 - normalizedDist - Math.abs(1 - areaRatio) * 0.3;
  return { score, valid: true };
}

function updateTrackTarget(
  track: Track,
  detection: Detection,
  frameTime: number,
): { action: 'UPDATE' | 'DUPLICATE'; lastSeenBefore: number; lastSeenAfter: number } {
  const lastSeenBefore = track.lastSeen;
  const newObservedAt = detection.observedAt !== undefined ? detection.observedAt : frameTime;
  const currentObservedAt =
    track.detection.observedAt !== undefined ? track.detection.observedAt : track.lastSeen;

  if (newObservedAt <= currentObservedAt) {
    // Duplicate or older observation: do not advance lastSeen, do not restart smoothing
    return { action: 'DUPLICATE', lastSeenBefore, lastSeenAfter: track.lastSeen };
  }

  const raw = geometry(detection.box);
  track.target.cx = raw.cx;
  track.target.cy = raw.cy;
  track.target.width = raw.width;
  track.target.height = raw.height;
  track.confidence += (detection.confidence - track.confidence) * 0.3;
  track.detection = detection;
  track.lastSeen = newObservedAt;

  return { action: 'UPDATE', lastSeenBefore, lastSeenAfter: track.lastSeen };
}

/**
 * Single-layer render smoothing with scale-aware deadband and adaptive time-constant.
 * When a person moves fast, tau is short (18ms) so box responds immediately.
 * When stationary, detector jitter is absorbed by scale-aware deadband and slow tau (110ms).
 */
function animateTrack(track: Track, now: number): void {
  const dt = Math.max(0, Math.min(now - track.lastRendered, 100));
  if (dt === 0) return;

  const dist = Math.hypot(track.target.cx - track.display.cx, track.target.cy - track.display.cy);
  const scale = Math.max(0.01, Math.min(track.target.width, track.target.height));
  const relativeMovement = dist / scale;

  // Adaptive tau: fast movement snaps rapidly, small movement settles gently
  const tauPos = relativeMovement > 0.25 ? 18 : relativeMovement > 0.1 ? 35 : 110;
  const alphaPos = 1 - Math.exp(-dt / tauPos);

  const errorX = track.target.cx - track.display.cx;
  const errorY = track.target.cy - track.display.cy;
  // Scale-aware deadband to filter detector micro-jitter when stationary
  const deadbandPos = Math.max(0.003, Math.min(0.012, scale * 0.04));
  const adjX = Math.abs(errorX) <= deadbandPos ? 0 : errorX - Math.sign(errorX) * deadbandPos;
  const adjY = Math.abs(errorY) <= deadbandPos ? 0 : errorY - Math.sign(errorY) * deadbandPos;

  track.display.cx += adjX * alphaPos;
  track.display.cy += adjY * alphaPos;

  // Single-layer size smoothing with deadband
  const errorW = track.target.width - track.display.width;
  const errorH = track.target.height - track.display.height;
  const tauSize = Math.abs(errorW) > track.display.width * 0.25 ? 45 : 150;
  const alphaSize = 1 - Math.exp(-dt / tauSize);

  const deadbandW = Math.max(0.004, track.display.width * 0.04);
  const deadbandH = Math.max(0.004, track.display.height * 0.04);
  const adjW = Math.abs(errorW) <= deadbandW ? 0 : errorW - Math.sign(errorW) * deadbandW;
  const adjH = Math.abs(errorH) <= deadbandH ? 0 : errorH - Math.sign(errorH) * deadbandH;

  track.display.width += adjW * alphaSize;
  track.display.height += adjH * alphaSize;

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

function findBestCandidateTrack(
  detection: Detection,
  detGeom: Geometry,
  tracks: Map<string, Track>,
  matchedTracks: Set<Track>,
): { key: string; track: Track } | null {
  let bestKey: string | null = null;
  let bestTrack: Track | null = null;
  let bestScore = -Infinity;

  for (const [candidateKey, candidate] of tracks) {
    if (matchedTracks.has(candidate)) continue;
    const { score, valid } = scoreCandidateMatch(detGeom, detection.box, candidate);
    if (valid && score > bestScore) {
      bestScore = score;
      bestKey = candidateKey;
      bestTrack = candidate;
    }
  }

  return bestTrack && bestKey ? { key: bestKey, track: bestTrack } : null;
}

export class LivePersonTracker {
  private readonly tracks = new Map<string, Track>();
  private frameTime = -Infinity;

  clear(): void {
    this.tracks.clear();
    this.frameTime = -Infinity;
  }

  private processFrameDetections(frame: DetectionFrame): void {
    const detections = frame.detections.filter(isValidDetection);
    const matchedTracks = new Set<Track>();
    const unmatched = this.matchExactDetections(detections, frame.frameTime, matchedTracks);
    this.associateCandidateDetections(unmatched, frame.frameTime, matchedTracks);
    this.evictStaleTracks(frame.frameTime, matchedTracks);
  }

  private matchExactDetections(
    detections: Detection[],
    frameTime: number,
    matchedTracks: Set<Track>,
  ): Detection[] {
    const unmatched: Detection[] = [];
    for (const detection of detections) {
      const id = detection.id!;
      const track = this.tracks.get(id);
      if (track && !matchedTracks.has(track)) {
        const { action, lastSeenBefore, lastSeenAfter } = updateTrackTarget(
          track,
          detection,
          frameTime,
        );
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${detection.id} action=${action} lastSeenBefore=${lastSeenBefore} lastSeenAfter=${lastSeenAfter} observedAt=${detection.observedAt} frameTime=${frameTime} ageMs=${frameTime - (detection.observedAt ?? frameTime)}`,
        );
        matchedTracks.add(track);
      } else {
        unmatched.push(detection);
      }
    }
    return unmatched;
  }

  private associateCandidateDetections(
    unmatchedDetections: Detection[],
    frameTime: number,
    matchedTracks: Set<Track>,
  ): void {
    for (const detection of unmatchedDetections) {
      const id = detection.id!;
      const detGeom = geometry(detection.box);
      const matchedCandidate = findBestCandidateTrack(
        detection,
        detGeom,
        this.tracks,
        matchedTracks,
      );

      if (matchedCandidate) {
        const isReassociate = matchedCandidate.key !== id;
        if (isReassociate) {
          this.tracks.delete(matchedCandidate.key);
          this.tracks.set(id, matchedCandidate.track);
        }
        const { action, lastSeenBefore, lastSeenAfter } = updateTrackTarget(
          matchedCandidate.track,
          detection,
          frameTime,
        );
        const logAction = isReassociate ? 'REASSOCIATE' : action;
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${detection.id} action=${logAction} lastSeenBefore=${lastSeenBefore} lastSeenAfter=${lastSeenAfter} observedAt=${detection.observedAt} frameTime=${frameTime} ageMs=${frameTime - (detection.observedAt ?? frameTime)}`,
        );
        matchedTracks.add(matchedCandidate.track);
      } else {
        const initial = geometry(detection.box);
        const obsAt = detection.observedAt !== undefined ? detection.observedAt : frameTime;
        const created: Track = {
          detection,
          target: { ...initial },
          display: { ...initial },
          confidence: detection.confidence,
          lastSeen: obsAt,
          lastRendered: frameTime,
        };
        this.tracks.set(id, created);
        matchedTracks.add(created);
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${detection.id} action=CREATE lastSeenBefore=0 lastSeenAfter=${obsAt} observedAt=${detection.observedAt} frameTime=${frameTime} ageMs=${frameTime - obsAt}`,
        );
      }
    }
  }

  private evictStaleTracks(frameTime: number, matchedTracks: Set<Track>): void {
    for (const [id, track] of this.tracks) {
      if (frameTime - track.lastSeen > TRACK_HOLD_MS) {
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${track.detection.id} action=REMOVE lastSeenBefore=${track.lastSeen} lastSeenAfter=${track.lastSeen} observedAt=${track.detection.observedAt} frameTime=${frameTime} ageMs=${frameTime - track.lastSeen}`,
        );
        this.tracks.delete(id);
      } else if (!matchedTracks.has(track)) {
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${track.detection.id} action=HOLD lastSeenBefore=${track.lastSeen} lastSeenAfter=${track.lastSeen} observedAt=${track.detection.observedAt} frameTime=${frameTime} ageMs=${frameTime - track.lastSeen}`,
        );
      }
    }
  }

  update(frames: DetectionFrame[]): void {
    for (const frame of frames) {
      if (frame.frameTime <= this.frameTime) continue;
      this.frameTime = frame.frameTime;
      this.processFrameDetections(frame);
    }
  }

  get(now: number, fit: PersonBoxFit = ORIGINAL_BOX_FIT): DetectedPerson[] {
    if (now - this.frameTime > STREAM_STALE_MS) {
      for (const [id, track] of this.tracks) {
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${track.detection.id} action=REMOVE lastSeenBefore=${track.lastSeen} lastSeenAfter=${track.lastSeen} observedAt=${track.detection.observedAt} frameTime=${this.frameTime} ageMs=${now - track.lastSeen} reason=stream_stale`,
        );
      }
      this.tracks.clear();
      return [];
    }
    const people: DetectedPerson[] = [];
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen > TRACK_HOLD_MS) {
        console.warn(
          `[PERSON_DEBUG][TRACK] trackId=${id} objectId=${track.detection.id} action=REMOVE lastSeenBefore=${track.lastSeen} lastSeenAfter=${track.lastSeen} observedAt=${track.detection.observedAt} frameTime=${this.frameTime} ageMs=${now - track.lastSeen} reason=person_stale`,
        );
        this.tracks.delete(id);
        continue;
      }
      animateTrack(track, now);
      const box = track.display;
      const fitWidth = Number.isFinite(fit.width) && fit.width > 0 ? Math.min(1, fit.width) : 1;
      const fitHeight = Number.isFinite(fit.height) && fit.height > 0 ? Math.min(1, fit.height) : 1;
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
