// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchNotificationPage, toUIEventItem } from '@/lib/events-client';
import { NotificationInbox } from './NotificationInbox';

vi.mock('@/lib/events-client', async (loadModule) => ({
  ...(await loadModule<typeof import('@/lib/events-client')>()),
  fetchNotificationPage: vi.fn(),
}));

const fetchPage = vi.mocked(fetchNotificationPage);
const local = (day: number, hour = 0, minute = 0) => new Date(2026, 3, day, hour, minute);
const atEndOfDay = (day: number) =>
  new Date(local(day + 1).getTime() - 1).toISOString().replace('.999Z', '.999999Z');
const event = toUIEventItem({
  id: 'fire',
  eventType: 'FIRE_SMOKE_DETECTED',
  priority: 'P0',
  status: 'RESOLVED',
  detectedAt: local(12, 13, 8).toISOString(),
  camera: { name: 'Nhà bếp' },
});
const openDetail = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  vi.spyOn(Date, 'now').mockReturnValue(local(12, 15, 30).getTime());
  fetchPage.mockReset().mockImplementation(async (query) => {
    const params = new URLSearchParams(query);
    if (params.get('pageSize') !== '1') return { events: [event], total: 21 };
    const status = params.get('notificationState');
    return {
      events: [],
      total: status === null ? 40 : status === 'done' ? 9 : status === 'pending' ? 6 : 25,
    };
  });
  openDetail.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <NotificationInbox recentEvents={[]} actionVersion={0} onViewDetail={openDetail} />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const queries = () => fetchPage.mock.calls.map(([value]) => new URLSearchParams(value));
const listQuery = () =>
  queries()
    .filter((params) => params.get('pageSize') === '10')
    .at(-1)!;
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  )!;
async function choose(label: string, item: string) {
  await act(async () =>
    host.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!.click(),
  );
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (element) => element.textContent?.trim() === item,
  )!;
  await act(async () => option.click());
}
const popupButton = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
    (node) => node.textContent?.trim() === label,
  )!;
const periodButton = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label^="${label},"]`)!;
const openPeriod = (label: string) => act(async () => periodButton(label).click());
function setTime(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('opens on today and uses exact day-wide totals independent of the active list filters', async () => {
  expect(host.querySelector('h2')?.textContent).toBe('Thông báo trong ngày');
  expect(listQuery().get('from')).toBe(local(12).toISOString());
  expect(listQuery().get('to')).toBe(atEndOfDay(12));
  expect(listQuery().has('notificationState')).toBe(false);
  expect(Array.from(host.querySelectorAll('dd'), (node) => node.textContent)).toEqual([
    '40',
    '6',
    '25',
    '9',
  ]);
  const countQueries = queries().filter((params) => params.get('pageSize') === '1');
  expect(countQueries).toHaveLength(4);
  expect(countQueries.every((params) => params.get('from') === local(12).toISOString())).toBe(true);
  await choose('Loại thông báo', 'Lửa / khói');
  expect(listQuery().get('eventType')).toBe('FIRE_SMOKE_DETECTED');
  expect(queries().filter((params) => params.has('eventType'))).toHaveLength(1);
  expect(host.querySelector('li button')?.textContent).toContain('Đã xử lý');
  expect(host.querySelector('li button')?.getAttribute('data-unread')).toBe('true');
  await act(async () => host.querySelector<HTMLButtonElement>('li button')!.click());
  expect(openDetail).toHaveBeenCalledWith(event);
});

it('applies a rolling preset, rejects reversed or out-of-range clocks and applies a valid interval', async () => {
  expect(host.querySelector('input[aria-label="Từ giờ"]')).toBeNull();
  await openPeriod('Khoảng giờ');
  await act(async () => popupButton('3 giờ trước').click());
  await openPeriod('Khoảng giờ');
  expect(listQuery().get('from')).toBe(local(12, 12, 30).toISOString());
  await act(async () => setTime('Từ giờ', '16:00:00'));
  await act(async () => popupButton('Áp dụng giờ').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('sau giờ bắt đầu');
  await act(async () => setTime('Từ giờ', '12:00:00'));
  await act(async () => popupButton('Áp dụng giờ').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('nằm trong khoảng');
  await act(async () => {
    setTime('Từ giờ', '13:00:00');
    setTime('Đến giờ', '14:00:00');
  });
  await act(async () => popupButton('Áp dụng giờ').click());
  expect(listQuery().get('from')).toBe(local(12, 13).toISOString());
  expect(listQuery().get('to')).toBe(local(12, 14).toISOString().replace('.000Z', '.999999Z'));
  expect(periodButton('Khoảng giờ').textContent).toContain('13:00:00 – 14:00:00');
  expect(document.activeElement).toBe(periodButton('Khoảng giờ'));
});

it('opens history through yesterday, combines period and status and restores today', async () => {
  await act(async () => button('Lịch sử').click());
  expect(host.querySelector('h2')?.textContent).toBe('Lịch sử thông báo');
  expect(host.querySelector('input')).toBeNull();
  expect(listQuery().has('from')).toBe(false);
  expect(listQuery().get('to')).toBe(atEndOfDay(11));
  expect(document.activeElement).toBe(button('Về hôm nay'));
  await openPeriod('Khoảng ngày');
  await act(async () => popupButton('3 ngày gần nhất').click());
  await choose('Trạng thái xử lý', 'Đã xử lý');
  expect(listQuery().get('from')).toBe(local(9).toISOString());
  expect(listQuery().get('notificationState')).toBe('done');
  expect(listQuery().has('urgentFirst')).toBe(false);
  expect(listQuery().get('page')).toBe('1');
  await act(async () => button('Về hôm nay').click());
  expect(listQuery().get('from')).toBe(local(12).toISOString());
  expect(host.querySelector('h2')?.textContent).toBe('Thông báo trong ngày');
});

it('filters today by status and uses numbered page controls', async () => {
  await choose('Trạng thái xử lý', 'Chỉ ghi nhận');
  expect(listQuery().get('notificationState')).toBe('logged');
  expect(listQuery().get('urgentFirst')).toBe('true');
  const last = host.querySelector<HTMLButtonElement>('button[aria-label="Trang 3"]')!;
  await act(async () => last.click());
  expect(listQuery().get('page')).toBe('3');
  expect(last.getAttribute('aria-current')).toBe('page');
});

it('selects both history dates inside the period popup and excludes today', async () => {
  await act(async () => button('Lịch sử').click());
  await openPeriod('Khoảng ngày');
  const calendarTrigger = (label: string) =>
    document.querySelector<HTMLButtonElement>(
      `[aria-label="Khoảng ngày"] button[aria-label="${label}"]`,
    )!;
  const calendar = (label: string) =>
    document.querySelector<HTMLDivElement>(`[role="dialog"][aria-label="Chọn ${label}"]`)!;
  const dateButton = (surface: Element, date: Date) => {
    const name = date.toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return Array.from(surface.querySelectorAll('button')).find(
      (item) => item.getAttribute('aria-label') === name,
    )!;
  };
  await act(async () => calendarTrigger('Từ ngày').click());
  expect(dateButton(calendar('từ ngày'), local(12)).disabled).toBe(true);
  await act(async () => dateButton(calendar('từ ngày'), local(8)).click());
  await act(async () => calendarTrigger('Đến ngày').click());
  await act(async () => dateButton(calendar('đến ngày'), local(10)).click());
  await act(async () => popupButton('Áp dụng ngày').click());
  expect(listQuery().get('from')).toBe(local(8).toISOString());
  expect(listQuery().get('to')).toBe(atEndOfDay(10));
});
