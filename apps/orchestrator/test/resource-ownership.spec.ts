import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { TOKEN_SERVICE } from '../src/auth/auth.types';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { ResourceAccessGuard } from '../src/auth/resource-access.guard';
import { CamerasController } from '../src/cameras/cameras.controller';
import { CamerasService } from '../src/cameras/cameras.service';
import { DatabaseService } from '../src/database/database.service';
import { MediaController } from '../src/media/media.controller';
import type { TokenClaims, TokenService } from '../src/auth/auth.types';
import { CamerasRepository } from '../src/cameras/cameras.repository';
import type { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import type { EventSummaryDto } from '../src/events/dto/event-summary-response.dto';
import { EventsRepository } from '../src/events/events.repository';
import { EventsService } from '../src/events/events.service';
import { MediaService } from '../src/media/media.service';
import type { IStorageService } from '../src/storage/storage.interface';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('camera ownership', () => {
  it('uses the application owner ID to scope camera listings', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const cameras = new CamerasRepository({ query } as unknown as Pool);
    const filter = { isEnabled: true, ownerUserId: owner };

    await cameras.findAll(filter);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('d.owner_user_id = $2'), [
      true,
      owner,
    ]);
  });

  it('scopes event results and their count before pagination', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const events = new EventsRepository({ query } as unknown as Pool);

    await events.listEvents({ page: 1, pageSize: 20, actorId: owner });

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('d.owner_user_id = $1'), [
      owner,
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('d.owner_user_id = $1'), [
      owner,
      20,
      0,
    ]);
  });

  it('sends camera events to their owner and administrators only', async () => {
    const verifyAccessToken = (sub: string) =>
      ({
        sub,
        role: sub === 'admin' ? 'ADMIN' : 'VIEWER',
      }) as TokenClaims;
    const events = new EventsService(
      {} as EventsRepository,
      {} as MediaService,
      {} as EscalationEngineService,
      {} as IStorageService,
      { verifyAccessToken } as TokenService,
    );
    const receiveOwner = jest.fn();
    const receiveOther = jest.fn();
    const receiveAdmin = jest.fn();
    const subscriptions = [
      (await events.streamEvents(owner)).subscribe(receiveOwner),
      (await events.streamEvents(other)).subscribe(receiveOther),
      (await events.streamEvents('admin')).subscribe(receiveAdmin),
    ];

    const event = {
      id: 'event',
      camera: { id: 'camera' },
      eventType: 'PERSON_DETECTED',
    } as EventSummaryDto;
    try {
      events.emitEvent(event, 'event.created', [owner]);
      events.emitEvent(event, 'event.created');

      expect(receiveOwner).toHaveBeenCalledTimes(1);
      expect(receiveOther).not.toHaveBeenCalled();
      expect(receiveAdmin).toHaveBeenCalledTimes(2);
    } finally {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    }
  });
});

describe('resource access over HTTP', () => {
  const cameraId = '33333333-3333-4333-8333-333333333333';
  const eventId = '44444444-4444-4444-8444-444444444444';
  const privateUrl = 'https://storage.example.test/private.jpg';
  const getPreview = jest.fn().mockResolvedValue({ url: privateUrl });
  const listEventMediaWithUrls = jest.fn().mockResolvedValue([{ url: privateUrl }]);
  const listCameras = jest.fn().mockResolvedValue({ data: [] });
  const query = jest.fn(async (_sql: string, [id, actor]: [string, string]) => ({
    rows: [cameraId, eventId].includes(id) ? [{ allowed: actor === owner }] : [],
  }));

  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CamerasController, MediaController],
      providers: [
        { provide: CamerasService, useValue: { getPreview, listCameras } },
        { provide: MediaService, useValue: { listEventMediaWithUrls } },
        { provide: DatabaseService, useValue: { query } },
        {
          provide: TOKEN_SERVICE,
          useValue: {
            verifyAccessToken: (sub: string) => ({
              sub,
              role: sub === 'admin' ? 'ADMIN' : 'VIEWER',
            }),
          },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: ResourceAccessGuard },
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app?.close());

  function get(path: string, sub?: string): Promise<Response> {
    return fetch(baseUrl + path, { headers: sub ? { Authorization: `Bearer ${sub}` } : {} });
  }

  it('authenticates before serving a camera list and scopes it to the current user', async () => {
    expect((await get('/cameras')).status).toBe(401);
    expect((await get('/cameras', owner)).status).toBe(200);
    expect(listCameras).toHaveBeenLastCalledWith({}, 'VIEWER', owner);
    expect((await get('/cameras', 'admin')).status).toBe(200);
    expect(listCameras).toHaveBeenLastCalledWith({}, 'ADMIN', undefined);
  });

  it('denies direct snapshot and event media requests before generating their URLs', async () => {
    const snapshot = `/cameras/${cameraId}/snapshot`;
    const media = `/events/${eventId}/media`;

    for (const path of [snapshot, media]) {
      const denied = await get(path, other);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain(privateUrl);
    }
    expect(getPreview).not.toHaveBeenCalled();
    expect(listEventMediaWithUrls).not.toHaveBeenCalled();

    expect(await (await get(snapshot, owner)).json()).toEqual({ url: privateUrl });
    expect(await (await get(media, owner)).json()).toEqual({ data: [{ url: privateUrl }] });

    query.mockClear();
    expect((await get(snapshot, 'admin')).status).toBe(200);
    expect((await get(media, 'admin')).status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });
});
