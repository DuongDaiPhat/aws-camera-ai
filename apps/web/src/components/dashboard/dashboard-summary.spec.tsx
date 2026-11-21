// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EventStats, UIEventItem, WellnessCheck, WellnessSchedule } from '@/types';
import { MetricCards } from './MetricCards';
import { OverviewPanel, SystemOverview } from './OverviewPanel';
import { ViewerHome } from './ViewerHome';

const api = vi.hoisted(() => ({
  schedules: vi.fn(),
  checks: vi.fn(),
  confirm: vi.fn(),
  sos: vi.fn(),
}));
vi.mock('@/lib/wellness-client', () => ({
  listWellnessSchedules: api.schedules,
  listWellnessChecks: api.checks,
  confirmWellnessCheck: api.confirm,
}));
vi.mock('@/lib/events-client', () => ({ triggerSosHelp: api.sos }));
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => React.ReactNode }) =>
    function Showcase({ onNavigate }: { onNavigate: (page: string) => void }) {
      return (
        <div>
          {options.loading()}
          <button onClick={() => onNavigate('cameras')}>Showcase camera</button>
        </div>
      );
    },
}));
const event: UIEventItem = {
  id: 'evt',
  eventType: 'FALL_DETECTED',
  status: 'NOTIFIED',
  priority: 'P1',
  detectedAt: '2026-11-21T00:00:00Z',
  cameraCode: 'CAM1',
  aiTag: 'Fall',
  relativeTimeText: '1 phút trước',
};
const stats: EventStats = {
  windowHours: 12,
  totalEvents: 10,
  personDetectedCount: 3,
  pendingCount: 2,
  resolvedCount: 8,
  falseAlarmCount: 0,
  cameraOnlineCount: 1,
  cameraTotalCount: 2,
  byType: [],
  byPriority: [],
};
const schedule: WellnessSchedule = {
  id: 'schedule',
  residentUserId: 'resident',
  name: 'Morning',
  checkAt: '08:00',
  daysOfWeek: [1, 3, 5],
  lookbackHours: 6,
  graceSeconds: 300,
  cameraIds: [],
  timezone: 'Asia/Ho_Chi_Minh',
  isEnabled: true,
};
const check: WellnessCheck = {
  id: 'check',
  scheduleId: 'schedule',
  residentUserId: 'resident',
  scheduledFor: event.detectedAt,
  localDate: '2026-11-21',
  status: 'ALERT_CREATED',
  presenceState: 'HOME',
  lookbackStartedAt: event.detectedAt,
  lookbackEndedAt: event.detectedAt,
  graceSeconds: 300,
  eventId: 'evt',
  eventStatus: 'NOTIFIED',
  requestSentAt: event.detectedAt,
  confirmationDeadlineAt: event.detectedAt,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  api.schedules.mockResolvedValue({ data: [] });
  api.checks.mockResolvedValue({ data: [] });
  api.confirm.mockResolvedValue({});
  api.sos.mockResolvedValue({});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function render(element: React.ReactElement) {
  act(() => root.render(element));
}
async function renderAsync(element: React.ReactElement) {
  await act(async () => root.render(element));
}
function button(text: string) {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
async function click(text: string) {
  await act(async () => button(text).click());
}

it('distinguishes unavailable, loading, empty and offline camera statistics', () => {
  render(<MetricCards stats={null} />);
  expect(host.textContent).toContain('Chưa có số liệu');
  expect(host.textContent).toContain('Đang đọc trạng thái camera');
  render(<MetricCards stats={null} isLoading error="offline" compact />);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('offline');
  expect(host.textContent).toContain('Đang tải số liệu');
  render(
    <MetricCards
      stats={{ ...stats, cameraTotalCount: 0, cameraOnlineCount: 0, pendingCount: 0 }}
    />,
  );
  expect(host.textContent).toContain('Chưa có camera nào');
  expect(host.textContent).toContain('Không có sự kiện nào');
  render(<MetricCards stats={stats} />);
  expect(host.textContent).toContain('1/2');
  expect(host.textContent).toContain('1 camera đang ngoại tuyến');
  expect(host.textContent).toContain('Có sự kiện đang chờ');
  expect(host.textContent).toContain('12 giờ');
  render(
    <MetricCards
      stats={{
        ...stats,
        cameraOnlineCount: 2,
        latestPendingEvent: {
          cameraName: 'Kitchen',
          zoneName: 'Door',
          detectedAt: event.detectedAt,
        },
      }}
    />,
  );
  expect(host.textContent).toContain('Tất cả camera hoạt động');
  expect(host.textContent).toContain('Kitchen — Door');
  render(<MetricCards stats={{ ...stats, latestPendingEvent: {} }} />);
  expect(host.textContent).toContain('Camera chưa đặt tên');
  expect(host.textContent).toContain('Chưa rõ thời điểm');
});

it('classifies loaded events and forwards overview navigation', async () => {
  const navigate = vi.fn();
  render(<SystemOverview events={[]} onNavigate={navigate} />);
  expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('0 sự kiện');
  render(
    <SystemOverview
      events={[
        event,
        { ...event, id: '2', status: 'RESOLVED' },
        { ...event, id: '3', status: 'CLOSED' },
        { ...event, id: '4', status: 'LOGGED_ONLY' },
        { ...event, id: '5', priority: 'P3' },
      ]}
      onNavigate={navigate}
    />,
  );
  expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
    '5 sự kiện đã tải: 1 cần kiểm tra, 2 đã xử lý, 2 thông tin',
  );
  await click('Mở lịch sử sự kiện');
  expect(navigate).toHaveBeenLastCalledWith('events');
  render(
    <OverviewPanel
      metrics={{ stats, isLoading: false, error: null, reload: vi.fn() }}
      onNavigate={navigate}
    />,
  );
  expect(host.textContent).toContain('Đang chuẩn bị');
  expect(host.textContent).toContain('1/2');
  await click('Showcase camera');
  expect(navigate).toHaveBeenLastCalledWith('cameras');
});

it('shows loading then empty viewer state, fallback greeting and quick navigation', async () => {
  let resolveSchedules: (data: unknown) => void = () => {};
  api.schedules.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSchedules = resolve;
    }),
  );
  const navigate = vi.fn(),
    ready = vi.fn();
  render(<ViewerHome events={[]} onNavigate={navigate} onViewEvent={vi.fn()} onReady={ready} />);
  expect(host.textContent).toContain('Xin chào, bạn');
  expect(host.textContent).toContain('Đang tải yêu cầu');
  await act(async () => resolveSchedules({}));
  expect(host.textContent).toContain('Hiện tại không có yêu cầu');
  expect(host.textContent).toContain('Chưa có lịch kiểm tra');
  expect(ready).toHaveBeenCalledOnce();
  for (const [label, page] of [
    ['Camera trực tiếp', 'cameras'],
    ['Xem lại', 'playback'],
    ['Thông báo của tôi', 'events'],
  ]) {
    await click(label);
    expect(navigate).toHaveBeenLastCalledWith(page);
  }
});

it('filters pending checks/events and picks the earliest enabled schedule', async () => {
  api.schedules.mockResolvedValue({
    data: [
      { ...schedule, id: 'later', name: 'Later', checkAt: '10:00' },
      { ...schedule, id: 'disabled', isEnabled: false, checkAt: '01:00' },
      schedule,
    ],
  });
  api.checks.mockResolvedValue({
    data: [
      check,
      { ...check, id: 'unsent', requestSentAt: null },
      { ...check, id: 'done', eventStatus: 'RESOLVED' },
    ],
  });
  const view = vi.fn();
  await renderAsync(
    <ViewerHome
      userName="Lan"
      events={[
        event,
        { ...event, id: 'escalated', status: 'ESCALATED' },
        { ...event, id: 'closed', status: 'CLOSED' },
      ]}
      onNavigate={vi.fn()}
      onViewEvent={view}
    />,
  );
  expect(host.textContent).toContain('Xin chào, Lan');
  expect(host.textContent).toContain('3 đang chờ');
  expect(host.textContent).toContain('Morning');
  expect(host.textContent).toContain('T2, T4, T6');
  expect(host.textContent).not.toContain('Later');
  await click('Xem chi tiết');
  expect(view).toHaveBeenCalledWith(event);
  api.schedules.mockResolvedValue({ data: [{ ...schedule, daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }] });
  await click('Tôi ổn');
  expect(host.textContent).toContain('Hàng ngày');
  expect(host.textContent).toContain('Đã xác nhận bạn an toàn');
});

it('reuses confirmation command IDs after a failed request and creates a new command after success', async () => {
  api.schedules.mockResolvedValue({ data: [{ ...schedule, daysOfWeek: [8] }] });
  api.checks.mockResolvedValue({ data: [check] });
  api.confirm.mockRejectedValueOnce(new Error('Try again')).mockResolvedValue({});
  await renderAsync(<ViewerHome events={[]} onNavigate={vi.fn()} onViewEvent={vi.fn()} />);
  expect(host.textContent).toContain('Chu kỳ: 8');
  await click('Tôi ổn');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Try again');
  const first = api.confirm.mock.calls[0][1];
  await click('Tôi ổn');
  expect(api.confirm.mock.calls[1][1]).toBe(first);
  await click('Tôi ổn');
  expect(api.confirm.mock.calls[2][1].commandId).not.toBe(first.commandId);
  await click('Cần giúp đỡ');
  expect(api.confirm).toHaveBeenLastCalledWith(
    'check',
    expect.objectContaining({ response: 'NEED_HELP' }),
  );
  expect(host.textContent).toContain('Đã gửi yêu cầu trợ giúp tới');
  api.confirm.mockRejectedValueOnce('unknown');
  await click('Cần giúp đỡ');
  expect(host.textContent).toContain('Không thể gửi phản hồi');
});

it.each([new Error('Schedule offline'), 'unknown'])(
  'explains initial load errors: %s',
  async (error) => {
    api.schedules.mockRejectedValue(error);
    await renderAsync(<ViewerHome events={[]} onNavigate={vi.fn()} onViewEvent={vi.fn()} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      error instanceof Error ? error.message : 'Không thể tải thông tin',
    );
  },
);

it('disables quick help while pending, reports success and allows retry after failures', async () => {
  let resolve: () => void = () => {};
  api.sos.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  await renderAsync(<ViewerHome events={[]} onNavigate={vi.fn()} onViewEvent={vi.fn()} />);
  await click('Yêu cầu trợ giúp');
  expect(button('Đang gửi yêu cầu…').disabled).toBe(true);
  await act(async () => resolve());
  expect(host.textContent).toContain('khẩn cấp tới người chăm sóc');
  api.sos.mockRejectedValueOnce(new Error('Network down'));
  await click('Yêu cầu trợ giúp');
  expect(host.textContent).toContain('Network down');
  api.sos.mockRejectedValueOnce('unknown');
  await click('Yêu cầu trợ giúp');
  expect(host.textContent).toContain('Không thể gửi yêu cầu trợ giúp');
});
