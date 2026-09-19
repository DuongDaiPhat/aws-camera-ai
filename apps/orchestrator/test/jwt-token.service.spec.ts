import { JwtTokenService } from '../src/auth/jwt-token.service';
import type { AuthUser } from '../src/auth/auth.types';

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@camerai.local',
  passwordHash: 'hash',
  fullName: 'Quản trị CameraAI',
  role: 'ADMIN',
  isActive: true,
  failedLoginCount: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

describe('JwtTokenService', () => {
  const service = new JwtTokenService({
    secret: 'test-secret-has-at-least-thirty-two-characters',
    accessTtlSeconds: 3600,
    refreshTtlSeconds: 604800,
  });

  it('cấp access và refresh token có đúng loại cùng thời hạn access một giờ', () => {
    const tokens = service.issueTokenPair(USER);

    expect(service.verifyAccessToken(tokens.accessToken)).toMatchObject({
      sub: USER.id,
      tokenType: 'access',
      role: 'ADMIN',
    });
    expect(service.verifyRefreshToken(tokens.refreshToken)).toMatchObject({
      sub: USER.id,
      tokenType: 'refresh',
    });
    expect(tokens.accessExpiresInSeconds).toBe(3600);
    expect(tokens.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('không chấp nhận refresh token thay cho access token', () => {
    const tokens = service.issueTokenPair(USER);

    expect(() => service.verifyAccessToken(tokens.refreshToken)).toThrow('Sai loại JWT.');
  });

  it('từ chối secret ngắn khi khởi động', () => {
    expect(
      () =>
        new JwtTokenService({
          secret: 'too-short',
          accessTtlSeconds: 3600,
          refreshTtlSeconds: 604800,
        }),
    ).toThrow('JWT_SECRET phải có ít nhất 32 ký tự.');
  });
});
