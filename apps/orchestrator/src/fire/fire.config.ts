import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FireConfig {
  readonly enabled: boolean;
  readonly topic: string;
  readonly modelVersion: string;
  readonly threshold: number;
  readonly requiredFrames: number;
  readonly windowSeconds: number;
  readonly gapSeconds: number;
  readonly clearSeconds: number;
  readonly maxAgeSeconds: number;
  readonly futureSeconds: number;
  readonly maxBytes: number;
  readonly maxPixels: number;
  readonly maxCameras: number;
  readonly maxConcurrent: number;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly leaseSeconds: number;
  readonly retrySeconds: number;
  readonly healthStaleSeconds: number;
  readonly healthTimeoutMs: number;

  constructor(config: ConfigService) {
    this.enabled = String(config.get('M3_ENABLED', 'false')) === 'true';
    this.topic = config.get('MQTT_TOPIC_FIRE_FRAMES', 'frigate/camerai/fire/frames');
    this.modelVersion = config.get('FIRE_MODEL_VERSION', 'fire-smoke-yolo26n-checkpoint-nms-v1');
    this.threshold = this.number(config, 'FIRE_CONFIDENCE_THRESHOLD', 0.5, 0.000001, 1);
    this.requiredFrames = this.number(config, 'FIRE_MIN_CONSECUTIVE_FRAMES', 3, 3, 60, true);
    this.windowSeconds = this.number(config, 'FIRE_CONFIRMATION_WINDOW_SECONDS', 5, 0.001);
    this.gapSeconds = this.number(config, 'FIRE_MAX_FRAME_GAP_SECONDS', 1, 0.001);
    this.clearSeconds = this.number(config, 'FIRE_CLEAR_SECONDS', 10, 0.001);
    this.maxAgeSeconds = this.number(config, 'FIRE_FRAME_MAX_AGE_SECONDS', 1, 0.001);
    this.futureSeconds = this.number(config, 'FIRE_FRAME_FUTURE_TOLERANCE_SECONDS', 0.5, 0);
    this.maxBytes = this.number(config, 'FIRE_MAX_IMAGE_BYTES', 1_048_576, 1, Infinity, true);
    this.maxPixels = this.number(config, 'FIRE_MAX_IMAGE_PIXELS', 2_073_600, 1, Infinity, true);
    this.maxCameras = this.number(config, 'FIRE_MAX_CAMERAS', 16, 1, 1024, true);
    this.maxConcurrent = this.number(config, 'FIRE_MAX_CONCURRENT_REQUESTS', 1, 1, 16, true);
    this.timeoutMs = this.number(config, 'FIRE_REQUEST_TIMEOUT_MS', 2000, 1, Infinity, true);
    this.pollMs = this.number(config, 'FIRE_DELIVERY_POLL_MS', 1000, 1, Infinity, true);
    this.leaseSeconds = this.number(config, 'FIRE_DELIVERY_LEASE_SECONDS', 30, 1, Infinity, true);
    this.retrySeconds = this.number(config, 'FIRE_DELIVERY_RETRY_SECONDS', 5, 1);
    this.healthStaleSeconds = this.number(config, 'FIRE_HEALTH_STALE_SECONDS', 5, 0.001);
    this.healthTimeoutMs = this.number(config, 'FIRE_HEALTH_TIMEOUT_MS', 1000, 1, Infinity, true);
    if (this.gapSeconds > this.windowSeconds) throw new Error('Invalid FIRE temporal window');
    if (this.healthStaleSeconds < this.maxAgeSeconds)
      throw new Error('FIRE health freshness must not be shorter than the frame age budget');
  }

  private number(
    config: ConfigService,
    key: string,
    fallback: number,
    minimum: number,
    maximum = Infinity,
    integer = false,
  ): number {
    const value = Number(config.get<string | number>(key, fallback));
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isInteger(value))
    ) {
      throw new Error(`Invalid ${key}`);
    }
    return value;
  }
}
