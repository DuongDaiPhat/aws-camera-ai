// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { PlaybackPlayer } from './PlaybackPlayer';
vi.mock('@/hooks/usePlaybackArchive', () => ({
  usePlaybackClip: () => ({ url: 'blob:recording', loading: false, error: '', retry: vi.fn() }),
}));
vi.mock('./PlaybackAnnotations', () => ({
  PlaybackAnnotations: ({ position }: { position: number }) => (
    <span data-testid="annotations">{position}</span>
  ),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const report = vi.fn(),
  blocked = vi.fn(),
  ended = vi.fn();
const start = Date.parse('2026-11-18T03:00:00Z');
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function show(playing = false, rate = 1, nonce = 1, seconds = 5) {
  await act(async () =>
    root.render(
      <PlaybackPlayer
        cameraId="cam"
        cameraName="Bếp"
        timeZone="Asia/Ho_Chi_Minh"
        segment={{
          id: 'clip',
          startAt: new Date(start).toISOString(),
          endAt: new Date(start + 120000).toISOString(),
          durationSeconds: 120,
          hasMotion: false,
        }}
        seek={{ nonce, seconds }}
        playing={playing}
        rate={rate}
        onPosition={report}
        onPlaybackError={blocked}
        onEnded={ended}
      />,
    ),
  );
}
it('uses actual video time for the shared clock and historical recognition, without an MP4 scrubber', async () => {
  await show(true, 2);
  const video = host.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { value: 1 });
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
  expect(video.controls).toBe(false);
  expect(video.currentTime).toBe(5);
  expect(video.playbackRate).toBe(2);
  expect(report).toHaveBeenLastCalledWith(start + 5000);
  await act(async () => {
    video.currentTime = 8.25;
    video.dispatchEvent(new Event('timeupdate'));
  });
  expect(report).toHaveBeenLastCalledWith(start + 8250);
  expect(host.querySelector('[data-testid="annotations"]')?.textContent).toBe('8.25');
  await show(false, 0.5);
  expect(video.pause).toHaveBeenCalled();
  expect(video.playbackRate).toBe(0.5);
});
it('seeks again within the same clip when the absolute-time command changes', async () => {
  await show();
  const video = host.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { value: 1 });
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
  await show(false, 1, 2, 45);
  expect(video.currentTime).toBe(45);
});
it('requests fullscreen for the camera surface when an ancestor monitor is already fullscreen', async () => {
  await show();
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Toàn màn hình Bếp"]')!;
  const surface = button.parentElement!;
  const request = vi.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { value: surface, configurable: true });
  });
  const exit = vi.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { value: host, configurable: true });
  });
  surface.requestFullscreen = request;
  document.exitFullscreen = exit;
  Object.defineProperty(document, 'fullscreenElement', { value: host, configurable: true });

  try {
    await act(async () => button.click());
    expect(request).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();

    await act(async () => button.click());
    expect(exit).toHaveBeenCalledOnce();
  } finally {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  }
});
