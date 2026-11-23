import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AiResultsService } from '../src/ai-results/ai-results.service';
import { readCloudConfig } from '../src/cloud-queue/cloud-config';
import { CloudQueueService } from '../src/cloud-queue/cloud-queue.service';
import { parseEnvelope } from '../src/cloud-queue/queue-contract';
import type { DatabaseService } from '../src/database/database.service';
import type { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';
import type { NotificationCloudService } from '../src/notification-cloud/notification-cloud.service';
import type { IStorageService } from '../src/storage/storage.interface';

const queueOrigin = 'https://sqs.ap-southeast-1.amazonaws.com/123456789012';
const settings = {
  FACE_JOB_TRANSPORT: 'sqs',
  NOTIFICATION_DRIVER: 'local',
  AWS_REGION: 'ap-southeast-1',
  APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
  NOTIFICATION_JOBS_QUEUE_URL: `${queueOrigin}/notifications`,
  APPLICATION_RESULTS_QUEUE_URL: `${queueOrigin}/results`,
  FACE_JOBS_QUEUE_URL: `${queueOrigin}/face`,
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'camerai-s4-dev-media-fixture-only',
};

function readFixture(fileName: string) {
  return parseEnvelope(
    JSON.parse(
      readFileSync(resolve(__dirname, '../../../aws/sprint4/contracts/fixtures', fileName), 'utf8'),
    ),
  );
}

const faceJob = readFixture('face-job.valid.json');
const faceResult = readFixture('face-result-unknown.valid.json');
if (faceJob.type !== 'face.job' || faceResult.type !== 'face.result')
  throw new Error('Bad fixtures');
const payload = faceJob.payload;
const preparing = {
  id: payload.jobId,
  result_id: payload.resultId,
  event_id: payload.eventId,
  camera_id: payload.cameraId,
  owner_user_id: payload.ownerScopeId,
  track_id: payload.trackId,
  collection_id: payload.collectionId,
  version: payload.collectionVersion,
  created_at: new Date(faceJob.occurredAt),
  detected_at: new Date(faceJob.occurredAt),
  camera_slug: 'test-camera',
  kind: 'face.job',
};
const sent = {
  ...preparing,
  current_owner: payload.ownerScopeId,
  current_collection_version: payload.collectionVersion,
  envelope: faceJob,
};

function setup(config: Record<string, string> = settings) {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const transaction = jest.fn(async (callback) => callback({ query }));
  const db = { query, transaction };
  const send = jest.fn().mockResolvedValue({});
  const destroy = jest.fn();
  const media = { getCroppedSnapshot: jest.fn().mockResolvedValue(Buffer.from('crop')) };
  const storage = { upload: jest.fn().mockResolvedValue(payload.image) };
  const ai = { submit: jest.fn() };
  const notifications = { applyResult: jest.fn() };
  const configService = new ConfigService(config);
  const queue = new CloudQueueService(
    configService,
    db as unknown as DatabaseService,
    media as unknown as FrigateMediaAdapter,
    storage as unknown as IStorageService,
    ai as unknown as AiResultsService,
    notifications as unknown as NotificationCloudService,
  );
  if (readCloudConfig(configService).enabled) Object.assign(queue, { sqs: { send, destroy } });
  return { queue, query, transaction, send, destroy, media, storage, ai, notifications };
}

describe('cloud queue endpoint configuration', () => {
  it.each([
    settings.APPLICATION_RESULTS_QUEUE_URL.replace('https://sqs', 'https://SQS'),
    `${queueOrigin}/notifications/../results`,
  ])('rejects queue URL aliases that target Results (%s)', (alias) => {
    expect(() =>
      readCloudConfig(
        new ConfigService({
          ...settings,
          NOTIFICATION_JOBS_QUEUE_URL: alias,
        }),
      ),
    ).toThrow('Cloud queues must be standard AWS SQS HTTPS URLs');
  });

  it('rejects passwords even with no username', () => {
    const url = settings.APPLICATION_RESULTS_QUEUE_URL.replace('https://', 'https://:secret@');
    expect(() =>
      readCloudConfig(
        new ConfigService({
          ...settings,
          APPLICATION_RESULTS_QUEUE_URL: url,
        }),
      ),
    ).toThrow('Cloud queues must be');
  });
});

describe('cloud queue transport lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not contact AWS or open a job transaction when both transports are local', async () => {
    const { queue, query, transaction, send } = setup({
      FACE_JOB_TRANSPORT: 'bullmq',
      NOTIFICATION_DRIVER: 'local',
    });
    query.mockResolvedValueOnce({ rows: [{ mode: 'bullmq' }] });
    await queue.onModuleInit();
    await queue.dispatchOne();
    await queue.consumeOnce();
    await queue.onModuleDestroy();
    expect(query).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not poll Results while the consumer is disabled', async () => {
    const { queue, send } = setup({ ...settings, APPLICATION_RESULTS_CONSUMER_ENABLED: 'false' });
    await queue.consumeOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('retries a receive failure without logging the provider error body and stops on destruction', async () => {
    jest.useFakeTimers();
    const { queue, query, send, destroy } = setup();
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    query.mockResolvedValueOnce({ rows: [{ mode: 'sqs', notification_driver: 'local' }] });
    send.mockRejectedValueOnce(
      Object.assign(new Error('PII in response'), { code: 'NetworkError' }),
    );
    try {
      await queue.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('(receive-results, NetworkError)'),
      );
      expect(logger.mock.calls.flat().join(' ')).not.toContain('PII in response');
      expect(send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      await queue.onModuleDestroy();
    }
    await jest.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('finishes existing work on shutdown and bounds unknown error details', async () => {
    const { queue, query, transaction, send, destroy } = setup();
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let reject: (value: object) => void = () => undefined;
    transaction.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    query.mockResolvedValueOnce({ rows: [{ mode: 'sqs', notification_driver: 'local' }] });
    await queue.onModuleInit();
    const stopped = queue.onModuleDestroy();
    expect(destroy).not.toHaveBeenCalled();
    reject({ body: 'Sensitive response' });
    await stopped;
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('(dispatch, unknown)'));
    expect(send).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('shared queue dispatch and receive', () => {
  it('persists a prepared Face envelope first and sends that exact body on the next pass', async () => {
    const { queue, query, storage, media, send } = setup();
    query.mockResolvedValueOnce({ rows: [{ ...preparing }] });
    await queue.dispatchOne();
    expect(media.getCroppedSnapshot).toHaveBeenCalledWith(payload.trackId);
    expect(storage.upload).toHaveBeenCalledWith(
      payload.image.key,
      Buffer.from('crop'),
      'image/jpeg',
      { tags: { retention: 'expire-7d' } },
    );
    expect(send).not.toHaveBeenCalled();
    const envelopeJSON = query.mock.calls[1]![1][1] as string;
    const stored = parseEnvelope(JSON.parse(envelopeJSON));
    expect(stored).toMatchObject({
      type: 'face.job',
      messageId: payload.jobId,
      payload: { image: payload.image, sourceSessionId: 'test-camera:1793847600.000000' },
    });
    query.mockResolvedValueOnce({ rows: [{ ...preparing, envelope: stored }] });
    await queue.dispatchOne();
    const command = send.mock.calls[0]![0] as SendMessageCommand;
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toEqual({
      QueueUrl: settings.FACE_JOBS_QUEUE_URL,
      MessageBody: envelopeJSON,
    });
    expect(query.mock.calls[3]![1]).toEqual([payload.jobId]);
  });

  it.each([
    [
      'absence of a collection',
      { ...preparing, collection_id: null },
      true,
      payload.image,
      'Face collection registry missing',
    ],
    ['an unavailable crop', preparing, false, payload.image, 'Face crop unavailable'],
    [
      'an upload to a different bucket',
      preparing,
      true,
      { ...payload.image, bucket: 'wrong' },
      'Unexpected upload bucket',
    ],
    [
      'an empty notification envelope',
      { ...preparing, kind: 'notification.job' },
      true,
      payload.image,
      'Face collection registry missing',
    ],
  ])('schedules a retry for %s without publishing', async (_name, job, hasCrop, upload, reason) => {
    const { queue, query, send, media, storage } = setup();
    query.mockResolvedValueOnce({ rows: [{ ...job }] });
    media.getCroppedSnapshot.mockResolvedValueOnce(hasCrop ? Buffer.from('crop') : null);
    storage.upload.mockResolvedValueOnce(upload);
    await queue.dispatchOne();
    expect(send).not.toHaveBeenCalled();
    expect(query.mock.calls[1]![0]).toContain("available_at=now()+interval '30 seconds'");
    expect(query.mock.calls[1]![1]).toEqual([payload.jobId, reason]);
  });

  it('sanitizes a publish failure before persisting the retry reason', async () => {
    const { queue, query, send } = setup();
    query.mockResolvedValueOnce({ rows: [sent] });
    send.mockRejectedValueOnce(new Error('SQS unredacted payload'));
    await queue.dispatchOne();
    expect(query.mock.calls[1]![0]).toContain('attempts=attempts+1');
    expect(query.mock.calls[1]![1]).toEqual([payload.jobId, 'PREPARE_OR_SEND_FAILED']);
  });

  it('retains malformed and unexpected result types while acknowledging the valid next result', async () => {
    const { queue, send, notifications } = setup();
    const outcome = readFixture('notification-outcome.valid.json');
    send.mockResolvedValueOnce({
      Messages: [
        { MessageId: 'empty', ReceiptHandle: 'empty' },
        { Body: '{"bad":', MessageId: 'invalid-json', ReceiptHandle: 'invalid-json' },
        { Body: JSON.stringify(faceJob), MessageId: 'wrong-type', ReceiptHandle: 'wrong-type' },
        { Body: JSON.stringify(outcome), MessageId: 'valid', ReceiptHandle: 'valid' },
      ],
    });
    await queue.consumeOnce();
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      ReceiveMessageCommand,
      DeleteMessageCommand,
    ]);
    expect(send.mock.calls[1]![0].input.ReceiptHandle).toBe('valid');
    expect(notifications.applyResult).toHaveBeenCalledWith(outcome);
  });
});

describe('shared Face authorization and result cache', () => {
  it('returns only mappings from active known faces and keeps the durable result', async () => {
    const { queue, query } = setup();
    query.mockResolvedValueOnce({ rows: [{ envelope: faceJob, cached_result: faceResult }] });
    query.mockResolvedValueOnce({
      rows: [{ face_id: 'provider-id', known_face_id: 'known-face-id' }],
    });
    await expect(queue.faceContext(payload.jobId)).resolves.toEqual({
      envelope: faceJob,
      cached_result: faceResult,
      mappings: { 'provider-id': 'known-face-id' },
    });
    expect(query.mock.calls[1]![0]).toContain('k.is_active');
    expect(query.mock.calls[1]![1]).toEqual([payload.jobId]);
  });

  it('fails closed when no durable Face envelope exists', async () => {
    const { queue, query } = setup();
    query.mockResolvedValueOnce({ rows: [{ envelope: null }] });
    await expect(queue.faceContext(payload.jobId)).rejects.toThrow('Face job missing or stale');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns the canonical outcome when another writer has already cached a result', async () => {
    const { queue, query } = setup();
    const canonical = { ...faceResult, occurredAt: '2026-11-05T03:01:00Z' };
    query.mockResolvedValueOnce({ rows: [{ envelope: faceJob, cached_result: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ cached_result: canonical }] });
    await expect(queue.cacheFaceResult(payload.jobId, faceResult)).resolves.toEqual(canonical);
    expect(query.mock.calls[2]![0]).toMatch(/COALESCE\(cached_result/);
    expect(query.mock.calls[2]![1]).toEqual([payload.jobId, JSON.stringify(faceResult)]);
  });

  it('rejects invalid schema before loading authorization context', async () => {
    const { queue, query } = setup();
    await expect(queue.cacheFaceResult(payload.jobId, {})).rejects.toThrow(
      'Invalid queue result contract',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['resultId', { ...faceJob, payload: { ...payload, resultId: payload.cameraId } }, faceResult],
    ['correlationId', { ...faceJob, correlationId: payload.cameraId }, faceResult],
    ['eventId', { ...faceJob, payload: { ...payload, eventId: payload.cameraId } }, faceResult],
    [
      'observationId',
      { ...faceJob, payload: { ...payload, observationId: 'track:other:face' } },
      faceResult,
    ],
    ['revision', { ...faceJob, payload: { ...payload, revision: 2 } }, faceResult],
    [
      'collectionVersion',
      { ...faceJob, payload: { ...payload, collectionVersion: 2 } },
      faceResult,
    ],
    [
      'ownerScopeId',
      { ...faceJob, payload: { ...payload, ownerScopeId: payload.cameraId } },
      faceResult,
    ],
    [
      'cameraId',
      { ...faceJob, payload: { ...payload, cameraId: payload.ownerScopeId } },
      faceResult,
    ],
    ['envelope type', faceJob, faceJob],
    [
      'job path',
      faceJob,
      { ...faceResult, payload: { ...faceResult.payload, jobId: payload.cameraId } },
    ],
  ])('rejects cache writes that mismatch %s', async (_field, envelope, candidate) => {
    const { queue, query } = setup();
    query.mockResolvedValueOnce({ rows: [{ envelope, cached_result: null }] });
    await expect(queue.cacheFaceResult(payload.jobId, candidate)).rejects.toThrow(
      'Worker result mismatch',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['stored owner', { ...sent, owner_user_id: payload.cameraId }, 'ownership/job'],
    ['current owner', { ...sent, current_owner: payload.cameraId }, 'ownership/job'],
    ['event identity', { ...sent, event_id: payload.cameraId }, 'ownership/job'],
    ['job kind', { ...sent, kind: 'notification.job' }, 'job/version'],
    ['missing durable envelope', { ...sent, envelope: null }, 'job/version'],
    ['result id', { ...sent, result_id: payload.cameraId }, 'job/version'],
    ['camera identity', { ...sent, camera_id: payload.ownerScopeId }, 'job/version'],
    [
      'observation',
      { ...sent, envelope: { payload: { ...payload, observationId: 'other' } } },
      'job/version',
    ],
    ['revision', { ...sent, envelope: { payload: { ...payload, revision: 2 } } }, 'job/version'],
    [
      'collection version',
      { ...sent, envelope: { payload: { ...payload, collectionVersion: 2 } } },
      'job/version',
    ],
  ])('does not apply a face result that mismatches %s', async (_field, row, error) => {
    const { queue, query, ai } = setup();
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(queue.applyResult(faceResult)).rejects.toThrow(error);
    expect(ai.submit).not.toHaveBeenCalled();
  });

  it('rejects an otherwise authorized Face result if its body differs from durable cache', async () => {
    const { queue, query, ai } = setup();
    query.mockResolvedValueOnce({ rows: [sent] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ identical: false }] });
    await expect(queue.applyResult(faceResult)).rejects.toThrow(
      'differs from durable worker result',
    );
    expect(ai.submit).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(3);
  });
});
