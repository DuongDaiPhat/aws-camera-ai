import { ConfigService } from '@nestjs/config';

export function readCloudConfig(config: ConfigService) {
  const mode = config.get<string>('FACE_JOB_TRANSPORT', 'bullmq');
  if (!['bullmq', 'sqs'].includes(mode))
    throw new Error('FACE_JOB_TRANSPORT must be bullmq or sqs');
  const required = (key: string) => {
    const value = config.get<string>(key)?.trim();
    if (!value) throw new Error(`Missing cloud configuration: ${key}`);
    return value;
  };
  if (mode === 'bullmq') return { mode } as const;
  const region = required('AWS_REGION');
  const consumerEnabled = required('APPLICATION_RESULTS_CONSUMER_ENABLED');
  if (!['true', 'false'].includes(consumerEnabled))
    throw new Error('APPLICATION_RESULTS_CONSUMER_ENABLED must be true or false');
  const queues = [
    'FACE_JOBS_QUEUE_URL',
    'NOTIFICATION_JOBS_QUEUE_URL',
    'APPLICATION_RESULTS_QUEUE_URL',
  ].map(required);
  for (const value of queues) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== `sqs.${region}.amazonaws.com` ||
      !/^\/\d{12}\/[^/]+$/.test(url.pathname) ||
      value.endsWith('.fifo')
    ) {
      throw new Error('Cloud queues must be standard AWS SQS HTTPS URLs in AWS_REGION');
    }
  }
  if (new Set(queues).size !== 3) throw new Error('Cloud queues must be separate');
  if (required('STORAGE_PROVIDER') !== 's3') throw new Error('SQS requires STORAGE_PROVIDER=s3');
  return {
    mode,
    region,
    consumerEnabled: consumerEnabled === 'true',
    faceQueue: queues[0]!,
    notificationQueue: queues[1]!,
    resultsQueue: queues[2]!,
    bucket: required('S3_BUCKET'),
  } as const;
}
