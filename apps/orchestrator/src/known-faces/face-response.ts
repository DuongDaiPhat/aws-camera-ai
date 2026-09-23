import type { EmbeddingResult } from './face-inference.interface';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isEmbeddingResult(value: unknown): value is EmbeddingResult {
  if (
    !record(value) ||
    typeof value.modelVersion !== 'string' ||
    value.modelVersion.length === 0 ||
    value.provider !== 'local'
  )
    return false;
  if (
    !Array.isArray(value.faces) ||
    !value.faces.every(
      (box) =>
        record(box) &&
        ['x', 'y', 'width', 'height'].every(
          (key) =>
            typeof box[key] === 'number' &&
            Number.isFinite(box[key]) &&
            box[key] >= 0 &&
            box[key] <= 1,
        ),
    )
  )
    return false;
  if (
    value.error !== null &&
    (!record(value.error) ||
      typeof value.error.code !== 'string' ||
      typeof value.error.message !== 'string')
  )
    return false;
  if (value.error === null) {
    return (
      typeof value.embeddingBase64 === 'string' &&
      typeof value.embeddingDim === 'number' &&
      Number.isInteger(value.embeddingDim) &&
      value.embeddingDim > 0 &&
      typeof value.selectedFaceIndex === 'number' &&
      Number.isInteger(value.selectedFaceIndex) &&
      value.selectedFaceIndex >= 0 &&
      value.selectedFaceIndex < value.faces.length
    );
  }
  return value.embeddingBase64 === null && value.embeddingDim === null;
}

export function isSyncAcknowledgement(
  value: unknown,
  owner: string,
  version: number,
  count: number,
): boolean {
  return (
    record(value) &&
    value.ownerScopeId === owner &&
    value.version === version &&
    value.loaded === count &&
    value.provider === 'local'
  );
}
