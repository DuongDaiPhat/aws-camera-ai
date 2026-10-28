import { createHash } from 'node:crypto';
import type { FireConfig } from './fire.config';
import type { ConfirmedFireResponse, FireFrame, FireResponseDto } from './fire.dto';

const URL_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
const SCORE_EPSILON = 0.000001;

export interface FireObservation {
  id: string;
  at: number;
  score: number;
}

export function episodeUuid(camera: string, session: string, firstAt: string): string {
  const identity = JSON.stringify([camera, session, new Date(firstAt).toISOString()]);
  const bytes = createHash('sha1').update(URL_NAMESPACE).update(identity).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateFireObservation(
  frame: FireFrame,
  result: FireResponseDto,
  config: FireConfig,
): void {
  const header = frame.header;
  if (
    result.cameraSlug !== header.cameraSlug ||
    result.sourceSessionId !== header.sourceSessionId ||
    result.frameId !== header.frameId ||
    Date.parse(result.observedAt) !== Date.parse(header.frameTimestamp)
  )
    throw new Error('Fire response identity mismatch');
  if (
    result.modelVersion !== config.modelVersion ||
    result.thresholdUsed !== config.threshold ||
    result.requiredFrames !== config.requiredFrames ||
    result.windowSeconds !== config.windowSeconds ||
    result.maxFrameGapSeconds !== config.gapSeconds
  )
    throw new Error('Fire rule/model snapshot mismatch');
  validateFrameScoreAndBoxes(result);
  if (
    !Number.isFinite(Date.parse(result.processedAt)) ||
    Date.parse(result.processedAt) > Date.now() + config.futureSeconds * 1000
  )
    throw new Error('Invalid fire processing timestamp');
}

function validateFrameScoreAndBoxes(result: FireResponseDto): void {
  const maximum = result.detections.length
    ? Math.max(...result.detections.map((item) => item.confidence))
    : null;
  if (
    maximum === null
      ? result.maxConfidence !== null
      : result.maxConfidence === null || Math.abs(maximum - result.maxConfidence) > SCORE_EPSILON
  )
    throw new Error('Invalid fire frame score');
  if (
    result.detections.some(
      (item) =>
        item.boundingBox.x + item.boundingBox.width > 1 + SCORE_EPSILON ||
        item.boundingBox.y + item.boundingBox.height > 1 + SCORE_EPSILON,
    )
  )
    throw new Error('Fire bounding box exceeds full frame');
}

export function hasConfirmedFire(result: FireResponseDto): result is ConfirmedFireResponse {
  return (
    result.confirmed &&
    result.error === null &&
    typeof result.episodeId === 'string' &&
    typeof result.firstQualifiedAt === 'string' &&
    typeof result.confirmedAt === 'string' &&
    typeof result.incidentConfidence === 'number'
  );
}

export function validateFireConfirmation(
  result: ConfirmedFireResponse,
  observations: FireObservation[],
  config: FireConfig,
): void {
  const ids = result.qualifyingFrameIds;
  const times = result.qualifyingFrameTimestamps.map((value) => Date.parse(value));
  if (
    ids.length !== config.requiredFrames ||
    ids.length !== times.length ||
    ids.length !== result.consecutiveFrames ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Invalid fire confirmation count');
  if (
    times[0] !== Date.parse(result.firstQualifiedAt) ||
    times[times.length - 1] !== Date.parse(result.confirmedAt) ||
    Date.parse(result.confirmedAt) !== Date.parse(result.observedAt) ||
    ids[ids.length - 1] !== result.frameId
  )
    throw new Error('Misaligned fire confirmation timestamps');
  const scores = ids.map((id, index) => {
    const observed = observations.find((item) => item.id === id && item.at === times[index]);
    if (!observed || observed.score < config.threshold)
      throw new Error('Unobserved fire qualifying evidence');
    if (
      index &&
      (times[index] <= times[index - 1] ||
        times[index] - times[index - 1] > config.gapSeconds * 1000)
    )
      throw new Error('Fire evidence is not consecutive');
    return observed.score;
  });
  if (
    times[times.length - 1] - times[0] > config.windowSeconds * 1000 ||
    Math.abs(Math.min(...scores) - result.incidentConfidence) > SCORE_EPSILON
  )
    throw new Error('Invalid fire temporal score/window');
  if (
    result.episodeId !==
    episodeUuid(result.cameraSlug, result.sourceSessionId, result.firstQualifiedAt)
  )
    throw new Error('Invalid fire episode identity');
}
