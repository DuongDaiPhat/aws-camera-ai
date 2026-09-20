import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type {
  AuthRepository,
  AuthUser,
  ClientContext,
  RefreshTokenRecord,
  StoredRefreshToken,
  UserRole,
} from './auth.types';

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

interface RefreshTokenRow extends UserRow {
  token_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
}

@Injectable()
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.database.query<UserRow>(
      `${this.userSelect()} WHERE email = $1 LIMIT 1`,
      [email],
    );
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async clearExpiredLock(userId: string): Promise<void> {
    await this.database.query(
      `UPDATE users
       SET failed_login_count = 0, locked_until = NULL
       WHERE id = $1 AND locked_until <= now()`,
      [userId],
    );
  }

  async recordFailedLogin(userId: string): Promise<number> {
    const result = await this.database.query<{ failed_login_count: number }>(
      `UPDATE users
       SET failed_login_count = failed_login_count + 1
       WHERE id = $1
       RETURNING failed_login_count`,
      [userId],
    );
    return result.rows[0]?.failed_login_count ?? 0;
  }

  async lockUser(userId: string, lockedUntil: Date, context: ClientContext): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query('UPDATE users SET locked_until = $2 WHERE id = $1', [userId, lockedUntil]);
      await this.insertAuditLog(client, userId, 'LOGIN_LOCKED', context, {
        lockedUntil: lockedUntil.toISOString(),
      });
    });
  }

  async recordSuccessfulLogin(userId: string, context: ClientContext): Promise<Date> {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ last_login_at: Date }>(
        `UPDATE users
         SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
         WHERE id = $1
         RETURNING last_login_at`,
        [userId],
      );
      await this.insertAuditLog(client, userId, 'LOGIN_SUCCESS', context);
      const lastLoginAt = result.rows[0]?.last_login_at;
      if (!lastLoginAt) throw new Error('Không cập nhật được thời gian đăng nhập.');
      return lastLoginAt;
    });
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [record.id, record.userId, record.tokenHash, record.expiresAt],
    );
  }

  async findActiveRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    const result = await this.database.query<RefreshTokenRow>(
      `SELECT rt.id AS token_id, rt.user_id, rt.token_hash, rt.expires_at,
              u.id, u.email, u.password_hash, u.full_name, u.role, u.is_active,
              u.failed_login_count, u.locked_until, u.last_login_at, u.created_at
       FROM auth_refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
         AND rt.revoked_at IS NULL
         AND rt.expires_at > now()
         AND u.is_active
       LIMIT 1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.token_id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      user: this.mapUser(row),
    };
  }

  async rotateRefreshToken(
    currentTokenId: string,
    nextToken: RefreshTokenRecord,
  ): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const revoked = await client.query(
        `UPDATE auth_refresh_tokens
         SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [currentTokenId],
      );
      if (revoked.rowCount !== 1) return false;

      await client.query(
        `INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [nextToken.id, nextToken.userId, nextToken.tokenHash, nextToken.expiresAt],
      );
      await client.query('UPDATE auth_refresh_tokens SET replaced_by_token_id = $2 WHERE id = $1', [
        currentTokenId,
        nextToken.id,
      ]);
      return true;
    });
  }

  async revokeRefreshToken(tokenHash: string, userId?: string): Promise<void> {
    await this.database.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = now()
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND ($2::uuid IS NULL OR user_id = $2)`,
      [tokenHash, userId ?? null],
    );
  }

  private userSelect(): string {
    return `SELECT id, email, password_hash, full_name, role, is_active,
                   failed_login_count, locked_until, last_login_at, created_at
            FROM users`;
  }

  private mapUser(row: UserRow): AuthUser {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      fullName: row.full_name,
      role: row.role,
      isActive: row.is_active,
      failedLoginCount: row.failed_login_count,
      lockedUntil: row.locked_until,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    };
  }

  private async insertAuditLog(
    client: PoolClient,
    userId: string,
    action: string,
    context: ClientContext,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, metadata)
       VALUES ($1, $2, 'USER', $1, $3, $4)`,
      [
        userId,
        action,
        context.ipAddress,
        JSON.stringify({ ...metadata, userAgent: context.userAgent }),
      ],
    );
  }
}
