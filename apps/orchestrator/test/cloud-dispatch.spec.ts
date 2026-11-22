import { ConfigService } from '@nestjs/config';
import { CloudQueueService } from '../src/cloud-queue/cloud-queue.service';
import { DatabaseService } from '../src/database/database.service';
import { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';
import { IStorageService } from '../src/storage/storage.interface';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { NotificationCloudService } from '../src/notification-cloud/notification-cloud.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cloud = {
  FACE_JOB_TRANSPORT: 'bullmq',
  NOTIFICATION_DRIVER: 'sqs',
  AWS_REGION: 'ap-southeast-1',
  APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
  NOTIFICATION_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/notification',
  APPLICATION_RESULTS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results',
};
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../aws/sprint4/contracts/fixtures', name), 'utf8'),
  );
function setup(config: Record<string, string> = cloud) {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const db = { query, transaction: jest.fn(async (work) => work({ query })) };
  const notifications = { applyResult: jest.fn(), enqueueNotification: jest.fn() };
  const media = { getCroppedSnapshot: jest.fn() };
  const storage = { upload: jest.fn() };
  const queues = new CloudQueueService(
    new ConfigService(config),
    db as unknown as DatabaseService,
    media as unknown as FrigateMediaAdapter,
    storage as unknown as IStorageService,
    {} as AiResultsService,
    notifications as unknown as NotificationCloudService,
  );
  const send = jest.fn().mockResolvedValue({});
  Object.assign(queues, { sqs: { send, destroy: jest.fn() } });
  return { queues, query, db, notifications, media, storage, send };
}

describe('notification-only SQS transport', () => {
  it('dispatches an existing notification without accessing video/storage', async () => {
    const { queues, query, send, media, storage } = setup();
    const envelope = fixture('notification-job.valid.json');
    query.mockResolvedValueOnce({
      rows: [{ id: envelope.messageId, kind: 'notification.job', envelope }],
    });
    await queues.dispatchOne();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({
      QueueUrl: cloud.NOTIFICATION_JOBS_QUEUE_URL,
      MessageBody: JSON.stringify(envelope),
    });
    expect(media.getCroppedSnapshot).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('consumes notification Results while Face uses bullmq', async () => {
    const { queues, notifications, send } = setup();
    const envelope = fixture('notification-outcome.valid.json');
    send.mockResolvedValueOnce({
      Messages: [{ Body: JSON.stringify(envelope), ReceiptHandle: 'receipt' }],
    });
    await queues.consumeOnce();
    expect(notifications.applyResult).toHaveBeenCalledWith(envelope);
    expect(send.mock.calls[1][0].input).toMatchObject({
      QueueUrl: cloud.APPLICATION_RESULTS_QUEUE_URL,
      ReceiptHandle: 'receipt',
    });
    expect(notifications.applyResult.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[1]!,
    );
  });

  it('retains notification Results when the outcome transaction rolls back', async () => {
    const { queues, notifications, send } = setup();
    notifications.applyResult.mockRejectedValue(new Error('Database unavailable'));
    send.mockResolvedValueOnce({
      Messages: [
        {
          Body: JSON.stringify(fixture('notification-outcome.valid.json')),
          ReceiptHandle: 'receipt',
        },
      ],
    });
    await queues.consumeOnce();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects a process whose notification transport differs from the DB', async () => {
    const { queues, query } = setup();
    query.mockResolvedValueOnce({ rows: [{ mode: 'bullmq', notification_driver: 'local' }] });
    await expect(queues.onModuleInit()).rejects.toThrow('NOTIFICATION_DRIVER differs');
  });
});
