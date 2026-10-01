import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  private readonly secret: string | undefined;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET') || undefined;
    if (
      config.get<string>('TELEGRAM_ENABLED') === 'true' &&
      (!this.secret || !/^[A-Za-z0-9_-]{1,256}$/.test(this.secret))
    ) {
      throw new Error('TELEGRAM_WEBHOOK_SECRET phải theo định dạng Telegram khi bật bot.');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('X-Telegram-Bot-Api-Secret-Token');
    if (!this.secret || !provided || !this.sameSecret(provided, this.secret)) {
      throw new UnauthorizedException('Telegram webhook secret không hợp lệ.');
    }
    return true;
  }

  private sameSecret(provided: string, expected: string): boolean {
    const providedHash = createHash('sha256').update(provided).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(providedHash, expectedHash);
  }
}
