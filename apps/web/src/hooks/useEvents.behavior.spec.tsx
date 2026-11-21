// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEvents } from './useEvents';
import { fetchEvents, subscribeEventsStream, confirmEvent, closeEvent } from '@/lib/events-client';
import { EVENTS_REFRESH_MS } from '@/lib/fire-ui-config';
vi.mock('@/lib/events-client', () => ({
  fetchEvents: vi.fn(),
  subscribeEventsStream: vi.fn(),
  confirmEvent: vi.fn(),
  closeEvent: vi.fn(),
  DEFAULT_EVENTS_PAGE_SIZE: 100,
}));
let host: HTMLDivElement, root: Root, state: ReturnType<typeof useEvents>;
let callbacks: Parameters<typeof subscribeEventsStream>[0];
const unsubscribe = vi.fn();
const events = Array.from({ length: 12 }, (_, i) => ({
  id: `e${i}`,
  detectedAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
  priority: i < 6 ? 'P1' : 'P3',
  status: i === 11 ? 'CLOSED' : 'NOTIFIED',
  eventType: 'FALL_DETECTED',
  zone: { id: i % 2 ? 'kitchen' : 'living', name: i % 2 ? 'Bếp' : 'Phòng khách' },
  camera: { name: 'Camera' },
  aiTag: 'Fall',
  isFalseAlarm: false,
}));
function Harness() {
  state = useEvents();
  return null;
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.mocked(fetchEvents).mockResolvedValue({ events } as never);
  vi.mocked(subscribeEventsStream).mockImplementation((input) => {
    callbacks = input;
    return unsubscribe;
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function mount() {
  await act(async () => root.render(<Harness />));
}
it('loads events and filters, paginates and resets from user controls', async () => {
  await mount();
  expect(fetchEvents).toHaveBeenCalledWith(100, true);
  expect(state.events).toHaveLength(12);
  expect(state.paginatedEvents).toHaveLength(5);
  expect(state.totalPages).toBe(3);
  act(() => state.setCurrentPage(3));
  expect(state.paginatedEvents).toHaveLength(2);
  act(() => state.setPageSize(10));
  expect(state.currentPage).toBe(1);
  expect(state.paginatedEvents).toHaveLength(10);
  act(() => state.setActiveFilterTab('URGENT'));
  expect(state.filteredEvents).toHaveLength(6);
  act(() => state.setSelectedZone('zone:kitchen'));
  expect(state.filteredEvents).toHaveLength(3);
  act(() => state.resetFilters());
  expect(state.filteredEvents).toHaveLength(12);
  expect(state.selectedZone).toBe('ALL');
  expect(state.currentPage).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(EVENTS_REFRESH_MS));
  expect(fetchEvents).toHaveBeenCalledTimes(2);
});
it('deduplicates new SSE events, updates in place and expires live notices', async () => {
  await mount();
  const created = { ...events[0], aiTag: 'New fall', camera: undefined };
  act(() => callbacks.onCreated?.(created as never));
  expect(state.events).toHaveLength(12);
  expect(state.events[0].id).toBe('e0');
  expect(state.liveNoticeText).toContain('New fall · Camera');
  act(() => callbacks.onCreated?.({ ...events[1], camera: { name: 'Kitchen' } } as never));
  expect(state.liveNoticeText).toContain('Kitchen');
  const before = state.events.map((e) => e.id);
  act(() => callbacks.onUpdated?.({ ...events[0], note: 'Updated detail' } as never));
  expect(state.events.map((e) => e.id)).toEqual(before);
  expect(state.events.find((e) => e.id === 'e0')?.note).toBe('Updated detail');
  act(() => callbacks.onUpdated?.({ ...events[0], id: 'missing' } as never));
  expect(state.events[0].id).toBe('missing');
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(state.liveNoticeText).toBeNull();
});
it('applies confirmation, help, emergency closure and false-alarm actions to one event', async () => {
  await mount();
  await act(async () => state.confirmOk('e0', 'Safe'));
  expect(confirmEvent).toHaveBeenCalledWith('e0', 'IM_OK', 'Safe');
  expect(state.events[0]).toMatchObject({
    status: 'RESOLVED',
    aiTag: 'An toàn',
    aiTagColor: 'success',
  });
  expect(state.events[1].status).toBe('NOTIFIED');
  await act(async () => state.confirmHelp('e1', 'Help'));
  expect(confirmEvent).toHaveBeenCalledWith('e1', 'NEED_HELP', 'Help');
  expect(state.events[1]).toMatchObject({ status: 'ESCALATED', priority: 'P0' });
  await act(async () => state.closeEmergency('e1', 'Closed'));
  expect(closeEvent).toHaveBeenCalledWith('e1', 'Closed');
  expect(state.events[1].status).toBe('CLOSED');
  act(() => state.toggleFalseAlarm('e2'));
  expect(state.events[2].isFalseAlarm).toBe(true);
  act(() => state.toggleFalseAlarm('e2'));
  expect(state.events[2].isFalseAlarm).toBe(false);
});
it.each(['confirmOk', 'confirmHelp', 'closeEmergency'] as const)(
  'reloads canonical server state after %s fails and rethrows',
  async (action) => {
    await mount();
    const error = new Error('conflict');
    vi.mocked(confirmEvent).mockRejectedValue(error);
    vi.mocked(closeEvent).mockRejectedValue(error);
    await act(async () => {
      await expect(state[action]('e0')).rejects.toBe(error);
    });
    expect(fetchEvents).toHaveBeenCalledTimes(2);
    expect(state.events[0].status).toBe('NOTIFIED');
  },
);
it.each([new Error('offline'), 'bad'])(
  'reports and recovers from a failed event list read',
  async (error) => {
    vi.mocked(fetchEvents).mockRejectedValueOnce(error);
    await mount();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe(
      error instanceof Error
        ? 'Không tải được danh sách sự kiện: offline'
        : 'Không tải được danh sách sự kiện.',
    );
    await act(async () => state.reload());
    expect(state.error).toBeNull();
    expect(state.events).toHaveLength(12);
  },
);
it('ignores completed network work after unmount and unsubscribes from SSE', async () => {
  let resolve!: (data: never) => void;
  vi.mocked(fetchEvents).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await act(async () => root.render(<div />));
  expect(unsubscribe).toHaveBeenCalledOnce();
  await act(async () => resolve({ events } as never));
  expect(state.events).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
