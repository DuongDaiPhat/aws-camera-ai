// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaregiverSettingsView } from './CaregiverSettingsView';
import * as api from '@/lib/household-client';
import { apiFetch } from '@/lib/api-client';
const m = vi.hoisted(() => ({ household: vi.fn(), run: vi.fn() }));
vi.mock('@/hooks/useHousehold', () => ({ useHousehold: m.household }));
vi.mock('@/components/settings/EscalationRulesSection', () => ({
  EscalationRulesSection: ({ isAdmin, household }: { isAdmin: boolean; household: boolean }) => (
    <div>
      Rules {String(isAdmin)} {String(household)}
    </div>
  ),
}));
vi.mock('@/lib/household-client', () => ({
  getAccountSettings: vi.fn(),
  saveProfile: vi.fn(),
  changePassword: vi.fn(),
  saveNotificationPreferences: vi.fn(),
  saveHouseholdSettings: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));
let host: HTMLDivElement, root: Root;
const account = {
  fullName: 'Owner',
  email: 'owner@test',
  phone: null,
  authProvider: 'jwt',
  telegramLinked: false,
  inAppAlerts: true,
  soundAlerts: true,
  telegramAlerts: true,
};
const household = {
  storage: { alertMediaBytes: String(2 * 1024 ** 3) },
  cameras: [{ recordingEnabled: true }, { recordingEnabled: false }],
  settings: { storageQuotaGb: 1, retentionDays: 7 },
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.resetAllMocks();
  vi.mocked(api.getAccountSettings).mockResolvedValue(account as never);
  vi.mocked(api.saveProfile).mockResolvedValue({ ...account, fullName: 'Edited' } as never);
  vi.mocked(api.saveHouseholdSettings).mockResolvedValue({ syncFailures: [] } as never);
  m.household.mockReturnValue({ data: household, error: '', busy: false, run: m.run });
  m.run.mockImplementation(async (work: () => Promise<void>) => work());
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<CaregiverSettingsView />));
}
async function click(text: string) {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!node) throw Error(text);
  await act(async () => node.click());
}
function input(name: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  act(() => {
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(label: string) {
  const form =
    label === 'storage'
      ? host.querySelectorAll('form')[2]
      : host.querySelector(`form[aria-label="${label}"]`)!;
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('saves profile with optional phone and emits the profile refresh event', async () => {
  const refresh = vi.fn();
  window.addEventListener('camerai-profile-updated', refresh);
  await render();
  expect(host.textContent).toContain('owner@test');
  expect(host.textContent).toContain('Rules true true');
  input('fullName', 'Edited');
  await submit('Hồ sơ chủ hộ');
  expect(api.saveProfile).toHaveBeenLastCalledWith({ fullName: 'Edited' });
  expect(refresh).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Đã lưu hồ sơ');
  input('phone', '+84901234567');
  await submit('Hồ sơ chủ hộ');
  expect(api.saveProfile).toHaveBeenLastCalledWith({ fullName: 'Edited', phone: '+84901234567' });
  window.removeEventListener('camerai-profile-updated', refresh);
});
it('changes the local password and clears password fields', async () => {
  await render();
  input('current', 'old-password');
  input('new', 'new-password');
  await submit('Đổi mật khẩu');
  expect(api.changePassword).toHaveBeenCalledWith({
    currentPassword: 'old-password',
    newPassword: 'new-password',
  });
  expect(host.querySelector<HTMLInputElement>('[name="current"]')!.value).toBe('');
  expect(host.textContent).toContain('thu hồi các phiên');
});
it('creates a one-use Telegram code and refreshes link status', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ linkToken: 'one-use', expiresAt: '2026-01-01' });
  await render();
  expect(host.textContent).toContain('Chưa liên kết Telegram');
  await click('Tạo mã liên kết');
  expect(apiFetch).toHaveBeenCalledWith('/auth/telegram/link', { method: 'POST' });
  expect(host.textContent).toContain('/start one-use');
  vi.mocked(api.getAccountSettings).mockResolvedValue({
    ...account,
    telegramLinked: true,
  } as never);
  await click('Kiểm tra trạng thái');
  expect(host.textContent).toContain('Đã liên kết Telegram');
});
it('persists each notification preference and notifies listeners', async () => {
  const refresh = vi.fn();
  window.addEventListener('camerai-preferences-updated', refresh);
  await render();
  for (let i = 0; i < 3; i++) {
    const check = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[i];
    await act(async () => check.click());
  }
  expect(api.saveNotificationPreferences).toHaveBeenLastCalledWith({
    inAppAlerts: false,
    soundAlerts: false,
    telegramAlerts: false,
  });
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(host.textContent).toContain('Đã lưu tùy chọn');
  window.removeEventListener('camerai-preferences-updated', refresh);
});
it.each([0, 2])('saves retention and explains %i camera sync failures', async (count) => {
  vi.mocked(api.saveHouseholdSettings).mockResolvedValue({
    syncFailures: Array(count).fill('camera'),
  } as never);
  await render();
  expect(host.textContent).toContain('đã vượt ngưỡng');
  input('days', '14');
  input('quota', '5');
  await submit('storage');
  expect(api.saveHouseholdSettings).toHaveBeenCalledWith({ retentionDays: 14, storageQuotaGb: 5 });
  expect(host.textContent).toContain(count ? '2 camera chưa áp dụng' : 'Đã lưu và gửi cấu hình');
});
it.each([new Error('Denied'), 'bad'])(
  'reports account mutation errors without losing form data',
  async (error) => {
    await render();
    vi.mocked(api.changePassword).mockRejectedValueOnce(error);
    input('current', 'old');
    await submit('Đổi mật khẩu');
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thực hiện được');
    expect(host.querySelector<HTMLInputElement>('[name="current"]')!.value).toBe('old');
  },
);
it.each([new Error('Offline'), 'bad'])('reports account load failures', async (error) => {
  vi.mocked(api.getAccountSettings).mockRejectedValue(error);
  await render();
  expect(host.textContent).toContain(error instanceof Error ? 'Offline' : 'Không thực hiện được');
});
it('routes Cognito password changes to hosted recovery and displays household errors', async () => {
  vi.mocked(api.getAccountSettings).mockResolvedValue({
    ...account,
    authProvider: 'cognito',
    phone: '+84901234567',
  } as never);
  m.household.mockReturnValue({
    data: { ...household, storage: { alertMediaBytes: '0' } },
    error: 'Sync unavailable',
    busy: true,
  });
  await render();
  expect(host.textContent).toContain('đăng nhập Cognito');
  expect(host.querySelector('[name="current"]')).toBeNull();
  expect(host.textContent).not.toContain('đã vượt ngưỡng');
  expect(host.textContent).toContain('Sync unavailable');
  expect(host.querySelector<HTMLInputElement>('[name="days"]')!.disabled).toBe(true);
});
it.each(['', 'Storage unavailable'])('shows household load status or error', async (error) => {
  m.household.mockReturnValue({ data: null, error });
  await render();
  expect(host.textContent).toContain(error || 'Đang tải cấu hình lưu trữ');
});
it('aborts a pending profile read on unmount', async () => {
  let reject!: (e: unknown) => void;
  vi.mocked(api.getAccountSettings).mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await render();
  const signal = vi.mocked(api.getAccountSettings).mock.calls[0][0]!;
  await act(async () => root.render(<div />));
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error('aborted')));
});
