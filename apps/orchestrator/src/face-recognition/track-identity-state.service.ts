import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FaceAssessBoundingBox } from './face-quality-gate.client';
import {
  type FaceTrackOptimizationConfig,
  readFaceTrackOptimizationConfig,
} from './face-track-optimization.config';

export type TrackIdentityState =
  'COLLECTING' | 'PENDING_RECOGNITION' | 'KNOWN' | 'UNKNOWN' | 'UNDETERMINED';

export interface BestShotCandidate {
  imageBuffer: Buffer;
  qualityScore: number;
  embedding: Float32Array | null;
  embeddingBase64: string | null;
  appearanceSignature: Float32Array | null;
  faceBoundingBox: FaceAssessBoundingBox | null;
  personBox: number[] | null;
  capturedAt: number;
  failOpenApplied?: boolean;
}

export interface TrackRecord {
  key: string;
  cameraSlug: string;
  trackId: string;
  canonicalTrackId?: string;
  eventId: string;
  cameraId: string | null;
  ownerScopeId: string;
  collectionVersion: number;
  sourceSessionId: string;
  state: TrackIdentityState;
  currentRevision: number;
  pendingRevision: number | null;
  firstSeenAt: number;
  bestShotWindowStartedAt: number | null;
  lastUpdatedAt: number;
  lastSampleAttemptAt: number | null;
  samplesCollected: number;
  bestShot: BestShotCandidate | null;
  dispatchedQualityScore: number | null;
  dispatchedEmbedding: Float32Array | null;
  dispatchedAppearanceSignature: Float32Array | null;
  dispatchedBox: number[] | null;
  dispatchedAt: number | null;
  lastResultAt: number | null;
  unknownRecheckUsed: boolean;
  undeterminedRetriesUsed: number;
  matchedKnownFaceId: string | null;
  matchedPersonName: string | null;
  lastBox: number[] | null;
  endedAt: number | null;
}

export interface TrackMetrics {
  tracksCreated: number;
  gateRejected: number;
  sessionCacheHits: number;
  spatialReidHits: number;
  dispatched: number;
  frozenKnownSkips: number;
  pendingSkips: number;
  retriesDispatched: number;
}

const MAX_TRACK_RECORDS = 5000;

/**
 * Layer 1 track-level identity state machine keyed by (cameraSlug, trackId).
 * Prevents redundant cloud recognition calls once a track is KNOWN or in-flight,
 * while permitting bounded retries for UNDETERMINED and a single quality-jump recheck for UNKNOWN.
 */
@Injectable()
export class TrackIdentityStateService {
  private readonly optConfig: FaceTrackOptimizationConfig;
  private readonly tracks = new Map<string, TrackRecord>();
  private readonly eventIdToKey = new Map<string, string>();
  private readonly metrics: TrackMetrics = {
    tracksCreated: 0,
    gateRejected: 0,
    sessionCacheHits: 0,
    spatialReidHits: 0,
    dispatched: 0,
    frozenKnownSkips: 0,
    pendingSkips: 0,
    retriesDispatched: 0,
  };

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.optConfig = readFaceTrackOptimizationConfig(this.configService);
  }

  static makeKey(cameraSlug: string, trackId: string): string {
    return `${cameraSlug}:${trackId}`;
  }

  getOrCreate(
    input: {
      cameraSlug: string;
      trackId: string;
      eventId: string;
      cameraId: string | null;
      ownerScopeId: string;
      collectionVersion: number;
      sourceSessionId: string;
      canonicalTrackId?: string;
    },
    now = Date.now(),
  ): { record: TrackRecord; created: boolean } {
    this.cleanup(now);
    const key = TrackIdentityStateService.makeKey(input.cameraSlug, input.trackId);
    const existing = this.tracks.get(key);
    if (existing) {
      existing.lastUpdatedAt = now;
      if (input.canonicalTrackId) existing.canonicalTrackId = input.canonicalTrackId;
      if (existing.state === 'COLLECTING') {
        existing.collectionVersion = input.collectionVersion;
      }
      this.tracks.delete(key);
      this.tracks.set(key, existing);
      this.eventIdToKey.set(existing.eventId, key);
      return { record: existing, created: false };
    }

    const record: TrackRecord = {
      key,
      cameraSlug: input.cameraSlug,
      trackId: input.trackId,
      canonicalTrackId: input.canonicalTrackId,
      eventId: input.eventId,
      cameraId: input.cameraId,
      ownerScopeId: input.ownerScopeId,
      collectionVersion: input.collectionVersion,
      sourceSessionId: input.sourceSessionId,
      state: 'COLLECTING',
      currentRevision: 0,
      pendingRevision: null,
      firstSeenAt: now,
      bestShotWindowStartedAt: null,
      lastUpdatedAt: now,
      lastSampleAttemptAt: null,
      samplesCollected: 0,
      bestShot: null,
      dispatchedQualityScore: null,
      dispatchedEmbedding: null,
      dispatchedAppearanceSignature: null,
      dispatchedBox: null,
      dispatchedAt: null,
      lastResultAt: null,
      unknownRecheckUsed: false,
      undeterminedRetriesUsed: 0,
      matchedKnownFaceId: null,
      matchedPersonName: null,
      lastBox: null,
      endedAt: null,
    };

    this.tracks.set(key, record);
    this.eventIdToKey.set(input.eventId, key);
    this.metrics.tracksCreated += 1;
    this.enforceMaxCapacity();
    return { record, created: true };
  }

  get(cameraSlug: string, trackId: string, now = Date.now()): TrackRecord | null {
    this.cleanup(now);
    return this.tracks.get(TrackIdentityStateService.makeKey(cameraSlug, trackId)) ?? null;
  }

  findByEventId(eventId: string, now = Date.now()): TrackRecord | null {
    this.cleanup(now);
    const key = this.eventIdToKey.get(eventId);
    if (!key) return null;
    return this.tracks.get(key) ?? null;
  }

  recordFrozenKnownSkip(): void {
    this.metrics.frozenKnownSkips += 1;
  }

  recordPendingSkip(): void {
    this.metrics.pendingSkips += 1;
  }

  recordGateRejected(): void {
    this.metrics.gateRejected += 1;
  }

  recordSessionCacheHit(): void {
    this.metrics.sessionCacheHits += 1;
  }

  recordSpatialReidHit(): void {
    this.metrics.spatialReidHits += 1;
  }

  updateBestShot(record: TrackRecord, candidate: BestShotCandidate, now = Date.now()): void {
    record.bestShotWindowStartedAt ??= now;
    record.samplesCollected += 1;
    record.lastUpdatedAt = now;
    if (
      !record.bestShot ||
      (record.bestShot.failOpenApplied && !candidate.failOpenApplied) ||
      candidate.qualityScore > record.bestShot.qualityScore
    ) {
      record.bestShot = candidate;
    }
  }

  markDispatched(
    record: TrackRecord,
    shot: {
      qualityScore: number;
      embedding: Float32Array | null;
      appearanceSignature: Float32Array | null;
      box: number[] | null;
    },
    isRetry: boolean,
    now = Date.now(),
  ): number {
    const nextRevision = record.currentRevision + 1;
    record.currentRevision = nextRevision;
    record.pendingRevision = nextRevision;
    record.state = 'PENDING_RECOGNITION';
    record.dispatchedQualityScore = shot.qualityScore;
    record.dispatchedEmbedding = shot.embedding;
    record.dispatchedAppearanceSignature = shot.appearanceSignature;
    record.dispatchedBox = shot.box ? [...shot.box] : record.lastBox ? [...record.lastBox] : null;
    record.dispatchedAt = now;
    record.lastUpdatedAt = now;
    record.bestShot = null;
    this.metrics.dispatched += 1;
    if (isRetry) {
      this.metrics.retriesDispatched += 1;
    }
    return nextRevision;
  }

  revertFailedDispatch(record: TrackRecord, now = Date.now()): void {
    record.pendingRevision = null;
    record.state = 'UNDETERMINED';
    record.lastResultAt = now;
    record.lastUpdatedAt = now;
  }

  markKnownFromLocalCache(
    record: TrackRecord,
    knownFaceId: string,
    personName: string | null,
    revision: number,
    box: number[] | null,
    now = Date.now(),
  ): void {
    record.state = 'KNOWN';
    record.currentRevision = Math.max(record.currentRevision, revision);
    record.pendingRevision = null;
    record.matchedKnownFaceId = knownFaceId;
    record.matchedPersonName = personName;
    record.bestShot = null;
    if (box) record.lastBox = [...box];
    record.lastResultAt = now;
    record.lastUpdatedAt = now;
  }

  applyRecognitionResult(
    input: {
      cameraSlug?: string;
      trackId?: string;
      eventId: string;
      revision: number;
      personStatus: 'KNOWN' | 'UNKNOWN' | 'UNDETERMINED';
      matchedKnownFaceId?: string | null;
      matchedPersonName?: string | null;
      disposition?: 'ACCEPTED' | 'DUPLICATE' | 'STALE';
      errorCode?: string | null;
    },
    now = Date.now(),
  ): TrackRecord | null {
    const record =
      (input.cameraSlug && input.trackId
        ? this.tracks.get(TrackIdentityStateService.makeKey(input.cameraSlug, input.trackId))
        : undefined) ?? this.findByEventId(input.eventId, now);

    if (!record) return null;

    // KNOWN is frozen forever for this track.
    if (record.state === 'KNOWN') {
      return record;
    }

    if (input.revision < record.currentRevision) {
      return record;
    }

    record.pendingRevision = null;
    record.lastResultAt = now;
    record.lastUpdatedAt = now;

    if (input.disposition === 'STALE' || input.errorCode) {
      record.state = 'UNDETERMINED';
      return record;
    }

    if (input.personStatus === 'KNOWN' && input.matchedKnownFaceId) {
      record.state = 'KNOWN';
      record.matchedKnownFaceId = input.matchedKnownFaceId;
      record.matchedPersonName = input.matchedPersonName ?? null;
      record.bestShot = null;
      return record;
    }

    if (input.personStatus === 'UNKNOWN') {
      record.state = 'UNKNOWN';
      return record;
    }

    record.state = 'UNDETERMINED';
    return record;
  }

  canRetryUnknown(record: TrackRecord, qualityScore: number, failOpenApplied?: boolean): boolean {
    if (record.state !== 'UNKNOWN') return false;
    if (!this.optConfig.unknownAllowSingleRecheck || record.unknownRecheckUsed) return false;
    if (failOpenApplied) return false;
    return (
      qualityScore >=
      (record.dispatchedQualityScore ?? 0) + this.optConfig.unknownRecheckMinQualityGain
    );
  }

  canAttemptUndeterminedRetry(record: TrackRecord, now = Date.now()): boolean {
    if (record.state !== 'UNDETERMINED') return false;
    if (record.undeterminedRetriesUsed >= this.optConfig.undeterminedMaxRetries) return false;
    const lastTime = record.lastResultAt ?? record.dispatchedAt ?? 0;
    return now - lastTime >= this.optConfig.undeterminedRetryCooldownMs;
  }

  canRetryUndeterminedWithScore(
    record: TrackRecord,
    qualityScore: number,
    failOpenApplied?: boolean,
  ): boolean {
    if (failOpenApplied) return false;
    return qualityScore > (record.dispatchedQualityScore ?? 0);
  }

  getMetrics(): TrackMetrics {
    return { ...this.metrics };
  }

  cleanup(now = Date.now()): void {
    const ttl = this.optConfig.trackStateTtlMs;
    for (const [key, record] of this.tracks) {
      if (now - record.lastUpdatedAt > ttl) {
        this.tracks.delete(key);
        if (this.eventIdToKey.get(record.eventId) === key) {
          this.eventIdToKey.delete(record.eventId);
        }
      }
    }
  }

  clear(): void {
    this.tracks.clear();
    this.eventIdToKey.clear();
  }

  private enforceMaxCapacity(): void {
    while (this.tracks.size > MAX_TRACK_RECORDS) {
      const oldest = this.tracks.entries().next().value as [string, TrackRecord] | undefined;
      if (!oldest) break;
      const [key, record] = oldest;
      this.tracks.delete(key);
      if (this.eventIdToKey.get(record.eventId) === key) {
        this.eventIdToKey.delete(record.eventId);
      }
    }
  }
}
