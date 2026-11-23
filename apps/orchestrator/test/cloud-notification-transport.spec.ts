import { ConfigService } from '@nestjs/config';
import { readCloudConfig } from '../src/cloud-queue/cloud-config';

const notificationCloud = {
  FACE_JOB_TRANSPORT: 'bullmq',
  NOTIFICATION_DRIVER: 'sqs',
  AWS_REGION: 'ap-southeast-1',
  APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
  NOTIFICATION_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/notification',
  APPLICATION_RESULTS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results',
};

describe('independent notification queue configuration', () => {
  it('keeps both local transports disabled by default', () => {
    expect(readCloudConfig(new ConfigService({}))).toMatchObject({
      mode: 'bullmq',
      notificationDriver: 'local',
      enabled: false,
    });
  });

  it('supports notification SQS while Face and storage remain local', () => {
    expect(readCloudConfig(new ConfigService(notificationCloud))).toMatchObject({
      mode: 'bullmq',
      notificationDriver: 'sqs',
      enabled: true,
      notificationQueue: notificationCloud.NOTIFICATION_JOBS_QUEUE_URL,
      resultsQueue: notificationCloud.APPLICATION_RESULTS_QUEUE_URL,
      consumerEnabled: true,
    });
  });

  it.each(['cloud', 'invalid'])('rejects unknown notification driver %s', (driver) => {
    expect(() => readCloudConfig(new ConfigService({ NOTIFICATION_DRIVER: driver }))).toThrow(
      'NOTIFICATION_DRIVER',
    );
  });

  it.each([
    'AWS_REGION',
    'APPLICATION_RESULTS_CONSUMER_ENABLED',
    'NOTIFICATION_JOBS_QUEUE_URL',
    'APPLICATION_RESULTS_QUEUE_URL',
  ])('fails startup when cloud configuration %s is missing', (key) => {
    expect(() => readCloudConfig(new ConfigService({ ...notificationCloud, [key]: '' }))).toThrow(
      'Missing',
    );
  });

  it('requires an explicit consumer boolean', () => {
    expect(() =>
      readCloudConfig(
        new ConfigService({ ...notificationCloud, APPLICATION_RESULTS_CONSUMER_ENABLED: 'yes' }),
      ),
    ).toThrow('true or false');
  });

  it.each([
    'http://sqs.ap-southeast-1.amazonaws.com/123456789012/results',
    'https://sqs.us-east-1.amazonaws.com/123456789012/results',
    'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results.fifo',
    'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results?redirect=1',
    'https://user:password@sqs.ap-southeast-1.amazonaws.com/123456789012/results',
    'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results#fragment',
    'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results/extra',
    'not-a-url',
  ])('rejects an invalid or ambiguous AWS queue URL %s', (url) => {
    expect(() =>
      readCloudConfig(
        new ConfigService({ ...notificationCloud, APPLICATION_RESULTS_QUEUE_URL: url }),
      ),
    ).toThrow();
  });

  it('requires separate queues in one account', () => {
    expect(() =>
      readCloudConfig(
        new ConfigService({
          ...notificationCloud,
          APPLICATION_RESULTS_QUEUE_URL: notificationCloud.NOTIFICATION_JOBS_QUEUE_URL,
        }),
      ),
    ).toThrow('separate');
    expect(() =>
      readCloudConfig(
        new ConfigService({
          ...notificationCloud,
          APPLICATION_RESULTS_QUEUE_URL:
            'https://sqs.ap-southeast-1.amazonaws.com/999999999999/results',
        }),
      ),
    ).toThrow('account');
  });

  it('retains Face SQS validation and its S3 requirement', () => {
    const face = {
      ...notificationCloud,
      FACE_JOB_TRANSPORT: 'sqs',
      FACE_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/face',
      STORAGE_PROVIDER: 's3',
      S3_BUCKET: 'face-test',
    };
    expect(readCloudConfig(new ConfigService(face))).toMatchObject({
      mode: 'sqs',
      faceQueue: face.FACE_JOBS_QUEUE_URL,
      bucket: 'face-test',
    });
    expect(() =>
      readCloudConfig(new ConfigService({ ...face, STORAGE_PROVIDER: 'minio' })),
    ).toThrow('STORAGE_PROVIDER');
    expect(() => readCloudConfig(new ConfigService({ ...face, S3_BUCKET: '' }))).toThrow(
      'S3_BUCKET',
    );
    expect(() => readCloudConfig(new ConfigService({ FACE_JOB_TRANSPORT: 'bad' }))).toThrow(
      'FACE_JOB_TRANSPORT',
    );
  });
});
