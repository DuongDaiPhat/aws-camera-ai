import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthController } from '../src/auth/auth.controller';
import { AUTH_POLICY, JWT_CONFIG, TOKEN_SERVICE, type TokenService } from '../src/auth/auth.types';
import { readAuthSettings } from '../src/auth/auth.config';
import { CognitoTokenService } from '../src/auth/cognito-token.service';
import { CognitoVerifierService } from '../src/auth/cognito-verifier.service';
import { JwtTokenService } from '../src/auth/jwt-token.service';
import { DatabaseModule, PG_POOL } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    },
  } as ConfigService;
}

const cognito = {
  AUTH_PROVIDER: 'cognito',
  COGNITO_USER_POOL_ID: 'ap-southeast-1_Lab123',
  COGNITO_CLIENT_ID: 'labclient123',
  COGNITO_DOMAIN: 'https://camerai-lab.auth.ap-southeast-1.amazoncognito.com',
};
const local = {
  JWT_SECRET: 'test-only-secret-at-least-32-characters-long',
  JWT_ACCESS_TTL: '3600',
  JWT_REFRESH_TTL: '604800',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCK_MINUTES: '15',
};

async function boot(values: Record<string, string>): Promise<TestingModule> {
  const query = jest.fn();
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      DatabaseModule,
      AuthModule,
    ],
  })
    .overrideProvider(ConfigService)
    .useValue(config(values))
    .overrideProvider(PG_POOL)
    .useValue({ end: jest.fn() })
    .overrideProvider(DatabaseService)
    .useValue({
      query,
      transaction: (work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }),
    })
    .compile();
}

describe('AUTH_PROVIDER deployment configuration', () => {
  it('boots default JWT mode without any Cognito configuration', async () => {
    const module = await boot(local);
    await module.init();
    expect(module.get(TOKEN_SERVICE)).toBeInstanceOf(JwtTokenService);
    expect(module.get(AuthController).getAuthConfig()).toEqual({ provider: 'jwt' });
    await module.close();
  });

  it('boots Cognito with no JWT or LOGIN variables and disables local issuance', async () => {
    const module = await boot(cognito);
    await module.init();
    expect(module.get(TOKEN_SERVICE)).toBeInstanceOf(CognitoTokenService);
    expect(module.get(JWT_CONFIG)).toBeNull();
    expect(module.get(AUTH_POLICY)).toBeNull();
    const service = module.get(AuthService);
    await expect(
      service.login(
        { email: 'a@test.invalid', password: 'unused' },
        { ipAddress: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.refresh('old-local-refresh')).rejects.toBeInstanceOf(ConflictException);
    const published = module.get(AuthController).getAuthConfig();
    expect(published.provider).toBe('cognito');
    expect(JSON.stringify(published)).not.toContain('JWT_SECRET');
    await module.close();
  });

  it('rejects unknown provider and incomplete selected configuration', async () => {
    expect(() => readAuthSettings(config({ AUTH_PROVIDER: 'typo' }))).toThrow('AUTH_PROVIDER');
    await expect(boot({ AUTH_PROVIDER: 'cognito' })).rejects.toThrow('COGNITO_USER_POOL_ID');
    await expect(boot({ AUTH_PROVIDER: 'jwt' })).rejects.toThrow();
  });

  it('JWT mode rejects a Cognito-shaped token instead of falling back', async () => {
    const module = await boot(local);
    const tokens = module.get<TokenService>(TOKEN_SERVICE);
    expect(() => tokens.verifyAccessToken('cognito.invalid.signature')).toThrow();
    await module.close();
  });
});

describe('Cognito account management over HTTP', () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const authority = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Lab123';
  const target = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'member@example.org',
    fullName: 'Người dùng',
    role: 'VIEWER',
    isActive: true,
    createdAt: '2026-11-06T00:00:00.000Z',
    isCognitoLinked: true,
  };
  const actor = { ...target, id: actorId, role: 'ADMIN' };
  const input = {
    email: 'new-user@example.org',
    fullName: 'Người dùng mới',
    cognitoSub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };
  let app: INestApplication;
  let baseUrl: string;
  let query: jest.Mock;

  beforeAll(async () => {
    const module = await boot(cognito);
    query = module.get(DatabaseService).query as jest.Mock;
    jest
      .spyOn(module.get<TokenService>(TOKEN_SERVICE), 'verifyAccessToken')
      .mockImplementation(async (token) => {
        const roles = { admin: 'ADMIN', caregiver: 'CAREGIVER', viewer: 'VIEWER' } as const;
        const role = roles[token as keyof typeof roles];
        if (!role) throw new Error('Invalid test token');
        return { sub: actorId, email: 'actor@example.org', role, tokenType: 'access', jti: 'test' };
      });
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => query.mockReset());
  afterAll(async () => app?.close());

  function create(body: object, token?: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  }

  it.each([
    [undefined, 401],
    ['viewer', 403],
    ['caregiver', 403],
  ])('rejects %s before writing an account', async (token, status) => {
    expect((await create({ ...input, role: 'ADMIN' }, token)).status).toBe(status);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['VIEWER', 'CAREGIVER', 'ADMIN'])('allows an admin to create a %s', async (role) => {
    const user = {
      id: '22222222-2222-4222-8222-222222222222',
      email: input.email,
      fullName: input.fullName,
      role,
      isActive: true,
      createdAt: '2026-11-06T00:00:00.000Z',
    };
    query.mockResolvedValue({ rows: [user] });
    const response = await create({ ...input, role }, 'admin');
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(user);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
      input.email,
      input.fullName,
      role,
      authority,
      input.cognitoSub,
      actorId,
    ]);
  });

  it.each([
    { role: 'OWNER' },
    { cognitoSub: 'two parts' },
    { fullName: '   ' },
    { password: 'unexpected-password' },
    { cognitoIssuer: 'https://other.example.org' },
  ])('rejects invalid or unexpected fields before writing', async (override) => {
    expect((await create({ ...input, role: 'VIEWER', ...override }, 'admin')).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('reports a duplicate account as a conflict', async () => {
    query.mockResolvedValue({ rows: [] });
    expect((await create({ ...input, role: 'VIEWER' }, 'admin')).status).toBe(409);
  });

  function list(token: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/users?page=2&pageSize=10&role=VIEWER`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  function changeRole(id: string, body: object, token = 'admin'): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/users/${id}/role`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it.each(['viewer', 'caregiver'])('denies listing and role changes for %s', async (token) => {
    expect((await list(token)).status).toBe(403);
    expect((await changeRole(target.id, { role: 'ADMIN' }, token)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a paginated list to the admin', async () => {
    query.mockResolvedValue({ rows: [{ data: [target], total: 11 }] });
    const response = await list('admin');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [target],
      meta: { page: 2, pageSize: 10, total: 11 },
    });
  });

  it('allows a different user to be updated and audits the actual role transition', async () => {
    const updated = { ...target, role: 'CAREGIVER' };
    query
      .mockResolvedValueOnce({ rows: [actor, target] })
      .mockResolvedValueOnce({ rows: [updated] });
    const response = await changeRole(target.id, { role: 'CAREGIVER' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
      target.id,
      'CAREGIVER',
      actorId,
      'VIEWER',
    ]);
  });

  it('rejects self changes and unexpected fields before writing', async () => {
    expect((await changeRole(actorId, { role: 'VIEWER' })).status).toBe(409);
    expect((await changeRole(target.id, { role: 'ADMIN', isActive: true })).status).toBe(400);
    expect((await changeRole(target.id, { role: 'OWNER' })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rechecks the acting admin under lock and handles an unknown target', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...actor, role: 'VIEWER' }, target] })
      .mockResolvedValueOnce({ rows: [actor] });
    expect((await changeRole(target.id, { role: 'ADMIN' })).status).toBe(403);
    expect((await changeRole(target.id, { role: 'ADMIN' })).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('Cognito identity adapter', () => {
  const verify = jest.fn();
  const query = jest.fn();
  const adapter = new CognitoTokenService(
    { verifyAccessToken: verify } as unknown as CognitoVerifierService,
    { query } as unknown as DatabaseService,
  );

  beforeEach(() => {
    verify.mockReset();
    query.mockReset();
  });

  it('uses verified issuer/sub and returns database ID and role', async () => {
    verify.mockResolvedValue({ iss: 'trusted-issuer', sub: 'cognito-sub', jti: 'jti' });
    query.mockResolvedValue({
      rows: [{ id: 'application-id', email: 'local@example.org', role: 'VIEWER', is_active: true }],
    });
    await expect(adapter.verifyAccessToken('token')).resolves.toMatchObject({
      sub: 'application-id',
      role: 'VIEWER',
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), ['trusted-issuer', 'cognito-sub']);
  });

  it.each([{ rows: [] }, { rows: [{ id: 'disabled', is_active: false }] }])(
    'rejects missing or disabled application users: %j',
    async ({ rows }) => {
      verify.mockResolvedValue({ iss: 'trusted-issuer', sub: 'cognito-sub' });
      query.mockResolvedValue({ rows });
      await expect(adapter.verifyAccessToken('token')).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('does not query users or fall back when signature verification fails', async () => {
    verify.mockRejectedValue(new UnauthorizedException());
    await expect(adapter.verifyAccessToken('local-or-invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
