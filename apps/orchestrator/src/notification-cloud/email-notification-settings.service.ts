import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { readNotificationConfig } from './notification-cloud.config';
import { NotificationRegistrationProvider } from './notification-registration.provider';
import { nextVerificationRequestCount } from './alert-verification-limit';

type EmailPreference = { enabled: boolean; email?: string };
type EmailSetting = {
  available: boolean;
  accountEmail: string;
  email: string;
  enabled: boolean;
  status: 'OFF' | 'PENDING' | 'VERIFIED';
  confirmationSent: boolean;
};
type EmailRow = {
  enabled: boolean;
  email: string;
  registration_id: string;
  topic_arn: string;
  requested_at: Date;
  requests_today: number;
  confirmation_sent: boolean;
  verified_at: Date | null;
};

@Injectable()
export class EmailNotificationSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly prefix: string | undefined;
  private readonly logger = new Logger(EmailNotificationSettingsService.name);
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;

  constructor(
    config: ConfigService,
    private readonly db: DatabaseService,
    @Inject(NotificationRegistrationProvider)
    private readonly sns: Pick<NotificationRegistrationProvider, 'register' | 'confirmed'>,
  ) {
    this.prefix = readNotificationConfig(config).emailTopicPrefix;
  }

  onModuleInit(): void {
    if (!this.prefix) return;
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = this.verifyPending()
        .catch(() => this.logger.warn('Email confirmation check will retry'))
        .finally(() => {
          this.checking = undefined;
        });
    }, 15_000).unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.checking;
  }

  async verifyPending(): Promise<void> {
    if (!this.prefix) return;
    const { rows } = await this.db.query<Pick<EmailRow, 'registration_id' | 'topic_arn' | 'email'>>(
      `WITH due AS (
         SELECT p.user_id FROM user_email_alert_settings p JOIN users u ON u.id=p.user_id
         WHERE p.enabled AND p.confirmation_sent AND p.verified_at IS NULL AND u.is_active
           AND p.topic_arn=($1 || p.registration_id::text)
           AND p.requested_at > clock_timestamp() - interval '3 days'
           AND (p.checked_at IS NULL OR p.checked_at < clock_timestamp() - interval '15 seconds')
         ORDER BY p.checked_at NULLS FIRST,p.requested_at LIMIT 10 FOR UPDATE OF p SKIP LOCKED
       ) UPDATE user_email_alert_settings p SET checked_at=clock_timestamp()
       FROM due WHERE p.user_id=due.user_id RETURNING p.registration_id,p.topic_arn,p.email`,
      [this.prefix],
    );
    await Promise.all(
      rows.map(async (row) => {
        if (await this.sns.confirmed(row.topic_arn, row.email).catch(() => false)) {
          await this.db.query(
            `UPDATE user_email_alert_settings SET verified_at=clock_timestamp()
           WHERE registration_id=$1 AND enabled AND confirmation_sent AND verified_at IS NULL`,
            [row.registration_id],
          );
        }
      }),
    );
  }

  async get(user: string): Promise<EmailSetting> {
    const {
      rows: [row],
    } = await this.db.query<EmailRow & { account_email: string }>(
      `SELECT p.*, lower(u.email::text) AS account_email
       FROM users u LEFT JOIN user_email_alert_settings p ON p.user_id=u.id
       WHERE u.id=$1 AND u.is_active`,
      [user],
    );
    if (!row) throw new NotFoundException('Không tìm thấy tài khoản.');
    const enabled = !!row.enabled && row.topic_arn === this.prefix + row.registration_id;
    return {
      available: !!this.prefix,
      accountEmail: row.account_email,
      email: row.email ?? row.account_email,
      enabled,
      status: enabled ? (row.verified_at ? 'VERIFIED' : 'PENDING') : 'OFF',
      confirmationSent: enabled && row.confirmation_sent,
    };
  }

  async set(user: string, input: EmailPreference): Promise<EmailSetting> {
    const prefix = this.prefix;
    if (input.enabled && !prefix)
      throw new ServiceUnavailableException('Kênh email chưa được cấu hình.');
    const requested = await this.db.transaction(async (client) => {
      const {
        rows: [account],
      } = await client.query<{ email: string }>(
        'SELECT email FROM users WHERE id=$1 AND is_active FOR UPDATE',
        [user],
      );
      if (!account) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (!input.enabled) {
        await client.query(
          'UPDATE user_email_alert_settings SET enabled=false, verified_at=NULL WHERE user_id=$1',
          [user],
        );
        return null;
      }
      const email = (input.email?.trim() || account.email).toLowerCase();
      if (email.length > 254 || !isEmail(email, { allow_utf8_local_part: false })) {
        throw new BadRequestException('Email không hợp lệ.');
      }
      const {
        rows: [previous],
      } = await client.query<EmailRow>('SELECT * FROM user_email_alert_settings WHERE user_id=$1', [
        user,
      ]);
      const same =
        previous?.enabled &&
        previous.email === email &&
        previous.topic_arn === prefix + previous.registration_id;
      if (
        same &&
        previous.confirmation_sent &&
        (previous.verified_at ||
          Date.now() - previous.requested_at.getTime() < 3 * 24 * 60 * 60 * 1000)
      )
        return null;
      const count = nextVerificationRequestCount(previous);
      const id = same && !previous.confirmation_sent ? previous.registration_id : randomUUID();
      const topic = prefix + id;
      await client.query(
        `INSERT INTO user_email_alert_settings(user_id,enabled,email,registration_id,topic_arn,requested_at,requests_today)
         VALUES($1,true,$2,$3,$4,clock_timestamp(),$5)
         ON CONFLICT(user_id) DO UPDATE SET enabled=true,email=$2,registration_id=$3,topic_arn=$4,
           requested_at=clock_timestamp(),requests_today=$5,confirmation_sent=false,verified_at=NULL,checked_at=NULL`,
        [user, email, id, topic, count],
      );
      return { id, email, topic };
    });
    if (requested) {
      try {
        await this.sns.register(requested.topic, requested.email);
      } catch {
        throw new ServiceUnavailableException('Chưa gửi được thư xác nhận. Hãy thử lại sau.');
      }
      await this.db.query(
        'UPDATE user_email_alert_settings SET confirmation_sent=true WHERE user_id=$1 AND registration_id=$2 AND enabled',
        [user, requested.id],
      );
    }
    return this.get(user);
  }
}
