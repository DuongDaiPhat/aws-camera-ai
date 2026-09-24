import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const INTERNAL_TOKEN_HEADER = 'x-internal-token';
const MINIMUM_TOKEN_LENGTH = 32;

@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly expectedToken: string;

  constructor(configService: ConfigService) {
    this.expectedToken = configService.getOrThrow<string>('INTERNAL_SERVICE_TOKEN');
    if (this.expectedToken.length < MINIMUM_TOKEN_LENGTH) {
      throw new Error(`INTERNAL_SERVICE_TOKEN phải có ít nhất ${MINIMUM_TOKEN_LENGTH} ký tự.`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const providedToken = request.header(INTERNAL_TOKEN_HEADER);
    if (!providedToken || !this.tokensMatch(providedToken)) {
      throw new UnauthorizedException({
        error: { code: 'INVALID_INTERNAL_TOKEN', message: 'Token dịch vụ nội bộ không hợp lệ.' },
      });
    }
    return true;
  }

  private tokensMatch(providedToken: string): boolean {
    const expectedBuffer = Buffer.from(this.expectedToken);
    const providedBuffer = Buffer.from(providedToken);
    return (
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer)
    );
  }
}
