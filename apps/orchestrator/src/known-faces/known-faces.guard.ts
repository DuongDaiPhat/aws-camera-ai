import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { faceError } from './face-error';

@Injectable()
export class KnownFacesGuard implements CanActivate {
  private active = 0;
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw faceError(401, 'UNAUTHORIZED', 'Bạn cần đăng nhập.');
    if (request.method === 'GET') return true;
    if (request.auth.role !== 'ADMIN')
      throw faceError(403, 'FORBIDDEN', 'Chỉ quản trị viên được thực hiện thao tác này.');
    if (request.method !== 'POST') return true;
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(request.auth.sub) ?? { count: 0, expires: now + 60000 };
    if (attempt.count >= Number(this.config.get('FACE_REQUESTS_PER_MINUTE', 10)))
      throw faceError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Hãy thử lại sau.');
    if (this.active >= Number(this.config.get('FACE_MAX_CONCURRENT', 2)))
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Hệ thống đang xử lý ảnh. Hãy thử lại.');
    attempt.count++;
    this.attempts.set(request.auth.sub, attempt);
    this.active++;
    const response = context
      .switchToHttp()
      .getResponse<{ once(event: string, callback: () => void): void }>();
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
    response.once('finish', release);
    response.once('close', release);
    return true;
  }
}
