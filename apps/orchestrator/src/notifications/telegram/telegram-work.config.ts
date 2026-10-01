import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramWorkConfig {
  readonly enabled: boolean;
  readonly pollMs: number;
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly batchSize: number;
  readonly callbackTtlSeconds: number;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('TELEGRAM_ENABLED') === 'true';
    this.pollMs = positiveInteger(config, 'TELEGRAM_WORK_POLL_MS', 1000);
    this.leaseSeconds = positiveInteger(config, 'TELEGRAM_WORK_LEASE_SECONDS', 30);
    this.maxAttempts = positiveInteger(config, 'TELEGRAM_WORK_MAX_ATTEMPTS', 8);
    this.batchSize = positiveInteger(config, 'TELEGRAM_WORK_BATCH_SIZE', 20);
    this.callbackTtlSeconds = positiveInteger(config, 'TELEGRAM_CALLBACK_TTL_SECONDS', 86400);
    const timeoutMs = positiveInteger(config, 'TELEGRAM_TIMEOUT_MS', 5000);
    if (this.leaseSeconds * 1000 <= timeoutMs * 2) {
      throw new Error('Telegram work lease phải dài hơn hai lần HTTP timeout.');
    }
  }
}

function positiveInteger(config: ConfigService, key: string, fallback: number): number {
  const value = Number(config.get<string>(key) ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${key} phải là số nguyên dương.`);
  return value;
}
