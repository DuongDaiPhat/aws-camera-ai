import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { TelegramLinkRepository } from './telegram-link.repository';

export function hashTelegramLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TelegramLinkService {
  constructor(private readonly repository: TelegramLinkRepository) {}

  async create(userId: string): Promise<{ linkToken: string; expiresAt: string }> {
    const linkToken = randomBytes(32).toString('base64url');
    const expiresAt = await this.repository.create(userId, hashTelegramLinkToken(linkToken));
    return { linkToken, expiresAt: expiresAt.toISOString() };
  }

  consume(token: string, telegramUserId: string, chatId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return Promise.resolve(false);
    return this.repository.consume(hashTelegramLinkToken(token), telegramUserId, chatId);
  }
}
