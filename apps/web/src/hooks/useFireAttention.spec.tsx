// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useFireAttention } from './useFireAttention';
import { fetchPendingFireEvents, toUIEventItem } from '@/lib/events-client';
import type { UIEventItem } from '@/types';

vi.mock('@/lib/events-client', async (original) => ({
  ...(await original<typeof import('@/lib/events-client')>()),
  fetchPendingFireEvents: vi.fn(),
}));
const NOW = Date.parse('2026-10-27T10:00:00Z');
let root: Root;
let container: HTMLDivElement;
function event(id: string, at = NOW - 60000, cameraId = 'camera-a'): UIEventItem {
  return toUIEventItem({
    id,
    status: 'NOTIFIED',
    priority: 'P0',
    eventType: 'FIRE_SMOKE_DETECTED',
    detectedAt: new Date(at).toISOString(),
    camera: { id: cameraId, name: cameraId },
  });
}
function Harness({ events, userId = 'operator' }: { events: UIEventItem[]; userId?: string }) {
  const value = useFireAttention(events, userId);
  return (
    <>
      <output>{value.event?.id ?? 'none'}</output>
      <button
        onClick={() => {
          if (value.event) value.review(value.event.id);
        }}
      >
        Review
      </button>
    </>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  vi.mocked(fetchPendingFireEvents).mockReset().mockResolvedValue([]);
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
const current = () => container.querySelector('output')?.textContent;
async function show(events: UIEventItem[], userId?: string) {
  vi.mocked(fetchPendingFireEvents).mockResolvedValue(events);
  await act(async () => root.render(<Harness events={events} userId={userId} />));
}

describe('persistent bounded fire attention', () => {
  it('keeps one dialog open while pending status changes, then never reopens it on remount', async () => {
    const first = event('fire');
    await show([first]);
    expect(current()).toBe('fire');
    await show([{ ...first, status: 'ESCALATED' }]);
    expect(current()).toBe('fire');
    await act(async () => container.querySelector('button')?.click());
    expect(current()).toBe('none');
    await act(async () => root.unmount());
    root = createRoot(container);
    await show([{ ...first, status: 'ESCALATED' }]);
    expect(current()).toBe('none');
  });
  it('records an interruption when shown, so reload cannot repeat an unopened alert', async () => {
    const events = [event('shown')];
    await show(events);
    expect(current()).toBe('shown');
    await act(async () => root.unmount());
    root = createRoot(container);
    await show(events);
    expect(current()).toBe('none');
  });
  it('closes at the three-hour deadline even when no SSE or poll arrives', async () => {
    await show([event('expiring', NOW - 10800000 + 500)]);
    expect(current()).toBe('expiring');
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(current()).toBe('none');
  });
  it('does not show historical incidents or repeat another ID from the same episode', async () => {
    await show([event('old', NOW - 10800001)]);
    expect(current()).toBe('none');
    await show([event('first')]);
    expect(current()).toBe('first');
    await act(async () => container.querySelector('button')?.click());
    await show([event('same-episode', NOW)]);
    expect(current()).toBe('none');
    await show([event('different-camera', NOW, 'b')]);
    expect(current()).toBe('different-camera');
  });
  it('scopes the persisted interruption to its account', async () => {
    const events = [event('fire')];
    await show(events, 'account-a');
    await act(async () => container.querySelector('button')?.click());
    await show(events, 'account-b');
    expect(current()).toBe('fire');
  });
});
