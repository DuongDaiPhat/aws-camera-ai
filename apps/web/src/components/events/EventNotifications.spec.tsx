// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import { FIRE_DETAIL_REFRESH_MS } from '@/lib/fire-ui-config';
import { EventNotifications } from './EventNotifications';

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(apiFetch).mockReset();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it('shows provider acceptance, dry-run and manual reconciliation independently', async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    data: [
      { id: '1', channel: 'SNS_EMAIL', status: 'SENT' },
      { id: '2', channel: 'SNS_SMS', status: 'SKIPPED', errorCode: 'DRY_RUN' },
      { id: '3', channel: 'CONNECT_CALL', status: 'PENDING', errorCode: 'UNCERTAIN' },
      { id: '4', channel: 'TELEGRAM', status: 'FAILED' },
      { id: '5', channel: 'DASHBOARD', status: 'SKIPPED' },
      { id: '6', channel: 'WEBHOOK', status: 'PENDING' },
    ],
  });
  await act(async () => root.render(<EventNotifications eventId="event-1" />));
  expect(apiFetch).toHaveBeenCalledWith(
    '/events/event-1/notifications',
    expect.objectContaining({ cache: 'no-store' }),
  );
  expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
    'EmailNhà cung cấp đã tiếp nhận',
    'SMSChạy thử, không gửi',
    'Cuộc gọiChưa rõ kết quả, cần đối soát',
    'TelegramGửi thất bại',
    'Bảng điều khiểnĐã bỏ qua',
    'WebhookĐang chờ gửi',
  ]);
});

it('shows controlled reason labels and masks unknown codes', async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    data: [
      { id: '1', channel: 'SNS_EMAIL', status: 'SKIPPED', errorCode: 'BLOCKED_PROVIDER' },
      { id: '2', channel: 'SNS_EMAIL', status: 'SKIPPED', errorCode: 'LAB_DRY_RUN' },
      { id: '3', channel: 'SNS_EMAIL', status: 'SKIPPED', errorCode: 'SENDER_DRY_RUN' },
      { id: '4', channel: 'SNS_EMAIL', status: 'FAILED', errorCode: 'LEASE_EXPIRED' },
      { id: '5', channel: 'SNS_EMAIL', status: 'FAILED', errorCode: 'LAMBDA_TIME_BUDGET' },
      { id: '6', channel: 'SNS_EMAIL', status: 'FAILED', errorCode: 'unknown@example.test' },
      { id: '7', channel: 'SNS_EMAIL', status: 'SKIPPED', errorCode: 'unknown@example.test' },
    ],
  });
  await act(async () => root.render(<EventNotifications eventId="event-reasons" />));
  expect([...container.querySelectorAll('li span')].map((item) => item.textContent)).toEqual([
    'Chưa đủ cấu hình kênh gửi',
    'Chạy thử, không gửi',
    'Chạy thử, không gửi',
    'Đã quá hạn gửi',
    'Hết thời gian xử lý gửi',
    'Gửi thất bại',
    'Đã bỏ qua',
  ]);
});

it('refreshes after failure and hides an empty list', async () => {
  vi.mocked(apiFetch)
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({ data: [] });
  await act(async () => root.render(<EventNotifications eventId="event-2" />));
  expect(container.textContent).toContain('Chưa cập nhật được trạng thái thông báo.');
  await act(async () => vi.advanceTimersByTimeAsync(FIRE_DETAIL_REFRESH_MS));
  expect(container.textContent).toBe('');
});

it.each(['resolve', 'reject'])('ignores a stale request on %s', async (settlement) => {
  let resolveRequest!: (value: { data: [] }) => void;
  let rejectRequest!: (cause: Error) => void;
  vi.mocked(apiFetch)
    .mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          resolveRequest = resolve;
          rejectRequest = reject;
        }),
    )
    .mockResolvedValue({ data: [] });
  await act(async () => root.render(<EventNotifications eventId="old" />));
  await act(async () => root.render(<EventNotifications eventId="new" />));
  await act(async () => {
    if (settlement === 'resolve') resolveRequest({ data: [] });
    else rejectRequest(new Error('stale request'));
  });
  expect(container.textContent).toBe('');
  await act(async () => vi.advanceTimersByTimeAsync(FIRE_DETAIL_REFRESH_MS));
  expect(apiFetch).toHaveBeenCalledTimes(3);
});
