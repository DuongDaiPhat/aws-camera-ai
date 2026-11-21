// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAccountPreferences, useNewAlertSound } from './useAccountPreferences';
import { getAccountSettings } from '@/lib/household-client';
import type { UIEventItem } from '@/types';
vi.mock('@/lib/household-client', () => ({ getAccountSettings: vi.fn() }));
let host: HTMLDivElement, root: Root;
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
  vi.unstubAllGlobals();
});
async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
}
it('keeps defaults before sign-in, reloads preferences and isolates account changes', async () => {
  let prefs!: ReturnType<typeof useAccountPreferences>;
  function Harness({ id }: { id?: string }) {
    prefs = useAccountPreferences(id);
    return null;
  }
  await render(<Harness />);
  expect(prefs.soundAlerts).toBe(true);
  expect(getAccountSettings).not.toHaveBeenCalled();
  vi.mocked(getAccountSettings).mockResolvedValue({
    inAppAlerts: false,
    soundAlerts: false,
    telegramAlerts: false,
  } as never);
  await render(<Harness id="a" />);
  expect(prefs.soundAlerts).toBe(false);
  vi.mocked(getAccountSettings).mockRejectedValueOnce(new Error('offline'));
  await act(async () => window.dispatchEvent(new Event('camerai-preferences-updated')));
  expect(prefs.soundAlerts).toBe(false);
  let done!: (value: never) => void;
  vi.mocked(getAccountSettings).mockReturnValue(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  await render(<Harness id="b" />);
  expect(prefs.soundAlerts).toBe(true);
  const signal = vi.mocked(getAccountSettings).mock.calls.at(-1)![0]!;
  await render(<Harness />);
  expect(signal.aborted).toBe(true);
  await act(async () => done({ soundAlerts: false } as never));
  expect(prefs.soundAlerts).toBe(true);
});
it('plays a brief sound only for a newly actionable alert in the same signed-in session', async () => {
  const oscillator = {
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  };
  const close = vi.fn().mockResolvedValue(undefined);
  const Audio = vi.fn(function () {
    return {
      createOscillator: () => oscillator,
      createGain: () => gain,
      currentTime: 10,
      destination: 'speaker',
      close,
    };
  });
  vi.stubGlobal('AudioContext', Audio);
  function Harness({
    ids,
    enabled = true,
    owner = 'a',
  }: {
    ids: { id: string; status: string; priority: string }[];
    enabled?: boolean;
    owner?: string;
  }) {
    useNewAlertSound(ids as UIEventItem[], enabled, owner);
    return null;
  }
  const first = { id: 'first', status: 'NOTIFIED', priority: 'P1' };
  await render(<Harness ids={[]} />);
  await render(<Harness ids={[first]} />);
  expect(Audio).not.toHaveBeenCalled();
  await render(<Harness ids={[first, { id: 'info', status: 'NOTIFIED', priority: 'P3' }]} />);
  expect(Audio).not.toHaveBeenCalled();
  await render(<Harness ids={[first, { id: 'resolved', status: 'RESOLVED', priority: 'P0' }]} />);
  expect(Audio).not.toHaveBeenCalled();
  await render(<Harness ids={[first, { id: 'urgent', status: 'ESCALATED', priority: 'P0' }]} />);
  expect(Audio).toHaveBeenCalledOnce();
  expect(oscillator.frequency.value).toBe(660);
  expect(oscillator.start).toHaveBeenCalledOnce();
  expect(oscillator.stop).toHaveBeenCalledWith(10.2);
  expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 10.2);
  oscillator.onended?.();
  expect(close).toHaveBeenCalledOnce();
  await render(<Harness ids={[first]} enabled={false} />);
  expect(close).toHaveBeenCalledTimes(2);
  await render(
    <Harness ids={[first, { id: 'next', status: 'NOTIFIED', priority: 'P0' }]} owner="other" />,
  );
  expect(Audio).toHaveBeenCalledOnce();
  vi.stubGlobal('AudioContext', undefined);
  await render(
    <Harness
      ids={[first, { id: 'without-audio', status: 'NOTIFIED', priority: 'P0' }]}
      owner="other"
    />,
  );
  expect(Audio).toHaveBeenCalledOnce();
});
