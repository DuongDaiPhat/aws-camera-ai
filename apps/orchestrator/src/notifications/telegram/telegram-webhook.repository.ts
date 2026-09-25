import { ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TelegramWebhookRepository {
  constructor(private readonly database: DatabaseService) {}

  async store(updateId: number, minimalBody: object): Promise<boolean> {
    const result = await this.database.query<{ update_id: string }>(
      `
      INSERT INTO telegram_webhook_inbox (update_id, update_body)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (update_id) DO NOTHING
      RETURNING update_id
    `,
      [updateId, JSON.stringify(minimalBody)],
    );
    if (result.rowCount === 1) return true;
    const existing = await this.database.query<{ same_payload: boolean }>(
      `
      SELECT update_body = $2::jsonb AS same_payload
      FROM telegram_webhook_inbox WHERE update_id = $1 LIMIT 1
    `,
      [updateId, JSON.stringify(minimalBody)],
    );
    if (existing.rows[0] && !existing.rows[0].same_payload) {
      throw new ConflictException('Telegram update_id đã có payload khác.');
    }
    return false;
  }

  async markProcessed(updateId: number): Promise<void> {
    await this.database.query(
      `
      UPDATE telegram_webhook_inbox
      SET status = 'PROCESSED', processed_at = now()
      WHERE update_id = $1 AND status = 'PENDING'
    `,
      [updateId],
    );
  }

  async isProcessed(updateId: number): Promise<boolean> {
    const result = await this.database.query<{ status: string }>(
      'SELECT status FROM telegram_webhook_inbox WHERE update_id = $1 LIMIT 1',
      [updateId],
    );
    return result.rows[0]?.status === 'PROCESSED';
  }
}
