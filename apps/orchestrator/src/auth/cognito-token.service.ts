import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type { DatabaseService } from '../database/database.service';
import type { CognitoVerifierService } from './cognito-verifier.service';
import type { TokenClaims, TokenService, UserRole } from './auth.types';

interface MappedUser extends QueryResultRow {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

/** Adapts Cognito identity to the application IDs used by ownership policies. */
export class CognitoTokenService implements TokenService {
  constructor(
    private readonly verifier: CognitoVerifierService,
    private readonly database: DatabaseService,
  ) {}

  issueTokenPair(): never {
    throw new ConflictException('Đăng nhập và refresh phải thực hiện qua Cognito.');
  }

  verifyRefreshToken(): never {
    throw new ConflictException('Refresh token phải được xử lý bởi Cognito.');
  }

  async verifyAccessToken(token: string): Promise<TokenClaims> {
    const claims = await this.verifier.verifyAccessToken(token);
    const result = await this.database.query<MappedUser>(
      `SELECT id, email, role, is_active FROM users
       WHERE cognito_issuer = $1 AND cognito_sub = $2 LIMIT 1`,
      [claims.iss, claims.sub],
    );
    const user = result.rows[0];
    if (!user?.is_active) {
      throw new ForbiddenException({
        error: { code: 'USER_NOT_PROVISIONED', message: 'Tài khoản chưa được cấp quyền ứng dụng.' },
      });
    }
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: 'access',
      jti: typeof claims.jti === 'string' ? claims.jti : '',
    };
  }
}
