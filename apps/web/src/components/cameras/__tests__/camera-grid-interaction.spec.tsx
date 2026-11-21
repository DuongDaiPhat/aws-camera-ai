// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CameraGridView } from '../CameraGridView';
import { CameraGridTile } from '../CameraGridTile';
import type { Camera } from '@/types';
const m = vi.hoisted(() => ({ debug: vi.fn(), publishing: false }));
vi.mock('../live/use-camera-debug-stream', () => ({ useCameraDebugStream: m.debug }));
vi.mock('../live/use-live-person-detections', () => ({ useLivePersonDetections: () => [] }));
vi.mock('../source/webcam-session-manager', () => ({
  useWebcamSession: () => ({ isPublishing: m.publishing }),
}));
vi.mock('../CameraAnnotations', () => ({
  CameraAnnotations: () => <span>Person annotations</span>,
}));
vi.mock('../CameraStreamViewport', () => ({
  CameraStreamViewport: ({
    children,
    onStatusChange,
  }: {
    children: React.ReactNode;
    onStatusChange: (status: string) => void;
  }) => (
    <div>
      {children}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStatusChange('live');
        }}
      >
        Frame received
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStatusChange('unavailable');
        }}
      >
        Stream failed
      </button>
    </div>
  ),
}));
let host: HTMLDivElement, root: Root;
const camera = {
  id: 'cam',
  name: 'Living',
  slug: 'living',
  isEnabled: true,
  runtimeStatus: 'ONLINE',
  sourceType: 'RTSP',
  fps: 5,
  detectWidth: 1280,
  detectHeight: 720,
} as Camera;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.clearAllMocks();
  m.publishing = false;
  m.debug.mockReturnValue({ data: { streamUrl: '/stream' }, error: false });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
function render(element: React.ReactElement) {
  act(() => root.render(element));
}
function click(text: string) {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!node) throw Error(text);
  act(() => node.click());
}
it('changes grid layout, focuses and resets tiles and forwards camera actions', () => {
  vi.useFakeTimers();
  const select = vi.fn(),
    list = vi.fn(),
    toggle = vi.fn();
  const cameras = [camera, { ...camera, id: 'other', name: 'Other', isEnabled: false }];
  const props = {
    cameras,
    selectedCameraId: 'other',
    onSelectCamera: select,
    onSwitchToList: list,
    onToggleState: toggle,
  };
  render(<CameraGridView {...props} />);
  expect(host.textContent).toContain('1/2 Camera đang online');
  click('Lưới 3x2');
  click('Lưới 2x2');
  click('Tự động');
  click('OSD: BẬT');
  expect(host.textContent).not.toContain('MAIN -');
  click('OSD: TẮT');
  click('AI Box: BẬT');
  expect(host.textContent).toContain('AI Box: TẮT');
  click('AI Box: TẮT');
  click('Phóng to');
  expect(host.textContent).toContain('Hiện tất cả (2)');
  expect(host.textContent).not.toContain('(other)');
  click('Thu nhỏ');
  expect(host.textContent).toContain('Other');
  click('Phóng to');
  click('Hiện tất cả (2)');
  const screen = host.querySelector<HTMLElement>('[role="button"]')!;
  act(() => screen.click());
  expect(select).toHaveBeenCalledWith('cam');
  act(() => screen.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  act(() => screen.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
  expect(select).toHaveBeenCalledTimes(3);
  click('Chi tiết');
  expect(list).toHaveBeenLastCalledWith('cam');
  click('Tắt');
  expect(toggle).toHaveBeenCalledWith('cam', false);
  click('Dạng danh sách');
  expect(list).toHaveBeenLastCalledWith('other');
  act(() => vi.advanceTimersByTime(1000));
  expect(host.textContent).toMatch(/\d{2}-\d{2}-\d{4}/);
  render(<CameraGridView {...props} cameras={[]} selectedCameraId={null} />);
  click('Quay lại danh sách');
  expect(list).toHaveBeenLastCalledWith();
  click('Dạng danh sách');
  expect(list).toHaveBeenLastCalledWith(undefined);
  render(
    <CameraGridView
      {...props}
      cameras={Array.from({ length: 5 }, (_, i) => ({ ...camera, id: String(i) }))}
    />,
  );
  expect(host.querySelectorAll('[role="button"]')).toHaveLength(5);
  render(<CameraGridView {...props} cameras={[camera]} />);
  expect(host.querySelectorAll('[role="button"]')).toHaveLength(1);
});
it('changes live status after frames, errors and annotation preferences', () => {
  const props = {
    camera,
    currentTimeString: '12:00',
    onSelect: vi.fn(),
    onSwitchToList: vi.fn(),
    onToggleState: vi.fn(),
  };
  render(<CameraGridTile {...props} />);
  expect(host.textContent).not.toContain('Person annotations');
  click('Frame received');
  expect(host.textContent).toContain('Person annotations');
  expect(host.textContent).toContain('LIVE');
  click('Stream failed');
  expect(host.textContent).not.toContain('Person annotations');
  render(<CameraGridTile {...props} showOsd={false} showDetections={false} />);
  click('Frame received');
  expect(host.textContent).not.toContain('Person annotations');
  expect(host.textContent).not.toContain('MAIN -');
});
it.each([
  [
    { ...camera, isEnabled: false, sourceType: 'VIDEO_FILE', detectWidth: 0, detectHeight: 0 },
    false,
    'CAMERA ĐANG TẮT',
    'VIDEO',
  ],
  [{ ...camera, runtimeStatus: 'FAILED' }, false, 'MẤT TÍN HIỆU', 'RTSP'],
  [{ ...camera, sourceType: 'BROWSER_WEBCAM' }, false, 'ĐANG KẾT NỐI', 'WEBCAM'],
] as const)(
  'explains unavailable source and fallback resolution',
  (item, publishing, message, label) => {
    m.debug.mockReturnValue({ data: null, error: false });
    m.publishing = publishing;
    const toggle = vi.fn();
    render(
      <CameraGridTile
        camera={item as Camera}
        currentTimeString="now"
        onSelect={vi.fn()}
        onSwitchToList={vi.fn()}
        onToggleState={toggle}
      />,
    );
    expect(host.textContent).toContain(message);
    expect(host.textContent).toContain(label);
    if (!item.detectWidth) expect(host.textContent).toContain('1280x720');
    click(item.isEnabled ? 'Tắt' : 'Bật');
    expect(toggle).toHaveBeenCalledWith('cam', !item.isEnabled);
  },
);
it('shows stream errors even when the camera runtime has not failed', () => {
  m.debug.mockReturnValue({ data: null, error: true });
  render(
    <CameraGridTile
      camera={camera}
      currentTimeString="now"
      onSelect={vi.fn()}
      onSwitchToList={vi.fn()}
      onToggleState={vi.fn()}
    />,
  );
  expect(host.textContent).toContain('MẤT TÍN HIỆU');
});
