import { ConfigService } from '@nestjs/config';
import {
  readFaceConfig,
  readFaceProvider,
  validateRekognitionCollectionPrefix,
} from '../known-faces/face-config';

export function readCloudConfig(config: ConfigService) {
  const mode = config.get<string>('FACE_JOB_TRANSPORT', 'bullmq');
  if (!['bullmq', 'sqs'].includes(mode))
    throw new Error('FACE_JOB_TRANSPORT must be bullmq or sqs');
  const faceProvider = readFaceProvider(config);
  if (faceProvider === 'rekognition') readFaceConfig(config);
  const notificationDriver = config.get<string>('NOTIFICATION_DRIVER')?.trim() || 'local';
  if (!['local', 'sqs'].includes(notificationDriver))
    throw new Error('NOTIFICATION_DRIVER must be local or sqs');
  const required = (key: string) => {
    const value = config.get<string>(key)?.trim();
    if (!value) throw new Error(`Missing cloud configuration: ${key}`);
    return value;
  };
  const enabled = mode === 'sqs' || notificationDriver === 'sqs';
  if (!enabled)
    return {
      mode,
      notificationDriver,
      faceProvider,
      enabled: false as const,
      consumerEnabled: false,
      region: undefined,
      faceQueue: undefined,
      notificationQueue: undefined,
      resultsQueue: undefined,
      bucket: undefined,
    };
  const region = required('AWS_REGION');
  const consumerEnabled = required('APPLICATION_RESULTS_CONSUMER_ENABLED');
  if (!['true', 'false'].includes(consumerEnabled))
    throw new Error('APPLICATION_RESULTS_CONSUMER_ENABLED must be true or false');
  const faceQueue = mode === 'sqs' ? required('FACE_JOBS_QUEUE_URL') : undefined;
  const notificationQueue = required('NOTIFICATION_JOBS_QUEUE_URL');
  const resultsQueue = required('APPLICATION_RESULTS_QUEUE_URL');
  const queues = [faceQueue, notificationQueue, resultsQueue].filter(
    (queue): queue is string => queue !== undefined,
  );
  const accounts = new Set<string>();
  for (const value of queues) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Invalid cloud queue URL');
    }
    if (
      url.protocol !== 'https:' ||
      url.host !== `sqs.${region}.amazonaws.com` ||
      url.href !== value ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/\d{12}\/[A-Za-z0-9_-]{1,80}$/.test(url.pathname)
    ) {
      throw new Error('Cloud queues must be standard AWS SQS HTTPS URLs in AWS_REGION');
    }
    accounts.add(url.pathname.split('/')[1]!);
  }
  if (new Set(queues).size !== queues.length) throw new Error('Cloud queues must be separate');
  if (accounts.size !== 1) throw new Error('Cloud queues must belong to one account');
  if (mode === 'sqs' && required('STORAGE_PROVIDER') !== 's3')
    throw new Error('Face SQS requires STORAGE_PROVIDER=s3');
  const rekognitionCollectionPrefix = validateRekognitionCollectionPrefix(
    config.get<string>('REKOGNITION_COLLECTION_PREFIX'),
    { allowDefault: faceProvider !== 'rekognition' },
  );
  return {
    mode,
    faceProvider,
    rekognitionCollectionPrefix,
    notificationDriver,
    enabled: true as const,
    region,
    consumerEnabled: consumerEnabled === 'true',
    faceQueue,
    notificationQueue,
    resultsQueue,
    bucket: mode === 'sqs' ? required('S3_BUCKET') : undefined,
  } as const;
}
