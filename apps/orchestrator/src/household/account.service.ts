import type { components } from '@cam/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import { DatabaseService } from '../database/database.service';
import type { ChangePasswordDto, NotificationPreferencesDto, ProfileDto } from './household.dto';

@Injectable()
export class AccountService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  async get(userId: string): Promise<components['schemas']['AccountSettings']> {
    const { rows } = await this.db.query<
      Omit<components['schemas']['AccountSettings'], 'authProvider'>
    >(
      `SELECT u.id,u.email,u.full_name AS "fullName",u.phone_e164 AS phone,u.role,
      u.telegram_linked_at IS NOT NULL AS "telegramLinked",COALESCE(p.in_app_alerts,TRUE) AS "inAppAlerts",
      COALESCE(p.sound_alerts,TRUE) AS "soundAlerts",COALESCE(p.telegram_alerts,TRUE) AS "telegramAlerts"
      FROM users u LEFT JOIN user_notification_preferences p ON p.user_id=u.id WHERE u.id=$1 AND u.is_active`,
      [userId],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return { ...rows[0], authProvider: this.config.get('AUTH_PROVIDER', 'jwt') };
  }
  async profile(
    userId: string,
    input: ProfileDto,
  ): Promise<components['schemas']['AccountSettings']> {
    if (!input.fullName.trim()) throw new BadRequestException('Họ tên không được để trống.');
    const nextPhone = input.phone ?? null;
    await this.db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE users SET full_name=$2,phone_e164=$3 WHERE id=$1 AND is_active RETURNING id`,
        [userId, input.fullName.trim(), nextPhone],
      );
      if (!result.rows[0]) throw new UnauthorizedException();
      if (!nextPhone) {
        await client.query('DELETE FROM user_phone_alert_settings WHERE user_id=$1', [userId]);
      } else {
        await client.query('UPDATE user_phone_alert_settings SET phone=$2 WHERE user_id=$1', [
          userId,
          nextPhone,
        ]);
      }
    });
    return this.get(userId);
  }
  async preferences(
    userId: string,
    input: NotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    await this.get(userId);
    await this.db.query(
      `INSERT INTO user_notification_preferences(user_id,in_app_alerts,sound_alerts,telegram_alerts) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET in_app_alerts=$2,sound_alerts=$3,telegram_alerts=$4`,
      [userId, input.inAppAlerts, input.soundAlerts, input.telegramAlerts],
    );
    return input;
  }
  async password(userId: string, input: ChangePasswordDto): Promise<{ saved: boolean }> {
    if (this.config.get('AUTH_PROVIDER', 'jwt') !== 'jwt')
      throw new ConflictException('Mật khẩu tài khoản này được quản lý tại Cognito.');
    if (input.currentPassword === input.newPassword)
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại.');
    await this.db.transaction(async (client) => {
      const result = await client.query<{ password_hash: string | null }>(
        'SELECT password_hash FROM users WHERE id=$1 AND is_active FOR UPDATE',
        [userId],
      );
      const stored = result.rows[0]?.password_hash;
      if (!stored || !(await verify(stored, input.currentPassword)))
        throw new BadRequestException('Mật khẩu hiện tại không đúng.');
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
        userId,
        await hash(input.newPassword),
      ]);
      await client.query('DELETE FROM auth_refresh_tokens WHERE user_id=$1', [userId]);
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'PASSWORD_CHANGED','user',$1)`,
        [userId],
      );
    });
    return { saved: true };
  }
}
