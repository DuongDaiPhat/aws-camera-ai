import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../src/database/database.module';
import { WellnessModule } from '../src/wellness/wellness.module';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { JwtTokenService } from '../src/auth/jwt-token.service';
import type { AuthUser } from '../src/auth/auth.types';

const secret = 'qa-only-jwt-secret-at-least-32-characters';
const internal = 'qa-only-internal-token-at-least-32-characters';
const owner = randomUUID(),
  resident = randomUUID(),
  camera = randomUUID(),
  device = randomUUID(),
  face = randomUUID();
let app: INestApplication, pool: Pool, base: string, token: string;
const body = {
  residentUserId: resident,
  name: 'QA schedule',
  checkAt: '09:00',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  lookbackHours: 6,
  graceSeconds: 300,
  cameraIds: [camera],
  timezone: 'Asia/Ho_Chi_Minh',
  isEnabled: false,
};
const config = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: 55432,
  POSTGRES_DB: 'qa_runtime',
  POSTGRES_USER: 'qa',
  POSTGRES_PASSWORD: 'qa-disposable-only',
  JWT_SECRET: secret,
  JWT_ACCESS_TTL: 3600,
  JWT_REFRESH_TTL: 86400,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
  INTERNAL_SERVICE_TOKEN: internal,
  M5_ENABLED: 'false',
};

async function call(
  path: string,
  method = 'GET',
  data?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(base + path, {
    method,
    headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers },
    body: data ? JSON.stringify(data) : undefined,
  });
}
describe('QA local HTTP runtime: production Wellness/Auth/Database modules', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DatabaseModule,
        WellnessModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      // Timer is explicitly controlled; HTTP, JWT, service and repositories are real.
      .overrideProvider(WellnessSchedulerService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/api/v1';
    pool = module.get(PG_POOL);
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe('qa_runtime');
    await pool.query(
      `INSERT INTO users(id,email,full_name,role,password_hash) VALUES($1,$2,'QA owner','CAREGIVER','qa-fixture-unused'),($3,$4,'QA resident','VIEWER','qa-fixture-unused')`,
      [owner, `${owner}@example.invalid`, resident, `${resident}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO devices(id,owner_user_id,name,device_type,status) VALUES($1,$2,'QA','EDGE_GATEWAY','ONLINE')`,
      [device, owner],
    );
    await pool.query(
      `INSERT INTO cameras(id,device_id,name,slug,rtsp_url) VALUES($1,$2,'QA',$3,'rtsp://127.0.0.1/qa')`,
      [camera, device, `qa_${camera.replaceAll('-', '')}`],
    );
    await pool.query(
      `INSERT INTO known_faces(id,owner_user_id,linked_user_id,person_name,embedding,embedding_dim,model_version)
      VALUES($1,$2,$3,'QA resident',$4,128,'qa-synthetic')`,
      [face, owner, resident, Buffer.alloc(512, 1)],
    );
    token = new JwtTokenService({
      secret,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
    }).issueTokenPair({
      id: owner,
      email: `${owner}@example.invalid`,
      role: 'CAREGIVER',
    } as AuthUser).accessToken;
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
  });
  it('US20 JWT guard denies an unauthenticated request', async () => {
    expect((await call('/wellness-schedules')).status).toBe(401);
  });
  it('US20 internal guard denies a wrong token', async () => {
    expect(
      (await call('/internal/wellness-observations', 'POST', {}, { 'X-Internal-Token': 'invalid' }))
        .status,
    ).toBe(401);
  });
  it('US20 create response follows frozen camelCase contract', async () => {
    const response = await call('/wellness-schedules', 'POST', body, {
      Authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      residentUserId: resident,
      checkAt: '09:00',
      lookbackHours: 6,
      isEnabled: false,
    });
  });
  it.each([
    { lookbackHours: 0 },
    { lookbackHours: 25 },
    { graceSeconds: 59 },
    { graceSeconds: 3601 },
  ])('US20 rejects out-of-range %j', async (patch) => {
    expect(
      (
        await call(
          '/wellness-schedules',
          'POST',
          { ...body, ...patch },
          { Authorization: `Bearer ${token}` },
        )
      ).status,
    ).toBe(400);
  });
  it('US20 rejects an unknown IANA timezone', async () => {
    expect(
      (
        await call(
          '/wellness-schedules',
          'POST',
          { ...body, checkAt: '09:01', timezone: 'Not/A_Zone' },
          { Authorization: `Bearer ${token}` },
        )
      ).status,
    ).toBe(400);
  });
  it('US20 rejects an empty daysOfWeek array', async () => {
    expect(
      (
        await call(
          '/wellness-schedules',
          'POST',
          { ...body, checkAt: '09:02', daysOfWeek: [] },
          { Authorization: `Bearer ${token}` },
        )
      ).status,
    ).toBe(400);
  });
  it('US20 rejects DEPARTURE without direction/identity evidence', async () => {
    const observation = {
      observationId: randomUUID(),
      ownerUserId: owner,
      residentUserId: resident,
      sourceSessionId: 'qa',
      trackId: 'qa',
      kind: 'DEPARTURE',
      observedAt: new Date().toISOString(),
    };
    expect(
      (
        await call('/internal/wellness-observations', 'POST', observation, {
          'X-Internal-Token': internal,
        })
      ).status,
    ).toBe(400);
  });
  it('US20 accepted observation uses HTTP 202 from frozen contract', async () => {
    const observation = {
      observationId: randomUUID(),
      ownerUserId: owner,
      residentUserId: resident,
      knownFaceId: face,
      cameraId: camera,
      sourceSessionId: 'qa',
      trackId: 'qa',
      kind: 'MOTION',
      observedAt: new Date().toISOString(),
    };
    expect(
      (
        await call('/internal/wellness-observations', 'POST', observation, {
          'X-Internal-Token': internal,
        })
      ).status,
    ).toBe(202);
  });
});
