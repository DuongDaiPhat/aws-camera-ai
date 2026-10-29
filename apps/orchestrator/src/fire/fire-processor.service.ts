import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import { MediaService } from '../media/media.service';
import { EventsService } from '../events/events.service';
import { FireAiClient } from './fire-ai.client';
import { FireConfig } from './fire.config';
import type { ConfirmedFireResponse, FireFrame, FireResponseDto } from './fire.dto';
import {
  hasConfirmedFire,
  validateFireConfirmation,
  validateFireObservation,
  type FireObservation,
} from './fire-evidence.validator';
import { FireIncidentsRepository } from './fire-incidents.repository';
import { FireStaleFrameError } from './fire-frame.codec';
import { FireTelemetry } from './fire-telemetry.service';

interface CameraEvidence {
  session: string;
  lastAt: number;
  lastId: string;
  aiSession: string | null;
  hasConfirmation: boolean;
  observations: FireObservation[];
  negativeSince: number | null;
  pending?: {
    cameraId: string;
    evidence: ConfirmedFireResponse;
    payload: SubmitAiResultDto;
    frame: FireFrame;
    retryAt: number;
    busy: boolean;
  };
}
const MAX_METADATA_DETECTIONS = 32;

@Injectable()
export class FireProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FireProcessorService.name);
  private readonly cameras = new Map<string, CameraEvidence>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly config: FireConfig,
    private readonly ai: FireAiClient,
    private readonly repository: FireIncidentsRepository,
    private readonly media: MediaService,
    private readonly events: EventsService,
    private readonly telemetry: FireTelemetry,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => {
      for (const [camera, state] of this.cameras) {
        void this.persistPending(state).catch((error) =>
          this.logger.error({ cameraSlug: camera, err: error }, 'Fire confirmation retry failed'),
        );
      }
    }, this.config.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async process(frame: FireFrame): Promise<void> {
    if (!this.config.enabled) return;
    if (!this.isFresh(frame)) {
      this.telemetry.counters.staleFrames++;
      return;
    }
    const cameraId = await this.repository.findEnabledCamera(frame.header.cameraSlug);
    if (!cameraId) return;
    const state = this.admit(frame);
    if (!state) return;
    await this.persistPending(state);
    const effectiveFrame = state.aiSession
      ? { ...frame, header: { ...frame.header, sourceSessionId: state.aiSession } }
      : frame;
    try {
      const result = await this.ai.detect(effectiveFrame);
      validateFireObservation(effectiveFrame, result, this.config);
      if (!this.isFresh(frame)) throw new FireStaleFrameError();
      await this.applyObservation(cameraId, effectiveFrame, result, state);
      this.recordObservation(frame, result);
    } catch (error) {
      if (error instanceof FireStaleFrameError) this.telemetry.counters.staleFrames++;
      this.telemetry.failed(frame.header.cameraSlug, 'OBSERVATION_REJECTED');
      this.restartEvidence(state);
      this.logger.warn(
        {
          cameraId,
          frameId: frame.header.frameId,
          error: error instanceof Error ? error.message : 'Unknown fire observation error',
        },
        'Fire observation rejected',
      );
    }
  }

  private recordObservation(frame: FireFrame, result: FireResponseDto): void {
    if (
      result.error ||
      ['STALE_FRAME', 'OUT_OF_ORDER', 'INFERENCE_ERROR'].includes(result.reason)
    ) {
      this.telemetry.failed(frame.header.cameraSlug, result.error?.code ?? result.reason);
      if (result.reason === 'STALE_FRAME') this.telemetry.counters.staleFrames++;
      return;
    }
    if (!result.isReplay) this.telemetry.processed(frame.header.cameraSlug);
  }

  private restartEvidence(state: CameraEvidence): void {
    state.observations = [];
    state.negativeSince = null;
    state.hasConfirmation = false;
    // A lost/unusable response must not leave AI latched on evidence we could not persist.
    state.aiSession = randomUUID();
  }

  private isFresh(frame: FireFrame): boolean {
    const age = (Date.now() - Date.parse(frame.header.frameTimestamp)) / 1000;
    return age >= -this.config.futureSeconds && age <= this.config.maxAgeSeconds;
  }

  private admit(frame: FireFrame): CameraEvidence | null {
    const { cameraSlug, sourceSessionId, frameId, frameTimestamp } = frame.header;
    const at = Date.parse(frameTimestamp);
    let state = this.cameras.get(cameraSlug);
    if (
      state &&
      (at <= state.lastAt || (state.session === sourceSessionId && frameId === state.lastId))
    )
      return null;
    if (!state && this.cameras.size >= this.config.maxCameras) return null;
    if (!state || state.session !== sourceSessionId) {
      const pending = state?.pending;
      state = {
        session: sourceSessionId,
        lastAt: at,
        lastId: frameId,
        aiSession: null,
        hasConfirmation: false,
        observations: [],
        negativeSince: null,
        pending,
      };
      this.cameras.set(cameraSlug, state);
    }
    if (at - state.lastAt > this.config.gapSeconds * 1000) {
      this.restartEvidence(state);
    }
    state.lastAt = at;
    state.lastId = frameId;
    return state;
  }

  private async applyObservation(
    cameraId: string,
    frame: FireFrame,
    result: FireResponseDto,
    state: CameraEvidence,
  ): Promise<void> {
    if (
      result.error ||
      result.isReplay ||
      ['STALE_FRAME', 'OUT_OF_ORDER', 'INFERENCE_ERROR'].includes(result.reason)
    ) {
      this.restartEvidence(state);
      return;
    }
    if (result.maxConfidence === null || result.maxConfidence < this.config.threshold) {
      await this.observeClear(cameraId, result, state);
      return;
    }
    state.negativeSince = null;
    if (result.reason === 'ACTIVE_EPISODE' && !state.hasConfirmation) {
      this.restartEvidence(state);
      return;
    }
    state.observations.push({
      id: result.frameId,
      at: Date.parse(result.observedAt),
      score: result.maxConfidence,
    });
    state.observations = state.observations.slice(-this.config.requiredFrames);
    if (!hasConfirmedFire(result) || result.reason !== 'CONFIRMED') return;
    validateFireConfirmation(result, state.observations, this.config);
    this.telemetry.counters.confirmedEpisodes++;
    state.hasConfirmation = true;
    state.pending ??= {
      cameraId,
      evidence: result,
      payload: this.submission(cameraId, result),
      frame,
      retryAt: 0,
      busy: false,
    };
    await this.persistPending(state);
  }

  private async persistPending(state: CameraEvidence): Promise<void> {
    const pending = state.pending;
    if (!pending || pending.busy || pending.retryAt > Date.now()) return;
    pending.busy = true;
    try {
      const cameraId = await this.repository.findEnabledCamera(pending.frame.header.cameraSlug);
      if (!cameraId || cameraId !== pending.cameraId) {
        state.pending = undefined;
        return;
      }
      const incident = await this.repository.confirm(cameraId, pending.evidence, pending.payload);
      state.pending = undefined;
      if (incident?.created)
        await this.storeConfirmationMedia(
          incident.eventId,
          cameraId,
          pending.evidence,
          pending.frame,
        );
    } catch (error) {
      pending.retryAt = Date.now() + this.config.retrySeconds * 1000;
      this.logger.error(
        {
          frameId: pending.frame.header.frameId,
          error: error instanceof Error ? error.message : 'Unknown fire persistence error',
        },
        'Fire confirmation persistence failed; evidence retained for retry',
      );
    } finally {
      pending.busy = false;
    }
  }

  private async storeConfirmationMedia(
    eventId: string,
    cameraId: string,
    result: ConfirmedFireResponse,
    frame: FireFrame,
  ): Promise<void> {
    this.logger.log({ cameraId, eventId, episodeId: result.episodeId }, 'Fire incident persisted');
    const snapshot = await this.media.storeCameraSnapshot(
      eventId,
      new Date(result.confirmedAt),
      frame.image,
      frame.header.frameWidth,
      frame.header.frameHeight,
    );
    if (snapshot) await this.events.publishCommittedUpdate(eventId);
  }

  private async observeClear(
    cameraId: string,
    result: FireResponseDto,
    state: CameraEvidence,
  ): Promise<void> {
    state.observations = [];
    if (!['NEGATIVE', 'BELOW_THRESHOLD'].includes(result.reason)) {
      state.negativeSince = null;
      return;
    }
    const at = Date.parse(result.observedAt);
    state.negativeSince ??= at;
    if (at - state.negativeSince < this.config.clearSeconds * 1000) return;
    await this.repository.clearActive(cameraId, {
      startedAt: new Date(state.negativeSince),
      observedAt: new Date(at),
    });
  }

  private submission(cameraId: string, result: ConfirmedFireResponse): SubmitAiResultDto {
    const detections = result.detections
      .filter((item) => item.confidence >= this.config.threshold)
      .slice(0, MAX_METADATA_DETECTIONS);
    return {
      schemaVersion: 1,
      resultId: randomUUID(),
      eventId: randomUUID(),
      observationId: `fire:${result.sourceSessionId}:${result.episodeId}`,
      revision: 1,
      module: 'M3_FIRE',
      modelVersion: result.modelVersion,
      processedAt: result.processedAt,
      error: null,
      results: [
        {
          module: 'M3_FIRE',
          label: 'FIRE_SMOKE_DETECTED',
          confidence: result.incidentConfidence,
          boundingBox: detections[0]?.boundingBox ?? null,
          metadata: {
            cameraId,
            sourceSessionId: result.sourceSessionId,
            episodeId: result.episodeId,
            frameId: result.frameId,
            firstQualifiedAt: result.firstQualifiedAt,
            confirmedAt: result.confirmedAt,
            qualifyingFrameIds: result.qualifyingFrameIds,
            qualifyingFrameTimestamps: result.qualifyingFrameTimestamps,
            consecutiveFrames: result.consecutiveFrames,
            requiredFrames: result.requiredFrames,
            windowSeconds: result.windowSeconds,
            maxFrameGapSeconds: result.maxFrameGapSeconds,
            thresholdUsed: result.thresholdUsed,
            incidentConfidencePolicyVersion: result.confidencePolicyVersion,
            labels: [...new Set(detections.map((item) => item.label))],
            detections,
          },
        },
      ],
    };
  }
}
