import { ConfigService } from '@nestjs/config';
import { readNotificationConfig } from '../src/notification-cloud/notification-cloud.config';

describe('notification cloud configuration', () => {
  it('keeps the local driver and dry-run defaults', () => {
    expect(readNotificationConfig(new ConfigService({}))).toMatchObject({
      driver: 'local',
      dryRun: true,
      cap: 5,
      cooldown: 60,
      lease: 120,
    });
    expect(
      readNotificationConfig(new ConfigService({ NOTIFICATION_DRIVER: '', SENDER_DRY_RUN: ' ' })),
    ).toMatchObject({ driver: 'local', dryRun: true });
  });

  it.each([
    [{ NOTIFICATION_DRIVER: 'sqs' }, 'APP_ENV'],
    [{ NOTIFICATION_DRIVER: 'sqs', APP_ENV: 'lab' }, 'APP_ENV'],
    [{ NOTIFICATION_DRIVER: 'cloud' }, 'NOTIFICATION_DRIVER'],
    [{ SENDER_DRY_RUN: 'sometimes' }, 'SENDER_DRY_RUN'],
    [{ SNS_SMS_ENABLED: '1' }, 'SNS_SMS_ENABLED'],
    [{ SENDER_NOTIFICATION_CAP: '1.2' }, 'SENDER_NOTIFICATION_CAP'],
    [{ SENDER_NOTIFICATION_CAP: '9007199254740992' }, 'SENDER_NOTIFICATION_CAP'],
    [{ SENDER_NOTIFICATION_CAP: '0' }, 'SENDER_NOTIFICATION_CAP'],
  ])('rejects invalid configuration %j', (value, key) => {
    expect(() => readNotificationConfig(new ConfigService(value))).toThrow(key);
  });

  it('accepts cloud configuration and trims environment variables', () => {
    expect(
      readNotificationConfig(
        new ConfigService({
          NOTIFICATION_DRIVER: 'sqs',
          APP_ENV: ' production ',
          SENDER_DRY_RUN: 'false',
          SNS_SMS_ENABLED: 'true',
          SENDER_NOTIFICATION_CAP: '9',
        }),
      ),
    ).toMatchObject({
      driver: 'sqs',
      environment: 'production',
      dryRun: false,
      smsEnabled: true,
      cap: 9,
    });
  });
});
