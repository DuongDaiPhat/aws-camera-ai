import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  type FaceTrackOptimizationConfig,
  readFaceTrackOptimizationConfig,
} from './face-track-optimization.config';

export interface FaceSessionScope {
  ownerScopeId: string;
  cameraSlug: string;
  collectionVersion: number;
}

export interface FaceSessionEntry {
  knownFaceId: string;
  personName: string | null;
  trackId: string;
  embedding: Float32Array | null;
  appearanceSignature: Float32Array | null;
  lastBox: number[] | null;
  confirmedAt: number;
  endedAt: number | null;
  expiresAt: number;
  ownerScopeId: string;
  cameraSlug: string;
  collectionVersion: number;
}

export interface EmbeddingMatchResult {
  entry: FaceSessionEntry;
  similarity: number;
}

export interface SpatialAppearanceMatchResult {
  entry: FaceSessionEntry;
  proximityScore: number;
  appearanceSimilarity: number;
}

interface ScopeBucket {
  collectionVersion: number;
  entries: Map<string, FaceSessionEntry>;
}

const APPEARANCE_DIM = 128;
const RGB_SAMPLE_SIZE = 24;
const MAX_ENTRIES_PER_CAMERA = 64;
const MAX_TOTAL_ENTRIES = 2000;

export function isValidBox(box: unknown): box is [number, number, number, number] {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((value) => typeof value === 'number' && Number.isFinite(value))
  );
}

/** Decodes a little-endian Float32 base64 embedding into a unit-normalized Float32Array. */
export function decodeEmbeddingBase64(
  base64: string,
  expectedDim?: number | null,
): Float32Array | null {
  if (!base64 || typeof base64 !== 'string') return null;
  try {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0 || buf.length % 4 !== 0) return null;
    const dim = buf.length / 4;
    if (expectedDim && dim !== expectedDim) return null;
    const vector = new Float32Array(dim);
    let normSq = 0;
    for (let i = 0; i < dim; i++) {
      const value = buf.readFloatLE(i * 4);
      if (!Number.isFinite(value)) return null;
      vector[i] = value;
      normSq += value * value;
    }
    if (normSq <= 0 || !Number.isFinite(normSq)) return null;
    const norm = Math.sqrt(normSq);
    for (let i = 0; i < dim; i++) {
      vector[i] = vector[i]! / norm;
    }
    return vector;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA <= 0 || normB <= 0) return 0;
  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(-1, Math.min(1, raw));
}

function normalizeBoxOrder(box: readonly number[]): [number, number, number, number] {
  const x1 = Math.min(box[0]!, box[2]!);
  const y1 = Math.min(box[1]!, box[3]!);
  const x2 = Math.max(box[0]!, box[2]!);
  const y2 = Math.max(box[1]!, box[3]!);
  return [x1, y1, x2, y2];
}

/**
 * Scale-invariant spatial proximity in [0, 1] combining IoU and scale-consistent
 * bounding-box center proximity so both pixel and normalized Frigate boxes work cleanly.
 */
export function computeBoxProximity(boxA: readonly number[], boxB: readonly number[]): number {
  if (!isValidBox(boxA) || !isValidBox(boxB)) return 0;
  const [ax1, ay1, ax2, ay2] = normalizeBoxOrder(boxA);
  const [bx1, by1, bx2, by2] = normalizeBoxOrder(boxB);

  const wA = Math.max(0, ax2 - ax1);
  const hA = Math.max(0, ay2 - ay1);
  const wB = Math.max(0, bx2 - bx1);
  const hB = Math.max(0, by2 - by1);
  const areaA = wA * hA;
  const areaB = wB * hB;
  if (areaA <= 0 || areaB <= 0) return 0;

  const interW = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const interH = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const interArea = interW * interH;
  const unionArea = areaA + areaB - interArea;
  const iou = unionArea > 0 ? interArea / unionArea : 0;

  const cxA = (ax1 + ax2) / 2;
  const cyA = (ay1 + ay2) / 2;
  const cxB = (bx1 + bx2) / 2;
  const cyB = (by1 + by2) / 2;
  const diag = Math.hypot((wA + wB) / 2, (hA + hB) / 2);
  const normDist = diag > 0 ? Math.hypot(cxA - cxB, cyA - cyB) / diag : Number.POSITIVE_INFINITY;
  const centerProximity = Math.max(0, 1 - normDist);
  const sizeRatio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
  const adjustedCenter = centerProximity * Math.min(1, sizeRatio / 0.35);

  return Math.max(iou, adjustedCenter);
}

function l2NormalizeHistogram(hist: Float32Array): Float32Array | null {
  let normSq = 0;
  for (let i = 0; i < hist.length; i++) {
    const val = hist[i]!;
    normSq += val * val;
  }
  if (normSq <= 0 || !Number.isFinite(normSq)) return null;
  const norm = Math.sqrt(normSq);
  for (let i = 0; i < hist.length; i++) {
    hist[i] = hist[i]! / norm;
  }
  return hist;
}

function computeByteHistogram(buffer: Buffer): Float32Array | null {
  if (buffer.length === 0) return null;
  const hist = new Float32Array(APPEARANCE_DIM);
  const split = Math.max(1, Math.floor(buffer.length / 2));
  const step = Math.max(1, Math.floor(buffer.length / 2048));
  for (let i = 0; i < buffer.length; i += step) {
    const bin = (buffer[i]! >> 2) & 0x3f;
    const offset = i < split ? 0 : 64;
    hist[offset + bin] = hist[offset + bin]! + 1;
  }
  return l2NormalizeHistogram(hist);
}

/**
 * Computes a lightweight L2-normalized upper/lower RGB color histogram from a crop JPEG/PNG,
 * falling back to a deterministic byte histogram for synthetic non-image buffers in unit tests.
 */
export async function computeAppearanceSignature(
  imageBuffer: Buffer,
): Promise<Float32Array | null> {
  if (!imageBuffer || imageBuffer.length === 0) return null;
  try {
    const rawRgb = await sharp(imageBuffer)
      .resize(RGB_SAMPLE_SIZE, RGB_SAMPLE_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const expectedBytes = RGB_SAMPLE_SIZE * RGB_SAMPLE_SIZE * 3;
    if (rawRgb.length >= expectedBytes) {
      const hist = new Float32Array(APPEARANCE_DIM);
      const halfPixels = (RGB_SAMPLE_SIZE * RGB_SAMPLE_SIZE) / 2;
      for (let px = 0; px < RGB_SAMPLE_SIZE * RGB_SAMPLE_SIZE; px++) {
        const base = px * 3;
        const r = rawRgb[base]! >> 6;
        const g = rawRgb[base + 1]! >> 6;
        const b = rawRgb[base + 2]! >> 6;
        const bin = (r << 4) | (g << 2) | b;
        const offset = px < halfPixels ? 0 : 64;
        hist[offset + bin] = hist[offset + bin]! + 1;
      }
      return l2NormalizeHistogram(hist);
    }
  } catch {
    // Non-image buffers (e.g. synthetic test buffers) fall through to deterministic byte histogram.
  }
  return computeByteHistogram(imageBuffer);
}

/**
 * Layer 4 tailgating-safe short-term session cache & spatial-appearance Re-ID.
 * Strictly scoped by (ownerScopeId, cameraSlug, collectionVersion) — never a blind camera cooldown.
 */
@Injectable()
export class FaceSessionCacheService {
  private readonly optConfig: FaceTrackOptimizationConfig;
  private readonly buckets = new Map<string, ScopeBucket>();

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.optConfig = readFaceTrackOptimizationConfig(this.configService);
  }

  upsertKnown(
    scope: FaceSessionScope,
    input: {
      knownFaceId: string;
      personName: string | null;
      trackId: string;
      embedding?: Float32Array | null;
      appearanceSignature?: Float32Array | null;
      lastBox?: number[] | null;
      confirmedAt?: number;
      endedAt?: number | null;
    },
    now = Date.now(),
  ): FaceSessionEntry | null {
    if (!this.optConfig.sessionCacheEnabled && !this.optConfig.spatialReidEnabled) {
      return null;
    }
    const bucket = this.getScopeBucket(scope, true, now)!;
    const existing = bucket.entries.get(input.knownFaceId);
    const confirmedAt = input.confirmedAt ?? now;
    const entry: FaceSessionEntry = {
      knownFaceId: input.knownFaceId,
      personName: input.personName ?? existing?.personName ?? null,
      trackId: input.trackId,
      embedding: input.embedding ?? existing?.embedding ?? null,
      appearanceSignature: input.appearanceSignature ?? existing?.appearanceSignature ?? null,
      lastBox: isValidBox(input.lastBox)
        ? [...input.lastBox]
        : existing?.lastBox
          ? [...existing.lastBox]
          : null,
      confirmedAt,
      endedAt: input.endedAt !== undefined ? input.endedAt : null,
      expiresAt: now + this.optConfig.sessionCacheTtlMs,
      ownerScopeId: scope.ownerScopeId,
      cameraSlug: scope.cameraSlug,
      collectionVersion: scope.collectionVersion,
    };

    bucket.entries.delete(input.knownFaceId);
    bucket.entries.set(input.knownFaceId, entry);
    this.enforceBounds(bucket);
    return entry;
  }

  updateTrackBox(scope: FaceSessionScope, trackId: string, box: number[], now = Date.now()): void {
    if (!isValidBox(box)) return;
    const bucket = this.getScopeBucket(scope, false, now);
    if (!bucket) return;
    for (const entry of bucket.entries.values()) {
      if (entry.trackId === trackId && entry.endedAt === null) {
        entry.lastBox = [...box];
      }
    }
  }

  markTrackEnded(
    scope: FaceSessionScope,
    trackId: string,
    endedAt = Date.now(),
    lastBox?: number[] | null,
  ): void {
    const bucket = this.getScopeBucket(scope, false, endedAt);
    if (!bucket) return;
    for (const entry of bucket.entries.values()) {
      if (entry.trackId === trackId) {
        entry.endedAt = endedAt;
        if (isValidBox(lastBox)) {
          entry.lastBox = [...lastBox];
        }
      }
    }
  }

  hasRecentlyEndedKnownTrack(scope: FaceSessionScope, now = Date.now()): boolean {
    if (!this.optConfig.spatialReidEnabled) return false;
    const bucket = this.getScopeBucket(scope, false, now);
    if (!bucket) return false;
    for (const entry of bucket.entries.values()) {
      if (
        entry.endedAt !== null &&
        now >= entry.endedAt &&
        now - entry.endedAt <= this.optConfig.spatialReidMaxGapMs
      ) {
        return true;
      }
    }
    return false;
  }

  matchByEmbedding(
    scope: FaceSessionScope,
    embedding: Float32Array | null,
    now = Date.now(),
  ): EmbeddingMatchResult | null {
    if (!this.optConfig.sessionCacheEnabled || !embedding || embedding.length === 0) {
      return null;
    }
    const bucket = this.getScopeBucket(scope, false, now);
    if (!bucket) return null;

    let best: EmbeddingMatchResult | null = null;
    for (const entry of bucket.entries.values()) {
      if (!entry.embedding) continue;
      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (
        similarity >= this.optConfig.sessionCacheSimilarityThreshold &&
        (!best || similarity > best.similarity)
      ) {
        best = { entry, similarity };
      }
    }
    return best;
  }

  matchBySpatialAppearance(
    scope: FaceSessionScope,
    box: number[] | null | undefined,
    appearanceSignature: Float32Array | null,
    now = Date.now(),
  ): SpatialAppearanceMatchResult | null {
    if (
      !this.optConfig.spatialReidEnabled ||
      !isValidBox(box) ||
      !appearanceSignature ||
      appearanceSignature.length === 0
    ) {
      return null;
    }
    const bucket = this.getScopeBucket(scope, false, now);
    if (!bucket) return null;

    let best: SpatialAppearanceMatchResult | null = null;
    let bestCombined = -1;
    for (const entry of bucket.entries.values()) {
      if (
        entry.endedAt === null ||
        now < entry.endedAt ||
        now - entry.endedAt > this.optConfig.spatialReidMaxGapMs ||
        !entry.lastBox ||
        !entry.appearanceSignature
      ) {
        continue;
      }

      const proximityScore = computeBoxProximity(box, entry.lastBox);
      if (proximityScore < this.optConfig.spatialReidMinProximityScore) continue;

      const appearanceSimilarity = cosineSimilarity(appearanceSignature, entry.appearanceSignature);
      if (appearanceSimilarity < this.optConfig.spatialReidMinAppearanceSimilarity) continue;

      const combined = proximityScore + appearanceSimilarity;
      if (combined > bestCombined) {
        bestCombined = combined;
        best = { entry, proximityScore, appearanceSimilarity };
      }
    }
    return best;
  }

  invalidateOwner(ownerScopeId: string): void {
    const prefix = `${ownerScopeId}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) {
        this.buckets.delete(key);
      }
    }
  }

  clear(): void {
    this.buckets.clear();
  }

  private scopeBucketKey(scope: FaceSessionScope): string {
    return `${scope.ownerScopeId}:${scope.cameraSlug}`;
  }

  private getScopeBucket(
    scope: FaceSessionScope,
    createIfMissing: boolean,
    now: number,
  ): ScopeBucket | null {
    const key = this.scopeBucketKey(scope);
    let bucket = this.buckets.get(key);

    // Changing collectionVersion invalidates all prior cached entries for this owner/camera.
    if (bucket && bucket.collectionVersion !== scope.collectionVersion) {
      this.buckets.delete(key);
      bucket = undefined;
    }

    if (bucket) {
      for (const [faceId, entry] of bucket.entries) {
        if (entry.expiresAt <= now) {
          bucket.entries.delete(faceId);
        }
      }
      if (bucket.entries.size === 0 && !createIfMissing) {
        this.buckets.delete(key);
        return null;
      }
      return bucket;
    }

    if (!createIfMissing) return null;
    const created: ScopeBucket = {
      collectionVersion: scope.collectionVersion,
      entries: new Map(),
    };
    this.buckets.set(key, created);
    return created;
  }

  private enforceBounds(currentBucket: ScopeBucket): void {
    while (currentBucket.entries.size > MAX_ENTRIES_PER_CAMERA) {
      const oldestKey = currentBucket.entries.keys().next().value;
      if (oldestKey === undefined) break;
      currentBucket.entries.delete(oldestKey);
    }

    let total = 0;
    for (const bucket of this.buckets.values()) {
      total += bucket.entries.size;
    }
    while (total > MAX_TOTAL_ENTRIES) {
      let evicted = false;
      for (const [bucketKey, bucket] of this.buckets) {
        const oldestKey = bucket.entries.keys().next().value;
        if (oldestKey !== undefined) {
          bucket.entries.delete(oldestKey);
          total -= 1;
          evicted = true;
          if (bucket.entries.size === 0) {
            this.buckets.delete(bucketKey);
          }
          break;
        }
      }
      if (!evicted) break;
    }
  }
}
