// @vitest-environment jsdom
import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { markLoginEntrance, consumeLoginEntrance } from '@/lib/login-entrance';
import { useLoginEntrance } from './useLoginEntrance';
let root: Root, host: HTMLDivElement;
let entrance: ReturnType<typeof useLoginEntrance>;
function Probe({ userId }: { userId?: string }) {
  entrance = useLoginEntrance(userId);
  return <div data-phase={entrance.phase} />;
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  vi.useFakeTimers();
  consumeLoginEntrance();
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  consumeLoginEntrance();
});
const show = async (userId?: string, key = 'initial') =>
  act(async () =>
    root.render(
      <StrictMode>
        <Probe key={key} userId={userId} />
      </StrictMode>,
    ),
  );
it('plays one login entrance after readiness and never replays after a remount or refresh', async () => {
  markLoginEntrance();
  await show();
  expect(entrance!.phase).toBe('idle');
  await show('a');
  expect(entrance!.phase).toBe('pending');
  await act(async () => entrance.onReady());
  expect(entrance!.phase).toBe('playing');
  await act(async () => vi.advanceTimersByTime(1450));
  expect(entrance!.phase).toBe('done');
  await show('a', 'reload');
  expect(entrance!.phase).toBe('idle');
  markLoginEntrance();
  await show('a', 'next-login');
  expect(entrance!.phase).toBe('pending');
});
it('does not animate normal page visits and cancels when the user navigates away', async () => {
  await show('a');
  expect(entrance!.phase).toBe('idle');
  markLoginEntrance();
  await show(undefined, 'login');
  await act(async () => entrance.finish());
  await show('a', 'login');
  expect(entrance!.phase).toBe('done');
  await show('a', 'reload');
  expect(entrance!.phase).toBe('idle');
});
it('starts after a bounded wait and consumes malformed or stale cues without playing', async () => {
  markLoginEntrance();
  await show('a');
  await act(async () => vi.advanceTimersByTime(1200));
  expect(entrance!.phase).toBe('playing');
  await act(async () => entrance.finish());
  expect(entrance!.phase).toBe('done');
  markLoginEntrance();
  vi.advanceTimersByTime(120001);
  await show('a', 'late');
  expect(entrance!.phase).toBe('idle');
  sessionStorage.setItem('cameraai.login-entrance', 'broken');
  await show('a', 'invalid');
  expect(entrance!.phase).toBe('idle');
  expect(sessionStorage.getItem('cameraai.login-entrance')).toBeNull();
});
