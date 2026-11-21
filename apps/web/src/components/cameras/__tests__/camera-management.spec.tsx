// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CameraView } from '../CameraView';
import { CameraList } from '../CameraList';
import { CameraCard } from '../CameraCard';
import type { Camera } from '@/types';
const m = vi.hoisted(() => ({
  cameras: vi.fn(),
  load: vi.fn(),
  select: vi.fn(),
  toggle: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@/hooks/useCameras', () => ({ useCameras: m.cameras }));
vi.mock('../source/webcam-session-manager', () => ({ stopWebcamSession: m.stop }));
vi.mock('../CameraPreview', () => ({ CameraPreview: () => <div>Preview</div> }));
vi.mock('../CameraSourceForm', () => ({
  CameraSourceForm: ({ onSourceUpdated }: { onSourceUpdated: () => void }) => (
    <button onClick={onSourceUpdated}>Source saved</button>
  ),
}));
vi.mock('../CameraSettingsPanel', () => ({
  CameraSettingsPanel: ({ onSynced }: { onSynced: () => void }) => (
    <button onClick={onSynced}>Settings synced</button>
  ),
}));
vi.mock('@/components/household/AddCameraButton', () => ({
  AddCameraButton: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <button onClick={() => onCreated('new')}>Add camera</button>
  ),
}));
vi.mock('../CameraGridView', () => ({
  CameraGridView: ({
    onSelectCamera,
    onSwitchToList,
    onToggleState,
  }: {
    onSelectCamera: (id: string) => void;
    onSwitchToList: (id?: string) => void;
    onToggleState: (id: string, enabled: boolean) => void;
  }) => (
    <div>
      Grid content<button onClick={() => onSelectCamera('cam')}>Grid select</button>
      <button onClick={() => onSwitchToList('cam')}>Grid details</button>
      <button onClick={() => onSwitchToList()}>Grid list</button>
      <button onClick={() => onToggleState('cam', true)}>Grid enable</button>
    </div>
  ),
}));
const camera = {
  id: 'cam',
  name: 'Living',
  slug: 'living_slug',
  isEnabled: true,
  runtimeStatus: 'ONLINE',
  syncStatus: 'SYNCED',
  sourceType: 'RTSP',
  fps: 5,
  detectWidth: 1280,
  detectHeight: 720,
  detectionEnabled: true,
  source: { lastError: null },
  frigateSync: { status: 'SYNCED' },
} as Camera;
let host: HTMLDivElement, root: Root, state: Record<string, unknown>;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.clearAllMocks();
  state = {
    cameras: [
      camera,
      {
        ...camera,
        id: 'failed',
        name: 'Failed',
        isEnabled: false,
        runtimeStatus: 'FAILED',
        frigateSync: { status: 'FAILED' },
      },
    ],
    selectedCamera: camera,
    selectedCameraId: 'cam',
    isLoading: false,
    error: null,
    toggleLoadingMap: {},
    loadCameras: m.load,
    selectCamera: m.select,
    toggleCamera: m.toggle,
  };
  m.cameras.mockImplementation(() => state);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
}
async function click(text: string) {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!node) throw Error(text);
  await act(async () => node.click());
}
function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Tìm camera"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('switches management tabs and layouts, persists choice and forwards camera operations', async () => {
  await render(<CameraView user={{ role: 'CAREGIVER' } as never} />);
  await click('Cấu hình nguồn phát (RTSP)');
  await click('Source saved');
  await click('Cài đặt Frigate & Đồng bộ');
  await click('Settings synced');
  await click('Xem trực tiếp và chẩn đoán');
  await click('Tắt camera');
  expect(m.stop).toHaveBeenCalledWith('cam');
  expect(m.toggle).toHaveBeenCalledWith('cam', false);
  await click('Add camera');
  expect(m.select).toHaveBeenCalledWith('new');
  await click('Lưới toàn bộ cam');
  expect(localStorage.getItem('camerai_view_mode')).toBe('grid');
  await click('Grid select');
  expect(m.select).toHaveBeenLastCalledWith('cam');
  await click('Grid enable');
  expect(m.toggle).toHaveBeenLastCalledWith('cam', true);
  await click('Grid details');
  expect(host.textContent).not.toContain('Grid content');
  await click('Lưới toàn bộ cam');
  await click('Grid list');
  await click('Làm mới');
  expect(m.load.mock.calls.length).toBeGreaterThan(4);
});
it('displays empty selection, loading and retry errors', async () => {
  state.selectedCamera = null;
  state.cameras = [];
  state.error = 'Offline';
  state.isLoading = true;
  await render(<CameraView user={null} />);
  expect(host.textContent).toContain('Vui lòng chọn');
  expect(host.textContent).toContain('Offline');
  await click('Thử lại');
  expect(m.load).toHaveBeenCalledOnce();
});
it('keeps viewer details read-only and hides configuration controls', async () => {
  await render(<CameraView user={{ role: 'VIEWER' } as never} />);
  expect(host.textContent).toContain('Grid content');
  await click('Grid details');
  expect(host.textContent).toContain('Preview');
  expect(host.textContent).not.toContain('Cấu hình nguồn');
  expect(host.textContent).not.toContain('Tắt camera');
});
it('shows disabled toggle and fallback resolution for video sources', async () => {
  state.selectedCamera = {
    ...camera,
    sourceType: 'VIDEO_FILE',
    source: { displayName: 'sample.mp4' },
    detectWidth: 0,
    detectHeight: 0,
    isEnabled: false,
  };
  state.toggleLoadingMap = { cam: true };
  await render(<CameraView user={{ role: 'ADMIN' } as never} />);
  expect(host.textContent).toContain('1280x720');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Bật camera')!.disabled,
  ).toBe(true);
});
it('filters camera list by enabled, disabled and error state, name or slug', async () => {
  const cameras = [
    camera,
    {
      ...camera,
      id: 'off',
      name: 'Bedroom',
      slug: 'sleep',
      isEnabled: false,
      syncStatus: 'FAILED',
      sourceType: 'VIDEO_FILE',
      frigateSync: { status: 'PENDING' },
      detectionEnabled: false,
      source: { lastError: 'Upload failed' },
    },
    {
      ...camera,
      id: 'failed',
      name: 'Entrance',
      runtimeStatus: 'FAILED',
      sourceType: 'BROWSER_WEBCAM',
      frigateSync: { status: 'FAILED' },
    },
  ] as Camera[];
  await render(
    <CameraList
      cameras={cameras}
      selectedId="cam"
      isAdmin
      onSelectCamera={m.select}
      onToggleState={m.toggle}
    />,
  );
  await click('Bật');
  expect(host.textContent).not.toContain('Bedroom');
  await click('Tắt');
  expect(host.textContent).toContain('Bedroom');
  expect(host.textContent).not.toContain('Entrance');
  await click('Lỗi');
  expect(host.textContent).toContain('Bedroom');
  expect(host.textContent).toContain('Entrance');
  expect(host.textContent).not.toContain('Living');
  await click('Tất cả');
  search(' SLEEP ');
  expect(host.textContent).toContain('Bedroom');
  expect(host.textContent).not.toContain('Living');
  search('living');
  expect(host.textContent).toContain('Living');
  search('not-found');
  expect(host.textContent).toContain('Không tìm thấy camera');
});
it('selects cards by keyboard and toggles without propagating a selection click', async () => {
  await render(
    <CameraCard camera={camera} isSelected isAdmin onSelect={m.select} onToggleState={m.toggle} />,
  );
  const card = host.querySelector<HTMLElement>('[role="button"]')!;
  await act(async () => {
    card.click();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(m.select).toHaveBeenCalledTimes(3);
  await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
  expect(m.toggle).toHaveBeenCalledWith('cam', false);
  expect(m.select).toHaveBeenCalledTimes(3);
  await render(
    <CameraCard
      camera={camera}
      isSelected={false}
      isAdmin
      isToggling
      onSelect={m.select}
      onToggleState={m.toggle}
    />,
  );
  expect(host.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
});
