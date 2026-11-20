// @vitest-environment jsdom
import { User } from 'oidc-client-ts';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import CallbackPage from './page';
import { completeCognitoLogin } from '@/lib/cognito-session';
import { consumeLoginEntrance } from '@/lib/login-entrance';
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock('@/lib/cognito-session', () => ({ completeCognitoLogin: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ setAccessToken: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('Cognito login entrance', () => {
  beforeEach(() => {
    consumeLoginEntrance();
    replace.mockReset();
    vi.mocked(completeCognitoLogin).mockReset();
  });
  it('queues the same one-use entrance only after a successful callback', async () => {
    let resolve: (value: User) => void = () => {};
    vi.mocked(completeCognitoLogin).mockReturnValue(
      new Promise<User>((r) => {
        resolve = r;
      }) as ReturnType<typeof completeCognitoLogin>,
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<CallbackPage />));
      expect(consumeLoginEntrance()).toBeNull();
      await act(async () =>
        resolve(
          new User({
            access_token: 'test-access-token',
            token_type: 'Bearer',
            profile: {
              sub: 'subject',
              iss: 'https://issuer.invalid',
              aud: 'client',
              iat: 1,
              exp: 9999999999,
            },
          }),
        ),
      );
      expect(replace).toHaveBeenCalledWith('/');
      expect(consumeLoginEntrance()).not.toBeNull();
      expect(consumeLoginEntrance()).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it('does not queue an entrance on callback failure', async () => {
    vi.mocked(completeCognitoLogin).mockRejectedValue(new Error('Invalid callback'));
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<CallbackPage />));
      expect(consumeLoginEntrance()).toBeNull();
      expect(replace).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Không hoàn tất');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
