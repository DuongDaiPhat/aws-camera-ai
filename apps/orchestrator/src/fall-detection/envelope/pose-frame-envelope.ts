import { Logger } from '@nestjs/common';
import type { PoseFrameHeaderDto, UnpackedPoseFrame } from '../dto/pose-frame.dto';

const MAX_ENVELOPE_BYTES = 1024 * 1024; // 1 MiB
const MAX_HEADER_BYTES = 32 * 1024; // 32 KiB
const MAX_PERSONS_PER_FRAME = 8;

const logger = new Logger('PoseFrameEnvelope');

/**
 * Giải mã Binary Envelope v1 của Pose Frame (4-byte big-endian header length + JSON header + JPEG bytes).
 * Tuân thủ mục 5.2 trong docs/sprint-3/PLAN_US-16_US-17_POSE_FALL_E2E.md.
 */
export function unpackPoseFrameEnvelope(buffer: Buffer): UnpackedPoseFrame | null {
  if (buffer.length < 4) {
    logger.warn('Dữ liệu envelope quá ngắn (< 4 bytes)');
    return null;
  }

  if (buffer.length > MAX_ENVELOPE_BYTES) {
    logger.warn(
      `Envelope vượt quá giới hạn cho phép (${buffer.length} > ${MAX_ENVELOPE_BYTES} bytes)`,
    );
    return null;
  }

  const headerLength = buffer.readUInt32BE(0);
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
    logger.warn(`Header length không hợp lệ: ${headerLength} bytes`);
    return null;
  }

  if (4 + headerLength > buffer.length) {
    logger.warn(`Header bị cắt xén (4 + ${headerLength} > ${buffer.length})`);
    return null;
  }

  let headerJson: unknown;
  try {
    const headerUtf8 = buffer.subarray(4, 4 + headerLength).toString('utf8');
    headerJson = JSON.parse(headerUtf8);
  } catch (error) {
    logger.warn(
      `Lỗi parse JSON header trong envelope: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (!isValidPoseFrameHeader(headerJson)) {
    logger.warn('Cấu trúc header envelope không hợp lệ theo PoseFrameHeaderDto');
    return null;
  }

  const imageBytes = buffer.subarray(4 + headerLength);

  return {
    header: headerJson,
    imageBytes,
  };
}

function isValidPoseFrameHeader(obj: unknown): obj is PoseFrameHeaderDto {
  if (!obj || typeof obj !== 'object') return false;
  const h = obj as Record<string, unknown>;

  if (
    typeof h.schemaVersion !== 'number' ||
    typeof h.sourceSessionId !== 'string' ||
    typeof h.frameId !== 'string' ||
    typeof h.cameraSlug !== 'string' ||
    typeof h.frameTimestamp !== 'number' ||
    typeof h.frameWidth !== 'number' ||
    typeof h.frameHeight !== 'number' ||
    !Array.isArray(h.persons)
  ) {
    return false;
  }

  if (h.persons.length > MAX_PERSONS_PER_FRAME) {
    return false;
  }

  for (const p of h.persons) {
    if (!p || typeof p !== 'object') return false;
    const person = p as Record<string, unknown>;
    if (
      typeof person.trackId !== 'string' ||
      !person.boundingBox ||
      typeof person.observedAt !== 'number'
    ) {
      return false;
    }
    const box = person.boundingBox as Record<string, unknown>;
    if (
      typeof box.x !== 'number' ||
      typeof box.y !== 'number' ||
      typeof box.width !== 'number' ||
      typeof box.height !== 'number'
    ) {
      return false;
    }
  }

  return true;
}
