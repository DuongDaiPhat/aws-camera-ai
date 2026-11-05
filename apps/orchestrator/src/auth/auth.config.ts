import type { ConfigService } from '@nestjs/config';

export const AUTH_SETTINGS = 'AUTH_SETTINGS';

export type AuthSettings =
  | { provider: 'jwt' }
  | {
      provider: 'cognito';
      cognito: {
        userPoolId: string;
        clientId: string;
        domain: string;
        authority: string;
        scope: string;
      };
    };

export function readAuthSettings(config: ConfigService): AuthSettings {
  const provider = config.get<string>('AUTH_PROVIDER') ?? 'jwt';
  if (provider === 'jwt') return { provider };
  if (provider !== 'cognito') throw new Error('AUTH_PROVIDER phải là jwt hoặc cognito.');

  const required = (key: string): string => {
    const value = config.get<string>(key)?.trim();
    if (!value) throw new Error(`${key} là bắt buộc khi AUTH_PROVIDER=cognito.`);
    return value;
  };
  const userPoolId = required('COGNITO_USER_POOL_ID');
  const region = /^([a-z0-9-]+)_\w+$/.exec(userPoolId)?.[1];
  if (!region) throw new Error('COGNITO_USER_POOL_ID không hợp lệ.');
  const domain = new URL(required('COGNITO_DOMAIN'));
  if (
    domain.protocol !== 'https:' ||
    domain.pathname !== '/' ||
    domain.search ||
    domain.hash ||
    domain.username ||
    domain.password
  ) {
    throw new Error('COGNITO_DOMAIN phải là HTTPS origin, không chứa path hoặc credentials.');
  }
  return {
    provider,
    cognito: {
      userPoolId,
      clientId: required('COGNITO_CLIENT_ID'),
      domain: domain.origin,
      authority: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
      scope: 'openid email profile',
    },
  };
}
