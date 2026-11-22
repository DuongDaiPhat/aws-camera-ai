import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { AiResultsService } from '../ai-results/ai-results.service';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import {
  CloudQueueService,
  type FaceRecognitionResultListener,
  type RecognitionResultNotification,
} from '../cloud-queue/cloud-queue.service';
import { DatabaseService } from '../database/database.service';
import { type CameraRecord, type EventRecord, EventsRepository } from '../events/events.repository';
import { FrigateDetectionTrackerService } from '../frigate/frigate-detection-tracker.service';
import type { FrigateEventAfterDto } from '../ingestion/dto/frigate-event.dto';
import { readFaceProvider } from '../known-faces/face-config';
import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { type FaceAssessBoundingBox, FaceQualityGateClient } from './face-quality-gate.client';
import {
  computeAppearanceSignature,
  decodeEmbeddingBase64,
  type FaceSessionScope,
  FaceSessionCacheService,
  isValidBox,
} from './face-session-cache.service';
import {
  type FaceTrackOptimizationConfig,
  readFaceTrackOptimizationConfig,
} from './face-track-optimization.config';
import type { MatchFaceJob } from './face-recognition.worker';
import {
  type BestShotCandidate,
  TrackIdentityStateService,
  type TrackRecord,
} from './track-identity-state.service';

export interface FaceTrackEventInput {
  messageType: 'new' | 'update' | 'end';
  event: EventRecord;
  after: FrigateEventAfterDto;
  isCreated: boolean;
  camera: CameraRecord | null;
}

const DEFAULT_OWNER_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
const LOCAL_CACHE_UUID_NAMESPACE = Buffer.from('7a9d3b104c5e41d9a2f08844c1f509ab', 'hex');

function deterministicUuid(identity: string): string {
  const bytes = createHash('sha1')
    .update(LOCAL_CACHE_UUID_NAMESPACE)
    .update(identity)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Coordinates Layer 1-4 face recognition pipeline:
 * Track state machine -> Local Quality Gate -> Best-Shot selection ->
 * Tailgating-safe Local Session Cache / Spatial-Appearance Re-ID -> SQS or BullMQ dispatch.
 */
@Injectable()
export class FaceRecognitionCoordinatorService
  implements FaceRecognitionResultListener, OnModuleDestroy
{
  private readonly logger = new Logger(FaceRecognitionCoordinatorService.name);
  private readonly optConfig: FaceTrackOptimizationConfig;
  private readonly windowTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: TrackIdentityStateService,
    private readonly sessionCache: FaceSessionCacheService,
    private readonly qualityGateClient: FaceQualityGateClient,
    private readonly frigateMedia: FrigateMediaAdapter,
    private readonly aiResultsService: AiResultsService,
    @Optional() private readonly eventsRepository?: EventsRepository,
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() private readonly cloudQueue?: CloudQueueService,
    @Optional() @InjectQueue('face-recognition') private readonly faceQueue?: Queue<MatchFaceJob>,
    @Optional() private readonly detectionTracker?: FrigateDetectionTrackerService,
  ) {
    this.optConfig = readFaceTrackOptimizationConfig(this.configService);
    this.cloudQueue?.registerRecognitionResultListener(this);
  }

  onModuleDestroy(): void {
    for (const timer of this.windowTimers.values()) {
      clearTimeout(timer);
    }
    this.windowTimers.clear();
  }

  async handleTrackEvent(input: FaceTrackEventInput): Promise<void> {
    if (!this.optConfig.enabled) {
      await this.handleLegacyDispatch(input);
      return;
    }
    if (!this.isTrackEligible(input)) {
      return;
    }

    const now = Date.now();
    const record = await this.ensureTrackRecord(input, now);
    const scope: FaceSessionScope = {
      ownerScopeId: record.ownerScopeId,
      cameraSlug: record.cameraSlug,
      collectionVersion: record.collectionVersion,
    };

    if (input.messageType === 'end') {
      await this.handleTrackEnd(record, scope, now);
      return;
    }
    if (!this.canAttemptSample(record, scope, now)) {
      return;
    }

    record.lastSampleAttemptAt = now;
    const cropBuffer = await this.frigateMedia.getCroppedSnapshot(record.trackId);
    if (!cropBuffer || cropBuffer.length === 0 || this.isTrackLocked(record)) {
      return;
    }

    const appearanceSignature = await computeAppearanceSignature(cropBuffer);
    if (await this.trySpatialAppearanceReid(record, scope, appearanceSignature, now)) {
      return;
    }

    const gateResult = await this.qualityGateClient.assess(cropBuffer);
    if (this.isTrackLocked(record)) {
      return;
    }
    if (!gateResult.passed) {
      this.stateService.recordGateRejected();
      return;
    }

    const embedding = gateResult.embeddingBase64
      ? decodeEmbeddingBase64(gateResult.embeddingBase64, gateResult.embeddingDim)
      : null;
    if (
      await this.tryEmbeddingSessionCache(
        record,
        scope,
        embedding,
        appearanceSignature,
        gateResult.boundingBox,
        gateResult.modelVersion,
        now,
      )
    ) {
      return;
    }

    const candidate: BestShotCandidate = {
      imageBuffer: cropBuffer,
      qualityScore: gateResult.qualityScore,
      embedding,
      embeddingBase64: gateResult.embeddingBase64,
      appearanceSignature,
      faceBoundingBox: gateResult.boundingBox,
      personBox: record.lastBox,
      capturedAt: now,
      failOpenApplied: gateResult.failOpenApplied,
    };
    await this.handleEvaluatedCandidate(record, candidate, now);
  }

  private isTrackEligible({ event, isCreated }: FaceTrackEventInput): boolean {
    if (event.status === 'RESOLVED' || event.status === 'CLOSED') {
      return false;
    }
    if (
      isCreated &&
      event.event_type !== 'PERSON_DETECTED' &&
      event.event_type !== 'RESTRICTED_ZONE'
    ) {
      return false;
    }
    return true;
  }

  private async ensureTrackRecord(
    { event, after, camera }: FaceTrackEventInput,
    now: number,
  ): Promise<TrackRecord> {
    const ownerScopeId = camera?.owner_user_id ?? DEFAULT_OWNER_SCOPE_ID;
    const collectionVersion = await this.resolveCollectionVersion(ownerScopeId);
    const sourceSessionId = this.resolveSourceSessionId(after, event);
    const canonicalTrackId = this.detectionTracker?.getCanonicalTrackId(after.camera, after.id);

    const { record } = this.stateService.getOrCreate(
      {
        cameraSlug: after.camera,
        trackId: after.id,
        eventId: event.id,
        cameraId: camera?.id ?? event.camera_id ?? null,
        ownerScopeId,
        collectionVersion,
        sourceSessionId,
        canonicalTrackId,
      },
      now,
    );
    if (isValidBox(after.box)) {
      record.lastBox = [...after.box];
    }
    return record;
  }

  private async handleTrackEnd(
    record: TrackRecord,
    scope: FaceSessionScope,
    now: number,
  ): Promise<void> {
    record.endedAt = now;
    this.clearWindowTimer(record.key);
    if (record.state === 'KNOWN') {
      this.sessionCache.markTrackEnded(scope, record.trackId, now, record.lastBox);
      this.stateService.recordFrozenKnownSkip();
      return;
    }
    if (record.state === 'PENDING_RECOGNITION') {
      this.stateService.recordPendingSkip();
      return;
    }
    if (record.state === 'COLLECTING' && record.bestShot) {
      await this.dispatchBestShot(record, record.bestShot, false, now);
    }
  }

  private canAttemptSample(record: TrackRecord, scope: FaceSessionScope, now: number): boolean {
    if (record.state === 'KNOWN') {
      if (record.lastBox) {
        this.sessionCache.updateTrackBox(scope, record.trackId, record.lastBox, now);
      }
      this.stateService.recordFrozenKnownSkip();
      return false;
    }
    if (record.state === 'PENDING_RECOGNITION') {
      this.stateService.recordPendingSkip();
      return false;
    }
    if (
      record.state === 'UNKNOWN' &&
      (!this.optConfig.unknownAllowSingleRecheck || record.unknownRecheckUsed)
    ) {
      return false;
    }
    if (
      record.state === 'UNDETERMINED' &&
      !this.stateService.canAttemptUndeterminedRetry(record, now)
    ) {
      return false;
    }
    return (
      record.lastSampleAttemptAt === null ||
      now - record.lastSampleAttemptAt >= this.optConfig.minSampleIntervalMs
    );
  }

  private async trySpatialAppearanceReid(
    record: TrackRecord,
    scope: FaceSessionScope,
    appearanceSignature: Float32Array | null,
    now: number,
  ): Promise<boolean> {
    if (
      record.state !== 'COLLECTING' ||
      !this.optConfig.spatialReidEnabled ||
      !isValidBox(record.lastBox) ||
      !this.sessionCache.hasRecentlyEndedKnownTrack(scope, now)
    ) {
      return false;
    }
    const reidMatch = this.sessionCache.matchBySpatialAppearance(
      scope,
      record.lastBox,
      appearanceSignature,
      now,
    );
    if (!reidMatch) {
      return false;
    }
    this.stateService.recordSpatialReidHit();
    await this.applyLocalCacheHit(record, scope, {
      knownFaceId: reidMatch.entry.knownFaceId,
      personName: reidMatch.entry.personName,
      embedding: reidMatch.entry.embedding,
      appearanceSignature: appearanceSignature ?? reidMatch.entry.appearanceSignature,
      similarity: reidMatch.appearanceSimilarity,
      boundingBox: null,
      matchMethod: 'spatial-appearance',
      modelVersion: 'local-session-cache-v1',
      now,
    });
    return true;
  }

  private async tryEmbeddingSessionCache(
    record: TrackRecord,
    scope: FaceSessionScope,
    embedding: Float32Array | null,
    appearanceSignature: Float32Array | null,
    boundingBox: FaceAssessBoundingBox | null,
    modelVersion: string,
    now: number,
  ): Promise<boolean> {
    if (!embedding || !this.optConfig.sessionCacheEnabled) {
      return false;
    }
    const cacheHit = this.sessionCache.matchByEmbedding(scope, embedding, now);
    if (!cacheHit) {
      return false;
    }
    this.stateService.recordSessionCacheHit();
    await this.applyLocalCacheHit(record, scope, {
      knownFaceId: cacheHit.entry.knownFaceId,
      personName: cacheHit.entry.personName,
      embedding,
      appearanceSignature: appearanceSignature ?? cacheHit.entry.appearanceSignature,
      similarity: cacheHit.similarity,
      boundingBox,
      matchMethod: 'embedding',
      modelVersion,
      now,
    });
    return true;
  }

  private async handleEvaluatedCandidate(
    record: TrackRecord,
    candidate: BestShotCandidate,
    now: number,
  ): Promise<void> {
    if (record.state === 'UNKNOWN') {
      if (
        !this.stateService.canRetryUnknown(
          record,
          candidate.qualityScore,
          candidate.failOpenApplied,
        )
      ) {
        return;
      }
      record.unknownRecheckUsed = true;
      await this.dispatchBestShot(record, candidate, true, now);
      return;
    }

    if (record.state === 'UNDETERMINED') {
      if (
        !this.stateService.canRetryUndeterminedWithScore(
          record,
          candidate.qualityScore,
          candidate.failOpenApplied,
        )
      ) {
        return;
      }
      record.undeterminedRetriesUsed += 1;
      await this.dispatchBestShot(record, candidate, true, now);
      return;
    }

    this.stateService.updateBestShot(record, candidate, now);
    const elapsed = now - record.firstSeenAt;
    const shouldDispatchNow =
      candidate.qualityScore >= this.optConfig.bestShotEarlyDispatchScore ||
      record.samplesCollected >= this.optConfig.bestShotMaxSamples ||
      elapsed >= this.optConfig.bestShotWindowMs;

    if (shouldDispatchNow && record.bestShot) {
      await this.dispatchBestShot(record, record.bestShot, false, now);
    } else if (record.bestShot) {
      this.ensureWindowTimer(record, now);
    }
  }

  async onRecognitionResult(result: RecognitionResultNotification): Promise<void> {
    if (!this.optConfig.enabled) return;
    const now = Date.now();
    const record = this.stateService.applyRecognitionResult(result, now);

    if (result.disposition === 'STALE') {
      return;
    }

    const cameraSlug = result.cameraSlug ?? record?.cameraSlug;
    const trackId = result.trackId || record?.trackId;
    const ownerScopeId = result.ownerScopeId || record?.ownerScopeId;
    const collectionVersion = result.collectionVersion || record?.collectionVersion || 1;

    if (
      !result.errorCode &&
      result.personStatus === 'KNOWN' &&
      result.matchedKnownFaceId &&
      cameraSlug &&
      trackId &&
      ownerScopeId
    ) {
      const personName =
        result.matchedPersonName ??
        (await this.lookupKnownFaceName(result.matchedKnownFaceId, ownerScopeId));
      if (record) {
        record.matchedPersonName = personName;
      }
      this.sessionCache.upsertKnown(
        { ownerScopeId, cameraSlug, collectionVersion },
        {
          knownFaceId: result.matchedKnownFaceId,
          personName,
          trackId,
          embedding: record?.dispatchedEmbedding ?? null,
          appearanceSignature: record?.dispatchedAppearanceSignature ?? null,
          lastBox: record?.lastBox ?? record?.dispatchedBox ?? null,
          confirmedAt: now,
          endedAt: record?.endedAt ?? null,
        },
        now,
      );
    }
  }

  private async handleLegacyDispatch(input: FaceTrackEventInput): Promise<void> {
    const { event, after, isCreated, camera } = input;
    if (!isCreated) return;
    if (event.event_type !== 'PERSON_DETECTED' && event.event_type !== 'RESTRICTED_ZONE') {
      return;
    }
    const ownerScopeId = camera?.owner_user_id ?? DEFAULT_OWNER_SCOPE_ID;
    const collectionVersion = await this.resolveCollectionVersion(ownerScopeId);
    const transport = this.configService.get<string>('FACE_JOB_TRANSPORT', 'bullmq');

    if (transport === 'sqs') {
      if (!this.cloudQueue || !camera?.id) return;
      await this.cloudQueue.enqueueFaceJob({
        eventId: event.id,
        cameraId: camera.id,
        ownerScopeId,
        trackId: after.id,
        sourceSessionId: this.resolveSourceSessionId(after, event),
        revision: 1,
      });
      return;
    }

    if (transport === 'bullmq' && this.faceQueue) {
      await this.faceQueue.add('match_face', {
        eventId: event.id,
        trackId: after.id,
        cameraSlug: after.camera,
        ownerScopeId,
        collectionVersion,
        sourceSessionId:
          typeof after.start_time === 'number'
            ? `${after.camera}:${after.start_time.toFixed(6)}`
            : undefined,
      });
    }
  }

  private async dispatchBestShot(
    record: TrackRecord,
    candidate: BestShotCandidate,
    isRetry: boolean,
    now: number,
  ): Promise<void> {
    this.clearWindowTimer(record.key);
    const revision = this.stateService.markDispatched(
      record,
      {
        qualityScore: candidate.qualityScore,
        embedding: candidate.embedding,
        appearanceSignature: candidate.appearanceSignature,
        box: candidate.personBox ?? record.lastBox,
      },
      isRetry,
      now,
    );

    const transport = this.configService.get<string>('FACE_JOB_TRANSPORT', 'bullmq');
    try {
      if (transport === 'sqs') {
        if (!this.cloudQueue || !record.cameraId) {
          this.logger.warn(
            {
              eventId: record.eventId,
              trackId: record.trackId,
              hasCameraId: Boolean(record.cameraId),
            },
            'Skipping SQS face dispatch because CloudQueueService or cameraId is unavailable',
          );
          this.stateService.revertFailedDispatch(record, now);
          return;
        }
        await this.cloudQueue.enqueueFaceJob({
          eventId: record.eventId,
          cameraId: record.cameraId,
          ownerScopeId: record.ownerScopeId,
          trackId: record.trackId,
          sourceSessionId: record.sourceSessionId,
          revision,
          imageBuffer: candidate.imageBuffer,
        });
        return;
      }

      if (!this.faceQueue) {
        this.stateService.revertFailedDispatch(record, now);
        return;
      }

      await this.faceQueue.add('match_face', {
        eventId: record.eventId,
        trackId: record.trackId,
        cameraSlug: record.cameraSlug,
        ownerScopeId: record.ownerScopeId,
        collectionVersion: record.collectionVersion,
        sourceSessionId: record.sourceSessionId,
        revision,
        imageBase64: candidate.imageBuffer.toString('base64'),
      });
    } catch (error) {
      this.logger.warn(
        {
          eventId: record.eventId,
          trackId: record.trackId,
          revision,
          error: error instanceof Error ? error.message : 'unknown',
        },
        'Failed to dispatch face recognition job',
      );
      this.stateService.revertFailedDispatch(record, now);
    }
  }

  private isTrackLocked(record: TrackRecord): boolean {
    return record.state === 'KNOWN' || record.state === 'PENDING_RECOGNITION';
  }

  private async applyLocalCacheHit(
    record: TrackRecord,
    scope: FaceSessionScope,
    hit: {
      knownFaceId: string;
      personName: string | null;
      embedding: Float32Array | null;
      appearanceSignature: Float32Array | null;
      similarity: number;
      boundingBox: FaceAssessBoundingBox | null;
      matchMethod: 'embedding' | 'spatial-appearance';
      modelVersion: string;
      now: number;
    },
  ): Promise<void> {
    this.clearWindowTimer(record.key);
    const revision = record.currentRevision + 1;
    this.stateService.markKnownFromLocalCache(
      record,
      hit.knownFaceId,
      hit.personName,
      revision,
      record.lastBox,
      hit.now,
    );
    this.sessionCache.upsertKnown(
      scope,
      {
        knownFaceId: hit.knownFaceId,
        personName: hit.personName,
        trackId: record.trackId,
        embedding: hit.embedding,
        appearanceSignature: hit.appearanceSignature,
        lastBox: record.lastBox,
        confirmedAt: hit.now,
        endedAt: null,
      },
      hit.now,
    );
    await this.submitLocalCacheHit(
      record,
      hit.knownFaceId,
      hit.personName,
      hit.similarity,
      hit.boundingBox,
      hit.matchMethod,
      revision,
      hit.now,
      hit.modelVersion,
    );
  }

  private async submitLocalCacheHit(
    record: TrackRecord,
    knownFaceId: string,
    personName: string | null,
    similarity: number,
    boundingBox: FaceAssessBoundingBox | null,
    matchMethod: 'embedding' | 'spatial-appearance',
    revision: number,
    now: number,
    modelVersion = 'local-session-cache-v1',
  ): Promise<void> {
    const observationId = `track:${record.trackId}:face`;
    const normalizedSim = Math.max(0, Math.min(1, Number(similarity.toFixed(6))));
    const resultId = deterministicUuid(
      `${record.eventId}:${observationId}:${revision}:local-session-cache:${knownFaceId}`,
    );

    const dto: SubmitAiResultDto = {
      schemaVersion: 1,
      resultId,
      requestId: resultId,
      eventId: record.eventId,
      observationId,
      revision,
      module: 'M1_FACE',
      modelVersion,
      processedAt: new Date(now).toISOString(),
      personStatus: 'KNOWN',
      matchedKnownFaceId: knownFaceId,
      collectionVersion: record.collectionVersion,
      results: [
        {
          module: 'M1_FACE',
          label: 'KNOWN',
          confidence: normalizedSim,
          boundingBox,
          metadata: {
            sourceSessionId: record.sourceSessionId,
            similarity: normalizedSim,
            confidencePolicyVersion: 'local-session-cache-v1',
            provider: 'local-session-cache',
            cacheHit: true,
            matchMethod,
            collectionVersion: record.collectionVersion,
            ...(personName ? { matchedPersonName: personName } : {}),
          },
        },
      ],
      error: null,
    };

    try {
      await this.aiResultsService.submit(record.eventId, dto);
    } catch (error) {
      this.logger.warn(
        {
          eventId: record.eventId,
          trackId: record.trackId,
          error: error instanceof Error ? error.message : 'unknown',
        },
        'Failed to submit local session cache hit result',
      );
    }
  }

  private ensureWindowTimer(record: TrackRecord, now: number): void {
    if (this.windowTimers.has(record.key)) return;
    const remainingMs = Math.max(1, record.firstSeenAt + this.optConfig.bestShotWindowMs - now);
    const timer = setTimeout(() => {
      this.windowTimers.delete(record.key);
      const current = this.stateService.get(record.cameraSlug, record.trackId);
      if (!current || current.state !== 'COLLECTING' || !current.bestShot) return;
      void this.dispatchBestShot(current, current.bestShot, false, Date.now());
    }, remainingMs);
    timer.unref?.();
    this.windowTimers.set(record.key, timer);
  }

  private clearWindowTimer(key: string): void {
    const timer = this.windowTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.windowTimers.delete(key);
    }
  }

  private resolveSourceSessionId(after: FrigateEventAfterDto, event: EventRecord): string {
    if (typeof after.start_time === 'number' && Number.isFinite(after.start_time)) {
      return `${after.camera}:${after.start_time.toFixed(6)}`;
    }
    return `${after.camera}:${(event.detected_at.getTime() / 1000).toFixed(6)}`;
  }

  private async resolveCollectionVersion(ownerScopeId: string): Promise<number> {
    const transport = this.configService.get<string>('FACE_JOB_TRANSPORT', 'bullmq');
    const provider = readFaceProvider(this.configService);
    if ((transport === 'sqs' || provider === 'rekognition') && this.databaseService) {
      try {
        const res = await this.databaseService.query<{ version: number }>(
          'SELECT version FROM cloud_face_collections WHERE owner_user_id = $1 LIMIT 1',
          [ownerScopeId],
        );
        return res.rows[0]?.version ?? 1;
      } catch {
        return 1;
      }
    }
    if (this.eventsRepository) {
      try {
        return await this.eventsRepository.getSyncedFaceCollectionVersion(ownerScopeId);
      } catch {
        return 1;
      }
    }
    return 1;
  }

  private async lookupKnownFaceName(
    knownFaceId: string,
    ownerScopeId: string,
  ): Promise<string | null> {
    if (!this.databaseService) return null;
    try {
      const res = await this.databaseService.query<{ person_name: string }>(
        'SELECT person_name FROM known_faces WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
        [knownFaceId, ownerScopeId],
      );
      return res.rows[0]?.person_name ?? null;
    } catch {
      return null;
    }
  }
}
