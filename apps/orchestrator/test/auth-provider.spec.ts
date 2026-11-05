import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

async function boot(values: Record<string, string>) {
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
    .useValue({ query: jest.fn() })
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
