// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { FamilyView } from './FamilyView';
const mocks = vi.hoisted(() => ({
  grants: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
  use: vi.fn(),
  saveContact: vi.fn(),
  removeContact: vi.fn(),
}));
vi.mock('@/hooks/useHousehold', () => ({ useHousehold: mocks.use }));
vi.mock('@/lib/household-client', () => ({
  setCameraGrants: mocks.grants,
  removeMember: mocks.remove,
  createMember: mocks.create,
  saveContact: mocks.saveContact,
  removeContact: mocks.removeContact,
}));
let root: Root, host: HTMLDivElement;
function button(label: string) {
  const match = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!match) throw Error('Missing button ' + label);
  return match;
}
describe('Caregiver family access', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.clearAllMocks();
    mocks.run.mockImplementation(async (job) => {
      await job();
      return true;
    });
    mocks.use.mockReturnValue({
      loading: false,
      error: null,
      notice: null,
      busy: false,
      run: mocks.run,
      data: {
        authProvider: 'jwt',
        members: [
          {
            id: 'owner',
            fullName: 'Owner',
            email: 'owner@example.test',
            role: 'CAREGIVER',
            grants: [],
          },
          {
            id: 'viewer',
            fullName: 'Resident',
            email: 'resident@example.test',
            role: 'VIEWER',
            grants: [],
          },
        ],
        cameras: [{ id: 'camera', name: 'Living room' }],
        contacts: [],
      },
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  it('saves independent live and history grants and cannot remove the owner', async () => {
    await act(async () => root.render(<FamilyView />));
    expect(
      Array.from(host.querySelectorAll('button')).filter((b) =>
        b.textContent?.includes('Xóa khỏi hộ'),
      ),
    ).toHaveLength(1);
    await act(async () => button('Quyền camera').click());
    const form = host.querySelector('form[aria-label="Quyền camera của Resident"]')!;
    const input = form.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async () => input.click());
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(mocks.grants).toHaveBeenCalledWith('viewer', [
      { cameraId: 'camera', canLive: true, canPlayback: false },
    ]);
  });
  it('requires a separate confirmation before removing a Viewer', async () => {
    await act(async () => root.render(<FamilyView />));
    await act(async () => button('Xóa khỏi hộ').click());
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(async () => button('Hủy').click());
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('creates a Viewer without automatically granting household cameras', async () => {
    await act(async () => root.render(<FamilyView />));
    await act(async () => button('Thêm thành viên').click());
    expect(host.textContent).toContain('Tài khoản mới chỉ xem được những camera bạn cấp quyền.');
    expect(host.querySelector('input[name=password]')?.getAttribute('minlength')).toBe('10');
  });
  it.each(['jwt', 'cognito'])(
    'submits the correct %s identity fields and retains a failed form',
    async (provider) => {
      const state = mocks.use.getMockImplementation()!();
      state.data.authProvider = provider;
      await act(async () => root.render(<FamilyView />));
      await act(async () => button('Thêm thành viên').click());
      const form = host.querySelector('form')!;
      form.querySelector<HTMLInputElement>('[name=fullName]')!.value = 'Mai';
      form.querySelector<HTMLInputElement>('[name=email]')!.value = 'mai@example.test';
      form.querySelector<HTMLInputElement>(
        `[name=${provider === 'jwt' ? 'password' : 'cognitoSub'}]`,
      )!.value = 'identity-value';
      mocks.run.mockImplementationOnce(async (job) => {
        await job();
        return false;
      });
      await act(async () =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      expect(mocks.create).toHaveBeenCalledWith({
        fullName: 'Mai',
        email: 'mai@example.test',
        [provider === 'jwt' ? 'password' : 'cognitoSub']: 'identity-value',
      });
      expect(host.querySelector('form')).not.toBeNull();
      await act(async () =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      expect(host.querySelector('form')).toBeNull();
      await act(async () => button('Thêm thành viên').click());
      await act(async () => button('Hủy').click());
      expect(host.querySelector('form')).toBeNull();
    },
  );
  it('creates, edits and removes emergency contacts with explicit confirmation', async () => {
    const state = mocks.use.getMockImplementation()!();
    state.data.contacts = [
      {
        id: 'contact',
        name: 'Lan',
        phone: '+84901234567',
        priority: 2,
        isEnabled: false,
        isVerified: true,
      },
    ];
    await act(async () => root.render(<FamilyView />));
    expect(host.textContent).toContain('Đã tắt');
    expect(host.textContent).toContain('Đã xác minh');
    await act(async () => button('Sửa').click());
    const form = host.querySelector('form')!;
    expect(form.querySelector<HTMLInputElement>('[name=name]')!.value).toBe('Lan');
    form.querySelector<HTMLInputElement>('[name=name]')!.value = 'Lan New';
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(mocks.saveContact).toHaveBeenCalledWith(
      { name: 'Lan New', phone: '+84901234567', priority: 2, isEnabled: false },
      'contact',
    );
    await act(async () => button('Thêm liên hệ').click());
    const next = host.querySelector('form')!;
    next.querySelector<HTMLInputElement>('[name=name]')!.value = 'Mai';
    next.querySelector<HTMLInputElement>('[name=phone]')!.value = '+84907654321';
    await act(async () =>
      next.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(mocks.saveContact).toHaveBeenLastCalledWith(
      { name: 'Mai', phone: '+84907654321', priority: 1, isEnabled: true },
      undefined,
    );
    await act(async () => button('Xóa').click());
    expect(mocks.removeContact).not.toHaveBeenCalled();
    mocks.run.mockImplementationOnce(async (job) => {
      await job();
      return false;
    });
    await act(async () => button('Xác nhận xóa').click());
    expect(host.textContent).toContain('“Lan”');
    await act(async () => button('Xác nhận xóa').click());
    expect(mocks.removeContact).toHaveBeenCalledWith('contact');
    expect(host.textContent).not.toContain('“Lan”');
  });
  it('saves existing and new camera grants independently and confirms Viewer removal', async () => {
    const state = mocks.use.getMockImplementation()!();
    state.data.cameras.push({ id: 'other', name: 'Kitchen' });
    state.data.members[1].grants.push({ cameraId: 'camera', canLive: true, canPlayback: false });
    state.data.members[1].telegramLinked = true;
    await act(async () => root.render(<FamilyView />));
    expect(host.textContent).toContain('Đã liên kết Telegram');
    await act(async () => button('Quyền camera').click());
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="Xem lại Kitchen"]')!.click(),
    );
    const form = host.querySelector('form')!;
    mocks.run.mockImplementationOnce(async (job) => {
      await job();
      return false;
    });
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(mocks.grants).toHaveBeenCalledWith('viewer', [
      { cameraId: 'camera', canLive: true, canPlayback: false },
      { cameraId: 'other', canLive: false, canPlayback: true },
    ]);
    expect(host.querySelector('form')).not.toBeNull();
    await act(async () => button('Hủy').click());
    expect(host.querySelector('form')).toBeNull();
    await act(async () => button('Xóa khỏi hộ').click());
    await act(async () => button('Xác nhận xóa').click());
    expect(mocks.remove).toHaveBeenCalledWith('viewer');
  });
  it('shows loading/errors/notices, an empty grant list and disables actions when busy', async () => {
    const state = mocks.use.getMockImplementation()!();
    state.loading = true;
    await act(async () => root.render(<FamilyView />));
    expect(host.textContent).toContain('Đang tải gia đình');
    state.loading = false;
    state.error = 'offline';
    state.notice = 'saved';
    state.data.cameras = [];
    await act(async () => root.render(<FamilyView />));
    expect(host.querySelector('[role=alert]')?.textContent).toBe('offline');
    expect(host.querySelector('[role=status]')?.textContent).toBe('saved');
    await act(async () => button('Quyền camera').click());
    expect(host.textContent).toContain('Chưa có camera trong hộ');
    await act(async () => button('Hủy').click());
    await act(async () => button('Thêm liên hệ').click());
    await act(async () => button('Hủy').click());
    state.busy = true;
    await act(async () => root.render(<FamilyView />));
    expect([...host.querySelectorAll('button')].every((item) => item.disabled)).toBe(true);
    state.data = null;
    state.busy = false;
    await act(async () => root.render(<FamilyView />));
    expect(button('Thêm thành viên').disabled).toBe(true);
  });
});
