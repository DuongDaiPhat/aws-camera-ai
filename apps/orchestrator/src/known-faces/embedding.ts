import type { EmbeddingResult, FaceUpload } from './face-inference.interface';
import { faceError } from './face-error';

export function selections(value: string | undefined, count: number): (number | null)[] {
  let parsed: unknown;
  try {
    parsed = value === undefined ? [] : JSON.parse(value);
  } catch {
    parsed = false;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > count ||
    parsed.some(
      (item: unknown) =>
        item !== null && (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0),
    )
  ) {
    throw faceError(422, 'FACE_SELECTION_INVALID', 'Lựa chọn khuôn mặt không hợp lệ.');
  }
  return Array.from({ length: count }, (_, index) => parsed[index] ?? null);
}

export function validateImages(files: FaceUpload[], maxBytes: number, maxTotal: number): void {
  if (files.length < 1 || files.length > 5)
    throw faceError(400, 'INVALID_IMAGE', 'Hãy chọn từ 1 đến 5 ảnh.');
  if (
    files.some((file) => file.buffer.length > maxBytes) ||
    files.reduce((sum, file) => sum + file.buffer.length, 0) > maxTotal
  ) {
    throw faceError(413, 'IMAGE_TOO_LARGE', 'Ảnh vượt giới hạn dung lượng.');
  }
  for (const { buffer } of files) {
    const jpeg = buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!jpeg && !png && !webp)
      throw faceError(400, 'INVALID_IMAGE', 'Chỉ nhận ảnh JPEG, PNG hoặc WebP hợp lệ.');
  }
}

function normalize(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0)
    throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Embedding không hợp lệ.');
  return vector.map((value) => value / norm);
}

export function aggregate(
  results: EmbeddingResult[],
  threshold: number,
): { embedding: Buffer; dimension: number; model: string } {
  const first = results[0];
  if (!first?.embeddingDim || first.embeddingDim > 4096)
    throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Embedding không hợp lệ.');
  const dimension = first.embeddingDim;
  const vectors = results.map((result) => {
    if (
      result.modelVersion !== first.modelVersion ||
      result.embeddingDim !== dimension ||
      !result.embeddingBase64 ||
      result.provider !== 'local'
    ) {
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Model hoặc dimension không thống nhất.');
    }
    const bytes = Buffer.from(result.embeddingBase64, 'base64');
    if (bytes.length !== dimension * 4)
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Embedding sai kích thước.');
    return normalize(Array.from({ length: dimension }, (_, index) => bytes.readFloatLE(index * 4)));
  });
  for (const left of vectors)
    for (const right of vectors) {
      const score = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
      if (score < threshold)
        throw faceError(
          422,
          'FACE_IMAGES_INCONSISTENT',
          'Các ảnh có thể không cùng một người. Hãy kiểm tra lại.',
        );
    }
  const centroid = normalize(
    Array.from(
      { length: dimension },
      (_, index) => vectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0) / vectors.length,
    ),
  );
  const embedding = Buffer.alloc(dimension * 4);
  centroid.forEach((value, index) => embedding.writeFloatLE(value, index * 4));
  return { embedding, dimension, model: first.modelVersion };
}
