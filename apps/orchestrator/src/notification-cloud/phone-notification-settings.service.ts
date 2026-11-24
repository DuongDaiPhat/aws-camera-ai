import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { readNotificationConfig } from './notification-cloud.config';
import { NotificationRegistrationProvider } from './notification-registration.provider';
import { nextVerificationRequestCount } from './alert-verification-limit';

export const ALERT_PHONE = /^\+[1-9][0-9]{7,14}$/;
type PhonePreference = { smsEnabled: boolean; callEnabled: boolean; phone?: string };
type PhoneSetting = {
  smsAvailable: boolean;
  callAvailable: boolean;
  smsEnabled: boolean;
  callEnabled: boolean;
  accountPhone: string | null;
  phone: string | null;
  status: 'OFF' | 'PENDING' | 'VERIFIED';
};
type PhoneRow = {
  phone: string;
  registration_id: string;
  requested_at: Date;
  requests_today: number;
  code_hash: string | null;
  code_attempts: number;
  verified_at: Date | null;
  sms_enabled: boolean;
  call_enabled: boolean;
};

@Injectable()
export class PhoneNotificationSettingsService {
  private readonly key: string;
  private readonly smsAvailable: boolean;
  private readonly callAvailable: boolean;

  constructor(
    config: ConfigService,
    private readonly db: DatabaseService,
    @Inject(NotificationRegistrationProvider)
    private readonly sns: Pick<NotificationRegistrationProvider, 'sendPhoneCode'>,
  ) {
    const settings = readNotificationConfig(config);
    this.key = config.get<string>('INTERNAL_SERVICE_TOKEN')?.trim() ?? '';
    this.smsAvailable = settings.phoneSelfService && settings.smsEnabled;
    this.callAvailable =
      settings.phoneSelfService &&
      !!(
        settings.connectInstanceId &&
        settings.connectContactFlowId &&
        settings.connectSourcePhoneNumber
      );
  }

  async get(user: string): Promise<PhoneSetting> {
    const {
      rows: [row],
    } = await this.db.query<PhoneRow & { account_phone: string | null }>(
      `SELECT p.*,u.phone_e164 AS account_phone FROM users u
       LEFT JOIN user_phone_alert_settings p ON p.user_id=u.id WHERE u.id=$1 AND u.is_active`,
      [user],
    );
    if (!row) throw new NotFoundException('Không tìm thấy tài khoản.');
    return {
      smsAvailable: this.smsAvailable,
      callAvailable: this.callAvailable,
      smsEnabled: !!row.sms_enabled,
      callEnabled: !!row.call_enabled,
      accountPhone: row.account_phone,
      phone: row.phone ?? row.account_phone,
      status:
        row.sms_enabled || row.call_enabled ? (row.verified_at ? 'VERIFIED' : 'PENDING') : 'OFF',
    };
  }

  async set(user: string, input: PhonePreference): Promise<PhoneSetting> {
    if ((input.smsEnabled && !this.smsAvailable) || (input.callEnabled && !this.callAvailable)) {
      throw new ServiceUnavailableException('Kênh nhận qua điện thoại chưa được cấu hình.');
    }
    const verification = await this.db.transaction(async (client) => {
      const {
        rows: [account],
      } = await client.query<{ phone_e164: string | null }>(
        'SELECT phone_e164 FROM users WHERE id=$1 AND is_active FOR UPDATE',
        [user],
      );
      if (!account) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (!input.smsEnabled && !input.callEnabled) {
        await client.query(
          'UPDATE user_phone_alert_settings SET sms_enabled=false,call_enabled=false,code_hash=NULL WHERE user_id=$1',
          [user],
        );
        return null;
      }
      const phone = input.phone?.trim() || account.phone_e164;
      if (!phone || !ALERT_PHONE.test(phone)) {
        throw new BadRequestException('Nhập số điện thoại có mã quốc gia, ví dụ +84901234567.');
      }
      const {
        rows: [previous],
      } = await client.query<PhoneRow>(
        'SELECT * FROM user_phone_alert_settings WHERE user_id=$1 FOR UPDATE',
        [user],
      );
      if (previous?.phone === phone && previous.verified_at) {
        await client.query(
          'UPDATE user_phone_alert_settings SET sms_enabled=$2,call_enabled=$3 WHERE user_id=$1',
          [user, input.smsEnabled, input.callEnabled],
        );
        return null;
      }
      const count = nextVerificationRequestCount(previous);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('notification-otp/' || $1, 0))",
        [phone],
      );
      const {
        rows: [limit],
      } = await client.query<{ blocked: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM user_phone_alert_settings WHERE (user_id=$1 OR phone=$2)
          AND requested_at > clock_timestamp() - interval '60 seconds') AS blocked`,
        [user, phone],
      );
      if (limit.blocked)
        throw new HttpException('Vui lòng đợi một phút trước khi yêu cầu mã mới.', 429);
      const id = randomUUID();
      const code = String(randomInt(1_000_000)).padStart(6, '0');
      await client.query(
        `INSERT INTO user_phone_alert_settings(user_id,sms_enabled,call_enabled,phone,registration_id,requested_at,code_hash,requests_today)
         VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7)
         ON CONFLICT(user_id) DO UPDATE SET sms_enabled=$2,call_enabled=$3,phone=$4,registration_id=$5,
           requested_at=clock_timestamp(),code_hash=$6,requests_today=$7,code_attempts=0,verified_at=NULL`,
        [user, input.smsEnabled, input.callEnabled, phone, id, this.digest(user, id, code), count],
      );
      return { phone, code };
    });
    if (verification) {
      try {
        await this.sns.sendPhoneCode(verification.phone, verification.code);
      } catch {
        throw new ServiceUnavailableException('Chưa gửi được mã xác minh. Hãy thử lại sau.');
      }
    }
    return this.get(user);
  }

  async verify(user: string, code: string): Promise<PhoneSetting> {
    const accepted = await this.db.transaction(async (client) => {
      const {
        rows: [row],
      } = await client.query<PhoneRow>(
        `SELECT p.* FROM user_phone_alert_settings p JOIN users u ON u.id=p.user_id
         WHERE p.user_id=$1 AND u.is_active AND (p.sms_enabled OR p.call_enabled)
           AND p.code_attempts < 5 AND p.code_hash IS NOT NULL
           AND p.requested_at > clock_timestamp() - interval '10 minutes'
         FOR UPDATE OF p`,
        [user],
      );
      if (!row?.code_hash) return false;
      const matched = timingSafeEqual(
        Buffer.from(row.code_hash, 'hex'),
        Buffer.from(this.digest(user, row.registration_id, code), 'hex'),
      );
      await client.query(
        `UPDATE user_phone_alert_settings SET code_attempts=code_attempts+1,
          verified_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,
          code_hash=CASE WHEN $2 OR code_attempts=4 THEN NULL ELSE code_hash END
         WHERE user_id=$1`,
        [user, matched],
      );
      return matched;
    });
    if (!accepted) throw new BadRequestException('Mã xác minh không đúng hoặc đã hết hiệu lực.');
    return this.get(user);
  }

  private digest(user: string, id: string, code: string): string {
    return createHmac('sha256', this.key).update(`phone-otp:${user}:${id}:${code}`).digest('hex');
  }
}
