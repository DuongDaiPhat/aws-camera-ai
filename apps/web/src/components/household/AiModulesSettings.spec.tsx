// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseholdAiModulesSettings } from '@/lib/household-client';
import { AiModulesSettings } from './AiModulesSettings';

const mocks = vi.hoisted(() => ({
  getHouseholdAiModules: vi.fn(),
  saveHouseholdAiModules: vi.fn(),
}));

vi.mock('@/lib/household-client', () => ({
  getHouseholdAiModules: mocks.getHouseholdAiModules,
  saveHouseholdAiModules: mocks.saveHouseholdAiModules,
}));

function makeSettings(
  overrides: Partial<HouseholdAiModulesSettings> = {},
): HouseholdAiModulesSettings {
  return {
    m1Face: true,
    m2aFall: true,
    m3Fire: false,
    m4Zone: true,
    m5Wellness: false,
    availability: {
      m1Face: true,
      m2aFall: true,
      m3Fire: true,
      m4Zone: false,
      m5Wellness: true,
    },
    updatedAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AiModulesSettings', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows loading state then renders all 5 modules with status and server availability badges', async () => {
    const req = deferred<HouseholdAiModulesSettings>();
    mocks.getHouseholdAiModules.mockReturnValueOnce(req.promise);

    await act(async () => root.render(<AiModulesSettings />));
    expect(host.textContent).toContain('Đang tải cấu hình các module AI…');

    await act(async () => {
      req.resolve(makeSettings());
      await req.promise;
    });

    for (const key of ['m1Face', 'm2aFall', 'm3Fire', 'm4Zone', 'm5Wellness']) {
      expect(host.querySelector(`input[name="${key}"]`)).not.toBeNull();
    }
    expect(host.textContent).toContain('Nhận diện khuôn mặt');
    expect(host.textContent).toContain('Phát hiện té ngã');
    expect(host.textContent).toContain('Phát hiện cháy & khói');
    expect(host.textContent).toContain('Giám sát vùng cấm');
    expect(host.textContent).toContain('Kiểm tra an sinh định kỳ');
    expect(host.textContent).toContain('Đang bật');
    expect(host.textContent).toContain('Đang tắt');
    expect(host.textContent).toContain('Máy chủ chưa bật');

    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
  });

  it('shows load error when fetching AI module settings fails', async () => {
    mocks.getHouseholdAiModules.mockRejectedValueOnce(
      new Error('Không có quyền truy cập module AI.'),
    );

    await act(async () => root.render(<AiModulesSettings />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Không có quyền truy cập module AI.',
    );
  });

  it('toggles modules and saves updated configuration', async () => {
    const initial = makeSettings();
    const updated = makeSettings({ m3Fire: true, m5Wellness: true });
    mocks.getHouseholdAiModules.mockResolvedValueOnce(initial);
    mocks.saveHouseholdAiModules.mockResolvedValueOnce(updated);

    await act(async () => root.render(<AiModulesSettings />));

    const fireCheckbox = host.querySelector<HTMLInputElement>('input[name="m3Fire"]')!;
    const wellnessCheckbox = host.querySelector<HTMLInputElement>('input[name="m5Wellness"]')!;
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    await act(async () => {
      fireCheckbox.click();
      wellnessCheckbox.click();
    });
    expect(submit.disabled).toBe(false);

    await act(async () => {
      fireCheckbox.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(mocks.saveHouseholdAiModules).toHaveBeenCalledWith({
      m1Face: true,
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: true,
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Đã lưu cấu hình các module AI cho hộ gia đình.',
    );
    expect(submit.disabled).toBe(true);
  });

  it('surfaces save errors without losing draft edits', async () => {
    mocks.getHouseholdAiModules.mockResolvedValueOnce(makeSettings());
    mocks.saveHouseholdAiModules.mockRejectedValueOnce(new Error('Caregiver only'));

    await act(async () => root.render(<AiModulesSettings />));

    const m1Checkbox = host.querySelector<HTMLInputElement>('input[name="m1Face"]')!;
    await act(async () => {
      m1Checkbox.click();
    });
    expect(m1Checkbox.checked).toBe(false);

    await act(async () => {
      m1Checkbox.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Caregiver only');
    expect(m1Checkbox.checked).toBe(false);
  });
});
