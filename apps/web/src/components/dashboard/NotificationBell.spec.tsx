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
