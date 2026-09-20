import type { Request } from 'express';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TOKEN_SERVICE, type TokenClaims, type TokenService } from './auth.types';
import { IS_PUBLIC_ROUTE } from './public.decorator';

export interface AuthenticatedRequest extends Request {
  auth?: TokenClaims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    if (!token) throw this.unauthorized('Bạn cần đăng nhập để tiếp tục.');

    try {
      request.auth = this.tokenService.verifyAccessToken(token);
      return true;
    } catch (error: unknown) {
      const code = this.isExpiredTokenError(error) ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
      const message =
        code === 'TOKEN_EXPIRED' ? 'Access token đã hết hạn.' : 'Access token không hợp lệ.';
      throw new UnauthorizedException({ error: { code, message } });
    }
  }

  private extractBearerToken(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return null;

    const token = authorization.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  private isExpiredTokenError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenExpiredError';
  }

  private unauthorized(message: string): UnauthorizedException {
    return new UnauthorizedException({ error: { code: 'UNAUTHORIZED', message } });
  }
}
