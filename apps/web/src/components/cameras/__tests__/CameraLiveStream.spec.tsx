// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CameraLiveStream } from '../CameraLiveStream';
import * as reader from '../live/camera-reader';
import type { LiveStreamSnapshot } from '../live/camera-reader';

vi.mock('../live/camera-reader', async (original) => ({
  ...(await original<typeof reader>()),
  subscribeCameraRead: vi.fn(),
  refreshCameraReadUrl: vi.fn(),
  retryCameraRead: vi.fn(),
}));
let root: Root, host: HTMLDivElement;
let emit: (snapshot: LiveStreamSnapshot) => void;
const status = vi.fn();
const stop = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  vi.mocked(reader.subscribeCameraRead).mockImplementation((_address, listener) => {
    emit = listener;
    listener({ status: 'connecting', stream: null });
    return stop;
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <CameraLiveStream
        streamUrl="http://localhost:8889/cam/?token=private"
        title="Camera thử nghiệm"
        onStatusChange={status}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('shows localized connection errors and never embeds the server error page', async () => {
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.textContent).toContain('Đang kết nối camera');
  await act(async () => emit({ status: 'unavailable', stream: null }));
  expect(host.textContent).toContain('Chưa nhận được tín hiệu camera');
  expect(host.textContent).toContain('tự thử lại');
  expect(host.textContent).not.toContain('stream not found');
  expect(status).toHaveBeenLastCalledWith('unavailable');
});

it('reports live only after the native video plays, and drops live status when it waits', async () => {
  const stream = {} as MediaStream;
  await act(async () => emit({ status: 'live', stream }));
  expect(status).toHaveBeenLastCalledWith('connecting');
  const video = host.querySelector('video')!;
  expect(video.srcObject).toBe(stream);
  await act(async () => video.dispatchEvent(new Event('playing')));
  expect(status).toHaveBeenLastCalledWith('live');
  expect(host.querySelector('[role=status]')).toBeNull();
  await act(async () => video.dispatchEvent(new Event('waiting')));
  expect(status).toHaveBeenLastCalledWith('connecting');
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(reader.retryCameraRead).toHaveBeenCalled();
});

it('detects a frozen video even when the browser does not emit waiting', async () => {
  await act(async () => emit({ status: 'live', stream: {} as MediaStream }));
  await act(async () => host.querySelector('video')!.dispatchEvent(new Event('playing')));
  await act(async () => vi.advanceTimersByTimeAsync(11000));
  expect(reader.retryCameraRead).toHaveBeenCalled();
});

it('renews the read token without replacing a playing video or subscribing twice', async () => {
  const stream = {} as MediaStream;
  await act(async () => emit({ status: 'live', stream }));
  const video = host.querySelector('video')!;
  await act(async () => video.dispatchEvent(new Event('playing')));
  await act(async () =>
    root.render(
      <CameraLiveStream
        streamUrl="http://localhost:8889/cam/?token=renewed"
        title="Camera thử nghiệm"
        onStatusChange={status}
      />,
    ),
  );
  expect(host.querySelector('video')).toBe(video);
  expect(video.srcObject).toBe(stream);
  expect(reader.subscribeCameraRead).toHaveBeenCalledOnce();
  expect(reader.refreshCameraReadUrl).toHaveBeenLastCalledWith(
    'http://localhost:8889/cam/?token=renewed',
  );
  expect(status).toHaveBeenLastCalledWith('live');
});

it('does not restart a playing camera while its browser tab is hidden', async () => {
  await act(async () => emit({ status: 'live', stream: {} as MediaStream }));
  await act(async () => host.querySelector('video')!.dispatchEvent(new Event('playing')));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => vi.advanceTimersByTimeAsync(11000));
  expect(reader.retryCameraRead).not.toHaveBeenCalled();
});
