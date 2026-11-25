import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nextVerificationRequestCount } from '../src/notification-cloud/alert-verification-limit';
import { EmailNotificationSettingsService } from '../src/notification-cloud/email-notification-settings.service';
import { NotificationSettingsController } from '../src/notification-cloud/notification-settings.controller';
import { PhoneNotificationSettingsService } from '../src/notification-cloud/phone-notification-settings.service';

describe('alert-verification-limit', () => {
  it('handles first request, 60s cooldown, next day reset, and 5/day cap', () => {
    expect(nextVerificationRequestCount(undefined)).toBe(1);

    const now = new Date();
    const recent = new Date(now.getTime() - 30_000);
    expect(() => nextVerificationRequestCount({ requested_at: recent, requests_today: 1 })).toThrow(
      HttpException,
    );

    const yesterday = new Date(now.getTime() - 86_400_000 * 2);
    expect(nextVerificationRequestCount({ requested_at: yesterday, requests_today: 5 })).toBe(1);

    const olderSameDay = new Date(now.getTime() - 120_000);
    olderSameDay.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    expect(nextVerificationRequestCount({ requested_at: olderSameDay, requests_today: 2 })).toBe(3);

    expect(() =>
      nextVerificationRequestCount({ requested_at: olderSameDay, requests_today: 5 }),
    ).toThrow('Đã hết lượt xác minh trong ngày.');
  });
});

describe('EmailNotificationSettingsService unit edge cases', () => {
  const prefix = 'arn:aws:sns:ap-southeast-1:123456789012:argusai-dev-incident-email-user-';
  const validEmailConfig = new ConfigService({
    NOTIFICATION_DRIVER: 'sqs',
    APP_ENV: 'dev',
    AWS_REGION: 'ap-southeast-1',
    SNS_EMAIL_TOPIC_PREFIX_ARN: prefix,
  });

  it('handles lifecycle and background verification interval', async () => {
    jest.useFakeTimers();
    try {
      const query = jest.fn();
      const confirmed = jest.fn();
      const service = new EmailNotificationSettingsService(
        validEmailConfig,
        { query } as any,
        { confirmed } as any,
      );

      service.onModuleInit();
      // interval triggers
      query.mockResolvedValueOnce({
        rows: [
          { registration_id: 'r1', topic_arn: prefix + 'r1', email: 'user@example.com' },
          { registration_id: 'r2', topic_arn: prefix + 'r2', email: 'fail@example.com' },
        ],
      });
      confirmed.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('SNS error'));
      query.mockResolvedValueOnce({ rows: [] });

      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(query).toHaveBeenCalled();
      expect(confirmed).toHaveBeenCalledWith(prefix + 'r1', 'user@example.com');

      // interval triggers with query failure to hit line 60 catch branch
      query.mockRejectedValueOnce(new Error('DB failure in interval'));
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();

      // trigger when checking is already active to hit line 58 if (this.checking) return
      (service as any).checking = Promise.resolve();
      jest.advanceTimersByTime(15_000);
      (service as any).checking = undefined;

      // service without prefix does not start timer
      const noPrefixService = new EmailNotificationSettingsService(
        new ConfigService({ NOTIFICATION_DRIVER: 'local' }),
        { query } as any,
        { confirmed } as any,
      );
      noPrefixService.onModuleInit();
      await noPrefixService.verifyPending();
      await noPrefixService.onModuleDestroy();

      await service.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('validates account existence, format, prefix configuration and SNS errors in set()', async () => {
    const query = jest.fn();
    const transaction = jest.fn();
    const register = jest.fn();
    const service = new EmailNotificationSettingsService(
      validEmailConfig,
      { query, transaction } as any,
      { register } as any,
    );

    // prefix missing
    const unconfigured = new EmailNotificationSettingsService(
      new ConfigService({ NOTIFICATION_DRIVER: 'local' }),
      { query, transaction } as any,
      { register } as any,
    );
    await expect(unconfigured.set('u1', { enabled: true })).rejects.toThrow(
      ServiceUnavailableException,
    );

    // account not found in get
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.get('unknown')).rejects.toThrow(NotFoundException);

    // account not found in set transaction
    transaction.mockImplementation(async (cb) => {
      const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      return cb(client);
    });
    await expect(service.set('unknown', { enabled: true })).rejects.toThrow(NotFoundException);

    // disabling email
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql) => {
          if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'acc@test.com' }] };
          return { rows: [] };
        }),
      };
      return cb(client);
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          account_email: 'acc@test.com',
          email: 'acc@test.com',
          enabled: false,
          topic_arn: '',
          registration_id: '',
          verified_at: null,
          confirmation_sent: false,
        },
      ],
    });
    const disabled = await service.set('u1', { enabled: false });
    expect(disabled.status).toBe('OFF');

    // invalid email length or format
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockResolvedValueOnce({ rows: [{ email: 'acc@test.com' }] }),
      };
      return cb(client);
    });
    await expect(service.set('u1', { enabled: true, email: 'not-an-email' })).rejects.toThrow(
      BadRequestException,
    );
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockResolvedValueOnce({ rows: [{ email: 'acc@test.com' }] }),
      };
      return cb(client);
    });
    await expect(
      service.set('u1', { enabled: true, email: 'a'.repeat(250) + '@example.com' }),
    ).rejects.toThrow(BadRequestException);

    // same email but !previous.confirmation_sent reuses registration_id
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql) => {
          if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'acc@test.com' }] };
          if (sql.includes('SELECT * FROM user_email_alert_settings')) {
            return {
              rows: [
                {
                  enabled: true,
                  email: 'acc@test.com',
                  registration_id: 'reused-id',
                  topic_arn: prefix + 'reused-id',
                  confirmation_sent: false,
                  verified_at: null,
                  requested_at: new Date(Date.now() - 120_000),
                  requests_today: 1,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };
      return cb(client);
    });
    register.mockResolvedValueOnce({});
    query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.*, lower(u.email::text)')) {
        return {
          rows: [
            {
              account_email: 'acc@test.com',
              email: 'acc@test.com',
              enabled: true,
              topic_arn: prefix + 'reused-id',
              registration_id: 'reused-id',
              verified_at: null,
              confirmation_sent: true,
            },
          ],
        };
      }
      return { rows: [] };
    });
    await service.set('u1', { enabled: true, email: 'acc@test.com' });
    expect(register).toHaveBeenCalledWith(prefix + 'reused-id', 'acc@test.com');
    register.mockClear();

    // already verified/confirmed return null in transaction
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql) => {
          if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'acc@test.com' }] };
          return {
            rows: [
              {
                enabled: true,
                email: 'acc@test.com',
                registration_id: 'r1',
                topic_arn: prefix + 'r1',
                confirmation_sent: true,
                verified_at: new Date(),
                requested_at: new Date(),
              },
            ],
          };
        }),
      };
      return cb(client);
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          account_email: 'acc@test.com',
          email: 'acc@test.com',
          enabled: true,
          topic_arn: prefix + 'r1',
          registration_id: 'r1',
          verified_at: new Date(),
          confirmation_sent: true,
        },
      ],
    });
    const verified = await service.set('u1', { enabled: true, email: 'acc@test.com' });
    expect(verified.status).toBe('VERIFIED');
    expect(register).not.toHaveBeenCalled();

    // SNS register failure throws 503
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql) => {
          if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'acc@test.com' }] };
          if (sql.includes('SELECT * FROM user_email_alert_settings')) return { rows: [] };
          return { rows: [] };
        }),
      };
      return cb(client);
    });
    register.mockRejectedValueOnce(new Error('AWS SNS down'));
    await expect(service.set('u1', { enabled: true, email: 'valid@test.com' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('PhoneNotificationSettingsService unit edge cases', () => {
  it('validates account existence, phone regex, and persists contact phone', async () => {
    const query = jest.fn();
    const transaction = jest.fn();
    const service = new PhoneNotificationSettingsService({ query, transaction } as any);

    // user not found in get
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.get('u-none')).rejects.toThrow(NotFoundException);

    // user not found in set
    transaction.mockImplementation(async (cb) => {
      const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      return cb(client);
    });
    await expect(service.set('u-none', { smsEnabled: true, callEnabled: false })).rejects.toThrow(
      NotFoundException,
    );

    // invalid phone format
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockResolvedValueOnce({ rows: [{ phone_e164: null }] }),
      };
      return cb(client);
    });
    await expect(
      service.set('u1', { smsEnabled: true, callEnabled: false, phone: 'invalid' }),
    ).rejects.toThrow(BadRequestException);

    // disable phone settings when no phone is present
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql) => {
          if (sql.includes('SELECT phone_e164 FROM users')) return { rows: [{ phone_e164: null }] };
          return { rows: [] };
        }),
      };
      return cb(client);
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          account_phone: null,
          phone: null,
          sms_enabled: false,
          call_enabled: false,
          verified_at: null,
        },
      ],
    });
    const off = await service.set('u1', { smsEnabled: false, callEnabled: false });
    expect(off.status).toBe('OFF');

    // valid phone save with account sync
    transaction.mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql) => {
          if (sql.includes('SELECT phone_e164 FROM users'))
            return { rows: [{ phone_e164: '+84901234567' }] };
          return { rows: [] };
        }),
      };
      return cb(client);
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          account_phone: '+84901234567',
          phone: '+84909876543',
          sms_enabled: true,
          call_enabled: true,
          verified_at: new Date(),
        },
      ],
    });
    const saved = await service.set('u1', {
      smsEnabled: true,
      callEnabled: true,
      phone: '+84909876543',
    });
    expect(saved.status).toBe('VERIFIED');
    expect(saved.phone).toBe('+84909876543');

    // verify method is a safe passthrough
    query.mockResolvedValueOnce({
      rows: [
        {
          account_phone: '+84901234567',
          phone: '+84909876543',
          sms_enabled: true,
          call_enabled: true,
          verified_at: new Date(),
        },
      ],
    });
    const verified = await service.verify('u1', '123456');
    expect(verified.status).toBe('VERIFIED');
  });
});

describe('NotificationSettingsController DTO transform branches', () => {
  it('calls controller handlers properly', () => {
    const emailService = { get: jest.fn(), set: jest.fn() };
    const phoneService = { get: jest.fn(), set: jest.fn(), verify: jest.fn() };
    const controller = new NotificationSettingsController(emailService as any, phoneService as any);
    const req = { auth: { sub: 'user-1' } } as any;

    controller.getEmail(req);
    expect(emailService.get).toHaveBeenCalledWith('user-1');

    controller.setEmail(req, { enabled: true, email: 'test@example.com' });
    expect(emailService.set).toHaveBeenCalledWith('user-1', {
      enabled: true,
      email: 'test@example.com',
    });

    controller.getPhone(req);
    expect(phoneService.get).toHaveBeenCalledWith('user-1');

    controller.setPhone(req, { smsEnabled: true, callEnabled: false, phone: '+84901234567' });
    expect(phoneService.set).toHaveBeenCalledWith('user-1', {
      smsEnabled: true,
      callEnabled: false,
      phone: '+84901234567',
    });

    controller.verifyPhone(req, { code: '123456' });
    expect(phoneService.verify).toHaveBeenCalledWith('user-1', '123456');
  });
});
