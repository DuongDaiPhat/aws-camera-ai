// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Camera } from '@/types';
import { DashboardOverview } from './DashboardOverview';
import { fetchCameraDebugStream } from '@/lib/cameras-client';
vi.mock('@/lib/cameras-client', () => ({
  fetchCameraDebugStream: vi.fn(async () => ({ streamUrl: '/ready-stream' })),
}));
const cameras = Array.from(
  { length: 9 },
  (_, i) =>
    ({
      id: `c${i + 1}`,
      name: `Camera ${i + 1}`,
      isEnabled: true,
      runtimeStatus: 'OFFLINE',
    }) as Camera,
);
vi.mock('@/hooks/useCameras', () => ({
  useCameras: () => ({
    cameras,
    selectedCamera: cameras[0],
    selectCamera: vi.fn(),
    isLoading: false,
    error: null,
    loadCameras: vi.fn(),
    toggleCamera: vi.fn(),
    toggleLoadingMap: {},
  }),
}));
vi.mock('@/hooks/useCameraSnapshot', () => ({ useCameraSnapshot: () => ({ preview: null }) }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const tiles = () => host.querySelectorAll('article[id^="live-"]');
it('uses saved area order for all layouts, paging and custom counts', async () => {
  localStorage.setItem('cameraai.dashboard.camera-order.a', JSON.stringify(['c9', 'c3']));
  await act(async () =>
    root.render(<DashboardOverview userId="a" isAdmin onNavigate={() => {}} />),
  );
  expect(tiles()).toHaveLength(2);
  expect(tiles()[0]!.id).toBe('live-c9');
  expect(tiles()[1]!.id).toBe('live-c3');
  async function selectLayout(value: string) {
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Số camera hiển thị"]')!.click(),
    );
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent === value)!
        .click(),
    );
  }
  for (const n of [1, 2, 4, 6, 8]) {
    await selectLayout(`${n} camera`);
    expect(tiles()).toHaveLength(n);
    expect(tiles()[0]!.id).toBe('live-c9');
  }
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Lưới camera sau"]')!.click(),
  );
  expect(tiles()).toHaveLength(1);
  await selectLayout('Tùy chỉnh');
  expect(tiles()).toHaveLength(3);
  expect(host.textContent).not.toContain('Đang xem');
  expect(host.textContent).not.toContain('Camera của bạn');
});
it('requests and exits fullscreen on the actual grid element', async () => {
  await act(async () => root.render(<DashboardOverview isAdmin onNavigate={() => {}} />));
  const panel = host.querySelector<HTMLElement>('#camera-monitor')!;
  const request = vi.fn(async () => {});
  panel.requestFullscreen = request;
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Phóng to lưới camera"]')!.click(),
  );
  expect(request).toHaveBeenCalledOnce();
  const exit = vi.fn(async () => {});
  Object.defineProperty(document, 'fullscreenElement', { value: panel, configurable: true });
  document.exitFullscreen = exit;
  await act(async () => document.dispatchEvent(new Event('fullscreenchange')));
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Thu nhỏ lưới camera"]')!.click(),
  );
  expect(exit).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
});
it('falls back to an accessible expanded view when native fullscreen is unavailable', async () => {
  await act(async () => root.render(<DashboardOverview isAdmin onNavigate={() => {}} />));
  host.querySelector<HTMLElement>('#camera-monitor')!.requestFullscreen = vi.fn(async () => {
    throw new Error('unsupported');
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Phóng to lưới camera"]')!.click(),
  );
  expect(
    document.querySelector('[role="dialog"][aria-label="Camera toàn màn hình"]'),
  ).not.toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Đóng camera toàn màn hình"]')!.click(),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('#camera-monitor')).not.toBeNull();
});

it('restores fixed and custom layouts after remount and isolates accounts', async () => {
  async function show(userId: string, mountKey: string) {
    await act(async () =>
      root.render(
        <DashboardOverview key={mountKey} userId={userId} isAdmin onNavigate={() => {}} />,
      ),
    );
  }
  async function select(value: string) {
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Số camera hiển thị"]')!.click(),
    );
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent === value)!
        .click(),
    );
  }
  await show('account-a', 'first');
  await select('1 camera');
  expect(tiles()).toHaveLength(1);
  await show('account-a', 'reload');
  expect(tiles()).toHaveLength(1);
  await select('Tùy chỉnh');
  const input = host.querySelector<HTMLInputElement>('[aria-label="Số camera tùy chỉnh"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(tiles()).toHaveLength(5);
  await show('account-a', 'reload-custom');
  expect(tiles()).toHaveLength(5);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Số camera tùy chỉnh"]')!.value).toBe(
    '5',
  );
  await show('account-b', 'other');
  expect(tiles()).toHaveLength(2);
  await select('8 camera');
  await show('account-a', 'back');
  expect(tiles()).toHaveLength(5);
  expect(
    JSON.parse(localStorage.getItem('cameraai.dashboard.camera-layout.account-b')!).layout,
  ).toBe('8');
});
it('recovers from invalid preferences without overwriting saved data on first load', async () => {
  const key = 'cameraai.dashboard.camera-layout.bad';
  localStorage.setItem(key, '{bad json');
  await act(async () =>
    root.render(<DashboardOverview userId="bad" isAdmin onNavigate={() => {}} />),
  );
  expect(tiles()).toHaveLength(2);
  expect(localStorage.getItem(key)).toBe('{bad json');
});

it('waits for an online camera before opening its stream', async () => {
  vi.mocked(fetchCameraDebugStream).mockClear();
  const original = cameras[0]!;
  try {
    cameras[0] = { ...original, runtimeStatus: 'STARTING' };
    await act(async () => root.render(<DashboardOverview isAdmin onNavigate={() => {}} />));
    expect(fetchCameraDebugStream).not.toHaveBeenCalled();
    expect(host.querySelector('iframe')).toBeNull();
    cameras[0] = { ...original, runtimeStatus: 'ONLINE' };
    await act(async () => root.render(<DashboardOverview isAdmin onNavigate={() => {}} />));
    expect(fetchCameraDebugStream).toHaveBeenCalledWith(original.id);
    expect(host.querySelector('iframe')?.getAttribute('src')).toBe('/ready-stream');
  } finally {
    cameras[0] = original;
  }
});
