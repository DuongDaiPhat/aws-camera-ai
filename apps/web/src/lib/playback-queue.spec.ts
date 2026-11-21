import { beforeEach, expect, it, vi } from 'vitest';
import type { queuePlayback as QueueFunction } from './playback-queue';
let queuePlayback: typeof QueueFunction;
beforeEach(async () => {
  vi.resetModules();
  ({ queuePlayback } = await import('./playback-queue'));
});
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('limits concurrent clip downloads to two and drains waiting work after completion', async () => {
  const a = deferred(),
    b = deferred(),
    c = vi.fn().mockResolvedValue('third');
  const signal = new AbortController().signal;
  const first = queuePlayback(() => a.promise, signal),
    second = queuePlayback(() => b.promise, signal),
    third = queuePlayback(c, signal);
  await Promise.resolve();
  expect(c).not.toHaveBeenCalled();
  a.resolve('first');
  await expect(first).resolves.toBe('first');
  await Promise.resolve();
  await Promise.resolve();
  await expect(third).resolves.toBe('third');
  b.resolve('second');
  await expect(second).resolves.toBe('second');
  expect(c).toHaveBeenCalledOnce();
});
it('rejects already-cancelled and queued requests without executing their downloads', async () => {
  const abort = new AbortController();
  abort.abort();
  const work = vi.fn();
  await expect(queuePlayback(work, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(work).not.toHaveBeenCalled();
  const a = deferred(),
    b = deferred();
  const first = queuePlayback(() => a.promise, new AbortController().signal),
    second = queuePlayback(() => b.promise, new AbortController().signal);
  const waiting = new AbortController();
  const queued = queuePlayback(work, waiting.signal);
  const assertion = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  waiting.abort();
  await assertion;
  expect(work).not.toHaveBeenCalled();
  a.resolve('a');
  b.resolve('b');
  await Promise.all([first, second]);
});
it('releases a slot after a rejected or synchronously throwing download', async () => {
  const error = new Error('failed');
  const failed = queuePlayback(async () => {
    throw error;
  }, new AbortController().signal);
  const thrown = queuePlayback(() => {
    throw error;
  }, new AbortController().signal);
  const next = queuePlayback(async () => 'recovered', new AbortController().signal);
  await expect(failed).rejects.toBe(error);
  await expect(thrown).rejects.toBe(error);
  await expect(next).resolves.toBe('recovered');
});
