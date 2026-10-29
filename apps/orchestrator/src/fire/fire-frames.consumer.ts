import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { type MqttClient } from 'mqtt';
import { createHash, randomUUID } from 'node:crypto';
import { FireConfig } from './fire.config';
import type { FireFrame } from './fire.dto';
import { decodeFireFrame, FireStaleFrameError } from './fire-frame.codec';
import { FireProcessorService } from './fire-processor.service';
import { FireTelemetry } from './fire-telemetry.service';

const QUEUE_PER_CAMERA = 2;

@Injectable()
export class FireFramesConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FireFramesConsumer.name);
  private client: MqttClient | null = null;
  private readonly pending = new Map<string, FireFrame[]>();
  private readonly running = new Set<string>();
  private stopped = false;
  private readonly generation = randomUUID();
  constructor(
    private readonly config: ConfigService,
    private readonly fire: FireConfig,
    private readonly processor: FireProcessorService,
    private readonly telemetry: FireTelemetry,
  ) {}

  onModuleInit(): void {
    if (!this.fire.enabled) return;
    this.client = mqtt.connect(this.config.get('MQTT_URL', 'mqtt://localhost:1883'), {
      clientId: `camerai-fire-${process.pid}`,
      username: this.config.get('MQTT_USERNAME'),
      password: this.config.get('MQTT_PASSWORD'),
      reconnectPeriod: 3000,
    });
    this.client.on('connect', () =>
      this.client?.subscribe(this.fire.topic, { qos: 0 }, (error) => {
        this.telemetry.mqttConnected = !error;
        if (error) this.logger.error({ err: error }, 'Fire frame subscription failed');
      }),
    );
    const disconnected = (): void => {
      this.telemetry.mqttConnected = false;
    };
    this.client.on('close', disconnected);
    this.client.on('offline', disconnected);
    this.client.on('reconnect', disconnected);
    this.client.on('end', disconnected);
    this.client.on('error', (error) =>
      this.logger.error({ err: error }, 'Fire MQTT connection failed'),
    );
    this.client.on('message', (topic, buffer) => {
      if (topic !== this.fire.topic) return;
      try {
        this.accept(decodeFireFrame(buffer, this.fire));
      } catch (error) {
        if (error instanceof FireStaleFrameError) this.telemetry.counters.staleFrames++;
        else this.telemetry.counters.invalidFrames++;
        this.logger.debug({ err: error }, 'Fire frame admission rejected');
      }
    });
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.telemetry.mqttConnected = false;
    this.pending.clear();
    this.client?.end(true);
  }

  accept(frame: FireFrame): void {
    if (this.stopped || !this.fire.enabled) return;
    this.telemetry.received(frame);
    const camera = frame.header.cameraSlug;
    // Restarting this producer must request fresh AI evidence even if the bridge stayed up.
    const sourceSessionId = createHash('sha256')
      .update(JSON.stringify([frame.header.sourceSessionId, this.generation]))
      .digest('hex');
    const admitted = { ...frame, header: { ...frame.header, sourceSessionId } };
    if (!this.pending.has(camera) && this.pending.size >= this.fire.maxCameras) {
      this.telemetry.counters.capacityDroppedFrames++;
      return;
    }
    const queue = this.pending.get(camera) ?? [];
    queue.push(admitted);
    while (queue.length > QUEUE_PER_CAMERA) {
      queue.shift();
      this.telemetry.counters.queueDroppedFrames++;
    }
    this.pending.set(camera, queue);
    this.pump();
  }

  private pump(): void {
    for (const [camera, queue] of [...this.pending]) {
      if (this.stopped || this.running.size >= this.fire.maxConcurrent) break;
      if (this.running.has(camera) || queue.length === 0) continue;
      const frame = queue.shift();
      if (!frame) continue;
      this.pending.delete(camera);
      this.pending.set(camera, queue);
      this.running.add(camera);
      void this.processor
        .process(frame)
        .catch((error) => {
          this.telemetry.failed(camera, 'PROCESSING_FAILED');
          this.logger.error({ cameraSlug: camera, err: error }, 'Fire frame processing failed');
        })
        .finally(() => {
          this.running.delete(camera);
          if (!queue.length) this.pending.delete(camera);
          this.pump();
        });
    }
  }
}
