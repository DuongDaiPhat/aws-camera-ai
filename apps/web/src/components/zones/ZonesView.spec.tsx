// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZonesView } from './ZonesView';
import { retryFrigateSync } from '@/lib/cameras-client';
const m = vi.hoisted(() => ({
  cameras: vi.fn(),
  zones: vi.fn(),
  snapshot: vi.fn(),
  select: vi.fn(),
  load: vi.fn(),
  add: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/hooks', () => ({
  useCameras: m.cameras,
  useZones: m.zones,
  useCameraSnapshot: m.snapshot,
}));
vi.mock('@/lib/cameras-client', () => ({ retryFrigateSync: vi.fn() }));
vi.mock('./CameraZonePreview', () => ({
  CameraZonePreview: ({
    onSelectZone,
    onAddPoint,
    onMovePoint,
    canDraw,
  }: {
    onSelectZone: (id: string) => void;
    onAddPoint: (p: [number, number]) => void;
    onMovePoint: (i: number, p: [number, number]) => void;
    canDraw: boolean;
  }) => (
    <div>
      Preview drawing:{String(canDraw)}
      <button onClick={() => onSelectZone('z1')}>Preview select</button>
      <button
        onClick={() => {
          onAddPoint([0, 0]);
        }}
      >
        Point 1
      </button>
      <button onClick={() => onAddPoint([1, 0])}>Point 2</button>
      <button onClick={() => onAddPoint([1, 1])}>Point 3</button>
      <button onClick={() => onMovePoint(0, [0.1, 0.1])}>Move point</button>
    </div>
  ),
}));
let host: HTMLDivElement, root: Root;
const zone = {
  id: 'z1',
  name: 'Kitchen',
  slug: 'kitchen',
  zoneType: 'RESTRICTED',
  polygon: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  minDwellSeconds: 2,
  activeFrom: null,
  activeTo: null,
  isEnabled: true,
};
const camera = {
  id: 'cam',
  name: 'Camera 1',
  runtimeStatus: 'ONLINE',
  frigateSync: { status: 'FAILED' },
};
let zonesState: Record<string, unknown>,
  cameraState: Record<string, unknown>,
  snapshotState: Record<string, unknown>;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  zonesState = {
    zones: [zone],
    isLoading: false,
    error: null,
    add: m.add,
    save: m.save,
    remove: m.remove,
    reload: m.reload,
  };
  cameraState = {
    cameras: [camera, { ...camera, id: 'other', name: 'Other', runtimeStatus: 'OFFLINE' }],
    selectedCamera: camera,
    selectCamera: m.select,
    loadCameras: m.load,
    isLoading: false,
    error: null,
  };
  snapshotState = {
    preview: { url: '/image.jpg' },
    isLoading: false,
    error: null,
    reload: m.reload,
  };
  m.zones.mockImplementation(() => zonesState);
  m.cameras.mockImplementation(() => cameraState);
  m.snapshot.mockImplementation(() => snapshotState);
  m.add.mockResolvedValue(zone);
  m.save.mockResolvedValue(zone);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(role = 'CAREGIVER') {
  await act(async () => root.render(<ZonesView user={{ role } as never} />));
}
async function click(text: string) {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!node) throw Error(`Missing ${text}: ${host.textContent}`);
  await act(async () => node.click());
}
function input(index: number, value: string) {
  const node = host.querySelectorAll('input')[index];
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function selectZone() {
  await click('Preview select');
  expect(host.textContent).toContain('Cả ngày');
  await click('Sửa');
}
async function newZone() {
  await click('+ Thêm vùng');
  input(0, 'Door');
  await click('Point 1');
  await click('Point 2');
  await click('Point 3');
}
it('creates a zone with suggested slug and normalized polygon', async () => {
  await render();
  await newZone();
  expect(host.querySelectorAll('input')[1].value).toBe('door');
  await click('Move point');
  await click('Hoàn tất polygon');
  await click('Lưu vùng');
  expect(m.add).toHaveBeenCalledWith({
    name: 'Door',
    zoneType: 'RESTRICTED',
    polygon: [
      [0.1, 0.1],
      [1, 0],
      [1, 1],
    ],
    minDwellSeconds: 2,
    activeFrom: null,
    activeTo: null,
    slug: 'door',
  });
  expect(m.load).toHaveBeenCalled();
  expect(host.querySelector('form')).toBeNull();
});
it('preserves manually entered slugs while changing a name and cancels drawings', async () => {
  await render();
  await click('+ Thêm vùng');
  input(1, 'custom_zone');
  input(0, 'Door');
  expect(host.querySelectorAll('input')[1].value).toBe('custom_zone');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await click('Hủy');
  expect(host.querySelector('form')).toBeNull();
});
it('edits an existing zone and deletes it only after confirmation', async () => {
  await render();
  await selectZone();
  input(0, 'Edited');
  await click('Lưu vùng');
  expect(m.save).toHaveBeenCalledWith(
    'z1',
    expect.objectContaining({ name: 'Edited', isEnabled: true }),
  );
  await click('Sửa');
  await click('Xóa vùng');
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await click('Giữ lại');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('Xóa vùng');
  const buttons = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Xóa vùng');
  await act(async () => buttons[buttons.length - 1].click());
  expect(m.remove).toHaveBeenCalledWith('z1');
  expect(host.querySelector('form')).toBeNull();
});
it.each([new Error('Denied'), 'bad'])(
  'reports save/delete/sync errors without losing edits',
  async (error) => {
    await render();
    m.save.mockRejectedValue(error);
    await selectZone();
    await click('Lưu vùng');
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thể lưu vùng');
    m.remove.mockRejectedValue(error);
    await click('Xóa vùng');
    const buttons = [...host.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Xóa vùng',
    );
    await act(async () => buttons[buttons.length - 1].click());
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thể xóa vùng');
    await click('Giữ lại');
    await click('Hủy');
    vi.mocked(retryFrigateSync).mockRejectedValue(error);
    await click('Thử lại');
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thể thử đồng bộ');
  },
);
it('retries failed sync and loads cameras after success', async () => {
  await render();
  await click('Thử lại');
  expect(retryFrigateSync).toHaveBeenCalledWith('cam');
  expect(m.load).toHaveBeenCalledOnce();
});
it('requires confirmation before discarding an unsaved drawing on camera or zone change', async () => {
  await render();
  await click('+ Thêm vùng');
  vi.mocked(window.confirm).mockReturnValue(false);
  const other = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Other'),
  )!;
  await act(async () => other.click());
  expect(m.select).not.toHaveBeenCalled();
  await click('KitchenVùng cấmĐang bật');
  expect(host.querySelector('form')).not.toBeNull();
  vi.mocked(window.confirm).mockReturnValue(true);
  await act(async () => other.click());
  expect(m.select).toHaveBeenCalledWith('other');
  await click('KitchenVùng cấmĐang bật');
  expect(host.querySelector('form')).toBeNull();
});
it('shows read-only details, scheduled hours and no administration buttons', async () => {
  zonesState.zones = [{ ...zone, activeFrom: '08:00', activeTo: '18:00' }];
  await render('VIEWER');
  expect(host.textContent).toContain('Bạn có quyền xem');
  expect(host.textContent).not.toContain('+ Thêm vùng');
  await click('Preview select');
  expect(host.textContent).toContain('08:00–18:00');
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Sửa')).toBe(false);
});
it('handles absent cameras, snapshot states and zone loading failures', async () => {
  cameraState.selectedCamera = null;
  cameraState.cameras = [];
  await render();
  expect(host.textContent).toContain('Chưa có camera');
  cameraState.selectedCamera = camera;
  cameraState.error = 'Cameras unavailable';
  snapshotState.preview = null;
  snapshotState.isLoading = true;
  await render();
  expect(host.textContent).toContain('Cameras unavailable');
  expect(host.textContent).toContain('Đang tải ảnh');
  snapshotState.isLoading = false;
  snapshotState.error = 'Snapshot unavailable';
  await render();
  expect(host.textContent).toContain('Snapshot unavailable');
  await click('Tải lại');
  expect(m.reload).toHaveBeenCalledOnce();
  snapshotState.error = null;
  await render();
  expect(host.textContent).toContain('Camera chưa có ảnh');
  zonesState.isLoading = true;
  await render();
  expect(host.textContent).toContain('Đang tải vùng');
  zonesState.isLoading = false;
  zonesState.error = 'Zones unavailable';
  await render();
  expect(host.textContent).toContain('Zones unavailable');
  const retries = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Thử lại');
  await act(async () => retries[retries.length - 1].click());
  expect(m.reload).toHaveBeenCalledTimes(2);
});
