// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UIEventItem } from '@/types';
import { EventCard } from './EventCard';
const base: UIEventItem = {
  id: 'event',
  eventType: 'FALL_DETECTED',
  status: 'NOTIFIED',
  priority: 'P1',
  detectedAt: new Date().toISOString(),
  cameraCode: 'CAM1',
  aiTag: 'AI',
  relativeTimeText: 'now',
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
function render(event: UIEventItem, callback = vi.fn()) {
  act(() => root.render(<EventCard event={event} onViewDetail={callback} />));
  return callback;
}
it.each([
  'FIRE_SMOKE_DETECTED',
  'FALL_DETECTED',
  'UNKNOWN_PERSON',
  'PERSON_DETECTED',
  'RESTRICTED_ZONE',
  'WELLNESS_TIMEOUT',
] as const)('shows an accessible action and placeholder for %s', (eventType) => {
  const event = { ...base, eventType },
    callback = render(event);
  expect(host.querySelector('[data-event-type]')?.getAttribute('data-event-type')).toBe(eventType);
  expect(host.querySelector('h3')!.textContent).not.toBe('');
  act(() => host.querySelector('button')!.click());
  expect(callback).toHaveBeenCalledWith(event);
});
it.each(['P0', 'P1', 'P2', 'P3'] as const)(
  'retains priority %s but changes the action for resolved and escalated incidents',
  (priority) => {
    render({ ...base, priority, status: 'NOTIFIED' });
    expect(host.querySelector('button')!.textContent).toBe('Xem chi tiết');
    render({ ...base, priority, status: 'RESOLVED' });
    expect(host.querySelector('button')!.textContent).toBe('Xem lại');
    render({ ...base, priority, status: 'CLOSED' });
    expect(host.querySelector('button')!.textContent).toBe('Xem lại');
    render({ ...base, priority, status: 'ESCALATED' });
    expect(host.querySelector('button')!.textContent).toBe('Xử lý khẩn cấp');
  },
);
it('renders location/confidence/person/notes and retries a snapshot after its signed URL changes', () => {
  render({
    ...base,
    thumbnailUrl: '/one.jpg',
    camera: { name: 'Kitchen' },
    zone: { name: 'Door' },
    confidence: 0,
    matchedPersonName: 'Lan',
    note: 'Checked',
    isFalseAlarm: true,
    aiTagColor: 'danger',
  });
  expect(host.textContent).toContain('Kitchen');
  expect(host.textContent).toContain('Door');
  expect(host.textContent).toContain('AI 0%');
  expect(host.textContent).toContain('Nhận ra Lan');
  expect(host.textContent).toContain('Checked');
  expect(host.textContent).toContain('báo động giả');
  act(() => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();
  render({ ...base, thumbnailUrl: '/two.jpg', aiTagColor: 'neutral' });
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/two.jpg');
  expect(host.querySelector('img')?.alt).toContain('camera');
  render({ ...base, eventType: 'FIRE_SMOKE_DETECTED', priority: 'P0', status: 'RESOLVED' });
  expect(host.querySelector('time')).not.toBeNull();
});
