import { ConfigService } from '@nestjs/config';

export function readNotificationConfig(config: ConfigService) {
  const text = (key: string) => config.get<string>(key)?.trim() || undefined;
  const driver = text('NOTIFICATION_DRIVER') ?? 'local';
  if (driver !== 'local' && driver !== 'sqs')
    throw new Error('NOTIFICATION_DRIVER must be local or sqs');
  const environment = text('APP_ENV');
  if (driver === 'sqs' && !['dev', 'staging', 'production'].includes(environment ?? '')) {
    throw new Error('APP_ENV must be dev, staging or production for notification SQS');
  }
  const boolean = (key: string, fallback: string) => {
    const value = text(key) ?? fallback;
    if (value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`);
    return value === 'true';
  };
  const positiveInteger = (key: string, fallback: string) => {
    const value = text(key) ?? fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
      throw new Error(`${key} must be a positive safe integer`);
    }
    return Number(value);
  };
  return {
    driver,
    environment,
    dryRun: boolean('SENDER_DRY_RUN', 'true'),
    cap: positiveInteger('SENDER_NOTIFICATION_CAP', '5'),
    cooldown: positiveInteger('SENDER_COOLDOWN_SECONDS', '60'),
    lease: positiveInteger('SENDER_LEASE_SECONDS', '120'),
    intentTtl: positiveInteger('SENDER_INTENT_TTL_SECONDS', '300'),
    topicArn: text('SNS_TOPIC_ARN'),
    smsEnabled: boolean('SNS_SMS_ENABLED', 'false'),
    connectInstanceId: text('CONNECT_INSTANCE_ID'),
    connectContactFlowId: text('CONNECT_CONTACT_FLOW_ID'),
    connectSourcePhoneNumber: text('CONNECT_SOURCE_PHONE_NUMBER'),
  };
}

export type NotificationConfig = ReturnType<typeof readNotificationConfig>;
