// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EscalationRuleCard } from './EscalationRuleCard';
vi.mock('./EscalationWaitControl', () => ({
  EscalationWaitControl: ({
    children,
    onChange,
    onHighWaitChange,
  }: {
    children: React.ReactNode;
    onChange: (n: number) => void;
    onHighWaitChange: (n: number) => void;
  }) => (
    <div>
      {children}
      <button onClick={() => onChange(60)}>Change wait</button>
      <button onClick={() => onHighWaitChange(10)}>Change urgent wait</button>
    </div>
  ),
}));
let host: HTMLDivElement, root: Root;
const rule = {
  eventType: 'FALL_DETECTED',
  displayName: 'Fall',
  priority: 'P1',
  tLow: 0.3,
  tHigh: 0.8,
  tWaitSeconds: 30,
  highWaitSeconds: 5,
  version: 2,
  updatedAt: null,
  updatedByName: 'Owner',
};
const draft = { tLow: 0.3, tHigh: 0.8, tWaitSeconds: 30, highWaitSeconds: 5 };
const update = vi.fn(),
  cancel = vi.fn(),
  save = vi.fn(),
  reload = vi.fn();
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function render(props: Partial<React.ComponentProps<typeof EscalationRuleCard>> = {}) {
  act(() =>
    root.render(
      <EscalationRuleCard
        rule={rule as never}
        draft={draft}
        isDirty
        isSaving={false}
        errorMessage={null}
        successMessage={null}
        isAdmin
        onUpdateDraft={update}
        onCancelDraft={cancel}
        onSaveRule={save}
        onReload={reload}
        {...props}
      />,
    ),
  );
}
function button(label: string) {
  const b = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
  if (!b) throw Error(label);
  return b;
}
function input(id: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(`[id="${id}-FALL_DETECTED"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it.each([
  { tLow: null },
  { tHigh: null },
  { tLow: Infinity },
  { tHigh: Infinity },
  { tLow: -0.1 },
  { tLow: 1.1 },
  { tHigh: -0.1 },
  { tHigh: 1.1 },
  { tLow: 0.9, tHigh: 0.8 },
])('rejects invalid confidence thresholds %o', (patch) => {
  render({ draft: { ...draft, ...patch } });
  expect(button('Lưu thay đổi').disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('Ngưỡng thấp');
});
it('edits nullable thresholds, forwards wait/save/cancel and supports version reload', () => {
  render({ errorMessage: 'Cấu hình thay đổi, hãy tải lại', successMessage: 'Saved' });
  input('tLow', '');
  expect(update).toHaveBeenLastCalledWith('FALL_DETECTED', 'tLow', null);
  input('tLow', '0.4');
  expect(update).toHaveBeenLastCalledWith('FALL_DETECTED', 'tLow', 0.4);
  input('tHigh', '');
  expect(update).toHaveBeenLastCalledWith('FALL_DETECTED', 'tHigh', null);
  input('tHigh', '0.9');
  expect(update).toHaveBeenLastCalledWith('FALL_DETECTED', 'tHigh', 0.9);
  act(() => {
    button('Change wait').click();
    button('Change urgent wait').click();
    button('Hủy').click();
    button('Lưu thay đổi').click();
    button('Tải lại ngay').click();
  });
  expect(update).toHaveBeenCalledWith('FALL_DETECTED', 'tWaitSeconds', 60);
  expect(update).toHaveBeenCalledWith('FALL_DETECTED', 'highWaitSeconds', 10);
  expect(cancel).toHaveBeenCalledWith('FALL_DETECTED');
  expect(save).toHaveBeenCalledWith('FALL_DETECTED');
  expect(reload).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Saved');
  expect(host.textContent).toContain('Người sửa: Owner');
});
it('shows compact dirty, saving and error statuses and validates wait durations', () => {
  render({ compact: true });
  expect(host.textContent).toContain('Chưa lưu');
  render({ compact: true, isSaving: true });
  expect(host.textContent).toContain('Đang lưu…');
  expect(button('Hủy').disabled).toBe(true);
  render({ compact: true, errorMessage: 'Denied', draft: { ...draft, tWaitSeconds: 0 } });
  expect(host.textContent).toContain('Lỗi lưu');
  expect(host.textContent).toContain('Thời gian chờ phải');
  expect(button('Lưu thay đổi').disabled).toBe(true);
  render({ draft: { ...draft, highWaitSeconds: 60 } });
  expect(button('Lưu thay đổi').disabled).toBe(true);
  render({ draft: { ...draft, highWaitSeconds: 5 }, isDirty: false });
  expect(button('Lưu thay đổi').disabled).toBe(true);
});
it.each(['P0', 'P2', 'P3'])(
  'renders other priority and legacy metadata combinations %s',
  (priority) => {
    render({
      rule: {
        ...rule,
        displayName: '',
        priority,
        version: undefined,
        updatedAt: '2026-01-01',
        updatedByName: null,
      } as never,
    });
    expect(host.textContent).toContain(`Ưu tiên ${priority}`);
    expect(host.textContent).toContain('FALL_DETECTED');
    expect(host.textContent).toContain('v1');
  },
);
it('does not require confidence thresholds for wellness and hides readonly mutation actions', () => {
  render({
    rule: { ...rule, eventType: 'WELLNESS_TIMEOUT' } as never,
    draft: { ...draft, tLow: null, tHigh: null },
    isAdmin: false,
  });
  expect(host.textContent).toContain('không sử dụng ngưỡng');
  expect(host.querySelector('input')).toBeNull();
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Lưu thay đổi')).toBe(
    false,
  );
});
