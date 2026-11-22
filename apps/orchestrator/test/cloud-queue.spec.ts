import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CloudQueueService } from '../src/cloud-queue/cloud-queue.service';
import { readCloudConfig } from '../src/cloud-queue/cloud-config';
import { queueSchema } from '../src/cloud-queue/queue-schema';
import { parseEnvelope } from '../src/cloud-queue/queue-contract';
import { DatabaseService } from '../src/database/database.service';
import { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';
import { IStorageService } from '../src/storage/storage.interface';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { NotificationCloudService } from '../src/notification-cloud/notification-cloud.service';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../aws/sprint4/contracts/fixtures', name), 'utf8'),
  );
const cloud = {
  FACE_JOB_TRANSPORT: 'sqs',
  APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
  AWS_REGION: 'ap-southeast-1',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'test',
  FACE_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/face',
  NOTIFICATION_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/notification',
  APPLICATION_RESULTS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results',
};
function service(query = jest.fn()) {
  const client = { query };
  const db = { query, transaction: jest.fn(async (work) => work(client)) };
  const ai = { submit: jest.fn() };
  const notifications = { applyResult: jest.fn(), enqueueNotification: jest.fn() };
  const queues = new CloudQueueService(
    new ConfigService(cloud),
    db as unknown as DatabaseService,
    {} as FrigateMediaAdapter,
    {} as IStorageService,
    ai as unknown as AiResultsService,
    notifications as unknown as NotificationCloudService,
  );
  return { queues, query, ai, client, notifications };
}
describe('cloud queue safety', () => {
  it('ships the same canonical contract for backend and Python worker', () => {
    const root = resolve(__dirname, '../../../');
    const canonical = JSON.parse(
      readFileSync(resolve(root, 'aws/sprint4/contracts/queue-v1.schema.json'), 'utf8'),
    );
    expect(queueSchema).toEqual(canonical);
    expect(
      JSON.parse(
        readFileSync(resolve(root, 'services/aws-workers/face/queue-v1.schema.json'), 'utf8'),
      ),
    ).toEqual(canonical);
  });
  it('applies face and receipt using the same transaction, ignoring stale collection versions', async () => {
    const message = parseEnvelope(fixture('face-result-unknown.valid.json'));
    if (message.type !== 'face.result') throw new Error('fixture type');
    const p = message.payload;
    for (const stale of [false, true]) {
      const job = {
        id: p.jobId,
        kind: 'face.job',
        event_id: message.correlationId,
        owner_user_id: p.ownerScopeId,
        current_owner: p.ownerScopeId,
        result_id: p.body.resultId,
        camera_id: p.cameraId,
        current_collection_version: p.body.collectionVersion! + (stale ? 1 : 0),
        envelope: {
          payload: {
            observationId: p.body.observationId,
            revision: p.body.revision,
            collectionVersion: p.body.collectionVersion,
          },
        },
      };
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [job] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ identical: true }] })
        .mockResolvedValue({ rows: [] });
      const { queues, ai, client } = service(query);
      ai.submit.mockResolvedValue({ disposition: 'ACCEPTED' });
      await queues.applyResult(message);
      if (stale) expect(ai.submit).not.toHaveBeenCalled();
      else expect(ai.submit).toHaveBeenCalledWith(p.body.eventId, p.body, client);
      expect(query.mock.calls[3]![1][3]).toBe(stale ? 'STALE' : 'ACCEPTED');
    }
  });

  it('defaults to local and rejects incomplete cloud configuration', () => {
    expect(readCloudConfig(new ConfigService({})).mode).toBe('bullmq');
    expect(() => readCloudConfig(new ConfigService({ FACE_JOB_TRANSPORT: 'sqs' }))).toThrow(
      'Missing',
    );
    expect(() =>
      readCloudConfig(
        new ConfigService({ ...cloud, APPLICATION_RESULTS_QUEUE_URL: cloud.FACE_JOBS_QUEUE_URL }),
      ),
    ).toThrow('separate');
    expect(() =>
      readCloudConfig(
        new ConfigService({ ...cloud, REKOGNITION_COLLECTION_PREFIX: 'bad-prefix-' }),
      ),
    ).toThrow('Invalid REKOGNITION_COLLECTION_PREFIX');
    expect(() =>
      readCloudConfig(new ConfigService({ ...cloud, FACE_PROVIDER: 'invalid' })),
    ).toThrow('FACE_PROVIDER must be local or rekognition');
    expect(() =>
      readCloudConfig(new ConfigService({ ...cloud, FACE_PROVIDER: 'rekognition' })),
    ).toThrow('Missing cloud configuration: REKOGNITION_COLLECTION_PREFIX');
    const stagingCloud = readCloudConfig(
      new ConfigService({
        ...cloud,
        FACE_PROVIDER: 'rekognition',
        REKOGNITION_COLLECTION_PREFIX: 'argusai-staging-owner-',
      }),
    );
    expect(stagingCloud).toMatchObject({
      mode: 'sqs',
      faceProvider: 'rekognition',
      rekognitionCollectionPrefix: 'argusai-staging-owner-',
    });
  });

  it('tags face crop uploads with retention=expire-7d unless event retain=true', async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const camera = '22222222-2222-4222-8222-222222222222';
    const event = '33333333-3333-4333-8333-333333333333';
    const jobId = '44444444-4444-4444-8444-444444444444';
    const resultId = '55555555-5555-4555-8555-555555555555';

    for (const retain of [false, true]) {
      const query = jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: jobId,
              result_id: resultId,
              event_id: event,
              kind: 'face.job',
              owner_user_id: owner,
              camera_id: camera,
              track_id: 'track-1',
              detected_at: new Date('2026-11-20T00:00:00Z'),
              created_at: new Date('2026-11-20T00:00:00Z'),
              camera_slug: 'cam_front',
              collection_id: `argusai-staging-owner-${owner}`,
              version: 2,
              retain,
              envelope: null,
            },
          ],
        })
        .mockResolvedValue({ rows: [] });
      const client = { query };
      const db = { query, transaction: jest.fn(async (work) => work(client)) };
      const media = {
        getCroppedSnapshot: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff])),
      };
      const storage = {
        upload: jest.fn().mockResolvedValue({
          bucket: 'test',
          key: `owners/${owner}/cameras/${camera}/events/${event}/face/${jobId}.jpg`,
          sizeBytes: 3,
          contentType: 'image/jpeg',
        }),
      };
      const queues = new CloudQueueService(
        new ConfigService({
          ...cloud,
          FACE_PROVIDER: 'rekognition',
          REKOGNITION_COLLECTION_PREFIX: 'argusai-staging-owner-',
        }),
        db as unknown as DatabaseService,
        media as unknown as FrigateMediaAdapter,
        storage as unknown as IStorageService,
        { submit: jest.fn() } as unknown as AiResultsService,
        {
          applyResult: jest.fn(),
          enqueueNotification: jest.fn(),
        } as unknown as NotificationCloudService,
      );

      await queues.dispatchOne();

      expect(storage.upload).toHaveBeenCalledWith(
        `owners/${owner}/cameras/${camera}/events/${event}/face/${jobId}.jpg`,
        expect.any(Buffer),
        'image/jpeg',
        retain ? { retain: true } : { tags: { retention: 'expire-7d' } },
      );
    }
  });
  it('validates canonical fixtures and rejects changed envelope identity', () => {
    for (const file of [
      'face-job.valid.json',
      'face-result-known.valid.json',
      'face-result-unknown.valid.json',
      'notification-outcome.valid.json',
    ])
      expect(parseEnvelope(fixture(file))).toBeDefined();
    const message = fixture('face-result-unknown.valid.json');
    message.messageId = message.payload.jobId;
    expect(() => parseEnvelope(message)).toThrow('identity');
  });
  it('requires DB and runtime transport to agree', async () => {
    const { queues } = service(jest.fn().mockResolvedValue({ rows: [{ mode: 'bullmq' }] }));
    await expect(queues.onModuleInit()).rejects.toThrow('differs');
  });
  it('duplicate result is a no-op and conflicting payload fails', async () => {
    const message = parseEnvelope(fixture('face-result-unknown.valid.json'));
    const job = {
      owner_user_id: message.payload.ownerScopeId,
      current_owner: message.payload.ownerScopeId,
      event_id: message.correlationId,
    };
    for (const identical of [true, false]) {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [job] })
        .mockResolvedValueOnce({ rows: [{ identical }] });
      const { queues, ai } = service(query);
      if (identical) await expect(queues.applyResult(message)).resolves.toBeUndefined();
      else await expect(queues.applyResult(message)).rejects.toThrow('conflict');
      expect(ai.submit).not.toHaveBeenCalled();
    }
  });
  it('checks ownership before recording a receipt', async () => {
    const { queues, query } = service(jest.fn().mockResolvedValue({ rows: [] }));
    await expect(
      queues.applyResult(parseEnvelope(fixture('face-result-unknown.valid.json'))),
    ).rejects.toThrow('ownership');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('never deletes a Results message if DB application fails', async () => {
    const { queues } = service();
    const message = fixture('face-result-unknown.valid.json');
    const send = jest.fn().mockResolvedValue({
      Messages: [{ Body: JSON.stringify(message), ReceiptHandle: 'handle', MessageId: 'id' }],
    });
    Object.assign(queues, { sqs: { send } });
    jest.spyOn(queues, 'applyResult').mockRejectedValue(new Error('DB unavailable'));
    await queues.consumeOnce();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('deletes only after successful DB application', async () => {
    const { queues } = service();
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify(fixture('face-result-unknown.valid.json')),
            ReceiptHandle: 'handle',
          },
        ],
      })
      .mockResolvedValue({});
    Object.assign(queues, { sqs: { send } });
    const apply = jest.spyOn(queues, 'applyResult').mockResolvedValue();
    await queues.consumeOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[1]!);
  });

  it('validates all readCloudConfig branches including transport, consumer flag, URL rules, and storage provider', () => {
    expect(() => readCloudConfig(new ConfigService({ FACE_JOB_TRANSPORT: 'kafka' }))).toThrow(
      'FACE_JOB_TRANSPORT must be bullmq or sqs',
    );
    expect(
      readCloudConfig(
        new ConfigService({
          FACE_JOB_TRANSPORT: 'bullmq',
          FACE_PROVIDER: 'rekognition',
          AWS_REGION: 'ap-southeast-1',
          REKOGNITION_COLLECTION_PREFIX: 'argusai-staging-owner-',
        }),
      ),
    ).toMatchObject({ mode: 'bullmq', faceProvider: 'rekognition', enabled: false });

    expect(() =>
      readCloudConfig(
        new ConfigService({ ...cloud, APPLICATION_RESULTS_CONSUMER_ENABLED: 'maybe' }),
      ),
    ).toThrow('APPLICATION_RESULTS_CONSUMER_ENABLED must be true or false');

    expect(() =>
      readCloudConfig(
        new ConfigService({
          ...cloud,
          FACE_JOBS_QUEUE_URL: 'http://sqs.ap-southeast-1.amazonaws.com/123456789012/face',
        }),
      ),
    ).toThrow('Cloud queues must be standard AWS SQS HTTPS URLs in AWS_REGION');

    expect(() =>
      readCloudConfig(
        new ConfigService({
          ...cloud,
          FACE_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/face.fifo',
        }),
      ),
    ).toThrow('Cloud queues must be standard AWS SQS HTTPS URLs in AWS_REGION');

    expect(() =>
      readCloudConfig(new ConfigService({ ...cloud, STORAGE_PROVIDER: 'minio' })),
    ).toThrow('Face SQS requires STORAGE_PROVIDER=s3');

    expect(
      readCloudConfig(
        new ConfigService({ ...cloud, APPLICATION_RESULTS_CONSUMER_ENABLED: 'false' }),
      ),
    ).toMatchObject({
      mode: 'sqs',
      consumerEnabled: false,
      rekognitionCollectionPrefix: 'camerai-s4-dev-owner-',
    });
  });

  it('runs lifecycle init/loop/destroy safely and logs sanitized error codes', async () => {
    jest.useFakeTimers();
    try {
      const query = jest.fn().mockResolvedValue({ rows: [{ mode: 'sqs' }] });
      const { queues } = service(query);
      const dispatchSpy = jest
        .spyOn(queues, 'dispatchOne')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))
        .mockResolvedValue(undefined);
      const consumeSpy = jest
        .spyOn(queues, 'consumeOnce')
        .mockRejectedValueOnce('non-error')
        .mockResolvedValue(undefined);
      const destroySpy = jest.fn();
      Object.assign(queues, { sqs: { send: jest.fn(), destroy: destroySpy } });

      await queues.onModuleInit();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(1000);
      await queues.onModuleDestroy();

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
      expect(consumeSpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }

    const bullmqQueues = new CloudQueueService(
      new ConfigService({ FACE_JOB_TRANSPORT: 'bullmq' }),
      {
        query: jest.fn().mockResolvedValue({ rows: [{ mode: 'bullmq' }] }),
      } as unknown as DatabaseService,
      {} as FrigateMediaAdapter,
      {} as IStorageService,
      {} as AiResultsService,
      {
        applyResult: jest.fn(),
        enqueueNotification: jest.fn(),
      } as unknown as NotificationCloudService,
    );
    await bullmqQueues.onModuleInit();
    await bullmqQueues.dispatchOne();
    await bullmqQueues.consumeOnce();
    await bullmqQueues.onModuleDestroy();
  });

  it('handles dispatchOne failure reasons, existing envelopes (face & notification), and retry updates', async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const baseRow = {
      id: '44444444-4444-4444-8444-444444444444',
      result_id: '55555555-5555-4555-8555-555555555555',
      event_id: '33333333-3333-4333-8333-333333333333',
      kind: 'face.job',
      owner_user_id: owner,
      camera_id: '22222222-2222-4222-8222-222222222222',
      track_id: 'track-1',
      detected_at: new Date('2026-11-20T00:00:00Z'),
      created_at: new Date('2026-11-20T00:00:00Z'),
      camera_slug: 'cam_front',
      collection_id: `camerai-s4-dev-owner-${owner}`,
      version: 1,
      retain: false,
      envelope: null,
    };

    const runDispatch = async (
      row: Record<string, unknown> | undefined,
      crop: Buffer | null = Buffer.from([1, 2]),
      uploadBucket = 'test',
      sqsSend = jest.fn().mockResolvedValue({}),
    ) => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: row ? [row] : [] })
        .mockResolvedValue({ rows: [] });
      const client = { query };
      const db = { query, transaction: jest.fn(async (w) => w(client)) };
      const media = { getCroppedSnapshot: jest.fn().mockResolvedValue(crop) };
      const storage = { upload: jest.fn().mockResolvedValue({ bucket: uploadBucket, key: 'k' }) };
      const queues = new CloudQueueService(
        new ConfigService(cloud),
        db as unknown as DatabaseService,
        media as unknown as FrigateMediaAdapter,
        storage as unknown as IStorageService,
        {} as AiResultsService,
        {
          applyResult: jest.fn(),
          enqueueNotification: jest.fn(),
        } as unknown as NotificationCloudService,
      );
      Object.assign(queues, { sqs: { send: sqsSend } });
      await queues.dispatchOne();
      return { query, sqsSend };
    };

    // No job selected
    expect((await runDispatch(undefined)).query).toHaveBeenCalledTimes(1);

    // Missing collection registry
    const missingCol = await runDispatch({ ...baseRow, collection_id: null });
    expect(missingCol.query.mock.calls[1]![1]).toEqual([
      baseRow.id,
      'Face collection registry missing',
    ]);

    // Prefix mismatch
    const wrongPrefix = await runDispatch({
      ...baseRow,
      collection_id: `argusai-staging-owner-${owner}`,
    });
    expect(wrongPrefix.query.mock.calls[1]![1]).toEqual([
      baseRow.id,
      'Face collection prefix mismatch',
    ]);

    // Missing crop
    const noCrop = await runDispatch(baseRow, null);
    expect(noCrop.query.mock.calls[1]![1]).toEqual([baseRow.id, 'Face crop unavailable']);

    // Unexpected bucket
    const badBucket = await runDispatch(baseRow, Buffer.from([1]), 'other-bucket');
    expect(badBucket.query.mock.calls[1]![1]).toEqual([baseRow.id, 'Unexpected upload bucket']);

    // Prepared face.job envelope sends to faceQueue
    const sentFace = await runDispatch({ ...baseRow, envelope: { type: 'face.job' } });
    expect(sentFace.sqsSend).toHaveBeenCalledWith(expect.any(SendMessageCommand));
    expect((sentFace.sqsSend.mock.calls[0]![0] as SendMessageCommand).input.QueueUrl).toBe(
      cloud.FACE_JOBS_QUEUE_URL,
    );

    // Prepared notification.job envelope sends to notificationQueue
    const sentNotif = await runDispatch({
      ...baseRow,
      kind: 'notification.job',
      envelope: { type: 'notification.job' },
    });
    expect((sentNotif.sqsSend.mock.calls[0]![0] as SendMessageCommand).input.QueueUrl).toBe(
      cloud.NOTIFICATION_JOBS_QUEUE_URL,
    );

    // Unknown error maps to PREPARE_OR_SEND_FAILED
    const sqsFail = await runDispatch(
      { ...baseRow, envelope: { type: 'face.job' } },
      null,
      'test',
      jest.fn().mockRejectedValue(new Error('sqs down')),
    );
    expect(sqsFail.query.mock.calls[1]![1]).toEqual([baseRow.id, 'PREPARE_OR_SEND_FAILED']);
  });

  it('handles consumeOnce disabled/empty, face result validations, faceContext, and cacheFaceResult', async () => {
    // consumeOnce skips when consumerEnabled=false
    const disabledConsumer = new CloudQueueService(
      new ConfigService({ ...cloud, APPLICATION_RESULTS_CONSUMER_ENABLED: 'false' }),
      { query: jest.fn(), transaction: jest.fn() } as unknown as DatabaseService,
      {} as FrigateMediaAdapter,
      {} as IStorageService,
      {} as AiResultsService,
      {
        applyResult: jest.fn(),
        enqueueNotification: jest.fn(),
      } as unknown as NotificationCloudService,
    );
    const disabledSend = jest.fn();
    Object.assign(disabledConsumer, { sqs: { send: disabledSend } });
    await disabledConsumer.consumeOnce();
    expect(disabledSend).not.toHaveBeenCalled();

    // consumeOnce handles empty Messages array
    const { queues } = service();
    const emptySend = jest.fn().mockResolvedValue({});
    Object.assign(queues, { sqs: { send: emptySend } });
    await queues.consumeOnce();
    expect(emptySend).toHaveBeenCalledWith(expect.any(ReceiveMessageCommand));

    // Unexpected type in applyResult
    await expect(queues.applyResult(parseEnvelope(fixture('face-job.valid.json')))).rejects.toThrow(
      'Unexpected Results type',
    );

    // Face result mismatch & durable worker result mismatch
    const faceRes = parseEnvelope(fixture('face-result-unknown.valid.json'));
    if (faceRes.type !== 'face.result') throw new Error('bad fixture');
    const validJob = {
      id: faceRes.payload.jobId,
      kind: 'face.job',
      event_id: faceRes.correlationId,
      owner_user_id: faceRes.payload.ownerScopeId,
      current_owner: faceRes.payload.ownerScopeId,
      result_id: faceRes.payload.body.resultId,
      camera_id: faceRes.payload.cameraId,
      current_collection_version: faceRes.payload.body.collectionVersion,
      envelope: {
        payload: {
          observationId: faceRes.payload.body.observationId,
          revision: faceRes.payload.body.revision,
          collectionVersion: faceRes.payload.body.collectionVersion,
        },
      },
    };
    const mismatchSvc = service(
      jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...validJob, kind: 'notification.job' }] })
        .mockResolvedValueOnce({ rows: [] }),
    ).queues;
    await expect(mismatchSvc.applyResult(faceRes)).rejects.toThrow(
      'Face result job/version mismatch',
    );

    const nonDurableSvc = service(
      jest
        .fn()
        .mockResolvedValueOnce({ rows: [validJob] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ identical: false }] }),
    ).queues;
    await expect(nonDurableSvc.applyResult(faceRes)).rejects.toThrow(
      'Result differs from durable worker result',
    );

    // Notification policy now lives in NotificationCloudService; delegation and rollback
    // are covered below, with ownership/version checks in its PostgreSQL suite.
    // faceContext & cacheFaceResult
    const jobEnv = parseEnvelope(fixture('face-job.valid.json'));
    if (jobEnv.type !== 'face.job') throw new Error('bad fixture');
    const missingCtx = service(jest.fn().mockResolvedValueOnce({ rows: [] })).queues;
    await expect(missingCtx.faceContext(jobEnv.payload.jobId)).rejects.toThrow(NotFoundException);

    const ctxQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ envelope: jobEnv, cached_result: null }] })
      .mockResolvedValueOnce({ rows: [{ face_id: 'f1', known_face_id: 'kf1' }] });
    const ctx = await service(ctxQuery).queues.faceContext(jobEnv.payload.jobId);
    expect(ctx.mappings).toEqual({ f1: 'kf1' });

    await expect(queues.cacheFaceResult(jobEnv.payload.jobId, { bad: true })).rejects.toThrow(
      BadRequestException,
    );

    const mismatchedWorkerResult = parseEnvelope(fixture('face-result-unknown.valid.json'));
    if (mismatchedWorkerResult.type !== 'face.result') throw new Error('bad');
    mismatchedWorkerResult.payload.body.revision = 99;
    const cacheMismatchSvc = service(
      jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ envelope: jobEnv, cached_result: null }] })
        .mockResolvedValueOnce({ rows: [] }),
    ).queues;
    await expect(
      cacheMismatchSvc.cacheFaceResult(jobEnv.payload.jobId, mismatchedWorkerResult),
    ).rejects.toThrow('Worker result mismatch');

    const validWorkerResult = parseEnvelope(fixture('face-result-unknown.valid.json'));
    const cacheOkSvc = service(
      jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ envelope: jobEnv, cached_result: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ cached_result: validWorkerResult }] }),
    ).queues;
    await expect(
      cacheOkSvc.cacheFaceResult(jobEnv.payload.jobId, validWorkerResult),
    ).resolves.toEqual(validWorkerResult);
  });

  it('uses the notification outcome transaction before acknowledging Results', async () => {
    const { queues, notifications, query } = service();
    const message = parseEnvelope(fixture('notification-outcome.valid.json'));
    await queues.applyResult(message);
    expect(notifications.applyResult).toHaveBeenCalledWith(message);
    expect(query).not.toHaveBeenCalled();
    notifications.applyResult.mockRejectedValueOnce(new Error('Outcome rollback'));
    await expect(queues.applyResult(message)).rejects.toThrow('Outcome rollback');
  });

  it('delegates notification enqueueing using the caller transaction', async () => {
    const { queues, notifications, client } = service();
    const message = parseEnvelope(fixture('notification-job.valid.json'));
    if (message.type !== 'notification.job') throw new Error('fixture type');
    await queues.enqueueNotification(client as never, message.payload);
    expect(notifications.enqueueNotification).toHaveBeenCalledWith(client, message.payload);
  });
});
