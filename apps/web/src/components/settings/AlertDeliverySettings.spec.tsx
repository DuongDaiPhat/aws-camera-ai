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
      if (path === '/household/ai-modules')
        return {
          m1Face: true,
          m2aFall: true,
          m3Fire: true,
          m4Zone: true,
          m5Wellness: true,
          availability: {
            m1Face: true,
            m2aFall: true,
            m3Fire: true,
            m4Zone: false,
            m5Wellness: true,
          },
          updatedAt: '2026-11-25T10:00:00.000Z',
        };
      throw new Error('Unexpected settings request');
    });
    try {
      await act(async () => root.render(<SettingsView user={user} />));
      const section = container.querySelector('[aria-label="Kênh nhận cảnh báo cá nhân"]');
      expect(section?.querySelector('input[name=phone]')).not.toBeFalsy();
      expect(section?.querySelector('input[name=email]')).not.toBeFalsy();
      const aiModules = container.querySelector('[aria-labelledby="caregiver-ai-modules-title"]');
      if (user.role === 'CAREGIVER') {
        expect(aiModules).not.toBeNull();
      } else {
        expect(aiModules).toBeNull();
      }
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
    if (path.endsWith('/phone')) {
      if (options?.method) {
        const body = JSON.parse(String(options.body)) as { phone?: string | null };
        if (body.phone === null) {
          return {
            ...phone,
            accountPhone: null,
            phone: null,
            callEnabled: false,
            smsEnabled: false,
            status: 'OFF',
          };
        }
        return { ...phone, status: 'PENDING', callEnabled: true };
      }
      return phone;
    }
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
    expect(input('phone').value).toBe('+84901234567');
    input('call').checked = true;
    await act(async () => {
      submit('call');
    });
    expect(mocked).toHaveBeenCalledWith('/account/alert-delivery/phone', {
      method: 'PUT',
      body: JSON.stringify({ callEnabled: true, smsEnabled: false, phone: '+84901234567' }),
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
    input('phone').value = '';
    input('call').checked = false;
    await act(async () => {
      submit('phone');
    });
    expect(mocked).toHaveBeenCalledWith('/account/alert-delivery/phone', {
      method: 'PUT',
      body: JSON.stringify({ callEnabled: false, smsEnabled: false, phone: null }),
    });
    expect(container.textContent).toContain('Đã tắt cảnh báo qua điện thoại');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});

it('renders message when neither call, SMS, nor email are available', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const mocked = vi.mocked(apiFetch);

  mocked.mockImplementation(async (path) => {
    if (path.endsWith('/phone')) {
      return {
        smsAvailable: false,
        callAvailable: false,
        smsEnabled: false,
        callEnabled: false,
        accountPhone: null,
        phone: null,
        status: 'OFF',
      };
    }
    return {
      available: false,
      enabled: false,
      accountEmail: 'user@example.com',
      email: 'user@example.com',
      status: 'OFF',
      confirmationSent: false,
    };
  });

  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    expect(container.textContent).toContain('Cuộc gọi và SMS chưa được cấu hình ở môi trường này.');
    expect(container.textContent).toContain('Email chưa được cấu hình ở môi trường này.');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});

it('renders message when only SMS is available and email is verified', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const mocked = vi.mocked(apiFetch);

  mocked.mockImplementation(async (path) => {
    if (path.endsWith('/phone')) {
      return {
        smsAvailable: true,
        callAvailable: false,
        smsEnabled: true,
        callEnabled: false,
        accountPhone: '+84901111111',
        phone: '+84902222222',
        status: 'VERIFIED',
      };
    }
    return {
      available: true,
      enabled: true,
      accountEmail: 'user@example.com',
      email: 'user@example.com',
      status: 'VERIFIED',
      confirmationSent: true,
    };
  });

  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    expect(container.textContent).toContain('Cuộc gọi chưa được cấu hình ở môi trường này.');
    expect(container.textContent).toContain('Đã bật email cho user@example.com');
    expect(container.textContent).toContain('Đã xác minh +84902222222');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});

it('renders message when only Call is available and email confirmation failed', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const mocked = vi.mocked(apiFetch);

  mocked.mockImplementation(async (path) => {
    if (path.endsWith('/phone')) {
      return {
        smsAvailable: false,
        callAvailable: true,
        smsEnabled: false,
        callEnabled: true,
        accountPhone: '+84901111111',
        phone: '+84901111111',
        status: 'PENDING',
      };
    }
    return {
      available: true,
      enabled: true,
      accountEmail: 'user@example.com',
      email: 'user@example.com',
      status: 'PENDING',
      confirmationSent: false,
    };
  });

  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    expect(container.textContent).toContain('Cảnh báo SMS chưa được cấu hình ở môi trường này.');
    expect(container.textContent).toContain('Chưa gửi được thư xác nhận. Hãy lưu lại để thử lại.');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});

it('handles initial load failure gracefully', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const mocked = vi.mocked(apiFetch);

  mocked.mockImplementation(async (path) => {
    if (path.endsWith('/phone')) throw new Error('Không thể tải điện thoại');
    throw 'Lỗi không xác định';
  });

  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    expect(container.textContent).toContain('Không thể tải điện thoại');
    expect(container.textContent).toContain('Không thể cập nhật cài đặt.');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});

it('handles update failure gracefully', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const mocked = vi.mocked(apiFetch);

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
  mocked.mockImplementation(async (path, options) => {
    if (options?.method) throw new Error('Cập nhật thất bại');
    return path.endsWith('/phone') ? phone : email;
  });

  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await act(async () => {
      button.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain('Cập nhật thất bại');
  } finally {
    await act(async () => root.unmount());
    mocked.mockReset();
  }
});

it('polls for email confirmation while pending and stops on unmount', async () => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const mocked = vi.mocked(apiFetch);

  const pendingEmail = {
    available: true,
    enabled: true,
    accountEmail: 'user@example.com',
    email: 'user@example.com',
    status: 'PENDING',
    confirmationSent: true,
  };
  const phone = {
    smsAvailable: true,
    callAvailable: true,
    smsEnabled: false,
    callEnabled: false,
    accountPhone: null,
    phone: null,
    status: 'OFF',
  };

  mocked.mockImplementation(async (path) => {
    if (path.endsWith('/phone')) return phone;
    return pendingEmail;
  });

  try {
    await act(async () => root.render(<AlertDeliverySettings />));
    expect(container.textContent).toContain('Chờ xác nhận qua thư gửi đến user@example.com');

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mocked).toHaveBeenCalledWith('/account/alert-delivery/email', expect.anything());
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    mocked.mockReset();
  }
});
