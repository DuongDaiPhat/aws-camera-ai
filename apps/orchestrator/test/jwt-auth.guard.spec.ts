import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard, type AuthenticatedRequest } from '../src/auth/jwt-auth.guard';
import type { TokenClaims, TokenService } from '../src/auth/auth.types';

const CLAIMS: TokenClaims = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'admin@camerai.local',
  role: 'ADMIN',
  tokenType: 'access',
  jti: '22222222-2222-4222-8222-222222222222',
};

function createContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createReflector(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
}

function createTokenService(): TokenService {
  return {
    issueTokenPair: (): never => {
      throw new Error('Không dùng trong test này');
    },
    verifyAccessToken: (token: string): TokenClaims => {
      if (token !== 'valid-access') throw new Error('invalid token');
      return CLAIMS;
    },
    verifyRefreshToken: (): never => {
      throw new Error('Không dùng trong test này');
    },
  };
}

describe('JwtAuthGuard', () => {
  it('cho phép route public không cần token', async () => {
    const guard = new JwtAuthGuard(createReflector(true), createTokenService());
    const request = { headers: {} } as AuthenticatedRequest;

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
  });

  it('từ chối route được bảo vệ khi thiếu access token', async () => {
    const guard = new JwtAuthGuard(createReflector(false), createTokenService());
    const request = { headers: {} } as AuthenticatedRequest;

    try {
      await guard.canActivate(createContext(request));
      throw new Error('Lẽ ra guard phải từ chối yêu cầu');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        error: { code: 'UNAUTHORIZED', message: 'Bạn cần đăng nhập để tiếp tục.' },
      });
    }
  });

  it('xác thực bearer token và gắn người dùng vào request', async () => {
    const guard = new JwtAuthGuard(createReflector(false), createTokenService());
    const request = {
      headers: { authorization: 'Bearer valid-access' },
    } as AuthenticatedRequest;

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.auth).toEqual(CLAIMS);
  });
});
