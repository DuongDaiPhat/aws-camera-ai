import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { NotificationCloudModule } from '../src/notification-cloud/notification-cloud.module';
import { NotificationCloudService } from '../src/notification-cloud/notification-cloud.service';

describe('notification worker HTTP endpoints', () => {
  let app: INestApplication;
  let url: string;
  const token = 'a'.repeat(32);
  const id = randomUUID();
  const cloud = {
    context: jest.fn().mockResolvedValue({ envelope: {}, cached_result: null }),
    claim: jest
      .fn()
      .mockResolvedValue({ notificationId: id, disposition: 'NO_OP', reason: 'RESOLVED' }),
    cacheResult: jest.fn().mockResolvedValue({ payload: {} }),
    submitOutcome: jest.fn().mockResolvedValue({ outcomeId: id, disposition: 'ACCEPTED' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        NotificationCloudModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ INTERNAL_SERVICE_TOKEN: token }))
      .overrideProvider(NotificationCloudService)
      .useValue(cloud)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()) + '/api/v1/internal/notifications';
  });

  afterAll(async () => app?.close());

  it('requires internal auth and validates the job path', async () => {
    expect((await fetch(`${url}/${id}`)).status).toBe(401);
    expect((await fetch(`${url}/bad`, { headers: { 'x-internal-token': token } })).status).toBe(
      400,
    );
    expect(cloud.context).not.toHaveBeenCalled();
    expect((await fetch(`${url}/${id}`, { headers: { 'x-internal-token': token } })).status).toBe(
      200,
    );
    expect(cloud.context).toHaveBeenCalledWith(id);
  });

  it('validates claim schema and delegates an authenticated claim', async () => {
    const headers = { 'x-internal-token': token, 'content-type': 'application/json' };
    const body = {
      schemaVersion: 1,
      claimId: randomUUID(),
      eventId: randomUUID(),
      expectedEventVersion: 1,
    };
    const path = `${url}/${id}/claim`;
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, ownerScopeId: id }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, expectedEventVersion: 0 }),
        })
      ).status,
    ).toBe(400);
    expect(cloud.claim).not.toHaveBeenCalled();
    expect(
      (await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })).status,
    ).toBe(200);
    expect(cloud.claim).toHaveBeenCalledWith(id, expect.objectContaining(body));
  });

  it('returns the cache response and the accepted status for direct outcomes', async () => {
    const headers = { 'x-internal-token': token, 'content-type': 'application/json' };
    const body = { outcomeId: id, notificationId: id };
    const cache = await fetch(`${url}/${id}/result`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    expect(cache.status).toBe(200);
    expect(await cache.json()).toEqual({ payload: {} });
    expect(cloud.cacheResult).toHaveBeenCalledWith(id, body);
    const outcome = await fetch(`${url}/${id}/outcome`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(outcome.status).toBe(202);
    expect(await outcome.json()).toEqual({ outcomeId: id, disposition: 'ACCEPTED' });
    expect(cloud.submitOutcome).toHaveBeenCalledWith(id, body);
  });
});
