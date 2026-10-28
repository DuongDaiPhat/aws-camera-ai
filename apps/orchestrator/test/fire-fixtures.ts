import { ConfigService } from '@nestjs/config';
import { FireConfig } from '../src/fire/fire.config';
import type { ConfirmedFireResponse, FireFrame, FireResponseDto } from '../src/fire/fire.dto';
import { episodeUuid } from '../src/fire/fire-evidence.validator';

export function fireConfig(overrides: Record<string, unknown> = {}): FireConfig {
  return new FireConfig(new ConfigService({ M3_ENABLED: 'true', ...overrides }));
}

export function fireFrame(at: number, id = `frame-${at}`, camera = 'cam_fire'): FireFrame {
  return {
    header: {
      schemaVersion: 1,
      cameraSlug: camera,
      sourceSessionId: 'source-1',
      frameId: id,
      frameTimestamp: new Date(at).toISOString(),
      frameWidth: 1280,
      frameHeight: 720,
    },
    image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  };
}

export function fireResponse(
  frame: FireFrame,
  evidence: FireFrame[] = [frame],
  score: number | null = 0.9,
): FireResponseDto {
  const first = evidence[0].header.frameTimestamp;
  const base: FireResponseDto = {
    confirmed: false,
    detections: [],
    modelVersion: 'fire-smoke-yolo26n-checkpoint-nms-v1',
    processedAt: frame.header.frameTimestamp,
    cameraSlug: frame.header.cameraSlug,
    sourceSessionId: frame.header.sourceSessionId,
    frameId: frame.header.frameId,
    observedAt: frame.header.frameTimestamp,
    isReplay: false,
    consecutiveFrames: 0,
    requiredFrames: 3,
    maxConfidence: score,
    episodeId: null,
    firstQualifiedAt: null,
    confirmedAt: null,
    windowSeconds: 5,
    maxFrameGapSeconds: 1,
    thresholdUsed: 0.5,
    qualifyingFrameIds: [],
    qualifyingFrameTimestamps: [],
    incidentConfidence: null,
    confidencePolicyVersion: 'fire-temporal-min-v1',
    reason: 'NEGATIVE',
    error: null,
  };
  if (score === null) return base;
  const confirmed = evidence.length >= 3;
  return {
    ...base,
    confirmed,
    detections: [
      {
        label: 'smoke',
        confidence: score,
        boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
    ],
    consecutiveFrames: evidence.length,
    episodeId: episodeUuid(frame.header.cameraSlug, frame.header.sourceSessionId, first),
    firstQualifiedAt: first,
    confirmedAt: confirmed ? frame.header.frameTimestamp : null,
    qualifyingFrameIds: evidence.map((item) => item.header.frameId),
    qualifyingFrameTimestamps: evidence.map((item) => item.header.frameTimestamp),
    incidentConfidence: confirmed ? score : null,
    reason: confirmed ? 'CONFIRMED' : 'INSUFFICIENT_FRAMES',
  };
}

export function confirmedFire(at = Date.now()): ConfirmedFireResponse {
  const frames = [fireFrame(at - 1000), fireFrame(at - 500), fireFrame(at)];
  const result = fireResponse(frames[2], frames);
  if (
    result.episodeId === null ||
    result.firstQualifiedAt === null ||
    result.confirmedAt === null ||
    result.incidentConfidence === null
  )
    throw new Error('Invalid test fixture');
  return {
    ...result,
    episodeId: result.episodeId,
    firstQualifiedAt: result.firstQualifiedAt,
    confirmedAt: result.confirmedAt,
    incidentConfidence: result.incidentConfidence,
  };
}
