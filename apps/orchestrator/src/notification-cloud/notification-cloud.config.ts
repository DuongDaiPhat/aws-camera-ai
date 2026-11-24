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
  const emailTopicPrefix = text('SNS_EMAIL_TOPIC_PREFIX_ARN');
  if (emailTopicPrefix) {
    const match =
      /^arn:aws:sns:([a-z0-9-]+):[0-9]{12}:argusai-(dev|staging|production)-incident-email-user-$/.exec(
        emailTopicPrefix,
      );
    if (!match || match[1] !== text('AWS_REGION') || match[2] !== environment || driver !== 'sqs') {
      throw new Error('SNS_EMAIL_TOPIC_PREFIX_ARN must match AWS_REGION and APP_ENV in SQS mode');
    }
  }
  const phoneSelfService = boolean('SNS_PHONE_SELF_SERVICE_ENABLED', 'false');
  if (
    phoneSelfService &&
    (driver !== 'sqs' || !text('AWS_REGION') || (text('INTERNAL_SERVICE_TOKEN')?.length ?? 0) < 32)
  ) {
    throw new Error('Phone alert settings require SQS, AWS_REGION and INTERNAL_SERVICE_TOKEN');
  }
  return {
    driver,
    environment,
    dryRun: boolean('SENDER_DRY_RUN', 'true'),
    cap: positiveInteger('SENDER_NOTIFICATION_CAP', '5'),
    cooldown: positiveInteger('SENDER_COOLDOWN_SECONDS', '60'),
    lease: positiveInteger('SENDER_LEASE_SECONDS', '120'),
    intentTtl: positiveInteger('SENDER_INTENT_TTL_SECONDS', '300'),
    topicArn: text('SNS_TOPIC_ARN'),
    emailTopicPrefix,
    phoneSelfService,
    smsEnabled: boolean('SNS_SMS_ENABLED', 'false'),
    connectInstanceId: text('CONNECT_INSTANCE_ID'),
    connectContactFlowId: text('CONNECT_CONTACT_FLOW_ID'),
    connectSourcePhoneNumber: text('CONNECT_SOURCE_PHONE_NUMBER'),
  };
}

export type NotificationConfig = ReturnType<typeof readNotificationConfig>;

export function usesPersonalAlertSettings(config: NotificationConfig, channel: string): boolean {
  if (channel === 'SNS_EMAIL') return !!config.emailTopicPrefix;
  return config.phoneSelfService && (channel === 'SNS_SMS' || channel === 'CONNECT_CALL');
}
