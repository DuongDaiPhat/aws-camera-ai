import type { ConfigService } from '@nestjs/config';
export function playbackLimit(config: ConfigService, name: string, fallback: number): number {
  const value = Number(config.get(name, fallback));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(name + ' must be a positive safe integer');
  return value;
}
