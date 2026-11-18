// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
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
