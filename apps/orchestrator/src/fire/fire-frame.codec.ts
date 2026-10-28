import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { FireConfig } from './fire.config';
import { FireFrameHeaderDto, type FireFrame } from './fire.dto';

const MAX_HEADER_BYTES = 32 * 1024;

export class FireStaleFrameError extends Error {
  constructor() {
    super('Stale fire frame');
  }
}

export function decodeFireFrame(
  payload: Buffer,
  config: FireConfig,
  nowMs = Date.now(),
): FireFrame {
  if (payload.length < 5 || payload.length > config.maxBytes + MAX_HEADER_BYTES + 4)
    throw new Error('Invalid fire frame size');
  const headerBytes = payload.readUInt32BE(0);
  if (headerBytes < 2 || headerBytes > MAX_HEADER_BYTES || headerBytes + 4 >= payload.length)
    throw new Error('Invalid fire frame header');
  const raw: unknown = JSON.parse(payload.subarray(4, 4 + headerBytes).toString('utf8'));
  const header = validateHeader(raw);
  validateFrameTimeAndPixels(header, config, nowMs);
  const image = payload.subarray(4 + headerBytes);
  if (image.length > config.maxBytes || image[0] !== 0xff || image[1] !== 0xd8)
    throw new Error('Invalid JPEG payload');
  return { header, image };
}

function validateHeader(raw: unknown): FireFrameHeaderDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid fire frame header');
  const header = plainToInstance(FireFrameHeaderDto, raw);
  if (validateSync(header, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new Error('Invalid fire frame fields');
  return header;
}

function validateFrameTimeAndPixels(
  header: FireFrameHeaderDto,
  config: FireConfig,
  nowMs: number,
): void {
  const ageSeconds = (nowMs - Date.parse(header.frameTimestamp)) / 1000;
  if (
    !Number.isFinite(ageSeconds) ||
    ageSeconds > config.maxAgeSeconds ||
    ageSeconds < -config.futureSeconds
  )
    throw new FireStaleFrameError();
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(header.frameTimestamp) ||
    header.frameWidth * header.frameHeight > config.maxPixels
  )
    throw new Error('Invalid frame timestamp or pixels');
}
