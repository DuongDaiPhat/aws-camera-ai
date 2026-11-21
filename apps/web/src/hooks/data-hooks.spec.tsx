// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useZones } from './useZones';
import { useHousehold } from './useHousehold';
import { useEventStats } from './useEventStats';
import { useEvidenceUrl } from './useEvidenceUrl';
import * as zones from '@/lib/zones-client';
import { getHousehold } from '@/lib/household-client';
import { fetchEventStats } from '@/lib/events-client';
vi.mock('@/lib/zones-client', () => ({
  fetchZones: vi.fn(),
  createZone: vi.fn(),
  updateZone: vi.fn(),
  deleteZone: vi.fn(),
}));
vi.mock('@/lib/household-client', () => ({ getHousehold: vi.fn() }));
vi.mock('@/lib/events-client', () => ({ fetchEventStats: vi.fn() }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.resetAllMocks();
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

it('loads and mutates zone state while preserving unaffected entries', async () => {
  let state!: ReturnType<typeof useZones>;
  function Harness({ id }: { id: string | null }) {
    state = useZones(id);
    return null;
  }
  vi.mocked(zones.fetchZones).mockResolvedValue([
    { id: 'b', name: 'Bedroom' },
    { id: 'c', name: 'Corridor' },
  ] as never);
  await mount(<Harness id="cam" />);
  expect(state.isLoading).toBe(false);
  expect(state.zones).toHaveLength(2);
  vi.mocked(zones.createZone).mockResolvedValue({ id: 'a', name: 'Atrium' } as never);
  await act(async () => {
    expect(await state.add({} as never)).toEqual({ id: 'a', name: 'Atrium' });
  });
  expect(state.zones.map((z) => z.id)).toEqual(['a', 'b', 'c']);
  vi.mocked(zones.updateZone).mockResolvedValue({ id: 'b', name: 'Balcony' } as never);
  await act(async () => {
    await state.save('b', { name: 'Balcony' });
  });
  expect(state.zones[1].name).toBe('Balcony');
  await act(async () => state.remove('b'));
  expect(state.zones.map((z) => z.id)).toEqual(['a', 'c']);
  expect(zones.deleteZone).toHaveBeenCalledWith('b');
  await mount(<Harness id={null} />);
  expect(state.zones).toEqual([]);
  await expect(state.add({} as never)).rejects.toThrow('Chưa chọn camera');
});

it('ignores stale zone responses and exposes retryable load errors', async () => {
  let state!: ReturnType<typeof useZones>;
  function Harness({ id }: { id: string }) {
    state = useZones(id);
    return null;
  }
  const old = deferred<never>(),
    current = deferred<never>();
  vi.mocked(zones.fetchZones).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await mount(<Harness id="old" />);
  expect(state.isLoading).toBe(true);
  await mount(<Harness id="new" />);
  await act(async () => old.reject(new Error('stale')));
  expect(state.error).toBeNull();
  expect(state.isLoading).toBe(true);
  await act(async () => current.resolve([{ id: 'new' }] as never));
  expect(state.zones).toEqual([{ id: 'new' }]);
  vi.mocked(zones.fetchZones)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce('bad');
  await act(async () => state.reload());
  expect(state.error).toBe('offline');
  await act(async () => state.reload());
  expect(state.error).toContain('Không thể tải');
  vi.mocked(zones.fetchZones).mockResolvedValue([]);
  await act(async () => state.reload());
  expect(state.error).toBeNull();
  const stale = deferred<never>();
  vi.mocked(zones.fetchZones).mockReturnValueOnce(stale.promise);
  await mount(<Harness id="third" />);
  await mount(<Harness id="fourth" />);
  await act(async () => stale.resolve([{ id: 'stale' }] as never));
  expect(state.zones).toEqual([]);
});

it('reloads household after successful mutation and blocks concurrent work', async () => {
  let state!: ReturnType<typeof useHousehold>;
  function Harness() {
    state = useHousehold();
    return null;
  }
  vi.mocked(getHousehold).mockResolvedValue({ members: [] } as never);
  await mount(<Harness />);
  expect(state.loading).toBe(false);
  expect(state.data).toEqual({ members: [] });
  const pending = deferred<void>();
  let result!: Promise<boolean>;
  act(() => {
    result = state.run(() => pending.promise, 'Saved');
  });
  expect(state.busy).toBe(true);
  const ignored = vi.fn();
  await expect(state.run(ignored, 'ignored')).resolves.toBe(false);
  expect(ignored).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve();
    await result;
  });
  expect(state.notice).toBe('Saved');
  expect(state.busy).toBe(false);
  expect(getHousehold).toHaveBeenCalledTimes(2);
  await act(async () => {
    expect(
      await state.run(async () => {
        throw new Error('invalid');
      }, 'Saved'),
    ).toBe(false);
  });
  expect(state.error).toBe('invalid');
  expect(state.notice).toBe('');
  await act(async () => {
    await state.run(async () => {
      throw 'bad';
    }, 'Saved');
  });
  expect(state.error).toContain('Không lưu được');
});

it.each([new Error('offline'), 'bad'])('reports household load errors', async (error) => {
  let state!: ReturnType<typeof useHousehold>;
  function Harness() {
    state = useHousehold();
    return null;
  }
  vi.mocked(getHousehold).mockRejectedValue(error);
  await mount(<Harness />);
  expect(state.loading).toBe(false);
  expect(state.error).toBe(error instanceof Error ? 'offline' : 'Không tải được hộ gia đình.');
});

it('aborts a pending household request when unmounted', async () => {
  let state!: ReturnType<typeof useHousehold>;
  function Harness() {
    state = useHousehold();
    return null;
  }
  const pending = deferred<never>();
  vi.mocked(getHousehold).mockReturnValue(pending.promise);
  await mount(<Harness />);
  const signal = vi.mocked(getHousehold).mock.calls[0][0]!;
  await mount(<div />);
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ members: [] } as never));
  expect(state.data).toBeNull();
});

it('refreshes event statistics on a timer, manual reload and refresh token', async () => {
  vi.useFakeTimers();
  let state!: ReturnType<typeof useEventStats>;
  function Harness({ token = 0 }) {
    state = useEventStats(token);
    return null;
  }
  vi.mocked(fetchEventStats).mockResolvedValue({ totalEvents: 7 } as never);
  await mount(<Harness />);
  expect(state.stats).toEqual({ totalEvents: 7 });
  expect(state.isLoading).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetchEventStats).toHaveBeenCalledTimes(2);
  vi.mocked(fetchEventStats).mockRejectedValueOnce(new Error('offline'));
  await act(async () => state.reload());
  expect(state.error).toBe('offline');
  vi.mocked(fetchEventStats).mockRejectedValueOnce('bad');
  await mount(<Harness token={1} />);
  expect(state.error).toContain('Không tải được');
  await act(async () => state.reload());
  expect(state.error).toBeNull();
  const pending = deferred<never>();
  vi.mocked(fetchEventStats).mockReturnValue(pending.promise);
  await mount(<Harness token={2} />);
  await mount(<div />);
  await act(async () => pending.resolve({ totalEvents: 99 } as never));
  expect(state.stats).toEqual({ totalEvents: 7 });
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves a working signed evidence URL until playback fails or identity changes', async () => {
  let url: string | null = null;
  function Harness({ incoming, failed = false }: { incoming: string | null; failed?: boolean }) {
    url = useEvidenceUrl(incoming, failed);
    return null;
  }
  await mount(<Harness incoming={null} />);
  expect(url).toBeNull();
  await mount(<Harness incoming="/clip?token=one" />);
  expect(url).toBe('/clip?token=one');
  await mount(<Harness incoming="/clip?token=two" />);
  expect(url).toBe('/clip?token=one');
  await mount(<Harness incoming="/clip?token=two" failed />);
  expect(url).toBe('/clip?token=two');
  await mount(<Harness incoming="/other?token=three" />);
  expect(url).toBe('/other?token=three');
  await mount(<Harness incoming={null} />);
  expect(url).toBeNull();
});
