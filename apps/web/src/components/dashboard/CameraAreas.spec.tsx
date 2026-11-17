// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from '@/types';
import { CameraAreas } from './CameraAreas';
import { useCameraOrder } from '@/hooks/useCameraOrder';

vi.mock('@/hooks/useCameraSnapshot', () => ({ useCameraSnapshot: () => ({ preview: null }) }));
const cameras = Array.from(
  { length: 6 },
  (_, i) =>
    ({
      id: `cam-${i + 1}`,
      name: `Camera ${i + 1}`,
      isEnabled: true,
      runtimeStatus: 'ONLINE',
    }) as Camera,
);
const toggle = vi.fn(async () => true);
let root: Root;
let host: HTMLDivElement;
function Harness({
  userId = 'a',
  admin = true,
  blocked = false,
}: {
  userId?: string;
  admin?: boolean;
  blocked?: boolean;
}) {
  const { ordered, save } = useCameraOrder(cameras, userId);
  return (
    <CameraAreas
      cameras={ordered}
      onSaveOrder={save}
      onSelect={() => {}}
      isLoading={false}
      isAdmin={admin}
      blocked={blocked}
      toggleLoadingMap={{}}
      onToggle={toggle}
    />
  );
}
beforeEach(() => {
  localStorage.clear();
  toggle.mockClear();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.getAttribute('aria-label') === name || b.textContent === name,
  )!;
const click = async (name: string, scope: ParentNode = document) => {
  await act(async () => button(name, scope).click());
};
const names = (scope: ParentNode) =>
  Array.from(scope.querySelectorAll('[aria-label^="Xem Camera"]')).map((e) =>
    e.getAttribute('aria-label'),
  );
describe('camera area manager', () => {
  it('limits the outer panel to four, pages and opens all cameras in a separate dialog', async () => {
    await act(async () => root.render(<Harness />));
    expect(names(host)).toHaveLength(4);
    expect(button('Chỉnh sửa thứ tự', host)).toBeUndefined();
    await click('Trang camera sau');
    expect(names(host)).toEqual(['Xem Camera 5', 'Xem Camera 6']);
    await click('Xem tất cả');
    expect(names(dialog())).toHaveLength(6);
    expect(dialog().querySelectorAll('[role="switch"]')).toHaveLength(6);
    await click('Bật tắt Camera 1', dialog());
    expect(toggle).toHaveBeenCalledWith('cam-1', false);
    await click('Đóng tất cả camera');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('moves numeric priorities, persists per account and cancels drafts', async () => {
    await act(async () => root.render(<Harness />));
    await click('Xem tất cả');
    await click('Chỉnh sửa thứ tự', dialog());
    const input = dialog().querySelector<HTMLInputElement>('[aria-label="Ưu tiên Camera 6"]')!;
    await act(async () => {
      input.value = '1';
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(names(dialog())[0]).toBe('Xem Camera 6');
    await click('Lưu thứ tự', dialog());
    await click('Đóng tất cả camera');
    expect(names(host)[0]).toBe('Xem Camera 6');
    expect(JSON.parse(localStorage.getItem('cameraai.dashboard.camera-order.a')!)[0]).toBe('cam-6');
    await act(async () => root.render(<Harness userId="b" />));
    expect(names(host)[0]).toBe('Xem Camera 1');
    await act(async () => root.render(<Harness />));
    expect(names(host)[0]).toBe('Xem Camera 6');
    await click('Xem tất cả');
    await click('Chỉnh sửa thứ tự', dialog());
    await click('Đưa Camera 5 lên trước', dialog());
    await click('Hủy', dialog());
    expect(names(dialog())[0]).toBe('Xem Camera 6');
  });
  it('supports drag ordering, denies viewer toggles and closes during a critical alert', async () => {
    await act(async () => root.render(<Harness admin={false} />));
    await click('Xem tất cả');
    expect(button('Bật tắt Camera 1', dialog()).disabled).toBe(true);
    await click('Chỉnh sửa thứ tự', dialog());
    const cards = dialog().querySelectorAll('[draggable="true"]');
    const data = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => 'cam-6' };
    const drag = (type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: data });
      return e;
    };
    await act(async () => cards[5]!.dispatchEvent(drag('dragstart')));
    await act(async () => cards[0]!.dispatchEvent(drag('drop')));
    expect(names(dialog())[0]).toBe('Xem Camera 6');
    await click('Lưu thứ tự', dialog());
    await act(async () => root.render(<Harness admin={false} blocked />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
