// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type { CurrentUser } from '@/lib/auth-client';
import { AlertDeliverySettings } from './AlertDeliverySettings';
import { SettingsView } from './SettingsView';

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/hooks/useHousehold', () => ({ useHousehold: () => ({ data: null }) }));
vi.mock('./EscalationRulesSection', () => ({ EscalationRulesSection: () => null }));

it.each(['CAREGIVER', 'VIEWER'] as const)(
  'shows both notification contact fields in Settings for %s',
  async (role) => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    const user: CurrentUser = {
      id: 'member',
      fullName: 'Thành viên',
      email: 'member@example.test',
      role,
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-11-23T00:00:00Z',
    };
    const mocked = vi.mocked(apiFetch);
    mocked.mockImplementation(async (path) => {
      if (path === '/account') return { ...user, authProvider: 'cognito' };
      if (path === '/account/alert-delivery/phone')
        return { smsAvailable: true, callAvailable: true, status: 'OFF' };
      if (path === '/account/alert-delivery/email')
        return { available: true, accountEmail: user.email, email: user.email, status: 'OFF' };
      throw new Error('Unexpected settings request');
    });
    try {
      await act(async () => root.render(<SettingsView user={user} />));
      const section = container.querySelector('[aria-label="Kênh nhận cảnh báo cá nhân"]');
      expect(section?.querySelector('input[name=phone]')).not.toBeFalsy();
      expect(section?.querySelector('input[name=email]')).not.toBeFalsy();
    } finally {
      await act(async () => root.unmount());
      mocked.mockReset();
    }
  },
);

it('saves the call toggle without turning on SMS, verifies the phone, and uses an alternate email', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const phone = {
    smsAvailable: true,
    callAvailable: true,
    smsEnabled: false,
    callEnabled: false,
    accountPhone: '+84901234567',
    phone: '+84901234567',
    status: 'OFF',
  };
  const email = {
    available: true,
    enabled: false,
    accountEmail: 'user@example.com',
    email: 'user@example.com',
    status: 'OFF',
    confirmationSent: false,
  };
  const mocked = vi.mocked(apiFetch);
  mocked.mockImplementation(async (path, options) => {
    if (path.endsWith('/verify')) return { ...phone, status: 'VERIFIED', callEnabled: true };
    if (path.endsWith('/phone'))
      return options?.method ? { ...phone, status: 'PENDING', callEnabled: true } : phone;
    return options?.method
      ? {
          ...email,
          email: 'alt@example.com',
          enabled: true,
          status: 'PENDING',
          confirmationSent: true,
        }
      : email;
  });
  const input = (name: string) =>
    container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const submit = (name: string) =>
    input(name).form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    input('call').checked = true;
    await act(async () => {
      submit('call');
    });
    expect(mocked).toHaveBeenCalledWith('/account/alert-delivery/phone', {
      method: 'PUT',
      body: JSON.stringify({ callEnabled: true, smsEnabled: false }),
    });
    expect(container.textContent).toContain('Chờ xác minh số điện thoại');
    input('code').value = '123456';
    await act(async () => {
      submit('code');
    });
    expect(mocked).toHaveBeenCalledWith('/account/alert-delivery/phone/verify', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });
    expect(container.textContent).toContain('Đã xác minh +84901234567');
    input('emailEnabled').checked = true;
    input('email').value = 'alt@example.com';
    await act(async () => {
      submit('email');
    });
    expect(mocked).toHaveBeenCalledWith('/account/alert-delivery/email', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, email: 'alt@example.com' }),
    });
    expect(container.textContent).toContain('Chờ xác nhận qua thư gửi đến alt@example.com');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});
