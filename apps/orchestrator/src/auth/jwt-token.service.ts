import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sign, verify, type JwtPayload } from 'jsonwebtoken';
import {
  JWT_CONFIG,
  type AuthUser,
  type JwtConfig,
  type TokenClaims,
  type TokenPair,
  type TokenService,
  type UserRole,
} from './auth.types';

const JWT_ISSUER = 'camerai-orchestrator';
const JWT_AUDIENCE = 'camerai-dashboard';
const MINIMUM_SECRET_LENGTH = 32;

@Injectable()
export class JwtTokenService implements TokenService {
  constructor(@Inject(JWT_CONFIG) private readonly config: JwtConfig) {
    if (config.secret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error('JWT_SECRET phải có ít nhất 32 ký tự.');
    }
  }

  issueTokenPair(user: AuthUser): TokenPair {
    const accessTokenId = randomUUID();
    const refreshTokenId = randomUUID();
    const commonClaims = { email: user.email, role: user.role };

    const accessToken = this.signToken(
      { ...commonClaims, tokenType: 'access' },
      user.id,
      accessTokenId,
      this.config.accessTtlSeconds,
    );
    const refreshToken = this.signToken(
      { ...commonClaims, tokenType: 'refresh' },
      user.id,
      refreshTokenId,
      this.config.refreshTtlSeconds,
    );

    return {
      accessToken,
      refreshToken,
      accessExpiresInSeconds: this.config.accessTtlSeconds,
      refreshExpiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
      refreshTokenId,
    };
  }

  verifyAccessToken(token: string): TokenClaims {
    return this.verifyToken(token, 'access');
  }

  verifyRefreshToken(token: string): TokenClaims {
    return this.verifyToken(token, 'refresh');
  }

  private signToken(
    payload: { email: string; role: UserRole; tokenType: 'access' | 'refresh' },
    subject: string,
    tokenId: string,
    expiresInSeconds: number,
  ): string {
    return sign(payload, this.config.secret, {
      algorithm: 'HS256',
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      subject,
      jwtid: tokenId,
      expiresIn: expiresInSeconds,
    });
  }

  private verifyToken(token: string, expectedType: 'access' | 'refresh'): TokenClaims {
    const decoded = verify(token, this.config.secret, {
      algorithms: ['HS256'],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    });

    if (typeof decoded === 'string' || decoded.tokenType !== expectedType) {
      throw new Error('Sai loại JWT.');
    }

    return this.toTokenClaims(decoded);
  }

  private toTokenClaims(payload: JwtPayload): TokenClaims {
    if (
      !payload.sub ||
      !payload.jti ||
      typeof payload.email !== 'string' ||
      !this.isUserRole(payload.role) ||
      (payload.tokenType !== 'access' && payload.tokenType !== 'refresh')
    ) {
      throw new Error('JWT thiếu claim bắt buộc.');
    }

    return {
      sub: payload.sub,
      jti: payload.jti,
      email: payload.email,
      role: payload.role,
      tokenType: payload.tokenType,
    };
  }

  private isUserRole(value: unknown): value is UserRole {
    return value === 'ADMIN' || value === 'CAREGIVER' || value === 'VIEWER';
  }
}
