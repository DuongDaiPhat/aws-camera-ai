// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEscalationRules, toRuleDraft } from './useEscalationRules';
import { fetchEscalationRules, updateEscalationThresholds } from '@/lib/escalation-rules-client';
import { ApiError } from '@/lib/api-client';
vi.mock('@/lib/escalation-rules-client', () => ({
  fetchEscalationRules: vi.fn(),
  updateEscalationThresholds: vi.fn(),
}));
let root: Root, host: HTMLDivElement, state: ReturnType<typeof useEscalationRules>;
const rule = {
  eventType: 'FALL_DETECTED',
  tLow: 0.3,
  tHigh: 0.8,
  tWaitSeconds: 30,
  highWaitSeconds: 5,
  version: 2,
};
function Harness({ household = false }) {
  state = useEscalationRules(household);
  return null;
}
async function mount(household = false) {
  await act(async () => root.render(<Harness household={household} />));
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.mocked(fetchEscalationRules)
    .mockReset()
    .mockResolvedValue([rule, { ...rule, eventType: 'PERSON_DETECTED' }] as never);
  vi.mocked(updateEscalationThresholds).mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('filters internal rules and supports draft edits and cancel', async () => {
  await mount(true);
  expect(fetchEscalationRules).toHaveBeenCalledWith(true);
  expect(state.rules).toEqual([rule]);
  expect(state.isLoading).toBe(false);
  expect(state.isDirty('FALL_DETECTED')).toBe(false);
  expect(state.isDirty('missing')).toBe(false);
  for (const [field, value] of [
    ['tLow', 0.4],
    ['tHigh', 0.9],
    ['tWaitSeconds', 60],
    ['highWaitSeconds', 10],
  ] as const) {
    act(() => state.updateDraft('FALL_DETECTED', field, value));
    expect(state.isDirty('FALL_DETECTED')).toBe(true);
    act(() => state.cancelDraft('FALL_DETECTED'));
    expect(state.isDirty('FALL_DETECTED')).toBe(false);
  }
  act(() => state.updateDraft('unknown', 'tLow', 0.2));
  expect(state.drafts.unknown).toEqual({
    tLow: 0.2,
    tHigh: null,
    tWaitSeconds: NaN,
    highWaitSeconds: null,
  });
  act(() => state.cancelDraft('unknown'));
  await act(async () => state.saveRule('unknown'));
  expect(updateEscalationThresholds).not.toHaveBeenCalled();
  expect(toRuleDraft({ tWaitSeconds: 30 } as never)).toEqual({
    tLow: null,
    tHigh: null,
    highWaitSeconds: null,
    tWaitSeconds: 30,
  });
});
it('saves with optimistic version and replaces only the saved rule', async () => {
  vi.mocked(fetchEscalationRules).mockResolvedValue([
    rule,
    { ...rule, eventType: 'FIRE_SMOKE_DETECTED' },
  ] as never);
  await mount(true);
  act(() => state.updateDraft('FALL_DETECTED', 'tWaitSeconds', 45));
  vi.mocked(updateEscalationThresholds).mockResolvedValue({
    ...rule,
    tWaitSeconds: 45,
    version: 3,
  } as never);
  await act(async () => state.saveRule('FALL_DETECTED'));
  expect(updateEscalationThresholds).toHaveBeenCalledWith(
    'FALL_DETECTED',
    { tLow: 0.3, tHigh: 0.8, tWaitSeconds: 45, highWaitSeconds: 5, expectedVersion: 2 },
    true,
  );
  expect(state.rules[1].eventType).toBe('FIRE_SMOKE_DETECTED');
  expect(state.isDirty('FALL_DETECTED')).toBe(false);
  expect(state.successMap.FALL_DETECTED).toContain('v3');
  expect(state.savingMap.FALL_DETECTED).toBe(false);
  act(() => state.updateDraft('FALL_DETECTED', 'tLow', 0.5));
  expect(state.successMap.FALL_DETECTED).toBeNull();
});
it('uses version 1 for legacy rules', async () => {
  vi.mocked(fetchEscalationRules).mockResolvedValue([
    { ...rule, version: undefined, highWaitSeconds: undefined },
  ] as never);
  vi.mocked(updateEscalationThresholds).mockResolvedValue(rule as never);
  await mount();
  await act(async () => state.saveRule('FALL_DETECTED'));
  expect(vi.mocked(updateEscalationThresholds).mock.calls[0][1].expectedVersion).toBe(1);
});
it.each([
  [new ApiError(409, 'TEST', 'conflict'), 'Cấu hình đã thay đổi'],
  [new ApiError(400, 'TEST', 'invalid'), 'invalid'],
  [new ApiError(400, 'TEST', ''), 'Lưu cấu hình thất bại'],
  [new Error('offline'), 'Lỗi kết nối máy chủ'],
])('reports a save failure without discarding the draft', async (error, text) => {
  await mount();
  act(() => state.updateDraft('FALL_DETECTED', 'tLow', 0.5));
  vi.mocked(updateEscalationThresholds).mockRejectedValue(error);
  await act(async () => state.saveRule('FALL_DETECTED'));
  expect(state.errorMap.FALL_DETECTED).toContain(text);
  expect(state.drafts.FALL_DETECTED.tLow).toBe(0.5);
  expect(state.savingMap.FALL_DETECTED).toBe(false);
});
it.each([
  [new ApiError(403, 'TEST', 'denied'), 'denied'],
  [new ApiError(500, 'TEST', ''), 'Không thể tải'],
  [new Error('offline'), 'Lỗi kết nối'],
])('reports a load failure and allows retry', async (error, text) => {
  vi.mocked(fetchEscalationRules).mockRejectedValueOnce(error);
  await mount();
  expect(state.error).toContain(text);
  expect(state.isLoading).toBe(false);
  await act(async () => state.reload());
  expect(state.error).toBeNull();
  expect(state.rules).toHaveLength(1);
});
