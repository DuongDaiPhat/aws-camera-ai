// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsersView } from './UsersView';
import { ApiError, apiFetch } from '@/lib/api-client';
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  apiFetch: vi.fn(),
}));
let host: HTMLDivElement, root: Root;
const user = {
  id: 'viewer',
  email: 'viewer@test',
  fullName: 'Viewer',
  role: 'VIEWER',
  isActive: false,
  isCognitoLinked: false,
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.resetAllMocks();
  vi.mocked(apiFetch).mockImplementation(async (path) => ({
    data: [user],
    meta: { page: Number(path.split('page=')[1]) || 1, pageSize: 1, total: 2 },
  }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<UsersView currentUserId="admin" />));
}
async function click(text: string) {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!node) throw Error(text);
  await act(async () => node.click());
}
it('pages account results, cancels role edits and opens or closes creation', async () => {
  await render();
  expect(host.textContent).toContain('Đã vô hiệu hóa');
  expect(host.textContent).toContain('Chưa liên kết Cognito');
  await click('Đổi quyền');
  expect(host.querySelector('select')).not.toBeNull();
  await click('Hủy');
  expect(host.querySelector('select')).toBeNull();
  await click('Sau');
  expect(apiFetch).toHaveBeenLastCalledWith('/users?page=2', { signal: expect.any(AbortSignal) });
  expect(host.textContent).toContain('Trang 2/2');
  await click('Trước');
  expect(host.textContent).toContain('Trang 1/2');
  await click('+ Tạo tài khoản');
  expect(host.querySelector('form')).not.toBeNull();
  await click('Đóng biểu mẫu');
  expect(host.querySelector('form')).toBeNull();
});
it.each([new ApiError(503, 'UNAVAILABLE', 'Server unavailable'), new Error('offline')])(
  'retries list load errors and displays empty results',
  async (error) => {
    vi.mocked(apiFetch).mockRejectedValueOnce(error);
    await render();
    expect(host.textContent).toContain(
      error instanceof ApiError ? 'Server unavailable' : 'Không tải được danh sách',
    );
    vi.mocked(apiFetch).mockResolvedValueOnce({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    await click('Tải lại');
    expect(host.textContent).toContain('Chưa có tài khoản');
  },
);
it.each([new ApiError(409, 'CONFLICT', 'Role conflict'), new Error('offline')])(
  'keeps an unsuccessful role draft editable',
  async (error) => {
    await render();
    await click('Đổi quyền');
    const select = host.querySelector('select')!;
    act(() => {
      select.value = 'CAREGIVER';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    vi.mocked(apiFetch).mockRejectedValueOnce(error);
    await click('Lưu vai trò');
    expect(host.textContent).toContain(
      error instanceof ApiError ? 'Role conflict' : 'Không lưu được vai trò',
    );
    expect(select.value).toBe('CAREGIVER');
    expect(select.disabled).toBe(false);
  },
);
it('creates a user from trimmed Cognito identity fields then refreshes the list', async () => {
  await render();
  await click('+ Tạo tài khoản');
  for (const [name, value] of [
    ['fullName', ' New Viewer '],
    ['email', 'new@test'],
    ['cognitoSub', ' sub-123 '],
  ])
    host.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...user, email: 'new@test' });
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(apiFetch).toHaveBeenCalledWith('/users', {
    method: 'POST',
    body: JSON.stringify({
      email: 'new@test',
      fullName: 'New Viewer',
      cognitoSub: 'sub-123',
      role: 'VIEWER',
    }),
  });
  expect(host.textContent).toContain('Đã tạo tài khoản new@test');
  expect(apiFetch).toHaveBeenLastCalledWith('/users?page=1', { signal: expect.any(AbortSignal) });
});
it.each([new ApiError(400, 'INVALID', 'Invalid identity'), new Error('offline')])(
  'reports account creation errors without losing input',
  async (error) => {
    await render();
    await click('+ Tạo tài khoản');
    const input = host.querySelector<HTMLInputElement>('[name="fullName"]')!;
    input.value = 'Viewer';
    vi.mocked(apiFetch).mockRejectedValueOnce(error);
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(host.textContent).toContain(
      error instanceof ApiError ? 'Invalid identity' : 'Không thể tạo tài khoản',
    );
    expect(input.value).toBe('Viewer');
  },
);
it('discards a list result after cancellation', async () => {
  let done!: (data: never) => void;
  vi.mocked(apiFetch).mockReturnValue(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  await render();
  const signal = vi.mocked(apiFetch).mock.calls[0][1]!.signal!;
  await act(async () => root.render(<div />));
  expect(signal.aborted).toBe(true);
  await act(async () => done({ data: [user], meta: { page: 1, pageSize: 20, total: 1 } } as never));
  expect(host.textContent).toBe('');
});
