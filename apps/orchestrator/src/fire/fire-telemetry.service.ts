import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { components } from '@cam/contracts';
import { FireConfig } from './fire.config';
import type { FireFrame } from './fire.dto';

type CameraHealth = components['schemas']['FireCameraHealth'];
interface CameraTelemetry {
  lastFrameAt: string;
  lastProcessedAt: string | null;
  lastSuccessMs: number | null;
  lastFailureMs: number | null;
  lastErrorCode: string | null;
  receivedFrames: number;
  processedFrames: number;
  processingErrors: number;
}

@Injectable()
export class FireTelemetry {
  readonly instanceId = randomUUID();
  mqttConnected = false;
  readonly counters = {
    receivedFrames: 0,
    invalidFrames: 0,
    staleFrames: 0,
    queueDroppedFrames: 0,
    capacityDroppedFrames: 0,
    processedFrames: 0,
    processingErrors: 0,
    confirmedEpisodes: 0,
  };
  private readonly cameras = new Map<string, CameraTelemetry>();
  constructor(private readonly config: FireConfig) {}

  received(frame: FireFrame): void {
    this.counters.receivedFrames++;
    const slug = frame.header.cameraSlug;
    let state = this.cameras.get(slug);
    if (!state) {
      if (this.cameras.size >= this.config.maxCameras) return;
      state = {
        lastFrameAt: frame.header.frameTimestamp,
        lastProcessedAt: null,
        lastSuccessMs: null,
        lastFailureMs: null,
        lastErrorCode: null,
        receivedFrames: 0,
        processedFrames: 0,
        processingErrors: 0,
      };
      this.cameras.set(slug, state);
    }
    state.lastFrameAt = frame.header.frameTimestamp;
    state.receivedFrames++;
  }

  processed(slug: string): void {
    this.counters.processedFrames++;
    const state = this.cameras.get(slug);
    if (!state) return;
    state.processedFrames++;
    state.lastProcessedAt = new Date().toISOString();
    state.lastSuccessMs = performance.now();
  }

  failed(slug: string, code: string): void {
    this.counters.processingErrors++;
    const state = this.cameras.get(slug);
    if (!state) return;
    state.processingErrors++;
    state.lastErrorCode = code;
    state.lastFailureMs = performance.now();
  }

  camera(slug: string, nowMs = performance.now()): CameraHealth {
    const state = this.cameras.get(slug);
    if (!state)
      return {
        slug,
        status: 'NO_FRAMES',
        lastFrameAt: null,
        lastProcessedAt: null,
        lastErrorCode: null,
        receivedFrames: 0,
        processedFrames: 0,
        processingErrors: 0,
      };
    return {
      slug,
      status: this.cameraStatus(state, nowMs),
      lastFrameAt: state.lastFrameAt,
      lastProcessedAt: state.lastProcessedAt,
      lastErrorCode: state.lastErrorCode,
      receivedFrames: state.receivedFrames,
      processedFrames: state.processedFrames,
      processingErrors: state.processingErrors,
    };
  }

  private cameraStatus(state: CameraTelemetry | undefined, nowMs: number): CameraHealth['status'] {
    if (!state) return 'NO_FRAMES';
    if (state.lastFailureMs !== null && state.lastFailureMs > (state.lastSuccessMs ?? -Infinity))
      return 'ERROR';
    if (state.lastSuccessMs === null) return 'STARTING';
    return nowMs - state.lastSuccessMs > this.config.healthStaleSeconds * 1000 ? 'STALE' : 'READY';
  }
}
