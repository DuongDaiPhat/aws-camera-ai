// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EventDetail, UIEventItem } from '@/types';
import { EventDetailModal } from './EventDetailModal';
import { EventDetailFooter } from './EventDetailFooter';
import { EventSnapshot, EventEvidenceViewer } from './EventEvidenceViewer';
import { EventRecording } from './EventRecording';
import { FireEvidenceSection, FireBoxes } from './FireEvidenceSection';
import { FireEventSummary } from './FireEventSummary';
import { FireAttention } from './FireAttention';

const loading = vi.hoisted(() => ({
  detail: null as EventDetail | null,
  isLoading: false,
  error: null as string | null,
  reload: vi.fn(),
}));
vi.mock('@/hooks/useEventDetail', () => ({ useEventDetail: () => loading }));
vi.mock('@/hooks/useDialogFocus', () => ({ useDialogFocus: () => null }));
vi.mock('@/hooks/useEvidenceUrl', () => ({ useEvidenceUrl: (url: string | null) => url }));

const event: UIEventItem = {
  id: 'event-1',
  eventType: 'FIRE_SMOKE_DETECTED',
  status: 'NOTIFIED',
  priority: 'P0',
  detectedAt: '2026-11-21T01:00:00Z',
  cameraCode: 'CAM-1',
  aiTag: 'Fire',
  relativeTimeText: 'now',
  camera: { id: 'camera', name: 'Kitchen' },
  zone: { id: 'zone', name: 'Door' },
  confidence: 0.85,
  personStatus: 'KNOWN',
  matchedPersonName: 'Lan',
};
function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: event.id,
    eventType: event.eventType,
    status: event.status,
    priority: event.priority,
    detectedAt: event.detectedAt,
    source: 'FRIGATE',
    trackId: 'track',
    aiModelVersion: 'v1',
    aiProcessedAt: event.detectedAt,
    aiResults: [
      {
        module: 'M3_FIRE',
        resultId: 'r1',
        observationId: 'obs',
        revision: 1,
        modelVersion: 'fire-v1',
        processedAt: event.detectedAt,
        label: 'FIRE_SMOKE_DETECTED',
        confidence: 0.85,
        status: 'SUCCESS',
        metadata: {
          incidentConfidencePolicyVersion: 'fire-only-temporal-min-v1',
          consecutiveFrames: 3,
          windowSeconds: 5,
          detections: [
            {
              label: 'fire',
              confidence: 0.85,
              boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  loading.detail = null;
  loading.isLoading = false;
  loading.error = null;
  loading.reload.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(element: React.ReactElement) {
  act(() => root.render(element));
}
function button(text: string) {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
function input(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('shows missing/loading video, plays a clip and retries a failed media link', async () => {
  const reload = vi.fn();
  render(<EventRecording detail={null} isFire={false} onReload={reload} />);
  expect(host.textContent).toBe('');
  render(<EventRecording detail={null} isFire onReload={reload} />);
  expect(host.textContent).toContain('Đang tải bản ghi camera');
  await click('Tải lại bằng chứng');
  expect(reload).toHaveBeenCalledOnce();
  render(<EventRecording detail={detail()} isFire onReload={reload} />);
  expect(host.textContent).toContain('Chưa có clip để phát');
  render(
    <EventRecording
      detail={detail({
        media: [
          { id: 'clip', expiresAt: '2026-11-22T01:00:00Z', mediaType: 'CLIP', url: '/clip.mp4' },
        ],
      })}
      isFire
      onReload={reload}
    />,
  );
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/clip.mp4');
  act(() => host.querySelector('video')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Chưa phát được clip');
  await click('Tải lại bằng chứng');
  expect(reload).toHaveBeenCalledTimes(2);
});

it('shows snapshot fallbacks, camera labels, dimensions and image failure notices', () => {
  render(<EventSnapshot event={{ ...event, camera: undefined }} detail={null} />);
  expect(host.textContent).toContain('Ảnh camera chưa sẵn sàng');
  expect(host.textContent).toContain('Camera · CAM-1');
  render(
    <EventSnapshot
      event={event}
      detail={detail({
        media: [
          {
            id: 'snapshot',
            expiresAt: '2026-11-22T01:00:00Z',
            mediaType: 'SNAPSHOT',
            url: '/snapshot.jpg',
          },
        ],
      })}
    />,
  );
  const image = host.querySelector('img')!;
  expect(image.alt).toContain('Kitchen');
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  act(() => image.dispatchEvent(new Event('load')));
  expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1000 500');
  expect(host.querySelector('rect')?.getAttribute('width')).toBe('300');
  act(() => image.dispatchEvent(new Event('error')));
  expect(host.textContent).toContain('Chưa tải được ảnh');
  render(
    <EventSnapshot
      key="compact"
      compact
      event={{
        ...event,
        eventType: 'FALL_DETECTED',
        camera: undefined,
        thumbnailUrl: '/thumb.jpg',
      }}
      detail={null}
    />,
  );
  expect(host.querySelector('img')!.alt).toContain('camera');
  act(() => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.textContent).toContain('Mở chi tiết để kiểm tra bằng chứng');
});

it('switches fire evidence modes and keeps both media sections visible for other events', async () => {
  const reload = vi.fn();
  render(
    <EventEvidenceViewer
      event={event}
      detail={detail({
        media: [{ id: 'clip', expiresAt: '2026-11-22T01:00:00Z', mediaType: 'CLIP', url: '/clip' }],
      })}
      onReload={reload}
    />,
  );
  expect(button('Ảnh khoanh vùng').getAttribute('aria-pressed')).toBe('true');
  await click('Xem video diễn biến');
  expect(host.querySelector('video')).not.toBeNull();
  await click('Tải lại bằng chứng');
  expect(reload).toHaveBeenCalledOnce();
  await click('Ảnh khoanh vùng');
  expect(host.querySelector('video')).toBeNull();
  render(
    <EventEvidenceViewer
      event={{ ...event, eventType: 'FALL_DETECTED' }}
      detail={detail({
        media: [{ id: 'clip', expiresAt: '2026-11-22T01:00:00Z', mediaType: 'CLIP', url: '/clip' }],
      })}
      onReload={reload}
    />,
  );
  expect(host.querySelector('[aria-label="Chọn bằng chứng"]')).toBeNull();
  expect(host.querySelector('video')).not.toBeNull();
});

it('scales fire bounding labels on resize and releases the observer', () => {
  const observe = vi.fn(),
    disconnect = vi.fn();
  let resize: () => void = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 500,
    height: 250,
  } as DOMRect);
  render(
    <>
      <FireEvidenceSection detail={detail()} />
      <FireBoxes detail={detail()} width={1000} height={500} />
    </>,
  );
  expect(host.textContent).toContain('3 khung hình');
  expect(host.textContent).toContain('85%');
  expect(observe).toHaveBeenCalledOnce();
  expect(host.querySelector('text')?.getAttribute('font-size')).toBe('28');
  act(() => resize());
  render(<FireBoxes detail={null} width={1000} height={500} />);
  expect(host.querySelector('svg')).toBeNull();
  expect(disconnect).toHaveBeenCalledOnce();
  vi.stubGlobal('ResizeObserver', undefined);
  render(<FireBoxes detail={detail()} width={1000} height={500} />);
  expect(host.querySelector('rect')).not.toBeNull();
  render(<FireBoxes detail={detail()} width={0} height={500} />);
  expect(host.querySelector('svg')).toBeNull();
});

it('summarizes fire evidence and uses the most recent matching status history', () => {
  render(
    <FireEventSummary
      event={event}
      detail={detail({
        statusHistory: [
          {
            actorType: 'SYSTEM',
            toStatus: 'NOTIFIED',
            createdAt: '2026-11-21T00:10:00Z',
            actorName: 'Older',
          },
          {
            actorType: 'SYSTEM',
            toStatus: 'DETECTED',
            createdAt: '2026-11-21T02:00:00Z',
            actorName: 'Unrelated',
          },
          {
            actorType: 'SYSTEM',
            toStatus: 'NOTIFIED',
            createdAt: '2026-11-21T01:10:00Z',
            actorName: 'Latest',
          },
        ],
      })}
      statusLabel="Chờ xử lý"
    />,
  );
  expect(host.textContent).toContain('Latest');
  expect(host.textContent).not.toContain('Older');
  expect(host.textContent).toContain('85%');
  render(
    <FireEventSummary
      event={{ ...event, camera: undefined, zone: undefined, confidence: undefined }}
      detail={null}
      statusLabel="Chờ xử lý"
    />,
  );
  expect(host.textContent).toContain('Chưa gán camera');
  expect(host.textContent).toContain('Chưa gán khu vực');
  expect(host.textContent).toContain('Chưa có bằng chứng lửa');
});

it('enforces footer permissions, review readiness, notes and false-alarm actions', async () => {
  const action = vi.fn().mockResolvedValue(undefined),
    note = vi.fn(),
    review = vi.fn(),
    falseAlarm = vi.fn();
  const props = {
    event,
    note: '',
    onNote: note,
    submitting: false,
    onAction: action,
    requireReview: true,
    canReview: false,
    onReview: review,
    onToggleFalseAlarm: falseAlarm,
  };
  render(<EventDetailFooter {...props} />);
  expect(button('Đã xem cảnh báo, tiếp tục xử lý').disabled).toBe(true);
  input(host.querySelector('input')!, 'Check room');
  expect(note).toHaveBeenCalledWith('Check room');
  await click('✅ Tôi ổn (An toàn)');
  expect(action).toHaveBeenLastCalledWith('OK');
  await click('🆘 Cần giúp đỡ (Leo thang)');
  expect(action).toHaveBeenLastCalledWith('HELP');
  await click('Đánh dấu báo động giả');
  expect(falseAlarm).toHaveBeenCalledWith(event.id);
  render(
    <EventDetailFooter
      {...props}
      canReview
      event={{ ...event, status: 'ESCALATED', isFalseAlarm: true }}
    />,
  );
  await click('Đã xem cảnh báo, tiếp tục xử lý');
  expect(review).toHaveBeenCalledOnce();
  await click('Đóng sự kiện khẩn cấp');
  expect(action).toHaveBeenLastCalledWith('CLOSE');
  expect(button('Bỏ đánh dấu báo động giả')).not.toBeNull();
  render(
    <EventDetailFooter
      {...props}
      event={{ ...event, status: 'ESCALATED' }}
      canCloseEmergency={false}
    />,
  );
  expect(host.textContent).toContain('Đang leo thang khẩn cấp');
  expect(host.textContent).not.toContain('Đóng sự kiện khẩn cấp');
  for (const status of ['RESOLVED', 'CLOSED', 'DETECTED'] as const) {
    render(
      <EventDetailFooter {...props} event={{ ...event, status, eventType: 'FALL_DETECTED' }} />,
    );
    expect(host.querySelector('input')).toBeNull();
  }
  render(<EventDetailFooter {...props} submitting />);
  expect(
    [...host.querySelectorAll('button')]
      .filter((node) => node.textContent === 'Đang gửi…')
      .every((node) => node.disabled),
  ).toBe(true);
  render(<EventDetailFooter {...props} submitting event={{ ...event, status: 'ESCALATED' }} />);
  expect(button('Đang đóng…').disabled).toBe(true);
  render(<EventDetailFooter {...props} readOnly />);
  expect(host.textContent).toBe('');
});

it('renders detail loading/errors, retry and both ordinary and fire analysis', async () => {
  const close = vi.fn();
  render(<EventDetailModal event={null} onClose={close} />);
  expect(host.textContent).toBe('');
  loading.isLoading = true;
  loading.error = 'Evidence unavailable';
  render(
    <EventDetailModal
      event={{
        ...event,
        eventType: 'FALL_DETECTED',
        confidence: undefined,
        personStatus: undefined,
        matchedPersonName: undefined,
        camera: undefined,
        zone: undefined,
      }}
      onClose={close}
    />,
  );
  expect(host.textContent).toContain('Đang tải chi tiết');
  expect(host.textContent).toContain('Chưa gán camera');
  await click('Thử tải lại bằng chứng');
  expect(loading.reload).toHaveBeenCalledOnce();
  loading.isLoading = false;
  loading.error = null;
  loading.detail = detail({
    statusHistory: [
      {
        actorType: 'SYSTEM',
        toStatus: 'RESOLVED',
        createdAt: event.detectedAt,
        reason: 'Safe',
        actorName: 'Lan',
      },
      { actorType: 'SYSTEM', toStatus: 'DETECTED', createdAt: event.detectedAt },
    ],
    aiResults: [
      {
        ...detail().aiResults![0],
        resultId: 'error1',
        status: 'ERROR',
        confidence: null,
        error: { code: 'MODEL_FAILURE', message: 'Model unavailable' },
      },
      { ...detail().aiResults![0], resultId: 'r2', status: 'ERROR', error: undefined },
      detail().aiResults![0],
    ],
  });
  render(<EventDetailModal event={{ ...event, eventType: 'FALL_DETECTED' }} onClose={close} />);
  expect(host.textContent).toContain('MODEL_FAILURE');
  expect(host.textContent).toContain('Lỗi AI');
  expect(host.textContent).toContain('Safe (Lan)');
  await click('Đóng');
  expect(close).toHaveBeenCalledOnce();
  render(<EventDetailModal event={event} onClose={close} readOnly />);
  expect(host.textContent).toContain('Chi tiết sự kiện lửa');
  expect(host.querySelector('[aria-label="Ghi chú xử lý"]')).toBeNull();
});

it.each(['OK', 'HELP', 'CLOSE'] as const)(
  'submits %s with trimmed notes and closes only after success',
  async (action) => {
    const callback = vi.fn().mockResolvedValue(undefined),
      close = vi.fn();
    loading.detail = detail();
    render(
      <EventDetailModal
        event={{ ...event, status: action === 'CLOSE' ? 'ESCALATED' : 'NOTIFIED' }}
        onClose={close}
        onConfirmOk={callback}
        onConfirmHelp={callback}
        onCloseEmergency={callback}
      />,
    );
    input(host.querySelector('input')!, '  Checked camera  ');
    await click(
      action === 'OK'
        ? '✅ Tôi ổn (An toàn)'
        : action === 'HELP'
          ? '🆘 Cần giúp đỡ (Leo thang)'
          : 'Đóng sự kiện khẩn cấp',
    );
    expect(callback).toHaveBeenCalledWith(event.id, 'Checked camera');
    expect(close).toHaveBeenCalledOnce();
  },
);

it.each([
  new Error('409 Conflict'),
  new Error('xử lý bởi người khác'),
  new Error('Network unavailable'),
  'unknown',
])('keeps the modal open and explains failed confirmation: %s', async (error) => {
  const confirm = vi.fn().mockRejectedValue(error),
    close = vi.fn();
  render(<EventDetailModal event={event} onClose={close} onConfirmOk={confirm} />);
  await click('✅ Tôi ổn (An toàn)');
  expect(confirm).toHaveBeenCalledWith(event.id, undefined);
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    error instanceof Error && !/409|xử lý bởi/.test(error.message)
      ? error.message
      : error instanceof Error
        ? 'trạng thái đã thay đổi'
        : 'Có lỗi xảy ra',
  );
  expect(button('✅ Tôi ổn (An toàn)').disabled).toBe(false);
});

it('requires review of an urgent event and opens its real detail view', async () => {
  const reviewed = vi.fn(),
    inspect = vi.fn();
  loading.detail = detail();
  render(
    <FireAttention
      event={{ ...event, escalationDeadlineAt: '2026-11-21T01:01:00Z' }}
      onReviewed={reviewed}
      onInspect={inspect}
      onConfirmOk={vi.fn()}
      onConfirmHelp={vi.fn()}
      onCloseEmergency={vi.fn()}
    />,
  );
  expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(host.textContent).toContain('Hạn xác nhận');
  expect(host.textContent).toContain('Kitchen · Door');
  await click('Xem chi tiết ngay');
  expect(inspect).toHaveBeenCalledWith(event.id);
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Đóng"]')).toBeNull();
  await click('Đã xem cảnh báo, tiếp tục xử lý');
  expect(reviewed).toHaveBeenCalledOnce();
});
