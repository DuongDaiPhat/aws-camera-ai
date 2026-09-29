import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';

export function faceError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): HttpException {
  return new HttpException({ error: { code, message, details, traceId: randomUUID() } }, status);
}
