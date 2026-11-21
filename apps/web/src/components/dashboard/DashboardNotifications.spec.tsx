// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardNotifications } from './DashboardNotifications';
import { toUIEventItem } from '@/lib/events-client';
import type { useEvents } from '@/hooks/useEvents';
import type { useEventStats } from '@/hooks/useEventStats';
import type { UIEventItem } from '@/types';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const event = (
  type: UIEventItem['eventType'],
  id: string,
  priority: UIEventItem['priority'] = 'P1',
) =>
  toUIEventItem({
    id,
    eventType: type,
    status: 'NOTIFIED',
    priority,
    detectedAt: '2026-11-16T10:00:00Z',
    camera: { id: 'c', name: 'Phòng khách' },
  });
const items = [
  event('UNKNOWN_PERSON', 'stranger'),
  event('FIRE_SMOKE_DETECTED', 'fire'),
  event('FALL_DETECTED', 'fall'),
  event('PERSON_DETECTED', 'movement', 'P3'),
];
async function click(text: string) {
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === text)
      ?.click(),
  );
}

describe('notification categories', () => {
  it('shows load, error, retry and empty filtering states with unavailable metrics', async () => {
    const reload = vi.fn(),
      navigate = vi.fn();
    const state = {
      filteredEvents: [],
      isLoading: true,
      error: null,
      reload,
    } as unknown as ReturnType<typeof useEvents>;
    const metrics = { stats: null, isLoading: true, error: null } as ReturnType<
      typeof useEventStats
    >;
    const render = async () =>
      act(async () =>
        root.render(
          <DashboardNotifications
            state={state}
            metrics={metrics}
            onNavigate={navigate}
            onViewDetail={vi.fn()}
          />,
        ),
      );
    await render();
    expect(host.textContent).toContain('Đang tải thông báo');
    expect(host.textContent).toContain('— sự kiện');
    state.isLoading = false;
    state.error = 'Offline';
    metrics.error = 'Stats offline';
    await render();
    expect(host.textContent).toContain('Offline');
    expect(host.textContent).toContain('Chưa tải được số liệu');
    await click('Thử lại');
    expect(reload).toHaveBeenCalledOnce();
    state.error = null;
    await render();
    expect(host.textContent).toContain('Chưa có thông báo trong khu vực');
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[title="Cảnh báo cần xử lý trong các sự kiện đã tải"]')!
        .click(),
    );
    expect(host.textContent).toContain('Không có thông báo cần xử lý');
    await click('Lửa');
    expect(host.textContent).toContain('Chưa có thông báo lửa cần xử lý');
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[title="Cảnh báo cần xử lý trong các sự kiện đã tải"]')!
        .click(),
    );
    expect(host.textContent).toContain('Chưa có thông báo lửa.');
    await click('Xem lịch sử sự kiện');
    expect(navigate).toHaveBeenCalledWith('events');
  });
  it('falls back from broken thumbnails and handles resident-only and unnamed events', async () => {
    const resident = {
      ...event('WELLNESS_TIMEOUT', 'resident'),
      camera: undefined,
      wellnessResidentName: 'Grandma',
      thumbnailUrl: '/broken.jpg',
    };
    const unnamed = { ...event('PERSON_DETECTED', 'unnamed', 'P3'), camera: undefined };
    const resolved = { ...event('FALL_DETECTED', 'resolved'), status: 'RESOLVED' };
    const state = {
      filteredEvents: [resident, unnamed, resolved],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useEvents>;
    const metrics = {
      stats: { totalEvents: 3, windowHours: 12 },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useEventStats>;
    await act(async () =>
      root.render(
        <DashboardNotifications
          state={state}
          metrics={metrics}
          onNavigate={vi.fn()}
          onViewDetail={vi.fn()}
        />,
      ),
    );
    expect(host.textContent).toContain('Grandma');
    expect(host.textContent).toContain('Sự kiện camera');
    expect(host.textContent).toContain('Đã ghi nhận');
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
  });
  it('filters by actual event type, opens the selected event, and excludes routine P3 activity from pending alerts', async () => {
    const open = vi.fn();
    const state = {
      filteredEvents: items,
      isLoading: false,
      error: null,
      reload: vi.fn(),
    } as unknown as ReturnType<typeof useEvents>;
    const metrics = {
      stats: { pendingCount: 3, totalEvents: 4, windowHours: 24 },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useEventStats>;
    await act(async () =>
      root.render(
        <DashboardNotifications
          state={state}
          metrics={metrics}
          onNavigate={() => {}}
          onViewDetail={open}
        />,
      ),
    );
    expect(host.querySelectorAll('[data-kind]')).toHaveLength(4);
    await click('Người lạ');
    expect(host.querySelectorAll('[data-kind]')).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-kind="stranger"]')!.click());
    expect(open).toHaveBeenCalledWith(items[0]);
    await click('Lửa');
    expect(host.querySelector('[data-kind="fire"] strong')?.textContent).toBe('Phát hiện lửa');
    expect(host.querySelector('[data-kind="fall"]')).toBeNull();
    await click('Té ngã');
    expect(host.querySelector('[data-kind="fall"]')).not.toBeNull();
    await click('Tất cả');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Lọc cảnh báo cần xử lý (3)"]')!.click(),
    );
    expect(host.querySelectorAll('[data-kind]')).toHaveLength(3);
    expect(host.querySelector('[data-kind="activity"]')).toBeNull();
  });
});
