import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalTokenGuard } from '../src/ai-results/internal-token.guard';

function contextWithToken(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ header: () => token }),
    }),
  } as ExecutionContext;
}

describe('InternalTokenGuard (US-11)', () => {
  const token = 'test-internal-token-that-is-at-least-32-characters';

  it('chấp nhận token nội bộ khớp chính xác', () => {
    const guard = new InternalTokenGuard(new ConfigService({ INTERNAL_SERVICE_TOKEN: token }));
    expect(guard.canActivate(contextWithToken(token))).toBe(true);
  });

  it('từ chối token thiếu hoặc sai', () => {
    const guard = new InternalTokenGuard(new ConfigService({ INTERNAL_SERVICE_TOKEN: token }));
    expect(() => guard.canActivate(contextWithToken('wrong-token'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWithToken())).toThrow(UnauthorizedException);
  });

  it('từ chối khởi động khi secret quá ngắn', () => {
    expect(
      () => new InternalTokenGuard(new ConfigService({ INTERNAL_SERVICE_TOKEN: 'short' })),
    ).toThrow('INTERNAL_SERVICE_TOKEN phải có ít nhất 32 ký tự.');
  });
});
