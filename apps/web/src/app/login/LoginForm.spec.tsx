// @vitest-environment jsdom
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';
import { getAuthConfig } from '@/lib/auth-config';
import { startCognitoLogin } from '@/lib/cognito-login';
import { consumeLoginEntrance } from '@/lib/login-entrance';

const { loginMock, replace } = vi.hoisted(() => ({ loginMock: vi.fn(), replace: vi.fn() }));
vi.mock('@/lib/auth-config', () => ({ getAuthConfig: vi.fn(async () => ({ provider: 'jwt' })) }));
vi.mock('@/lib/cognito-login', () => ({ startCognitoLogin: vi.fn(async () => {}) }));
vi.mock('@/lib/auth-client', () => ({ login: loginMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

describe('login form', () => {
  it('prevents submitting credentials through a native GET while JavaScript is loading', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<LoginForm />);
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('Đang tải');
  });

  it('submits the actual autofilled field values and preserves spaces in the password', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    loginMock.mockReset().mockResolvedValue(undefined);
    replace.mockClear();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<LoginForm />));
      const form = host.querySelector('form')!;
      // Browser autofill can update native values without firing a React change event.
      form.querySelector<HTMLInputElement>('[name="email"]')!.value = '  saved@example.test  ';
      form.querySelector<HTMLInputElement>('[name="password"]')!.value = ' password with spaces ';
      await act(async () =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      expect(loginMock).toHaveBeenCalledWith({
        email: 'saved@example.test',
        password: ' password with spaces ',
      });
      expect(replace).toHaveBeenCalledWith('/');
      expect(consumeLoginEntrance()).not.toBeNull();
      expect(consumeLoginEntrance()).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

it('does not schedule an entrance after failed authentication', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  consumeLoginEntrance();
  loginMock.mockReset().mockRejectedValue(new Error('Invalid login'));
  replace.mockClear();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LoginForm />));
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(replace).not.toHaveBeenCalled();
    expect(consumeLoginEntrance()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('starts Cognito without queuing the entrance before callback authentication succeeds', async () => {
  consumeLoginEntrance();
  vi.mocked(getAuthConfig).mockResolvedValueOnce({
    provider: 'cognito',
    cognito: {
      authority: 'https://issuer.invalid/pool',
      clientId: 'client',
      domain: 'https://login.invalid',
      scope: 'openid email profile',
    },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LoginForm />));
    expect(host.querySelector('form')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(startCognitoLogin).toHaveBeenCalledOnce();
    expect(consumeLoginEntrance()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
