// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCameras } from './useCameras';
import { useCameraSnapshot } from './useCameraSnapshot';
import { usePlaybackArchive, usePlaybackClip } from './usePlaybackArchive';
import { usePlaybackMetadata } from './usePlaybackMetadata';
import * as camerasApi from '@/lib/cameras-client';
import * as playbackApi from '@/lib/playback-client';
import { apiFetch } from '@/lib/api-client';
vi.mock('@/lib/cameras-client', () => ({
  fetchCameras: vi.fn(),
  updateCameraState: vi.fn(),
  fetchCameraSnapshot: vi.fn(),
}));
vi.mock('@/lib/playback-client', () => ({
  listPlaybackCameras: vi.fn(),
  getRecordingDay: vi.fn(),
  getRecordingClip: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.resetAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:clip'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function mount(element: React.ReactElement) {
  await act(async () => root.render(element));
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const camera = { id: 'cam', name: 'Living', isEnabled: true, runtimeStatus: 'ONLINE' };
const segment = { id: 'segment', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-01T00:01:00Z' };

it('selects cameras, refreshes in background and optimistically toggles state', async () => {
  vi.useFakeTimers();
  let state!: ReturnType<typeof useCameras>;
  function Harness() {
    state = useCameras();
    return null;
  }
  vi.mocked(camerasApi.fetchCameras).mockResolvedValue([
    camera,
    { ...camera, id: 'other' },
  ] as never);
  await mount(<Harness />);
  expect(state.selectedCameraId).toBe('cam');
  expect(state.selectedCamera?.id).toBe('cam');
  act(() => state.selectCamera('other'));
  expect(state.selectedCamera?.id).toBe('other');
  act(() => state.selectCamera('missing'));
  expect(state.selectedCamera?.id).toBe('cam');
  const pending = deferred<never>();
  vi.mocked(camerasApi.updateCameraState).mockReturnValue(pending.promise);
  let result!: Promise<boolean>;
  act(() => {
    result = state.toggleCamera('cam');
  });
  expect(state.cameras[0].isEnabled).toBe(false);
  expect(state.cameras[0].runtimeStatus).toBe('DISABLED');
  expect(state.toggleLoadingMap.cam).toBe(true);
  await act(async () => {
    pending.resolve({ ...camera, isEnabled: false } as never);
    expect(await result).toBe(true);
  });
  expect(state.toggleLoadingMap).toEqual({});
  expect(state.cameras[1].id).toBe('other');
  vi.mocked(camerasApi.updateCameraState).mockResolvedValue(camera as never);
  await act(async () => {
    expect(await state.toggleCamera('cam', true)).toBe(true);
  });
  expect(camerasApi.updateCameraState).toHaveBeenLastCalledWith('cam', true);
  await expect(state.toggleCamera('unknown')).resolves.toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(camerasApi.fetchCameras).toHaveBeenCalledTimes(2);
  await mount(<div />);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([new Error('Denied'), 'bad'])(
  'rolls back failed camera toggles and reports load errors',
  async (error) => {
    let state!: ReturnType<typeof useCameras>;
    function Harness() {
      state = useCameras('cam');
      return null;
    }
    vi.mocked(camerasApi.fetchCameras).mockResolvedValue([
      camera,
      { ...camera, id: 'other' },
    ] as never);
    await mount(<Harness />);
    vi.mocked(camerasApi.updateCameraState).mockRejectedValue(error);
    await act(async () => {
      expect(await state.toggleCamera('cam', false)).toBe(false);
    });
    expect(state.cameras[0]).toEqual(camera);
    expect(state.error).toContain(error instanceof Error ? 'Denied' : 'Cập nhật trạng thái');
    vi.mocked(camerasApi.fetchCameras).mockRejectedValue(error);
    await act(async () => state.loadCameras());
    expect(state.error).toContain(error instanceof Error ? 'Denied' : 'Không thể tải danh sách');
    expect(state.isLoading).toBe(false);
  },
);
it('handles an empty camera registry', async () => {
  let state!: ReturnType<typeof useCameras>;
  function Harness() {
    state = useCameras();
    return null;
  }
  vi.mocked(camerasApi.fetchCameras).mockResolvedValue([]);
  await mount(<Harness />);
  expect(state.selectedCamera).toBeNull();
  expect(state.selectedCameraId).toBeNull();
});

it('freezes zone snapshots while editing and refreshes before expiry', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  let state!: ReturnType<typeof useCameraSnapshot>;
  function Harness({ id = 'cam', frozen = false }: { id?: string | null; frozen?: boolean }) {
    state = useCameraSnapshot(id, frozen);
    return null;
  }
  vi.mocked(camerasApi.fetchCameraSnapshot).mockResolvedValue({
    url: '/preview',
    expiresAt: '2026-01-01T00:01:00Z',
  } as never);
  await mount(<Harness />);
  expect(state.preview?.url).toBe('/preview');
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(camerasApi.fetchCameraSnapshot).toHaveBeenCalledTimes(2);
  await mount(<Harness frozen />);
  await act(async () => state.reload());
  expect(camerasApi.fetchCameraSnapshot).toHaveBeenCalledTimes(2);
  expect(state.preview?.url).toBe('/preview');
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(camerasApi.fetchCameraSnapshot).toHaveBeenCalledTimes(2);
  await mount(<Harness id={null} />);
  expect(state.preview).toBeNull();
  await mount(<Harness id="other" />);
  expect(camerasApi.fetchCameraSnapshot).toHaveBeenLastCalledWith('other');
});
it('ignores stale snapshot loads and exposes retry errors', async () => {
  let state!: ReturnType<typeof useCameraSnapshot>;
  function Harness({ id }: { id: string }) {
    state = useCameraSnapshot(id, false);
    return null;
  }
  const old = deferred<never>(),
    current = deferred<never>();
  vi.mocked(camerasApi.fetchCameraSnapshot)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  await mount(<Harness id="old" />);
  await mount(<Harness id="new" />);
  await act(async () => old.reject(new Error('stale')));
  expect(state.error).toBeNull();
  expect(state.isLoading).toBe(true);
  await act(async () => current.resolve({ url: '/new' } as never));
  expect(state.preview?.url).toBe('/new');
  vi.mocked(camerasApi.fetchCameraSnapshot)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce('bad');
  await act(async () => state.reload());
  expect(state.error).toBe('offline');
  expect(state.preview).toBeNull();
  await act(async () => state.reload());
  expect(state.error).toContain('Không thể tải ảnh');
  const stale = deferred<never>();
  vi.mocked(camerasApi.fetchCameraSnapshot)
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValue({ url: '/latest' } as never);
  await mount(<Harness id="third" />);
  await mount(<Harness id="fourth" />);
  await act(async () => stale.resolve({ url: '/stale' } as never));
  expect(state.preview?.url).toBe('/latest');
});

it('loads a recording archive, retains selected cameras on retry and changes date', async () => {
  let state!: ReturnType<typeof usePlaybackArchive>;
  function Harness({ date = '2026-01-01' }) {
    state = usePlaybackArchive(date);
    return null;
  }
  vi.mocked(playbackApi.listPlaybackCameras).mockResolvedValue({
    data: [{ id: 'cam' }, { id: 'other' }],
  } as never);
  vi.mocked(playbackApi.getRecordingDay).mockImplementation(
    async (cameraId, date) => ({ cameraId, date, segments: [] }) as never,
  );
  await mount(<Harness />);
  expect(state.cameraId).toBe('cam');
  expect(state.day?.date).toBe('2026-01-01');
  expect(state.loading).toBe(false);
  await act(async () => state.setCameraId('other'));
  expect(state.day?.cameraId).toBe('other');
  await act(async () => state.retry());
  expect(state.cameraId).toBe('other');
  await mount(<Harness date="2026-01-02" />);
  expect(state.day?.date).toBe('2026-01-02');
});
it.each([new Error('offline'), 'bad'])(
  'reports recording archive errors and retries',
  async (error) => {
    let state!: ReturnType<typeof usePlaybackArchive>;
    function Harness() {
      state = usePlaybackArchive('2026-01-01');
      return null;
    }
    vi.mocked(playbackApi.listPlaybackCameras)
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ data: [{ id: 'cam' }] } as never);
    vi.mocked(playbackApi.getRecordingDay).mockRejectedValue(error);
    await mount(<Harness />);
    expect(state.error).toContain(error instanceof Error ? 'offline' : 'Không thể tải bản ghi');
    await act(async () => state.retry());
    expect(state.error).toContain(error instanceof Error ? 'offline' : 'Không thể tải bản ghi');
    expect(state.loading).toBe(false);
  },
);
it('aborts stale camera/day requests on transition', async () => {
  let state!: ReturnType<typeof usePlaybackArchive>;
  function Harness({ date = '2026-01-01' }) {
    state = usePlaybackArchive(date);
    return null;
  }
  const old = deferred<never>();
  vi.mocked(playbackApi.listPlaybackCameras).mockResolvedValue({ data: [{ id: 'cam' }] } as never);
  vi.mocked(playbackApi.getRecordingDay)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ cameraId: 'cam', date: '2026-01-02' } as never);
  await mount(<Harness />);
  await mount(<Harness date="2026-01-02" />);
  await act(async () => old.resolve({ cameraId: 'cam', date: '2026-01-01' } as never));
  expect(state.day?.date).toBe('2026-01-02');
});
it('creates and releases clip URLs and retries failed downloads', async () => {
  let state!: ReturnType<typeof usePlaybackClip>;
  function Harness({ selected = segment }: { selected?: typeof segment | null }) {
    state = usePlaybackClip('cam', selected as never);
    return null;
  }
  vi.mocked(playbackApi.getRecordingClip).mockResolvedValue(new Blob(['video']));
  await mount(<Harness />);
  expect(state.url).toBe('blob:clip');
  expect(state.loading).toBe(false);
  await mount(<Harness selected={null} />);
  expect(state.url).toBe('');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip');
  vi.mocked(playbackApi.getRecordingClip)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce('bad')
    .mockResolvedValue(new Blob());
  await mount(<Harness />);
  expect(state.error).toBe('offline');
  await act(async () => state.retry());
  expect(state.error).toContain('Không thể tải bản ghi');
  await act(async () => state.retry());
  expect(state.error).toBe('');
  expect(state.url).toBe('blob:clip');
});
it('discards a clip downloaded after cancellation', async () => {
  let state!: ReturnType<typeof usePlaybackClip>;
  function Harness({ selected = segment }: { selected?: typeof segment | null }) {
    state = usePlaybackClip('cam', selected as never);
    return null;
  }
  const old = deferred<Blob>();
  vi.mocked(playbackApi.getRecordingClip).mockReturnValue(old.promise);
  await mount(<Harness />);
  await mount(<Harness selected={null} />);
  await act(async () => old.resolve(new Blob()));
  expect(state.url).toBe('');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('loads recording metadata by range and discards data from the old segment', async () => {
  let state!: ReturnType<typeof usePlaybackMetadata>;
  function Harness({ selected = segment }: { selected?: typeof segment | null }) {
    state = usePlaybackMetadata('cam', selected as never);
    return null;
  }
  vi.mocked(apiFetch).mockResolvedValue({ frames: [] });
  await mount(<Harness />);
  expect(state.metadata).toEqual({ frames: [] });
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining('/playback/cameras/cam/metadata?startAt='),
    { signal: expect.any(AbortSignal) },
  );
  await mount(<Harness selected={null} />);
  expect(state.metadata).toBeNull();
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
  await mount(<Harness />);
  expect(state.error).toBe('offline');
  await mount(<Harness selected={null} />);
  vi.mocked(apiFetch).mockRejectedValueOnce('bad');
  await mount(<Harness />);
  expect(state.error).toContain('Chưa tải được dữ liệu');
});
