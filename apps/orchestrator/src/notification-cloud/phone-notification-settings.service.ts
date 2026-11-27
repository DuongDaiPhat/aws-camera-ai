import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ALERT_PHONE, INVALID_PHONE_MESSAGE, normalizePhoneE164Input } from '../common/phone';
import { DatabaseService } from '../database/database.service';

export { ALERT_PHONE };
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
  constructor(private readonly db: DatabaseService) {}

  async get(user: string): Promise<PhoneSetting> {
    const {
      rows: [row],
    } = await this.db.query<PhoneRow & { account_phone: string | null }>(
      `SELECT p.*,u.phone_e164 AS account_phone FROM users u
       LEFT JOIN user_phone_alert_settings p ON p.user_id=u.id WHERE u.id=$1 AND u.is_active`,
      [user],
    );
    if (!row) throw new NotFoundException('Không tìm thấy tài khoản.');
    const activePhone = row.phone ?? row.account_phone;
    return {
      smsAvailable: false,
      callAvailable: false,
      smsEnabled: !!row.sms_enabled,
      callEnabled: !!row.call_enabled,
      accountPhone: row.account_phone,
      phone: activePhone,
      status: activePhone ? 'VERIFIED' : 'OFF',
    };
  }

  async set(user: string, input: PhonePreference): Promise<PhoneSetting> {
    await this.db.transaction(async (client) => {
      const {
        rows: [account],
      } = await client.query<{ phone_e164: string | null }>(
        'SELECT phone_e164 FROM users WHERE id=$1 AND is_active FOR UPDATE',
        [user],
      );
      if (!account) throw new NotFoundException('Không tìm thấy tài khoản.');

      const normalized = normalizePhoneE164Input(input.phone);
      const normalizedStr = typeof normalized === 'string' ? normalized : undefined;
      const phone = normalizedStr || account.phone_e164;
      if (normalizedStr && !ALERT_PHONE.test(normalizedStr)) {
        throw new BadRequestException(INVALID_PHONE_MESSAGE);
      }

      if (!phone) {
        await client.query('DELETE FROM user_phone_alert_settings WHERE user_id=$1', [user]);
        return;
      }

      await client.query(
        `INSERT INTO user_phone_alert_settings(user_id,sms_enabled,call_enabled,phone,registration_id,requested_at,code_hash,requests_today,verified_at)
         VALUES($1,$2,$3,$4,gen_random_uuid(),clock_timestamp(),NULL,1,clock_timestamp())
         ON CONFLICT(user_id) DO UPDATE SET
           sms_enabled=$2,call_enabled=$3,phone=$4,
           requested_at=clock_timestamp(),verified_at=clock_timestamp(),code_hash=NULL,code_attempts=0`,
        [user, !!input.smsEnabled, !!input.callEnabled, phone],
      );

      if (normalizedStr && normalizedStr !== account.phone_e164) {
        await client.query('UPDATE users SET phone_e164=$2 WHERE id=$1', [user, phone]);
      }
    });

    return this.get(user);
  }

  async verify(user: string, _code: string): Promise<PhoneSetting> {
    return this.get(user);
  }
}
