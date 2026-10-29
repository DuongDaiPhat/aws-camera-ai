import { Injectable } from '@nestjs/common';
import type { components } from '@cam/contracts';
import { FireAiClient } from './fire-ai.client';
import { FireConfig } from './fire.config';
import { FireIncidentsRepository } from './fire-incidents.repository';
import { FireTelemetry } from './fire-telemetry.service';

export type FireHealth = components['schemas']['FireHealth'];

@Injectable()
export class FireHealthService {
  constructor(
    private readonly config: FireConfig,
    private readonly telemetry: FireTelemetry,
    private readonly ai: FireAiClient,
    private readonly repository: FireIncidentsRepository,
  ) {}

  async check(): Promise<FireHealth> {
    const base: FireHealth = {
      status: 'DISABLED',
      instanceId: this.telemetry.instanceId,
      checkedAt: new Date().toISOString(),
      mqttConnected: this.telemetry.mqttConnected,
      databaseAvailable: false,
      camerasTruncated: false,
      staleAfterSeconds: this.config.healthStaleSeconds,
      counters: { ...this.telemetry.counters },
      cameras: [],
      ai: null,
    };
    if (!this.config.enabled) return base;
    const [database, ai] = await Promise.allSettled([
      this.repository.listEnabledCameras(this.config.maxCameras + 1),
      this.ai.health(),
    ]);
    base.databaseAvailable = database.status === 'fulfilled';
    if (database.status === 'fulfilled') {
      base.camerasTruncated = database.value.length > this.config.maxCameras;
      base.cameras = database.value
        .slice(0, this.config.maxCameras)
        .map(({ slug }) => this.telemetry.camera(slug));
    }
    if (ai.status === 'fulfilled') base.ai = ai.value;
    base.mqttConnected = this.telemetry.mqttConnected;
    base.counters = { ...this.telemetry.counters };
    base.checkedAt = new Date().toISOString();
    base.status = this.isReady(base) ? 'READY' : 'DEGRADED';
    return base;
  }

  private isReady(health: FireHealth): boolean {
    return (
      health.mqttConnected &&
      health.databaseAvailable &&
      !health.camerasTruncated &&
      health.ai?.status === 'READY' &&
      health.ai.modelLoaded &&
      health.ai.modelVersion === this.config.modelVersion &&
      health.cameras.length > 0 &&
      health.cameras.every((camera) => camera.status === 'READY')
    );
  }
}
