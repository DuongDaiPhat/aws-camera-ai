// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SlidingTabs } from './SlidingTabs';
const m = vi.hoisted(() => ({ reduced: false, disconnect: vi.fn(), scroll: vi.fn() }));
vi.mock('motion/react', () => ({
  useReducedMotion: () => m.reduced,
  motion: {
    span: ({
      children,
      animate,
      ...props
    }: React.ComponentProps<'span'> & {
      animate: Record<string, number>;
      transition: unknown;
      initial: unknown;
    }) => {
      const { transition: _transition, initial: _initial, ...rest } = props;
      void _transition;
      void _initial;
      return (
        <span {...rest} data-position={JSON.stringify(animate)}>
          {children}
        </span>
      );
    },
  },
}));
let host: HTMLDivElement, root: Root;
const items = [
  { id: 'one', label: 'First', icon: 'camera' as const, count: 3 },
  { id: 'two', label: 'Second' },
  { id: 'three', label: 'Third', count: 0 },
];
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  m.reduced = false;
  vi.clearAllMocks();
  Object.defineProperty(document, 'fonts', {
    value: {
      ready: {
        then: (done: () => void) => {
          done();
          return Promise.resolve();
        },
      },
    },
    configurable: true,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {
        m.disconnect();
      }
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: m.scroll, configurable: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(props: Partial<React.ComponentProps<typeof SlidingTabs>> = {}) {
  await act(async () =>
    root.render(
      <SlidingTabs items={items} label="Sections" value="one" onChange={vi.fn()} {...props} />,
    ),
  );
}
function key(node: HTMLElement, value: string) {
  act(() => node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
}
it('provides accessible tab counts and wraps keyboard navigation', async () => {
  const change = vi.fn();
  await render({ variant: 'filter', onChange: change });
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(tabs[0].getAttribute('aria-label')).toBe('First (3)');
  expect(tabs[2].getAttribute('aria-label')).toBe('Third (0)');
  expect(tabs[1].tabIndex).toBe(-1);
  key(tabs[0], 'ArrowLeft');
  expect(change).toHaveBeenLastCalledWith('three');
  expect(document.activeElement).toBe(tabs[2]);
  key(tabs[2], 'ArrowRight');
  expect(change).toHaveBeenLastCalledWith('one');
  key(tabs[0], 'End');
  expect(change).toHaveBeenLastCalledWith('three');
  key(tabs[2], 'Home');
  expect(change).toHaveBeenLastCalledWith('one');
  const count = change.mock.calls.length;
  key(tabs[0], 'Escape');
  expect(change).toHaveBeenCalledTimes(count);
  act(() => tabs[1].click());
  expect(change).toHaveBeenLastCalledWith('two');
});
it('moves the hover indicator and restores selected navigation when focus leaves', async () => {
  const change = vi.fn();
  await render({ onChange: change, collapsed: true, orientation: 'vertical' });
  const tabs = host.querySelectorAll('button');
  expect(tabs[0].title).toBe('First');
  expect(tabs[0].getAttribute('aria-current')).toBe('page');
  key(tabs[0], 'ArrowRight');
  expect(change).not.toHaveBeenCalled();
  act(() => tabs[1].dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
  act(() => tabs[1].focus());
  expect(document.activeElement).toBe(tabs[1]);
  act(() => tabs[0].focus());
  act(() => tabs[0].blur());
  act(() =>
    host
      .querySelector('[aria-label="Sections"]')!
      .dispatchEvent(new MouseEvent('pointerout', { bubbles: true })),
  );
  expect(host.querySelector('[data-nav-indicator="navigation"]')).not.toBeNull();
});
it('scrolls an active horizontal tab into view and honors reduced motion', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.value === 'two' ? 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(60);
  await render({ value: 'two' });
  expect(m.scroll).toHaveBeenCalledWith({ left: 98, behavior: 'smooth' });
  const container = host.querySelector<HTMLElement>('[aria-label="Sections"]')!;
  container.scrollLeft = 100;
  m.reduced = true;
  await render({ value: 'one' });
  expect(m.scroll).toHaveBeenLastCalledWith({ left: -8, behavior: 'instant' });
  await render({ value: 'missing' });
  expect(m.disconnect).toHaveBeenCalled();
});
