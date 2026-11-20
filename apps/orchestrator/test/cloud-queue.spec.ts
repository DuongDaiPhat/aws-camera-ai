import { ConfigService } from '@nestjs/config';
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
  const queues = new CloudQueueService(
    new ConfigService(cloud),
    db as unknown as DatabaseService,
    {} as FrigateMediaAdapter,
    {} as IStorageService,
    ai as unknown as AiResultsService,
  );
  return { queues, query, ai, client };
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
});
