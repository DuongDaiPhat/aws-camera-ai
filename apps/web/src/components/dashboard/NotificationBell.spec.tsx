// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';
import { toUIEventItem } from '@/lib/events-client';
let root: Root, host: HTMLDivElement;
const detail = vi.fn(),
  all = vi.fn(),
  retry = vi.fn();
const events = Array.from({ length: 7 }, (_, i) =>
  toUIEventItem({
    id: `e${i}`,
    detectedAt: `2026-11-16T10:0${i}:00Z`,
    eventType: 'UNKNOWN_PERSON',
    priority: i === 0 ? 'P3' : 'P1',
    status: 'NOTIFIED',
    camera: { id: `c${i}`, name: `Cam ${i}` },
  }),
);
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
  vi.restoreAllMocks();
});
const button = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === text || b.getAttribute('aria-label') === text,
  )!;
async function render(props: Partial<React.ComponentProps<typeof NotificationBell>> = {}) {
  await act(async () =>
    root.render(
      <NotificationBell
        events={events}
        now={Date.parse('2026-11-16T10:10:00Z')}
        onViewDetail={detail}
        onViewAll={all}
        onRetry={retry}
        {...props}
      />,
    ),
  );
}
async function click(text: string) {
  await act(async () => button(text).click());
}
it('shows five newest, opens details and navigates to all notifications', async () => {
  await render();
  await click('Thông báo mới nhất');
  const rows = document.querySelectorAll('li');
  expect(rows).toHaveLength(5);
  expect(rows[0]!.textContent).toContain('Cam 6');
  await act(async () => rows[0]!.querySelector('button')!.click());
  expect(detail).toHaveBeenCalledWith(events[6]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Thông báo mới nhất');
  await click('Xem tất cả');
  expect(all).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('closes on outside interaction and critical alert, handles retry/empty', async () => {
  await render({ error: 'Mất kết nối' });
  await click('Thông báo mới nhất');
  await click('Thử lại');
  expect(retry).toHaveBeenCalledOnce();
  await act(async () =>
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ events: [] });
  await click('Thông báo mới nhất');
  expect(document.body.textContent).toContain('Không có thông báo mới');
  await render({ disabled: true });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button('Thông báo mới nhất').disabled).toBe(true);
});

it('restores bell focus on Escape and excludes resolved or routine events from pending', async () => {
  await render({
    events: [{ ...events[0]!, priority: 'P3' }, { ...events[1]!, status: 'RESOLVED' }, events[2]!],
  });
  await click('Thông báo mới nhất');
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('1 cần xử lý');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button('Thông báo mới nhất'));
});

it('promotes P0 only while within three hours and reorders on expiry without marking it read', async () => {
  const expiresAt = Date.parse('2026-11-16T10:10:00Z');
  const p0 = toUIEventItem({
    id: 'old-fire',
    eventType: 'FIRE_SMOKE_DETECTED',
    priority: 'P0',
    status: 'ESCALATED',
    detectedAt: new Date(expiresAt - 10800000).toISOString(),
  });
  const notifications = [events[6]!, p0];
  await render({ events: notifications, now: expiresAt - 1 });
  await click('Thông báo mới nhất');
  let rows = Array.from(document.querySelectorAll('li button'));
  expect(rows[0]?.getAttribute('data-alert')).toBe('urgent');
  expect(rows[0]?.textContent).toContain('Phát hiện lửa');

  await render({ events: notifications, now: expiresAt });
  rows = Array.from(document.querySelectorAll('li button'));
  expect(rows[0]?.textContent).toContain('Cam 6');
  expect(rows[1]?.hasAttribute('data-alert')).toBe(false);
  expect(rows[1]?.textContent).toContain('Đã xử lý');
  expect(rows[1]?.getAttribute('data-unread')).toBe('true');

  await render({ events: notifications, now: expiresAt, readIds: new Set([p0.id]) });
  expect(document.querySelectorAll('li button')[1]?.hasAttribute('data-unread')).toBe(false);
});

it('renders loading and errors without offering an unavailable retry callback', async () => {
  await render({ isLoading: true });
  await click('Thông báo mới nhất');
  expect(document.querySelector('[role=status]')).not.toBeNull();
  await render({ error: 'Offline', isLoading: false, onRetry: undefined });
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Offline');
  expect(button('Thử lại')).toBeUndefined();
  await click('Đóng thông báo');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(button('Thông báo mới nhất'));
});
it('caps large counts, handles thumbnail failures and distinguishes read/escalated notifications', async () => {
  const many = Array.from({ length: 105 }, (_, index) => ({
    ...events[1]!,
    id: `many-${index}`,
    status: index === 104 ? ('ESCALATED' as const) : ('NOTIFIED' as const),
    thumbnailUrl: '/image.jpg',
  }));
  await render({ events: many, readIds: new Set(many.map((item) => item.id)) });
  expect(host.textContent).toContain('99+');
  await click('Thông báo mới nhất');
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('99+ cần xử lý');
  expect(document.querySelector('li button')?.hasAttribute('data-unread')).toBe(false);
  const image = document.querySelector('li img')! as HTMLImageElement;
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(image.style.display).toBe('none');
});
it('keeps the popover in the viewport and reacts to resize and inside/outside pointer interactions', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 600,
    bottom: 640,
    right: 1200,
    left: 1160,
    width: 40,
    height: 40,
  } as DOMRect);
  await render();
  await click('Thông báo mới nhất');
  let dialog = document.querySelector('[role=dialog]') as HTMLElement;
  expect(parseFloat(dialog.style.left)).toBeLessThan(window.innerWidth);
  expect(parseFloat(dialog.style.top)).toBeLessThan(600);
  await act(async () => {
    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
    top: 0,
    bottom: 20,
    right: 20,
    left: 0,
    width: 20,
    height: 20,
  } as DOMRect);
  await act(async () => window.dispatchEvent(new Event('resize')));
  dialog = document.querySelector('[role=dialog]') as HTMLElement;
  expect(dialog.style.left).toBe('12px');
  await act(async () =>
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
