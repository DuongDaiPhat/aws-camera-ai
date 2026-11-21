// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimeField } from './TimeField';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function Harness() {
  const [value, setValue] = useState('23:59:59');
  return <TimeField label="Đến" value={value} onChange={setValue} />;
}
it('shows an unambiguous 24-hour value and commits custom hour/minute/second choices', async () => {
  await act(async () => root.render(<Harness />));
  const input = host.querySelector('input')!;
  expect(input.type).toBe('text');
  expect(input.value).toBe('23:59:59');
  await act(async () => host.querySelector('button')!.click());
  const popup = document.querySelector('[role="dialog"]')!;
  expect(popup.textContent).not.toMatch(/\bAM\b|\bPM\b/);
  await act(async () =>
    popup.querySelector<HTMLButtonElement>('[data-unit="0"][data-value="10"]')!.click(),
  );
  await act(async () =>
    popup.querySelector<HTMLButtonElement>('[data-unit="1"][data-value="5"]')!.click(),
  );
  await act(async () =>
    [...popup.querySelectorAll('button')]
      .find((button) => button.textContent === 'Chọn giờ')!
      .click(),
  );
  expect(input.value).toBe('10:05:59');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('supports keyboard selection and Escape without committing a cancelled edit', async () => {
  await act(async () => root.render(<Harness />));
  const trigger = host.querySelector('button')!;
  await act(async () => trigger.click());
  const selected = document.querySelector<HTMLButtonElement>(
    '[data-unit="0"][aria-selected="true"]',
  )!;
  await act(async () =>
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  );
  expect(document.activeElement?.getAttribute('data-value')).toBe('0');
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(host.querySelector('input')!.value).toBe('23:59:59');
  expect(document.activeElement).toBe(trigger);
});

it.each(['bad', '24:00:00', '12:60:00', '12:00:60'])(
  'identifies invalid time %s and starts the picker at midnight',
  async (value) => {
    await act(async () =>
      root.render(
        <TimeField label="Từ" value={value} onChange={vi.fn()} hideLabel tone="dark" compact />,
      ),
    );
    expect(host.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain('Nhập giờ 24 giờ');
    await act(async () => host.querySelector('button')!.click());
    expect(document.querySelector('output')!.textContent).toBe('00:00:00');
    await act(async () =>
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

it('normalizes a typed value on blur and supports every picker navigation key', async () => {
  const change = vi.fn();
  await act(async () => root.render(<TimeField label="Từ" value="1:2:3" onChange={change} />));
  await act(async () =>
    host.querySelector('input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
  );
  expect(change).toHaveBeenCalledWith('01:02:03');
  await act(async () => host.querySelector('button')!.click());
  const press = async (key: string) =>
    act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
    );
  await press('Home');
  expect(document.activeElement?.getAttribute('data-value')).toBe('0');
  await press('ArrowUp');
  expect(document.activeElement?.getAttribute('data-value')).toBe('23');
  await press('End');
  expect(document.activeElement?.getAttribute('data-value')).toBe('23');
  await press('Enter');
  expect(document.querySelector('output')!.textContent).toBe('23:02:03');
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Đóng bộ chọn giờ"]')!.click(),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
