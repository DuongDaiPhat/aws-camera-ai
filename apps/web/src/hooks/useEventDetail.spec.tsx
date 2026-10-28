// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventDetail } from './useEventDetail';
import { ApiError } from '@/lib/api-client';
import { fetchEventDetail, toUIEventItem } from '@/lib/events-client';
import type { EventDetail } from '@/types';

vi.mock('@/lib/events-client', async (original) => ({
  ...(await original<typeof import('@/lib/events-client')>()),
  fetchEventDetail: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
function event(id: string) {
  return toUIEventItem({
    id,
    eventType: 'FIRE_SMOKE_DETECTED',
    priority: 'P0',
    status: 'NOTIFIED',
    detectedAt: '2026-10-27T09:06:43Z',
  });
}
function detail(id: string): EventDetail {
  return {
    ...event(id),
    source: 'AI_SERVICE',
    trackId: null,
    aiResults: [],
    media: [],
    statusHistory: [],
  };
}
function Harness({ id }: { id: string }) {
  const value = useEventDetail(event(id));
  return (
    <div>
      <span data-testid="id">{value.detail?.id}</span>
      <span role="alert">{value.error}</span>
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchEventDetail).mockReset();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('event evidence recovery', () => {
  it('recovers after a temporary backend outage without closing the detail screen', async () => {
    vi.mocked(fetchEventDetail)
      .mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Unavailable'))
      .mockResolvedValue(detail('fire'));
    await act(async () => root.render(<Harness id="fire" />));
    expect(container.textContent).toContain('đang thử lại');
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(container.querySelector('[data-testid="id"]')?.textContent).toBe('fire');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('');
  });
  it('never shows the previous event media while another event is loading', async () => {
    let complete: ((value: EventDetail) => void) | undefined;
    vi.mocked(fetchEventDetail)
      .mockResolvedValueOnce(detail('first'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
    await act(async () => root.render(<Harness id="first" />));
    await act(async () => root.render(<Harness id="second" />));
    expect(container.querySelector('[data-testid="id"]')?.textContent).toBe('');
    await act(async () => complete?.(detail('second')));
    expect(container.querySelector('[data-testid="id"]')?.textContent).toBe('second');
  });
});
