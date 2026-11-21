// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import LoginPage, { metadata } from './page';
vi.mock('./LoginForm', () => ({
  LoginForm: () => (
    <form aria-label="Đăng nhập tài khoản">
      <input type="email" />
    </form>
  ),
}));
it('presents the sign-in form with accessible product context and concrete capabilities', () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const host = document.createElement('div'),
    root = createRoot(host);
  try {
    act(() => root.render(<LoginPage />));
    expect(metadata.title).toBe('Đăng nhập | CameraAI');
    expect(host.querySelector('main')).not.toBeNull();
    expect(host.querySelector('[aria-labelledby="login-title"] form')).not.toBeNull();
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(host.textContent).toContain('Phát hiện té ngã');
    expect(host.textContent).toContain('Nhận diện người quen');
    expect(host.textContent).toContain('Cảnh báo Telegram');
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Cụm quang học CameraAI',
    );
  } finally {
    act(() => root.unmount());
  }
});
