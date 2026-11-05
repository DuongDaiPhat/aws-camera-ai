import { generateKeyPairSync, sign } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { CognitoVerifierService } from '../src/auth/cognito-verifier.service';

const pool = 'ap-southeast-1_Lab123';
const issuer = `https://cognito-idp.ap-southeast-1.amazonaws.com/${pool}`;
const client = 'labclient123';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function token(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'lab-key' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: 'cognito-user',
      client_id: client,
      token_use: 'access',
      scope: 'openid email profile',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    }),
  ).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}

describe('Cognito access-token verification with real signatures', () => {
  let service: CognitoVerifierService;

  beforeEach(() => {
    const verifier = CognitoJwtVerifier.create({
      userPoolId: pool,
      clientId: client,
      tokenUse: 'access',
      scope: 'openid',
    });
    verifier.cacheJwks({
      keys: [
        {
          ...publicKey.export({ format: 'jwk' }),
          kty: 'RSA',
          kid: 'lab-key',
          alg: 'RS256',
          use: 'sig',
        },
      ],
    });
    jest
      .spyOn(CognitoJwtVerifier, 'create')
      .mockReturnValue(verifier as ReturnType<typeof CognitoJwtVerifier.create>);
    service = new CognitoVerifierService(
      new ConfigService({ COGNITO_USER_POOL_ID: pool, COGNITO_CLIENT_ID: client }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a correctly signed access token without contacting AWS', async () => {
    await expect(service.verifyAccessToken(token())).resolves.toMatchObject({
      sub: 'cognito-user',
      token_use: 'access',
    });
  });

  it.each([
    { iss: 'https://untrusted.invalid/pool' },
    { client_id: 'other-client' },
    { exp: 1 },
    { token_use: 'id', aud: client },
    { scope: 'email profile' },
  ])('rejects mismatched claims %j', async (claims) => {
    await expect(service.verifyAccessToken(token(claims))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a modified signature and local token format', async () => {
    const jwt = token();
    const parts = jwt.split('.');
    parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`;
    await expect(service.verifyAccessToken(parts.join('.'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.verifyAccessToken('local.invalid.signature')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
