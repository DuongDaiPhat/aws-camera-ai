// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth';
const auth = vi.hoisted(() => ({
  user: vi.fn(),
  logout: vi.fn(),
  stop: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({ getCurrentUser: auth.user, logout: auth.logout }));
vi.mock('@/components/cameras/source/webcam-session-manager', () => ({
  stopAllWebcamSessions: auth.stop,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: auth.replace, refresh: auth.refresh }),
}));
let host: HTMLDivElement, root: Root, latest: ReturnType<typeof useAuth>;
function Probe() {
  latest = useAuth();
  return <span>{latest.user?.fullName ?? (latest.isLoading ? 'loading' : 'anonymous')}</span>;
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function mount() {
  await act(async () => root.render(<Probe />));
}

it('loads the user, refreshes on profile update and removes its listener on unmount', async () => {
  auth.user
    .mockResolvedValueOnce({ fullName: 'Lan' })
    .mockResolvedValueOnce({ fullName: 'Mai' })
    .mockRejectedValue(new Error('offline'));
  await mount();
  expect(host.textContent).toBe('Lan');
  expect(latest.isLoading).toBe(false);
  await act(async () => window.dispatchEvent(new Event('camerai-profile-updated')));
  expect(host.textContent).toBe('Mai');
  await act(async () => window.dispatchEvent(new Event('camerai-profile-updated')));
  expect(host.textContent).toBe('Mai');
  act(() => root.render(<div />));
  window.dispatchEvent(new Event('camerai-profile-updated'));
  expect(auth.user).toHaveBeenCalledTimes(3);
});
it('handles unauthenticated requests and ignores an initial response after unmount', async () => {
  auth.user.mockRejectedValueOnce(new Error('unauthorized'));
  await mount();
  expect(host.textContent).toBe('anonymous');
  act(() => root.render(<div />));
  let resolve: (value: unknown) => void = () => {};
  auth.user.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  expect(latest.isLoading).toBe(true);
  act(() => root.render(<div>left</div>));
  await act(async () => resolve({ fullName: 'Too late' }));
  expect(host.textContent).toBe('left');
});
it.each(['local', 'redirect', 'error'])(
  'stops webcam sessions before %s logout and handles navigation',
  async (mode) => {
    auth.user.mockResolvedValue(null);
    if (mode === 'error') auth.logout.mockRejectedValue(new Error('revoke failed'));
    else auth.logout.mockResolvedValue(mode);
    await mount();
    await act(async () => latest.handleLogout());
    expect(auth.stop).toHaveBeenCalledOnce();
    expect(auth.stop.mock.invocationCallOrder[0]).toBeLessThan(
      auth.logout.mock.invocationCallOrder[0],
    );
    if (mode === 'redirect') {
      expect(auth.replace).not.toHaveBeenCalled();
      expect(auth.refresh).not.toHaveBeenCalled();
    } else {
      expect(auth.replace).toHaveBeenCalledWith('/login');
      expect(auth.refresh).toHaveBeenCalledOnce();
    }
  },
);
