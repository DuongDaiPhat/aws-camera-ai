// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CameraStreamViewport, containCameraFrame } from '../CameraStreamViewport';

it('contains the complete image and its annotations across wide, square and portrait surfaces', () => {
  expect(containCameraFrame(1600, 900, 16 / 9)).toEqual({
    width: 1600,
    height: 900,
    left: 0,
    top: 0,
  });
  expect(containCameraFrame(600, 600, 16 / 9)).toEqual({
    width: 600,
    height: 337.5,
    left: 0,
    top: 131.25,
  });
  expect(containCameraFrame(1200, 300, 16 / 9).left).toBeCloseTo(333.3333);
  expect(containCameraFrame(300, 600, 3 / 4)).toEqual({
    width: 300,
    height: 400,
    left: 0,
    top: 100,
  });
});

it('keeps the player node across metadata renders and requests fullscreen on video plus overlays', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const show = (token: string, label: string) =>
    act(async () =>
      root.render(
        <CameraStreamViewport streamUrl={'/stream?token=' + token} title="Bếp" fullscreen>
          <svg>
            <text>{label}</text>
          </svg>
        </CameraStreamViewport>,
      ),
    );
  try {
    await show('first', 'Người 92%');
    const frame = host.querySelector<HTMLVideoElement>('video[data-stream-url]');
    await show('first', 'Người 94%');
    expect(host.querySelector<HTMLVideoElement>('video[data-stream-url]')).toBe(frame);
    expect(frame?.getAttribute('data-stream-url')).toContain('token=first');
    const surface = host.querySelector<HTMLElement>('[data-camera-viewport]')!;
    const request = vi.fn(async () => {});
    surface.requestFullscreen = request;
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(request).toHaveBeenCalledOnce();
    expect(surface.contains(frame)).toBe(true);
    expect(surface.querySelector('svg text')?.textContent).toBe('Người 94%');
    await show('renewed', 'Người 94%');
    expect(host.querySelector<HTMLVideoElement>('video[data-stream-url]')).toBe(frame);
    expect(frame?.getAttribute('data-stream-url')).toContain('token=renewed');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

vi.mock('@/components/cameras/CameraLiveStream', () => ({
  CameraLiveStream: ({
    streamUrl,
    onStatusChange,
  }: {
    streamUrl: string;
    onStatusChange?: (status: 'live') => void;
  }) => {
    React.useEffect(() => {
      onStatusChange?.('live');
    }, [streamUrl]);
    return <video data-stream-url={streamUrl} />;
  },
}));
