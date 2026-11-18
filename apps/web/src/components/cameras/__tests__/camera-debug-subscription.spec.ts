import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchCameraDebugStream, type CameraDebugStream } from '@/lib/cameras-client';
import { subscribeCameraDebug } from '../live/use-camera-debug-stream';

vi.mock('@/lib/cameras-client', () => ({ fetchCameraDebugStream: vi.fn() }));
const disposers: (() => void)[] = [];
const data = (cameraId: string) =>
  ({ cameraId, streamUrl: '/stream?token=a', detectionFrames: [] }) as unknown as CameraDebugStream;
const subscribe = (id: string, callback = vi.fn()) => {
  const dispose = subscribeCameraDebug(id, callback);
  disposers.push(dispose);
  return dispose;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchCameraDebugStream).mockReset();
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

it('shares one request per camera, keeps other consumers alive and stops after the last unmount', async () => {
  vi.mocked(fetchCameraDebugStream).mockResolvedValue(data('a'));
  const first = vi.fn(),
    second = vi.fn();
  const stopFirst = subscribe('a', first),
    stopSecond = subscribe('a', second);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(1);
  expect(first.mock.lastCall?.[0].data).toBe(second.mock.lastCall?.[0].data);
  stopFirst();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(2);
  stopSecond();
  expect(vi.mocked(fetchCameraDebugStream).mock.calls[0]?.[1]?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(2);
});

it('never overlaps requests and ignores late responses after switching cameras', async () => {
  let resolve!: (data: CameraDebugStream) => void;
  vi.mocked(fetchCameraDebugStream)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(data('b'));
  const stale = vi.fn();
  const stop = subscribe('a', stale);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(1);
  stop();
  const next = vi.fn();
  subscribe('b', next);
  resolve(data('a'));
  await vi.advanceTimersByTimeAsync(0);
  expect(stale).toHaveBeenCalledTimes(1); // initial empty state only
  expect(next.mock.lastCall?.[0].data.cameraId).toBe('b');
});

it('backs off API failures without discarding established video, then recovers', async () => {
  vi.mocked(fetchCameraDebugStream)
    .mockResolvedValueOnce(data('a'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(data('a'));
  const notify = vi.fn();
  subscribe('a', notify);
  await vi.advanceTimersByTimeAsync(100);
  expect(notify.mock.lastCall?.[0]).toMatchObject({
    error: true,
    data: { streamUrl: '/stream?token=a' },
  });
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(notify.mock.lastCall?.[0].error).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(4);
});

it('drops a response whose camera identity does not match the subscription', async () => {
  vi.mocked(fetchCameraDebugStream).mockResolvedValue(data('other'));
  const notify = vi.fn();
  subscribe('a', notify);
  await vi.advanceTimersByTimeAsync(0);
  expect(notify.mock.lastCall?.[0]).toEqual({ error: true, data: null });
});
