import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

const LINK_TTL_MINUTES = 10;
const LINK_RATE_LIMIT_SECONDS = 60;

interface LinkRequestRow {
  expires_at: Date;
}

@Injectable()
export class TelegramLinkRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, tokenHash: string): Promise<Date> {
    return this.database.transaction(async (client) => {
      const user = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE',
        [userId],
      );
      if (!user.rows[0]) throw new Error('Không tìm thấy tài khoản đang hoạt động.');

      const recent = await client.query<{ too_soon: boolean }>(
        `
        SELECT created_at > now() - ($2 * interval '1 second') AS too_soon
        FROM telegram_link_requests
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
      `,
        [userId, LINK_RATE_LIMIT_SECONDS],
      );
      if (recent.rows[0]?.too_soon) {
        throw new HttpException(
          'Vui lòng chờ một phút trước khi tạo mã mới.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await client.query(
        'UPDATE telegram_link_requests SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL',
        [userId],
      );
      const result = await client.query<LinkRequestRow>(
        `
        INSERT INTO telegram_link_requests (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + ($3 * interval '1 minute'))
        RETURNING expires_at
      `,
        [userId, tokenHash, LINK_TTL_MINUTES],
      );
      return result.rows[0].expires_at;
    });
  }

  async consume(tokenHash: string, telegramUserId: string, chatId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        user_id: string;
        consumed_at: Date | null;
        valid: boolean;
      }>(
        `
        SELECT id, user_id, consumed_at, expires_at > now() AS valid
        FROM telegram_link_requests
        WHERE token_hash = $1 FOR UPDATE
      `,
        [tokenHash],
      );
      const request = result.rows[0];
      if (!request) return false;
      if (request.consumed_at) {
        const linked = await client.query<{ id: string }>(
          `
          SELECT id FROM users
          WHERE id = $1 AND telegram_user_id = $2 AND telegram_chat_id = $3
                AND telegram_linked_at IS NOT NULL AND is_active = TRUE LIMIT 1
        `,
          [request.user_id, telegramUserId, chatId],
        );
        return Boolean(linked.rows[0]);
      }
      if (!request.valid) return false;

      const existing = await client.query<{ id: string }>(
        `
        SELECT id FROM users WHERE telegram_user_id = $1 AND id <> $2 LIMIT 1
      `,
        [telegramUserId, request.user_id],
      );
      await client.query('UPDATE telegram_link_requests SET consumed_at = now() WHERE id = $1', [
        request.id,
      ]);
      if (existing.rows[0]) return false;

      const linked = await client.query(
        `
        UPDATE users SET telegram_user_id = $2, telegram_chat_id = $3,
                         telegram_linked_at = now()
        WHERE id = $1 AND is_active = TRUE
      `,
        [request.user_id, telegramUserId, chatId],
      );
      return linked.rowCount === 1;
    });
  }
}
