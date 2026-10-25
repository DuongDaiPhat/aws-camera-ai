// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WellnessView } from './WellnessView';
import type { CurrentUser } from '@/types';
import * as api from '@/lib/wellness-client';
import { listKnownFaces } from '@/lib/known-faces-client';
import { fetchCameras } from '@/lib/cameras-client';
import { subscribeEventsStream } from '@/lib/events-client';

vi.mock('@/lib/wellness-client', () => ({
  listWellnessSchedules: vi.fn(),
  listWellnessChecks: vi.fn(),
  createWellnessSchedule: vi.fn(),
  updateWellnessSchedule: vi.fn(),
  deleteWellnessSchedule: vi.fn(),
  confirmWellnessCheck: vi.fn(),
}));
vi.mock('@/lib/known-faces-client', () => ({ listKnownFaces: vi.fn() }));
vi.mock('@/lib/cameras-client', () => ({ fetchCameras: vi.fn() }));
vi.mock('@/lib/events-client', () => ({ subscribeEventsStream: vi.fn(() => () => {}) }));
const schedule: api.WellnessSchedule = {
  id: 'schedule',
  residentUserId: 'resident',
  ownerUserId: 'owner',
  name: 'Buổi sáng',
  checkAt: '09:00',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  lookbackHours: 6,
  graceSeconds: 300,
  cameraIds: [],
  timezone: 'Asia/Ho_Chi_Minh',
  isEnabled: true,
  configurationStatus: 'READY',
};
const check: api.WellnessCheck = {
  id: 'check',
  scheduleId: 'schedule',
  residentUserId: 'resident',
  ownerUserId: 'owner',
  scheduledFor: '2026-10-18T02:00:00Z',
  localDate: '2026-10-18',
  status: 'ALERT_CREATED',
  presenceState: 'UNKNOWN',
  lookbackStartedAt: '2026-10-17T20:00:00Z',
  lookbackEndedAt: '2026-10-18T02:00:00Z',
  graceSeconds: 300,
  eventId: 'event',
  eventStatus: 'NOTIFIED',
  requestSentAt: '2026-10-18T02:00:01Z',
  confirmationDeadlineAt: '2026-10-18T02:05:01Z',
};
describe('US20 caregiver and resident UI', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(subscribeEventsStream).mockReturnValue(() => {});
    vi.mocked(api.listWellnessSchedules).mockResolvedValue({ data: [schedule] });
    vi.mocked(api.listWellnessChecks).mockResolvedValue({ data: [check], total: 1 });
    vi.mocked(listKnownFaces).mockResolvedValue({
      data: [{ id: 'face', personName: 'Mẹ', linkedUserId: 'resident' }] as never,
    });
    vi.mocked(fetchCameras).mockResolvedValue([{ id: 'camera', name: 'Cửa chính' }] as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  async function render(id: string, role: CurrentUser['role']) {
    await act(async () =>
      root.render(<WellnessView user={{ id, role, fullName: 'Người dùng QA' } as CurrentUser} />),
    );
  }
  async function click(text: string) {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }
  it('caregiver can create, edit, disable and delete a schedule, while resident confirmation stays hidden', async () => {
    await render('owner', 'CAREGIVER');
    expect(container.textContent).toContain('Mẹ');
    expect(container.textContent).toContain('Cửa chính');
    expect(container.textContent).not.toContain('Tôi ổn');
    await click('Sửa');
    expect(container.querySelector('input[type=time]')).toHaveProperty('value', '09:00');
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(api.updateWellnessSchedule).toHaveBeenCalledWith(
      'schedule',
      expect.objectContaining({ checkAt: '09:00', graceSeconds: 300 }),
    );
    await click('Tắt');
    expect(api.updateWellnessSchedule).toHaveBeenCalledWith('schedule', { isEnabled: false });
    await click('Xóa');
    expect(api.deleteWellnessSchedule).toHaveBeenCalledWith('schedule');
    await click('Sửa');
    await click('Hủy sửa');
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'resident';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(api.createWellnessSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ residentUserId: 'resident', checkAt: '09:00' }),
    );
  });
  it('resident sees own pending request, stable command on retry, error and refresh after conflict', async () => {
    vi.mocked(api.confirmWellnessCheck).mockRejectedValueOnce(
      new Error('Đã hết thời gian phản hồi'),
    );
    await render('resident', 'VIEWER');
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Tôi ổn');
    expect(container.textContent).not.toContain('Tạo lịch');
    await click('Tôi ổn');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Đã hết thời gian');
    await click('Tôi ổn');
    const calls = vi.mocked(api.confirmWellnessCheck).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0][1].commandId).toMatch(/^[a-f0-9-]{36}$/);
    await click('Cần giúp đỡ');
    expect(api.confirmWellnessCheck).toHaveBeenLastCalledWith(
      'check',
      expect.objectContaining({ response: 'NEED_HELP' }),
    );
    expect(api.listWellnessChecks).toHaveBeenCalledTimes(4);
  });
  it('hides actions before dispatch and for terminal/foreign requests; renders empty/error states', async () => {
    vi.mocked(api.listWellnessChecks).mockResolvedValue({
      data: [{ ...check, requestSentAt: null }],
      total: 1,
    });
    await render('resident', 'VIEWER');
    expect(container.textContent).toContain('Đang chờ gửi');
    expect(container.textContent).not.toContain('Tôi ổn');
  });
  it('shows an empty history', async () => {
    vi.mocked(api.listWellnessChecks).mockResolvedValue({ data: [], total: 0 });
    vi.mocked(api.listWellnessSchedules).mockResolvedValue({ data: [] });
    await render('resident', 'VIEWER');
    expect(container.textContent).toContain('Chưa có lượt kiểm tra');
    expect(container.textContent).toContain('Chưa có lịch kiểm tra');
  });
  it('offers retry when loading fails', async () => {
    vi.mocked(api.listWellnessChecks).mockRejectedValueOnce(new Error('Mất kết nối QA'));
    await render('resident', 'VIEWER');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Mất kết nối QA');
    await click('Thử lại');
    expect(container.textContent).toContain('Tôi ổn');
  });
});
