import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  AUTH_REPOSITORY,
  PASSWORD_HASHER,
  TOKEN_SERVICE,
  type AuthClock,
  type AuthPolicy,
  type AuthRepository,
  type AuthResult,
  type AuthUser,
  type ClientContext,
  type LoginCredentials,
  type PasswordHasher,
  type PublicUser,
  type RefreshTokenRecord,
  type TokenPair,
  type TokenClaims,
  type TokenService,
} from './auth.types';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$FsZu+Cdsiw7bzUxmN/XQuQ$1Mhd1cDsXLp0O1Qc1cfvLEd4qdgCYgGCRHEHQ3ftGMs';
const ACCOUNT_LOCKED_STATUS = 423;

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(AUTH_POLICY) private readonly policy: AuthPolicy,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  async login(credentials: LoginCredentials, context: ClientContext): Promise<AuthResult> {
    const email = credentials.email.trim().toLowerCase();
    const user = await this.repository.findUserByEmail(email);

    if (!user?.passwordHash || !user.isActive) {
      await this.passwordHasher.verify(DUMMY_PASSWORD_HASH, credentials.password);
      throw this.invalidCredentialsError();
    }

    await this.normalizeExpiredLock(user);
    await this.assertAccountCanAttemptLogin(user, context);

    const isPasswordValid = await this.passwordHasher.verify(
      user.passwordHash,
      credentials.password,
    );
    if (!isPasswordValid) {
      await this.repository.recordFailedLogin(user.id);
      throw this.invalidCredentialsError();
    }

    const tokens = this.tokenService.issueTokenPair(user);
    const lastLoginAt = await this.repository.recordSuccessfulLogin(user.id, context);
    await this.repository.saveRefreshToken(this.toRefreshTokenRecord(user.id, tokens));

    return this.toAuthResult(user, lastLoginAt, tokens);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const claims = this.verifyRefreshToken(refreshToken);
    const currentToken = await this.repository.findActiveRefreshToken(this.hashToken(refreshToken));

    if (!currentToken || currentToken.id !== claims.jti || currentToken.userId !== claims.sub) {
      throw this.invalidRefreshTokenError();
    }

    const nextTokens = this.tokenService.issueTokenPair(currentToken.user);
    const didRotate = await this.repository.rotateRefreshToken(
      currentToken.id,
      this.toRefreshTokenRecord(currentToken.user.id, nextTokens),
    );
    if (!didRotate) throw this.invalidRefreshTokenError();

    return this.toAuthResult(
      currentToken.user,
      currentToken.user.lastLoginAt ?? this.clock(),
      nextTokens,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeRefreshToken(this.hashToken(refreshToken));
  }

  async getCurrentUser(email: string): Promise<PublicUser> {
    const user = await this.repository.findUserByEmail(email.toLowerCase());
    if (!user?.isActive) throw this.invalidCredentialsError();
    return this.toPublicUser(user);
  }

  private async normalizeExpiredLock(user: AuthUser): Promise<void> {
    const now = this.clock();
    if (user.lockedUntil && user.lockedUntil.getTime() <= now.getTime()) {
      await this.repository.clearExpiredLock(user.id);
      user.failedLoginCount = 0;
      user.lockedUntil = null;
    }
  }

  private async assertAccountCanAttemptLogin(
    user: AuthUser,
    context: ClientContext,
  ): Promise<void> {
    const now = this.clock();
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      throw this.accountLockedError(user.lockedUntil);
    }

    if (user.failedLoginCount >= this.policy.maxLoginAttempts) {
      const lockedUntil = new Date(now.getTime() + this.policy.lockDurationMinutes * 60_000);
      await this.repository.lockUser(user.id, lockedUntil, context);
      throw this.accountLockedError(lockedUntil);
    }
  }

  private toRefreshTokenRecord(userId: string, tokens: TokenPair): RefreshTokenRecord {
    return {
      id: tokens.refreshTokenId,
      userId,
      tokenHash: this.hashToken(tokens.refreshToken),
      expiresAt: tokens.refreshExpiresAt,
    };
  }

  private toAuthResult(user: AuthUser, lastLoginAt: Date, tokens: TokenPair): AuthResult {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.accessExpiresInSeconds,
      user: this.toPublicUser(user, lastLoginAt),
    };
  }

  private toPublicUser(user: AuthUser, lastLoginAt = user.lastLoginAt): PublicUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private invalidCredentialsError(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' },
    });
  }

  private accountLockedError(lockedUntil: Date): HttpException {
    return new HttpException(
      {
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần.',
          details: { lockedUntil: lockedUntil.toISOString() },
        },
      },
      ACCOUNT_LOCKED_STATUS,
    );
  }

  private verifyRefreshToken(refreshToken: string): TokenClaims {
    try {
      return this.tokenService.verifyRefreshToken(refreshToken);
    } catch {
      throw this.invalidRefreshTokenError();
    }
  }

  private invalidRefreshTokenError(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'INVALID_REFRESH_TOKEN', message: 'Phiên đăng nhập không còn hợp lệ.' },
    });
  }
}
