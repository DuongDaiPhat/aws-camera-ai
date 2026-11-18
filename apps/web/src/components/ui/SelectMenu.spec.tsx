// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SelectMenu } from './SelectMenu';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

it('limits long camera layout menus to six rows and reaches remaining options with the keyboard', async () => {
  const change = vi.fn();
  const choices = [1, 2, 4, 6, 8, 10, 12]
    .map((count) => ({ value: String(count), label: `${count} camera` }))
    .concat({ value: 'custom', label: 'Tùy chỉnh' });
  await act(async () =>
    root.render(
      <SelectMenu
        label="Bố cục"
        options={choices}
        value="2"
        onChange={change}
        visibleOptions={6}
      />,
    ),
  );
  const trigger = host.querySelector('button')!;
  await act(async () => trigger.click());
  const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.style.maxHeight).toBe('240px');
  expect(list.querySelectorAll('[role="option"]')).toHaveLength(8);
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
  );
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  expect(change).toHaveBeenCalledWith('custom');
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const options = [
  { value: '2', label: '2 camera' },
  { value: '4', label: '4 camera' },
  { value: 'custom', label: 'Tùy chỉnh' },
];
it('opens a custom list and selects using keyboard, restoring its collapsed state', async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(<SelectMenu label="Bố cục" options={options} value="2" onChange={change} />),
  );
  const trigger = host.querySelector('button')!;
  const press = async (key: string) =>
    act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  await press('ArrowDown');
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  expect(change).not.toHaveBeenCalled();
  await press('ArrowDown');
  await press('Enter');
  expect(change).toHaveBeenCalledWith('4');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  await act(async () => trigger.click());
  await press('Escape');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('supports pointer selection and closes on outside interaction without changing the value', async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(<SelectMenu label="Bố cục" options={options} value="2" onChange={change} />),
  );
  const trigger = host.querySelector('button')!;
  await act(async () => trigger.click());
  await act(async () => document.querySelectorAll<HTMLElement>('[role="option"]')[2]!.click());
  expect(change).toHaveBeenCalledWith('custom');
  await act(async () => trigger.click());
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(change).toHaveBeenCalledOnce();
});
