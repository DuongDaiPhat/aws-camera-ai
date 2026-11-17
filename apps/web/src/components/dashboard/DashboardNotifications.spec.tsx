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
    expect(host.querySelector('[data-kind="fire"]')).not.toBeNull();
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
