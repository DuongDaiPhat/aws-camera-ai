import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { FireHealthService } from '../src/fire/fire-health.service';
import { FireTelemetry } from '../src/fire/fire-telemetry.service';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { FireAiClient } from '../src/fire/fire-ai.client';
import type { FireAiHealthDto } from '../src/fire/fire-health.dto';
import { fireConfig, fireFrame } from './fire-fixtures';
import { Test, type TestingModule } from '@nestjs/testing';
import { FireConfig } from '../src/fire/fire.config';
import { FireFramesConsumer } from '../src/fire/fire-frames.consumer';
import { FireProcessorService } from '../src/fire/fire-processor.service';

function readyAi(): FireAiHealthDto {
  return {
    status: 'READY',
    instanceId: randomUUID(),
    modelVersion: 'fire-smoke-yolo26n-checkpoint-nms-v1',
    modelLoaded: true,
    requestCount: 1,
    errorCount: 0,
    staleFrameCount: 0,
    capacityRejectedCount: 0,
    inFlight: 0,
    lastRequestAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    lastErrorCode: null,
    lastDurationMs: 50,
  };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

interface HealthFixture {
  module: TestingModule;
  ai: { health: jest.Mock<Promise<FireAiHealthDto>, []> };
  repository: { listEnabledCameras: jest.Mock<Promise<{ slug: string }[]>, []> };
  telemetry: FireTelemetry;
  health: FireHealthService;
}
async function fixture(enabled = true): Promise<HealthFixture> {
  const ai = { health: jest.fn().mockResolvedValue(readyAi()) };
  const repository = { listEnabledCameras: jest.fn().mockResolvedValue([{ slug: 'cam_fire' }]) };
  const module = await Test.createTestingModule({
    providers: [
      FireTelemetry,
      FireHealthService,
      { provide: FireConfig, useValue: fireConfig({ M3_ENABLED: String(enabled) }) },
      { provide: FireAiClient, useValue: ai },
      { provide: FireIncidentsRepository, useValue: repository },
    ],
  }).compile();
  return {
    module,
    ai,
    repository,
    telemetry: module.get(FireTelemetry),
    health: module.get(FireHealthService),
  };
}

it('requires observed fresh processing rather than MQTT traffic or generic liveness', async () => {
  jest.useFakeTimers();
  const { module, telemetry, health } = await fixture();
  try {
    telemetry.mqttConnected = true;
    expect((await health.check()).cameras[0].status).toBe('NO_FRAMES');
    telemetry.received(fireFrame(Date.now()));
    expect((await health.check()).status).toBe('DEGRADED');
    telemetry.processed('cam_fire');
    expect((await health.check()).status).toBe('READY');
    jest.advanceTimersByTime(5001);
    telemetry.received(fireFrame(Date.now()));
    expect((await health.check()).cameras[0].status).toBe('STALE');
    telemetry.failed('cam_fire', 'OBSERVATION_REJECTED');
    expect((await health.check()).cameras[0].status).toBe('ERROR');
    jest.advanceTimersByTime(1);
    telemetry.processed('cam_fire');
    const recovered = await health.check();
    expect(recovered.status).toBe('READY');
    expect(recovered.cameras[0].processingErrors).toBe(1);
    expect(recovered.counters.processingErrors).toBe(1);
  } finally {
    await module.close();
  }
});

it('reports dependency failures, model mismatch and incomplete camera coverage as degraded', async () => {
  const { module, ai, repository, telemetry, health } = await fixture();
  try {
    telemetry.received(fireFrame(Date.now()));
    telemetry.processed('cam_fire');
    telemetry.mqttConnected = true;
    ai.health.mockRejectedValueOnce(new Error('offline'));
    expect((await health.check()).ai).toBeNull();
    ai.health.mockResolvedValueOnce({ ...readyAi(), modelVersion: 'wrong-model' });
    expect((await health.check()).status).toBe('DEGRADED');
    repository.listEnabledCameras.mockRejectedValueOnce(new Error('database offline'));
    expect((await health.check()).databaseAvailable).toBe(false);
    repository.listEnabledCameras.mockResolvedValueOnce(
      Array.from({ length: 17 }, (_, i) => ({ slug: `cam_${i}` })),
    );
    const truncated = await health.check();
    expect(truncated.camerasTruncated).toBe(true);
    expect(truncated.cameras).toHaveLength(16);
    expect(truncated.status).toBe('DEGRADED');
    telemetry.mqttConnected = false;
    expect((await health.check()).status).toBe('DEGRADED');
  } finally {
    await module.close();
  }
});

it('disabled health does not connect to AI or the database', async () => {
  const { module, ai, repository, health } = await fixture(false);
  try {
    expect((await health.check()).status).toBe('DISABLED');
    expect(ai.health).not.toHaveBeenCalled();
    expect(repository.listEnabledCameras).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

it('rejects malformed AI diagnostics rather than reporting spoofed readiness', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ ...readyAi(), modelLoaded: 'true' })));
  const client = new FireAiClient(
    new ConfigService({ AI_INTERNAL_TOKEN: 'test-only' }),
    fireConfig(),
  );
  await expect(client.health()).rejects.toThrow('Invalid fire health fields');
});

it('counts queue and camera-capacity drops while processing remains bounded', async () => {
  let release = (): void => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const processor = { process: jest.fn().mockReturnValue(blocked) };
  const module = await Test.createTestingModule({
    providers: [
      FireFramesConsumer,
      FireTelemetry,
      { provide: ConfigService, useValue: new ConfigService() },
      { provide: FireConfig, useValue: fireConfig({ FIRE_MAX_CAMERAS: 1 }) },
      { provide: FireProcessorService, useValue: processor },
    ],
  }).compile();
  const consumer = module.get(FireFramesConsumer);
  try {
    for (let index = 0; index < 5; index++)
      consumer.accept(fireFrame(Date.now(), `frame-${index}`));
    consumer.accept(fireFrame(Date.now(), 'other', 'another-camera'));
    const telemetry = module.get(FireTelemetry);
    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(telemetry.counters.queueDroppedFrames).toBe(2);
    expect(telemetry.counters.capacityDroppedFrames).toBe(1);
    expect(telemetry.camera('cam_fire').status).toBe('STARTING');
  } finally {
    consumer.onModuleDestroy();
    release();
    await module.close();
  }
});
