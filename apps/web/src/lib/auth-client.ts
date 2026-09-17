import type { components } from '@cam/contracts';
import { apiFetch, setAccessToken } from './api-client';
import { clearBrowserSession, markBrowserSession } from './auth-session';

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

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
  setAccessToken(null);
  clearBrowserSession();
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/me');
}
