import type { components } from '@cam/contracts';
import { apiFetch, setAccessToken } from './api-client';
import { clearBrowserSession, markBrowserSession } from './auth-session';
import { getAuthConfig } from './auth-config';
import { getCognitoManager } from './cognito-session';

export type LoginRequest = components['schemas']['LoginRequest'];
export type AuthTokens = components['schemas']['AuthTokens'];
export type CurrentUser = components['schemas']['User'];

export async function login(credentials: LoginRequest): Promise<AuthTokens> {
  const session = await apiFetch<AuthTokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  setAccessToken(session.accessToken);
  markBrowserSession();
  return session;
}

export async function logout(): Promise<'redirect' | void> {
  const config = await getAuthConfig();
  if (config.provider === 'cognito' && config.cognito) {
    const manager = await getCognitoManager(config);
    try {
      await manager.revokeTokens(['refresh_token']);
    } finally {
      await manager.removeUser();
      setAccessToken(null);
      clearBrowserSession();
    }
    const url = new URL(`${config.cognito.domain}/logout`);
    url.searchParams.set('client_id', config.cognito.clientId);
    url.searchParams.set('logout_uri', window.location.origin);
    window.location.assign(url.toString());
    return 'redirect';
  }
  await apiFetch<void>('/auth/logout', { method: 'POST' });
  setAccessToken(null);
  clearBrowserSession();
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/me');
}
