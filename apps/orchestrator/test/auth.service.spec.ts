import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import type {
  AuthRepository,
  AuthUser,
  ClientContext,
  PasswordHasher,
  RefreshTokenRecord,
  TokenPair,
  TokenService,
} from '../src/auth/auth.types';

const NOW = new Date('2026-09-17T01:00:00.000Z');
const CLIENT_CONTEXT: ClientContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'Vitest',
};

function createUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@camerai.local',
    passwordHash: 'valid-password-hash',
    fullName: 'Quản trị CameraAI',
    role: 'ADMIN',
    isActive: true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

class InMemoryAuthRepository implements AuthRepository {
  user: AuthUser | null = createUser();
  auditActions: string[] = [];
  refreshTokens: RefreshTokenRecord[] = [];
  activeRefreshToken: RefreshTokenRecord | null = null;
  didRotateRefreshToken = false;
  revokedTokenHash: string | null = null;

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.user?.email === email ? { ...this.user } : null;
  }

  async clearExpiredLock(userId: string): Promise<void> {
    if (this.user?.id === userId) {
      this.user.failedLoginCount = 0;
      this.user.lockedUntil = null;
    }
  }

  async recordFailedLogin(userId: string): Promise<number> {
    if (this.user?.id !== userId) return 0;
    this.user.failedLoginCount += 1;
    return this.user.failedLoginCount;
  }

  async lockUser(userId: string, lockedUntil: Date, context: ClientContext): Promise<void> {
    if (this.user?.id === userId) this.user.lockedUntil = lockedUntil;
    this.auditActions.push(`LOGIN_LOCKED:${context.ipAddress ?? 'unknown'}`);
  }

  async recordSuccessfulLogin(userId: string, context: ClientContext): Promise<Date> {
    if (this.user?.id === userId) {
      this.user.failedLoginCount = 0;
      this.user.lastLoginAt = NOW;
    }
    this.auditActions.push(`LOGIN_SUCCESS:${context.ipAddress ?? 'unknown'}`);
    return NOW;
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.push(record);
  }

  async findActiveRefreshToken(): Promise<(RefreshTokenRecord & { user: AuthUser }) | null> {
    if (!this.activeRefreshToken || !this.user) return null;
    return { ...this.activeRefreshToken, user: { ...this.user } };
  }

  async rotateRefreshToken(
    _currentTokenId: string,
    nextToken: RefreshTokenRecord,
  ): Promise<boolean> {
    this.didRotateRefreshToken = true;
    this.activeRefreshToken = nextToken;
    return true;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    this.revokedTokenHash = tokenHash;
  }
}

class StubPasswordHasher implements PasswordHasher {
  async verify(hash: string, plainText: string): Promise<boolean> {
    return hash === 'valid-password-hash' && plainText === 'Admin@12345';
  }
}

class StubTokenService implements TokenService {
  issueTokenPair(): TokenPair {
    return {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessExpiresInSeconds: 3600,
      refreshExpiresAt: new Date('2026-09-24T01:00:00.000Z'),
      refreshTokenId: '22222222-2222-4222-8222-222222222222',
    };
  }

  verifyAccessToken(): never {
    throw new Error('Không dùng trong test này');
  }

  verifyRefreshToken(token: string): ReturnType<TokenService['verifyRefreshToken']> {
    if (token !== 'valid-refresh') throw new Error('Refresh token không hợp lệ');
    return {
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'admin@camerai.local',
      role: 'ADMIN' as const,
      tokenType: 'refresh' as const,
      jti: '33333333-3333-4333-8333-333333333333',
    };
  }
}

function createService(repository: InMemoryAuthRepository): AuthService {
  return new AuthService(
    repository,
    new StubPasswordHasher(),
    new StubTokenService(),
    { maxLoginAttempts: 5, lockDurationMinutes: 15 },
    () => NOW,
  );
}

async function expectHttpStatus(action: Promise<unknown>, status: number): Promise<void> {
  try {
    await action;
    throw new Error('Lẽ ra yêu cầu phải thất bại');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}

describe('AuthService.login', () => {
  it('cấp access token một giờ, lưu refresh token và ghi audit khi mật khẩu đúng', async () => {
    const repository = new InMemoryAuthRepository();
    const service = createService(repository);

    const result = await service.login(
      { email: 'ADMIN@CAMERAI.LOCAL ', password: 'Admin@12345' },
      CLIENT_CONTEXT,
    );

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.expiresIn).toBe(3600);
    expect(result.user.email).toBe('admin@camerai.local');
    expect(repository.refreshTokens).toHaveLength(1);
    expect(repository.auditActions).toContain('LOGIN_SUCCESS:127.0.0.1');
  });

  it('trả 401 trong năm lần nhập sai đầu tiên', async () => {
    const repository = new InMemoryAuthRepository();
    const service = createService(repository);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectHttpStatus(
        service.login({ email: 'admin@camerai.local', password: 'wrong-password' }, CLIENT_CONTEXT),
        HttpStatus.UNAUTHORIZED,
      );
    }

    expect(repository.user?.failedLoginCount).toBe(5);
    expect(repository.auditActions).not.toContain('LOGIN_LOCKED:127.0.0.1');
  });

  it('khóa 15 phút và ghi audit ở lần thử thứ sáu', async () => {
    const repository = new InMemoryAuthRepository();
    repository.user = createUser({ failedLoginCount: 5 });
    const service = createService(repository);

    await expectHttpStatus(
      service.login({ email: 'admin@camerai.local', password: 'Admin@12345' }, CLIENT_CONTEXT),
      423,
    );

    expect(repository.user?.lockedUntil?.toISOString()).toBe('2026-09-17T01:15:00.000Z');
    expect(repository.auditActions).toContain('LOGIN_LOCKED:127.0.0.1');
  });
});

describe('AuthService refresh và logout', () => {
  it('xoay refresh token và cấp một cặp token mới', async () => {
    const repository = new InMemoryAuthRepository();
    repository.activeRefreshToken = {
      id: '33333333-3333-4333-8333-333333333333',
      userId: createUser().id,
      tokenHash: 'stored-hash',
      expiresAt: new Date('2026-09-24T01:00:00.000Z'),
    };
    const service = createService(repository);

    const result = await service.refresh('valid-refresh');

    expect(result.accessToken).toBe('access-token');
    expect(repository.didRotateRefreshToken).toBe(true);
  });

  it('thu hồi refresh token khi đăng xuất', async () => {
    const repository = new InMemoryAuthRepository();
    const service = createService(repository);

    await service.logout('valid-refresh');

    expect(repository.revokedTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
