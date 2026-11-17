import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../src/database/database.service';
import { SmokeController } from '../src/health/smoke.controller';
import { SmokeService } from '../src/health/smoke.service';
import type { IStorageService } from '../src/storage/storage.interface';

function createStorageMock(overrides: Partial<IStorageService> = {}): IStorageService & {
  upload: jest.Mock;
  download: jest.Mock;
  getPresignedUrl: jest.Mock;
  delete: jest.Mock;
} {
  return {
    upload: jest.fn().mockResolvedValue({
      bucket: 'camerai-media',
      key: '_smoke/orchestrator-smoke.txt',
      sizeBytes: 19,
      contentType: 'text/plain',
    }),
    download: jest.fn().mockResolvedValue(Buffer.from('camerai-smoke-check')),
    getPresignedUrl: jest.fn().mockResolvedValue({
      url: 'https://camerai-media.s3.ap-southeast-1.amazonaws.com/_smoke/orchestrator-smoke.txt?sig=1',
      expiresAt: new Date(Date.now() + 60_000),
    }),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IStorageService & {
    upload: jest.Mock;
    download: jest.Mock;
    getPresignedUrl: jest.Mock;
    delete: jest.Mock;
  };
}

function createDatabaseMock(mode = 'bullmq', userCount = 3) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT 1')) return { rows: [{ ok: 1 }] };
    if (sql.includes('cloud_transport_mode')) return { rows: [{ mode }] };
    if (sql.includes('FROM users')) return { rows: [{ total: userCount }] };
    return { rows: [] };
  });
  return { query } as unknown as DatabaseService & { query: jest.Mock };
}

describe('SmokeService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('trả về ok khi database, jwt auth, storage và bullmq hoạt động bình thường', async () => {
    const db = createDatabaseMock('bullmq', 2);
    const storage = createStorageMock();
    const service = new SmokeService(
      new ConfigService({
        AUTH_PROVIDER: 'jwt',
        JWT_SECRET: 'local-jwt-secret-that-is-sufficient',
        STORAGE_PROVIDER: 'minio',
        FACE_JOB_TRANSPORT: 'bullmq',
      }),
      db,
      storage,
    );

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks.database).toEqual({ status: 'ok', detail: 'mode=bullmq,users=2' });
    expect(result.checks.auth).toEqual({ status: 'ok', detail: 'provider=jwt' });
    expect(result.checks.storage).toEqual({
      status: 'ok',
      detail: 'provider=minio,bucket=camerai-media',
    });
    expect(result.checks.cloudQueue).toEqual({ status: 'ok', detail: 'mode=bullmq' });
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.download).toHaveBeenCalledTimes(1);
    expect(storage.getPresignedUrl).toHaveBeenCalledWith('_smoke/orchestrator-smoke.txt', 60);
    expect(storage.delete).toHaveBeenCalledWith('_smoke/orchestrator-smoke.txt');
  });

  it('kiểm tra được Cognito JWKS và SQS trong chế độ cloud', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [{ kid: 'k1' }] }),
    } as globalThis.Response);
    const sqsSendSpy = jest.spyOn(SQSClient.prototype, 'send').mockResolvedValue({} as never);
    jest.spyOn(SQSClient.prototype, 'destroy').mockImplementation(() => undefined);

    const service = new SmokeService(
      new ConfigService({
        AUTH_PROVIDER: 'cognito',
        COGNITO_USER_POOL_ID: 'ap-southeast-1_4WQxu8bnB',
        COGNITO_CLIENT_ID: '5p3hgqnkmjrdc5ktb99ur46hjr',
        COGNITO_DOMAIN: 'https://example.auth.ap-southeast-1.amazoncognito.com',
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'camerai-staging-media',
        AWS_REGION: 'ap-southeast-1',
        FACE_JOB_TRANSPORT: 'sqs',
        APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
        FACE_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/face',
        NOTIFICATION_JOBS_QUEUE_URL:
          'https://sqs.ap-southeast-1.amazonaws.com/123456789012/notification',
        APPLICATION_RESULTS_QUEUE_URL:
          'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results',
      }),
      createDatabaseMock('sqs', 5),
      createStorageMock(),
    );

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks.auth).toEqual({
      status: 'ok',
      detail: 'provider=cognito,jwksKeys=1',
    });
    expect(result.checks.cloudQueue).toEqual({ status: 'ok', detail: 'mode=sqs,consumer=true' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_4WQxu8bnB/.well-known/jwks.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sqsSendSpy).toHaveBeenCalledTimes(1);
  });

  it('trả về degraded khi storage mismatch, DB lỗi hoặc Cognito JWKS không khả dụng', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
    } as globalThis.Response);

    const db = {
      query: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    } as unknown as DatabaseService;
    const storage = createStorageMock({
      download: jest.fn().mockResolvedValue(Buffer.from('corrupted')),
    });
    const service = new SmokeService(
      new ConfigService({
        AUTH_PROVIDER: 'cognito',
        COGNITO_USER_POOL_ID: 'ap-southeast-1_4WQxu8bnB',
        COGNITO_CLIENT_ID: '5p3hgqnkmjrdc5ktb99ur46hjr',
        COGNITO_DOMAIN: 'https://example.auth.ap-southeast-1.amazoncognito.com',
        STORAGE_PROVIDER: 's3',
        FACE_JOB_TRANSPORT: 'bullmq',
      }),
      db,
      storage,
    );

    const result = await service.check();

    expect(result.status).toBe('degraded');
    expect(result.checks.database.status).toBe('error');
    expect(result.checks.auth).toEqual({ status: 'error', reason: 'Cognito JWKS HTTP 502' });
    expect(result.checks.storage).toEqual({
      status: 'error',
      reason: 'Storage roundtrip payload mismatch',
    });
    expect(result.checks.cloudQueue.status).toBe('error');
    expect(storage.delete).toHaveBeenCalledWith('_smoke/orchestrator-smoke.txt');
  });
});

describe('SmokeController', () => {
  it('đặt HTTP 200 khi ok và 503 khi degraded', async () => {
    const statusMock = jest.fn();
    const res = { status: statusMock } as unknown as Response;

    const okService = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        service: 'orchestrator',
        version: 'sha-1',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'ok' },
          auth: { status: 'ok' },
          storage: { status: 'ok' },
          cloudQueue: { status: 'ok' },
        },
      }),
    } as unknown as SmokeService;
    await new SmokeController(okService).check(res);
    expect(statusMock).toHaveBeenLastCalledWith(HttpStatus.OK);

    const degradedService = {
      check: jest.fn().mockResolvedValue({
        status: 'degraded',
        service: 'orchestrator',
        version: 'sha-1',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'error', reason: 'down' },
          auth: { status: 'ok' },
          storage: { status: 'ok' },
          cloudQueue: { status: 'ok' },
        },
      }),
    } as unknown as SmokeService;
    await new SmokeController(degradedService).check(res);
    expect(statusMock).toHaveBeenLastCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
