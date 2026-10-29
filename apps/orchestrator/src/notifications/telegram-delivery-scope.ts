import { ConfigService } from '@nestjs/config';

export interface TelegramDeliveryScope {
  cameraId: string;
  recipientUserId: string;
  createdAfter: string;
  until: string;
  maxAttempts: number;
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Optional operator-approved scope; normal delivery remains unrestricted when absent. */
export function telegramDeliveryScope(config: ConfigService): TelegramDeliveryScope | null {
  const raw = config.get<string>('TELEGRAM_DELIVERY_SCOPE');
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid TELEGRAM_DELIVERY_SCOPE');
  }
  if (!object(value)) throw new Error('Invalid TELEGRAM_DELIVERY_SCOPE');
  if (
    !uuid(value.cameraId) ||
    !uuid(value.recipientUserId) ||
    !timestamp(value.createdAfter) ||
    !timestamp(value.until) ||
    typeof value.maxAttempts !== 'number' ||
    !Number.isSafeInteger(value.maxAttempts) ||
    value.maxAttempts <= 0 ||
    Date.parse(value.until) <= Date.parse(value.createdAfter)
  )
    throw new Error('Invalid TELEGRAM_DELIVERY_SCOPE');
  return {
    cameraId: value.cameraId,
    recipientUserId: value.recipientUserId,
    createdAfter: value.createdAfter,
    until: value.until,
    maxAttempts: value.maxAttempts,
  };
}
