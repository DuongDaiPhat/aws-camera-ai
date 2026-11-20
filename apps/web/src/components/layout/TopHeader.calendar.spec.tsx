// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopHeader } from './TopHeader';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 12));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('header calendar and filters', () => {
  it('moves across the year boundary and returns to the actual current week', async () => {
    await act(async () => root.render(<TopHeader userName="Minh" />));
    expect(container.querySelector('[aria-current="date"] time')?.getAttribute('dateTime')).toBe(
      '2026-12-31',
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Tuần sau"]')?.click(),
    );
    expect(container.textContent).toContain('Tháng 1, 2027');
    expect(container.querySelector('[aria-current="date"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Về hôm nay"]')?.click(),
    );
    expect(container.querySelector('[aria-current="date"] time')?.getAttribute('dateTime')).toBe(
      '2026-12-31',
    );
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(container.querySelector('[aria-current="date"] time')?.getAttribute('dateTime')).toBe(
      '2027-01-01',
    );
  });

  it('places the bell before a static dark/light control and removes the area filter', async () => {
    const view = vi.fn();
    await act(async () => root.render(<TopHeader onViewEvents={view} />));
    expect(container.querySelector('[aria-label="Lọc theo khu vực"]')).toBeNull();
    const bell = container.querySelector<HTMLButtonElement>('[aria-label="Xem cảnh báo"]')!;
    const theme = container.querySelector<HTMLButtonElement>(
      '[aria-label="Giao diện sáng / tối (sắp có)"]',
    )!;
    expect(theme.getAttribute('aria-disabled')).toBe('true');
    expect(bell.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => theme.click());
    expect(view).not.toHaveBeenCalled();
  });
});

describe('arbitrary date picker', () => {
  it('jumps directly to a distant local date and returns to today', async () => {
    await act(async () => root.render(<TopHeader />));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Chọn ngày"]')!.click(),
    );
    const popup = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Chọn ngày tháng năm"]',
    )!;
    expect(popup).not.toBeNull();
    expect(container.querySelector('form')).toBeNull();
    const year = popup.querySelector<HTMLInputElement>('[aria-label="Chọn năm"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(year, '2042');
      year.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      popup.querySelector<HTMLButtonElement>('[aria-label="Chọn tháng"]')!.click(),
    );
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent === 'Tháng 8')!
        .click(),
    );
    await act(async () =>
      popup.querySelector<HTMLButtonElement>('[aria-label="Thứ Bảy, 23 tháng 8, 2042"]')!.click(),
    );
    expect(container.querySelector('[aria-pressed="true"] time')?.getAttribute('dateTime')).toBe(
      '2042-08-23',
    );
    expect(container.textContent).toContain('Tháng 8, 2042');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Về hôm nay"]')!.click(),
    );
    expect(container.querySelector('[aria-pressed="true"] time')?.getAttribute('dateTime')).toBe(
      '2026-12-31',
    );
  });
});
