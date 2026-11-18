// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Camera, PlaybackMetadata, RecordingSegment } from '@/types';
import { fetchCameraDebugStream } from '@/lib/cameras-client';
import { CameraPreview } from '../CameraPreview';
import { LiveCameraViewport } from '../LiveCameraViewport';
import { DashboardOverview } from '@/components/dashboard/DashboardOverview';
import { PlaybackAnnotations } from '@/components/playback/PlaybackAnnotations';

let camera: Camera;
const segment = {
  id: 'recording',
  startAt: '2026-11-17T10:00:00Z',
  endAt: '2026-11-17T10:00:20Z',
  durationSeconds: 20,
} as RecordingSegment;
const metadata = {
  toleranceMs: 400,
  frames: [
    {
      at: '2026-11-17T10:00:01Z',
      boxes: [{ x: 0.2, y: 0.3, width: 0.1, height: 0.4, confidence: 0.92, label: 'person' }],
    },
  ],
} as PlaybackMetadata;
vi.mock('@/lib/cameras-client', () => ({
  fetchCameraZones: vi.fn(async () => []),
  fetchCameraDebugStream: vi.fn(async (id: string) => ({
    cameraId: id,
    streamUrl: '/live-camera?token=stable',
    activeZones: [],
    serverTime: Date.now(),
    detectionFrames: [
      {
        frameTime: Date.now(),
        detections: [
          {
            id: 'person-a',
            box: [0.3, 0.2, 0.7, 0.3],
            confidence: 0.92,
            label: 'person',
            observedAt: Date.now(),
          },
        ],
      },
    ],
  })),
}));
vi.mock('@/hooks/useCameras', () => ({
  useCameras: () => ({
    cameras: [camera],
    selectedCamera: camera,
    selectCamera: vi.fn(),
    isLoading: false,
    error: null,
    loadCameras: vi.fn(),
    toggleCamera: vi.fn(),
    toggleLoadingMap: {},
  }),
}));
vi.mock('@/hooks/usePlaybackMetadata', () => ({
  usePlaybackMetadata: () => ({ metadata, error: '' }),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (timer: ReturnType<typeof setTimeout>) =>
    clearTimeout(timer),
  );
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  localStorage.clear();
  vi.mocked(fetchCameraDebugStream).mockClear();
  camera = {
    id: 'shared-live',
    name: 'Camera thử nghiệm',
    isEnabled: true,
    runtimeStatus: 'ONLINE',
    sourceType: 'RTSP',
    detectWidth: 1280,
    detectHeight: 720,
    detectionEnabled: true,
    fps: 5,
  } as Camera;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function advance(milliseconds: number) {
  // Flush React effects between API polls, as real browser turns do.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await act(async () => vi.advanceTimersByTimeAsync(Math.min(100, milliseconds - elapsed)));
  }
}
const show = (position = 1) =>
  act(async () =>
    root.render(
      <>
        <CameraPreview camera={camera} />
        <DashboardOverview userId="consistent" isAdmin onNavigate={() => {}} />
        <PlaybackAnnotations
          cameraId={camera.id}
          segment={segment}
          position={position}
          width={1280}
          height={720}
        />
      </>,
    ),
  );

it('renders the same cyan person layer in source, dashboard, area live video and recorded playback', async () => {
  await show();
  await advance(120);
  expect(host.querySelectorAll('video[data-stream-url]')).toHaveLength(3);
  expect(host.querySelectorAll('[stroke="#38bdf8"]')).toHaveLength(4);
  const area = host.querySelector('[aria-labelledby="area-cameras-title"]')!;
  expect(area.querySelector<HTMLVideoElement>('video[data-stream-url]')).not.toBeNull();
  expect(area.querySelector('img')).toBeNull();
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(2);
  const playback = host.querySelector('[aria-label="Nhận diện trong bản ghi"]')!;
  expect(playback.textContent).toContain('person 92%');
  // Pausing a recording keeps its annotation even while live samples advance.
  await advance(2000);
  expect(playback.textContent).toContain('person 92%');
  await show(12);
  expect(playback.querySelector('svg')).toBeNull();
  expect(host.querySelectorAll('[stroke="#38bdf8"]')).toHaveLength(3);
});

it('stops all live media and shared polling when a camera is disabled', async () => {
  await show();
  await advance(120);
  camera = { ...camera, isEnabled: false };
  await show();
  expect(host.querySelector<HTMLVideoElement>('video[data-stream-url]')).toBeNull();
  const count = vi.mocked(fetchCameraDebugStream).mock.calls.length;
  await advance(500);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(count);
});

it('shows a placeholder for an unconfigured starting camera across source, dashboard and area cards', async () => {
  camera = { ...camera, runtimeStatus: 'STARTING' };
  await show();
  await advance(120);
  expect(fetchCameraDebugStream).toHaveBeenCalled();
  expect(host.querySelector<HTMLVideoElement>('video[data-stream-url]')).toBeNull();
  expect(host.textContent).toContain('Đang chờ nguồn phát camera');
  expect(host.textContent).toContain('Đang chờ luồng camera');
});

it('expires live boxes during API failure without freezing a ghost box or interrupting the player', async () => {
  await show();
  await advance(120);
  vi.mocked(fetchCameraDebugStream).mockRejectedValueOnce(new Error('temporary outage'));
  await advance(700);
  expect(host.querySelectorAll('video[data-stream-url]')).toHaveLength(3);
  // Only the paused historical annotation remains; live boxes have expired.
  expect(host.querySelectorAll('[stroke="#38bdf8"]')).toHaveLength(1);
  await advance(2000);
  expect(host.querySelectorAll('[stroke="#38bdf8"]')).toHaveLength(4);
});

it('opens a live area stream only while its card is visible and releases it when scrolled away', async () => {
  let visibility!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        visibility = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  await act(async () => root.render(<LiveCameraViewport camera={camera} compact />));
  expect(fetchCameraDebugStream).not.toHaveBeenCalled();
  const update = (isIntersecting: boolean) =>
    act(async () =>
      visibility([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    );
  await update(true);
  await advance(120);
  expect(host.querySelector<HTMLVideoElement>('video[data-stream-url]')).not.toBeNull();
  await update(false);
  expect(host.querySelector<HTMLVideoElement>('video[data-stream-url]')).toBeNull();
  const count = vi.mocked(fetchCameraDebugStream).mock.calls.length;
  await advance(500);
  expect(fetchCameraDebugStream).toHaveBeenCalledTimes(count);
  expect(vi.mocked(fetchCameraDebugStream).mock.calls[0]?.[1]?.aborted).toBe(true);
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalledOnce();
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
