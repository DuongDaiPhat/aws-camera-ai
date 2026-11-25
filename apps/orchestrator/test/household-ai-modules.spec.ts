import {
  ForbiddenException,
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { TokenClaims } from '../src/auth/auth.types';
import { RolesGuard } from '../src/auth/roles.guard';
import type { CamerasRepository } from '../src/cameras/cameras.repository';
import type { DatabaseService } from '../src/database/database.service';
import { PoseFrameConsumer } from '../src/fall-detection/consumer/pose-frame.consumer';
import type { FallIncidentCoordinator } from '../src/fall-detection/coordinator/fall-incident.coordinator';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import type { HouseholdAccessService } from '../src/household/household-access.service';
import { HouseholdAiModulesController } from '../src/household/household-ai-modules.controller';
import { HouseholdAiModulesService } from '../src/household/household-ai-modules.service';
import { confirmedFire } from './fire-fixtures';

describe('HouseholdAiModulesService', () => {
  const caregiver: TokenClaims = {
    sub: 'caregiver-2',
    email: 'caregiver@example.test',
    role: 'CAREGIVER',
    tokenType: 'access',
    jti: 'jti-cg-2',
  };

  function makeService(
    dbImpl?: jest.Mock,
    env: Record<string, string> = {
      M2A_ENABLED: 'true',
      M3_ENABLED: 'false',
      M5_ENABLED: 'true',
    },
  ) {
    const query =
      dbImpl ??
      jest.fn(async (sql: string) => {
        if (sql.includes('FROM users')) {
          return { rows: [{ owner: 'household-owner-1' }] };
        }
        return { rows: [] };
      });
    const client = { query: jest.fn() };
    const transaction = jest.fn(async (fn: (c: typeof client) => Promise<unknown>) => fn(client));
    const db = { query, transaction } as unknown as DatabaseService;
    const audit = jest.fn().mockResolvedValue(undefined);
    const access = { audit } as unknown as HouseholdAccessService;
    const config = new ConfigService(env);
    const service = new HouseholdAiModulesService(db, access, config);
    return { service, query, client, transaction, audit };
  }

  it('returns default enabled settings and server availability for an active caregiver', async () => {
    const { service, query } = makeService();
    const res = await service.get(caregiver);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM users'), ['caregiver-2']);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM household_ai_module_settings'),
      ['household-owner-1'],
    );
    expect(res).toEqual({
      m1Face: true,
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: true,
      availability: {
        m1Face: true,
        m2aFall: true,
        m3Fire: false,
        m4Zone: true,
        m5Wellness: true,
      },
      updatedAt: null,
    });
  });

  it('reads stored flags and upserts updated toggles with an audit entry', async () => {
    const updatedAt = new Date('2026-11-25T09:30:00.000Z');
    const { service, client, audit } = makeService();
    client.query.mockResolvedValueOnce({
      rows: [
        {
          m1_face_enabled: false,
          m2a_fall_enabled: true,
          m3_fire_enabled: false,
          m4_zone_enabled: true,
          m5_wellness_enabled: false,
          updated_at: updatedAt,
        },
      ],
    });

    const input = {
      m1Face: false,
      m2aFall: true,
      m3Fire: false,
      m4Zone: true,
      m5Wellness: false,
    };
    const res = await service.update(caregiver, input);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO household_ai_module_settings'),
      ['household-owner-1', false, true, false, true, false, 'caregiver-2'],
    );
    expect(audit).toHaveBeenCalledWith(
      client,
      'caregiver-2',
      'HOUSEHOLD_AI_MODULES_UPDATED',
      'household-owner-1',
      input,
    );
    expect(res).toMatchObject({
      ...input,
      updatedAt: '2026-11-25T09:30:00.000Z',
    });
  });

  it('rejects unauthenticated, non-caregiver roles, and inactive caregiver accounts', async () => {
    const { service, query } = makeService(jest.fn(async () => ({ rows: [] })));

    await expect(service.get(undefined)).rejects.toThrow(UnauthorizedException);
    await expect(
      service.get({
        sub: 'admin-1',
        email: 'admin@camerai.local',
        role: 'ADMIN',
        tokenType: 'access',
        jti: 'jti-admin-1',
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.update(
        {
          sub: 'viewer-1',
          email: 'viewer@example.test',
          role: 'VIEWER',
          tokenType: 'access',
          jti: 'jti-viewer-1',
        },
        { m1Face: true, m2aFall: true, m3Fire: true, m4Zone: true, m5Wellness: true },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(query).not.toHaveBeenCalled();

    await expect(service.get(caregiver)).rejects.toThrow(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('HouseholdAiModulesController HTTP & Caregiver-only RolesGuard', () => {
  let app: INestApplication;
  let base: string;
  const aiModules = {
    get: jest.fn().mockResolvedValue({
      m1Face: true,
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: true,
      availability: { m1Face: true, m2aFall: true, m3Fire: true, m4Zone: true, m5Wellness: true },
      updatedAt: null,
    }),
    update: jest.fn().mockResolvedValue({
      m1Face: false,
      m2aFall: true,
      m3Fire: true,
      m4Zone: false,
      m5Wellness: true,
      availability: { m1Face: true, m2aFall: true, m3Fire: true, m4Zone: true, m5Wellness: true },
      updatedAt: '2026-11-25T10:00:00.000Z',
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HouseholdAiModulesController],
      providers: [{ provide: HouseholdAiModulesService, useValue: aiModules }],
    }).compile();

    app = module.createNestApplication();
    const rolesGuard = new RolesGuard(module.get(Reflector));
    app.useGlobalGuards(
      {
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          const role = req.headers['x-test-role'];
          if (typeof role !== 'string') {
            throw new UnauthorizedException();
          }
          req.auth = { sub: `user-${role}`, email: `${role}@example.test`, role };
          return true;
        },
      },
      rolesGuard,
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/household/ai-modules';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => app?.close());

  function request(method: string, role?: string, body?: object) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (role) headers['x-test-role'] = role;
    return fetch(base, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('blocks unauthenticated requests (401) and ADMIN/VIEWER roles (403)', async () => {
    expect((await request('GET')).status).toBe(401);

    for (const forbiddenRole of ['ADMIN', 'VIEWER']) {
      expect((await request('GET', forbiddenRole)).status).toBe(403);
      expect(
        (
          await request('PUT', forbiddenRole, {
            m1Face: false,
            m2aFall: true,
            m3Fire: true,
            m4Zone: true,
            m5Wellness: true,
          })
        ).status,
      ).toBe(403);
    }

    expect(aiModules.get).not.toHaveBeenCalled();
    expect(aiModules.update).not.toHaveBeenCalled();
  });

  it('allows CAREGIVER with no-store header and validates strict boolean payload', async () => {
    const getRes = await request('GET', 'CAREGIVER');
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('cache-control')).toBe('no-store');
    expect(aiModules.get).toHaveBeenCalledWith({
      sub: 'user-CAREGIVER',
      email: 'CAREGIVER@example.test',
      role: 'CAREGIVER',
    });

    const invalidType = await request('PUT', 'CAREGIVER', {
      m1Face: 'yes',
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: true,
    });
    expect(invalidType.status).toBe(400);

    const extraField = await request('PUT', 'CAREGIVER', {
      m1Face: false,
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: true,
      ownerUserId: 'other-user',
    });
    expect(extraField.status).toBe(400);
    expect(aiModules.update).not.toHaveBeenCalled();

    const validBody = {
      m1Face: false,
      m2aFall: true,
      m3Fire: true,
      m4Zone: false,
      m5Wellness: true,
    };
    const putRes = await request('PUT', 'CAREGIVER', validBody);
    expect(putRes.status).toBe(200);
    expect(putRes.headers.get('cache-control')).toBe('no-store');
    expect(aiModules.update).toHaveBeenCalledWith(
      { sub: 'user-CAREGIVER', email: 'CAREGIVER@example.test', role: 'CAREGIVER' },
      validBody,
    );
  });
});

describe('Household AI module pipeline guards (M2a, M3)', () => {
  it('skips M2a fall evaluation when camera has ai_m2a_fall_enabled = false', async () => {
    const config = new ConfigService({ M2A_ENABLED: 'true' });
    const camerasRepository = {
      findBySlug: jest.fn().mockResolvedValue({
        id: 'cam-m2a-1',
        slug: 'cam_living',
        is_enabled: true,
        ai_m2a_fall_enabled: false,
      }),
    } as unknown as CamerasRepository;
    const processFrame = jest.fn();
    const coordinator = { processFrame } as unknown as FallIncidentCoordinator;
    const consumer = new PoseFrameConsumer(config, camerasRepository, coordinator);

    const observedAt = Date.now() / 1000;
    const header = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        cameraSlug: 'cam_living',
        sourceSessionId: 'session-m2a',
        frameId: '11111111-1111-4111-8111-111111111111',
        frameTimestamp: observedAt,
        frameWidth: 640,
        frameHeight: 480,
        persons: [
          {
            trackId: 'person-1',
            observedAt,
            boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.6 },
          },
        ],
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    const frame = Buffer.concat([prefix, header, Buffer.from([0xff, 0xd8, 0xff, 0xd9])]);

    await consumer.handlePoseFrame(frame);

    expect(camerasRepository.findBySlug).toHaveBeenCalledWith('cam_living');
    expect(processFrame).not.toHaveBeenCalled();
  });

  it('filters M3 fire queries by m3_fire_enabled and locks camera with FOR UPDATE OF c', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
    const transaction = jest.fn(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) =>
      fn({ query: clientQuery }),
    );
    const db = { query, transaction } as unknown as DatabaseService;
    const repo = new FireIncidentsRepository(db);

    expect(await repo.findEnabledCamera('cam_fire')).toBeNull();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringMatching(/household_ai_module_settings[\s\S]*m3_fire_enabled/i),
      ['cam_fire'],
    );

    expect(await repo.listEnabledCameras(20)).toEqual([]);
    expect(query.mock.calls[1]?.[0]).toMatch(/household_ai_module_settings[\s\S]*m3_fire_enabled/i);

    const evidence = confirmedFire();
    const res = await repo.confirm('cam-fire-1', evidence, {
      schemaVersion: 1,
      resultId: '22222222-2222-4222-8222-222222222222',
      eventId: '33333333-3333-4333-8333-333333333333',
      observationId: `fire:${evidence.sourceSessionId}:${evidence.episodeId}`,
      revision: 1,
      module: 'M3_FIRE',
      modelVersion: evidence.modelVersion,
      processedAt: evidence.processedAt,
      error: null,
      results: [
        {
          module: 'M3_FIRE',
          label: 'FIRE_SMOKE_DETECTED',
          confidence: evidence.incidentConfidence,
          boundingBox: evidence.detections[0].boundingBox,
          metadata: {},
        },
      ],
    });

    expect(res).toBeNull();
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringMatching(
        /FOR UPDATE OF c[\s\S]*m3_fire_enabled|m3_fire_enabled[\s\S]*FOR UPDATE OF c/i,
      ),
      ['cam-fire-1'],
    );
  });
});
