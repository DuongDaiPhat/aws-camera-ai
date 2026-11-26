// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useFireAttention } from './useFireAttention';
import { fetchPendingCriticalEvents, toUIEventItem } from '@/lib/events-client';
import type { UIEventItem } from '@/types';

vi.mock('@/lib/events-client', async (original) => ({
  ...(await original<typeof import('@/lib/events-client')>()),
  fetchPendingCriticalEvents: vi.fn(),
}));
const NOW = Date.parse('2026-10-27T10:00:00Z');
let root: Root;
let container: HTMLDivElement;
function event(
  id: string,
  at = NOW - 60000,
  cameraId = 'camera-a',
  eventType: UIEventItem['eventType'] = 'FIRE_SMOKE_DETECTED',
): UIEventItem {
  return toUIEventItem({
    id,
    status: 'NOTIFIED',
    priority: 'P0',
    eventType,
    detectedAt: new Date(at).toISOString(),
    escalationDeadlineAt: new Date(at + 120000).toISOString(),
    camera: { id: cameraId, name: cameraId },
  });
}
function Harness({
  events,
  userId = 'operator',
  canCloseEmergency = true,
}: {
  events: UIEventItem[];
  userId?: string;
  canCloseEmergency?: boolean;
}) {
  const value = useFireAttention(events, userId, canCloseEmergency);
  return (
    <>
      <output data-mandatory={String(value.isMandatory)}>{value.event?.id ?? 'none'}</output>
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
  vi.mocked(fetchPendingCriticalEvents).mockReset().mockResolvedValue([]);
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
const isMandatory = () => container.querySelector('output')?.getAttribute('data-mandatory');
async function show(events: UIEventItem[], userId?: string, canCloseEmergency = true) {
  vi.mocked(fetchPendingCriticalEvents).mockResolvedValue(events);
  await act(async () =>
    root.render(<Harness events={events} userId={userId} canCloseEmergency={canCloseEmergency} />),
  );
}

describe('persistent mandatory fire attention', () => {
  it('forces active fire handling across escalation and reload until resolved or closed', async () => {
    const first = event('fire');
    await show([first]);
    expect(current()).toBe('fire');
    expect(isMandatory()).toBe('true');

    // Dismissing via review() cannot bypass an unresolved mandatory fire alert.
    await act(async () => container.querySelector('button')?.click());
    expect(current()).toBe('fire');

    // Escalation keeps it mandatory for caregivers/admins, even after page reload.
    await act(async () => root.render(<Harness events={[{ ...first, status: 'ESCALATED' }]} />));
    expect(current()).toBe('fire');
    await act(async () => root.unmount());
    root = createRoot(container);
    await show([{ ...first, status: 'ESCALATED' }]);
    expect(current()).toBe('fire');

    // Once closed, the mandatory alert clears immediately.
    await show([{ ...first, status: 'CLOSED' }]);
    expect(current()).toBe('none');
  });

  it('triggers immediately on a new fire on the same camera even shortly after resolving a prior fire', async () => {
    const first = event('fire-1', NOW - 60000);
    await show([first]);
    expect(current()).toBe('fire-1');

    await show([{ ...first, status: 'RESOLVED' }]);
    expect(current()).toBe('none');

    // Another fire 30s later on the same camera MUST immediately pop up.
    const second = event('fire-2', NOW);
    await show([{ ...first, status: 'RESOLVED' }, second]);
    expect(current()).toBe('fire-2');
    expect(isMandatory()).toBe('true');
  });

  it('shows a new SSE fire immediately even while the pending-list poll still holds stale empty data', async () => {
    await show([]);
    expect(current()).toBe('none');

    // Simulate SSE delivering a new fire while fetchPendingCriticalEvents still returns [].
    vi.mocked(fetchPendingCriticalEvents).mockResolvedValue([]);
    const liveFire = event('sse-fire', NOW);
    await act(async () => root.render(<Harness events={[liveFire]} />));
    expect(current()).toBe('sse-fire');
    expect(isMandatory()).toBe('true');
  });

  it('wakes up immediately for a fire with slight server clock skew ahead of browser clock', async () => {
    const skewedFire = event('skewed-fire', NOW + 150);
    await show([skewedFire]);
    expect(current()).toBe('none');
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(current()).toBe('skewed-fire');
  });

  it('allows viewers to acknowledge an escalated fire they cannot close, and deduplicates non-fire P0 on reload', async () => {
    const escalatedFire = { ...event('fire-esc'), status: 'ESCALATED' as const };
    await show([escalatedFire], 'viewer-1', false);
    expect(current()).toBe('fire-esc');
    expect(isMandatory()).toBe('false');
    await act(async () => container.querySelector('button')?.click());
    expect(current()).toBe('none');

    const fall = event('fall-p0', NOW - 30000, 'camera-a', 'FALL_DETECTED');
    await show([fall], 'operator');
    expect(current()).toBe('fall-p0');
    expect(isMandatory()).toBe('false');
    await act(async () => root.unmount());
    root = createRoot(container);
    await show([fall], 'operator');
    expect(current()).toBe('none');
  });

  it('closes exactly at three hours even when no SSE or poll arrives', async () => {
    await show([{ ...event('expiring', NOW - 10800000 + 500), status: 'ESCALATED' }]);
    expect(current()).toBe('expiring');
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(current()).toBe('none');
  });

  it('does not show historical incidents and scopes non-fire receipts per account', async () => {
    await show([{ ...event('old', NOW - 10800001), status: 'ESCALATED' }]);
    expect(current()).toBe('none');

    const fall = event('fall-scoped', NOW - 30000, 'camera-a', 'FALL_DETECTED');
    await show([fall], 'account-a');
    await act(async () => container.querySelector('button')?.click());
    await show([fall], 'account-b');
    expect(current()).toBe('fall-scoped');
  });
});
