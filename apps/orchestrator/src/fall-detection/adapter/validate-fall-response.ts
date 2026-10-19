import type { EvaluateFallRequest, FallResponse } from './pose-inference.adapter';

type FrameIdentity = Pick<
  EvaluateFallRequest,
  'trackId' | 'cameraSlug' | 'sourceSessionId' | 'frameId' | 'frameTimestamp'
>;

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function finiteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function matchesFrame(data: Record<string, unknown>, request: FrameIdentity): boolean {
  return (
    ['trackId', 'cameraSlug', 'sourceSessionId', 'frameId'].every(
      (key) => data[key] === request[key as keyof FrameIdentity],
    ) &&
    isTimestamp(data.observedAt) &&
    Date.parse(data.observedAt) === Date.parse(request.frameTimestamp)
  );
}

function validConfirmationTime(data: Record<string, unknown>, threshold: number): boolean {
  if (
    !isTimestamp(data.candidateStartedAt) ||
    !isTimestamp(data.confirmedAt) ||
    !isTimestamp(data.observedAt)
  )
    return false;
  const elapsed = (Date.parse(data.confirmedAt) - Date.parse(data.candidateStartedAt)) / 1000;
  return (
    elapsed > threshold &&
    typeof data.immobileSeconds === 'number' &&
    data.immobileSeconds <= elapsed + 0.01 &&
    Date.parse(data.confirmedAt) <= Date.parse(data.observedAt)
  );
}

function validConfirmation(data: Record<string, unknown>, threshold: number): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (
    data.error === null &&
    data.poseAvailable === true &&
    typeof data.episodeId === 'string' &&
    uuid.test(data.episodeId) &&
    finiteRange(data.immobileSeconds, threshold, Number.MAX_VALUE) &&
    data.immobileSeconds > threshold &&
    data.thresholdSeconds === threshold &&
    finiteRange(data.torsoAngleDeg, 0, 30) &&
    data.torsoAngleDeg < 30 &&
    finiteRange(data.confidence, 0, 1) &&
    validConfirmationTime(data, threshold)
  );
}

/** Reject foreign identity and incomplete evidence at both HTTP and incident boundaries. */
export function isValidFallResponse(
  value: unknown,
  request: FrameIdentity,
  thresholdSeconds = 3,
): value is FallResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if (
    !matchesFrame(data, request) ||
    !['MONITORING', 'CANDIDATE', 'CONFIRMED', 'CANCELLED'].includes(String(data.state)) ||
    typeof data.poseAvailable !== 'boolean' ||
    typeof data.reason !== 'string' ||
    typeof data.modelVersion !== 'string' ||
    !data.modelVersion ||
    !isTimestamp(data.processedAt)
  )
    return false;
  return data.state !== 'CONFIRMED' || validConfirmation(data, thresholdSeconds);
}
