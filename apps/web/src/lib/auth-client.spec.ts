import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logout } from './auth-client';

const mocks = vi.hoisted(() => ({
  revokeTokens: vi.fn(),
  removeUser: vi.fn(),
  assign: vi.fn(),
  setAccessToken: vi.fn(),
  clearBrowserSession: vi.fn(),
}));

vi.mock('./api-client', () => ({ apiFetch: vi.fn(), setAccessToken: mocks.setAccessToken }));
vi.mock('./auth-session', () => ({
  clearBrowserSession: mocks.clearBrowserSession,
  markBrowserSession: vi.fn(),
}));
vi.mock('./auth-config', () => ({
  getAuthConfig: async () => ({
    provider: 'cognito',
    cognito: { domain: 'https://auth.example.test', clientId: 'test-client' },
  }),
}));
vi.mock('./cognito-session', () => ({ getCognitoManager: async () => mocks }));

describe('Cognito logout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000', assign: mocks.assign },
    });
  });

  it.each([false, true])(
    'clears both sessions when revocation fails: %s',
    async (revocationFails) => {
      if (revocationFails)
        mocks.revokeTokens.mockRejectedValue(new Error('revocation unavailable'));

      await expect(logout()).resolves.toBe('redirect');

      expect(mocks.removeUser).toHaveBeenCalledOnce();
      expect(mocks.setAccessToken).toHaveBeenCalledWith(null);
      expect(mocks.clearBrowserSession).toHaveBeenCalledOnce();
      const url = new URL(mocks.assign.mock.calls[0][0]);
      expect(url.origin).toBe('https://auth.example.test');
      expect(url.pathname).toBe('/logout');
      expect(url.searchParams.get('client_id')).toBe('test-client');
      expect(url.searchParams.get('logout_uri')).toBe('http://localhost:3000');
    },
  );
});
