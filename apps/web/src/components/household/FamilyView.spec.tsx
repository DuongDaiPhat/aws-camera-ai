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
}));
vi.mock('@/hooks/useHousehold', () => ({ useHousehold: mocks.use }));
vi.mock('@/lib/household-client', () => ({
  setCameraGrants: mocks.grants,
  removeMember: mocks.remove,
  createMember: mocks.create,
  saveContact: vi.fn(),
  removeContact: vi.fn(),
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
});
