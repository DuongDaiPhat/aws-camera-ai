// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthConfig } from './auth-config';

const oidc = vi.hoisted(() => ({
  settings: vi.fn(),
  store: vi.fn(),
  getUser: vi.fn(),
  signinSilent: vi.fn(),
  callback: vi.fn(),
  redirect: vi.fn(),
  config: vi.fn(),
}));
vi.mock('./auth-config', () => ({ getAuthConfig: oidc.config }));
vi.mock('oidc-client-ts', () => ({
  WebStorageStateStore: class {
    constructor(settings: unknown) {
      oidc.store(settings);
    }
  },
  UserManager: class {
    constructor(settings: unknown) {
      oidc.settings(settings);
    }
    getUser = oidc.getUser;
    signinSilent = oidc.signinSilent;
    signinRedirectCallback = oidc.callback;
    signinRedirect = oidc.redirect;
  },
}));
const config = {
  provider: 'cognito',
  cognito: {
    authority: 'https://identity.example.test',
    clientId: 'camera-client',
    domain: 'identity.example.test',
    scope: 'openid email',
  },
} satisfies AuthConfig;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  oidc.config.mockResolvedValue(config);
  window.history.replaceState({}, '', '/auth/callback?code=one');
});
afterEach(() => vi.restoreAllMocks());

it('rejects non-Cognito/missing settings and configures session storage and PKCE', async () => {
  const { getCognitoManager } = await import('./cognito-session');
  await expect(getCognitoManager({ provider: 'jwt' })).rejects.toThrow('không dùng Cognito');
  await expect(getCognitoManager({ provider: 'cognito' } as AuthConfig)).rejects.toThrow(
    'không dùng Cognito',
  );
  await getCognitoManager();
  expect(oidc.settings).toHaveBeenCalledWith(
    expect.objectContaining({
      authority: config.cognito!.authority,
      client_id: 'camera-client',
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: 'code',
      scope: 'openid email',
      disablePKCE: false,
      automaticSilentRenew: false,
      monitorSession: false,
      loadUserInfo: false,
    }),
  );
  expect(oidc.store).toHaveBeenCalledTimes(2);
  expect(oidc.store).toHaveBeenCalledWith({ store: window.sessionStorage });
});

it('reuses the manager for one authority/client and replaces it when the client changes', async () => {
  const { getCognitoManager } = await import('./cognito-session');
  const first = await getCognitoManager(config);
  expect(await getCognitoManager(config)).toBe(first);
  const changed = await getCognitoManager({
    ...config,
    cognito: { ...config.cognito!, clientId: 'other-client' },
  });
  expect(changed).not.toBe(first);
  expect(oidc.settings).toHaveBeenCalledTimes(2);
});

it('completes each callback URL once even if mounted concurrently', async () => {
  const user = { access_token: 'token' };
  oidc.callback.mockResolvedValue(user);
  const { completeCognitoLogin } = await import('./cognito-session');
  const first = completeCognitoLogin(),
    second = completeCognitoLogin();
  expect(first).toBe(second);
  expect(await first).toBe(user);
  expect(oidc.callback).toHaveBeenCalledTimes(1);
  expect(oidc.callback).toHaveBeenCalledWith(window.location.href);
  window.history.replaceState({}, '', '/auth/callback?code=two');
  await completeCognitoLogin();
  expect(oidc.callback).toHaveBeenCalledTimes(2);
});

it('requires a refresh token and a successful renewed access token', async () => {
  const { refreshCognitoToken } = await import('./cognito-session');
  oidc.getUser
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({})
    .mockResolvedValue({ refresh_token: 'refresh' });
  await expect(refreshCognitoToken(config)).rejects.toThrow('đã hết hạn');
  await expect(refreshCognitoToken(config)).rejects.toThrow('đã hết hạn');
  expect(oidc.signinSilent).not.toHaveBeenCalled();
  oidc.signinSilent
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ access_token: 'renewed' });
  await expect(refreshCognitoToken(config)).rejects.toThrow('Không làm mới');
  await expect(refreshCognitoToken(config)).rejects.toThrow('Không làm mới');
  await expect(refreshCognitoToken(config)).resolves.toBe('renewed');
});

it('starts login with a fresh nonce and propagates redirect failures', async () => {
  const nonce = '9c8f31ae-819b-4b76-9277-5911e0918a45';
  vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(nonce);
  const { startCognitoLogin } = await import('./cognito-login');
  await startCognitoLogin();
  expect(oidc.redirect).toHaveBeenCalledWith({ nonce });
  oidc.redirect.mockRejectedValueOnce(new Error('redirect failed'));
  await expect(startCognitoLogin()).rejects.toThrow('redirect failed');
});
