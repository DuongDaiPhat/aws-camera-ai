// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';
import { EscalationRulesSection } from './EscalationRulesSection';
const m = vi.hoisted(() => ({
  rules: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/hooks/useEscalationRules', () => ({
  useEscalationRules: m.rules,
  toRuleDraft: (rule: Record<string, unknown>) => ({
    tLow: rule.tLow,
    tHigh: rule.tHigh,
    tWaitSeconds: rule.tWaitSeconds,
    highWaitSeconds: rule.highWaitSeconds ?? null,
  }),
}));
vi.mock('@/components/household/CaregiverSettingsView', () => ({
  CaregiverSettingsView: () => <div>Household settings</div>,
}));
vi.mock('./EscalationRuleCard', () => ({
  EscalationRuleCard: ({
    rule,
    draft,
    onUpdateDraft,
    onCancelDraft,
    onSaveRule,
    onReload,
    errorMessage,
    successMessage,
    isAdmin,
  }: {
    rule: { eventType: string };
    draft: { tLow: number };
    onUpdateDraft: (type: string, field: string, value: number) => void;
    onCancelDraft: (type: string) => void;
    onSaveRule: (type: string) => void;
    onReload: () => void;
    errorMessage: string;
    successMessage: string;
    isAdmin: boolean;
  }) => (
    <div>
      {rule.eventType} threshold:{draft.tLow} admin:{String(isAdmin)} {errorMessage}{' '}
      {successMessage}
      <button onClick={() => onUpdateDraft(rule.eventType, 'tLow', 0.5)}>Update</button>
      <button onClick={() => onCancelDraft(rule.eventType)}>Cancel</button>
      <button onClick={() => onSaveRule(rule.eventType)}>Save</button>
      <button onClick={onReload}>Reload</button>
    </div>
  ),
}));
let host: HTMLDivElement, root: Root;
const user = { id: 'viewer', fullName: 'Grandma', email: 'grandma@test', role: 'VIEWER' };
const rules = {
  rules: [{ eventType: 'FALL_DETECTED', tLow: 0.3, tHigh: 0.8, tWaitSeconds: 30 }],
  drafts: {},
  isLoading: false,
  error: null,
  reload: m.reload,
  updateDraft: m.update,
  cancelDraft: m.cancel,
  isDirty: () => false,
  saveRule: m.save,
  savingMap: {},
  errorMap: {},
  successMap: {},
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  localStorage.clear();
  vi.clearAllMocks();
  m.rules.mockReturnValue(rules);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw Error(text);
  await act(async () => button.click());
}
it('loads and saves per-viewer preferences with immediate feedback', async () => {
  localStorage.setItem('camerai_viewer_prefs_viewer', '{"soundAlerts":false}');
  await render(<SettingsView user={user as never} />);
  expect(host.textContent).toContain('Grandma');
  expect(host.textContent).toContain('grandma@test');
  const inputs = host.querySelectorAll<HTMLInputElement>('input');
  expect([...inputs].map((n) => n.checked)).toEqual([true, false, false]);
  for (const input of inputs) await act(async () => input.click());
  expect(JSON.parse(localStorage.getItem('camerai_viewer_prefs_viewer')!)).toEqual({
    inAppAlerts: false,
    soundAlerts: true,
    compactView: true,
  });
  expect(host.textContent).toContain('Đã lưu tùy chọn');
});
it('keeps defaults for malformed saved preferences and reports unavailable storage', async () => {
  localStorage.setItem('camerai_viewer_prefs_viewer', 'invalid');
  await render(<SettingsView user={user as never} />);
  expect(host.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('quota');
  });
  await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
  expect(host.textContent).toContain('Không thể lưu vào trình duyệt');
});
it('routes caregivers to household settings and admins to editable rules', async () => {
  await render(<SettingsView user={{ ...user, role: 'CAREGIVER' } as never} />);
  expect(host.textContent).toContain('Household settings');
  await render(<SettingsView user={{ ...user, role: 'ADMIN' } as never} />);
  expect(host.textContent).toContain('admin:true');
  await render(<SettingsView user={null} />);
  expect(host.textContent).toContain('chế độ chỉ đọc');
});
it('shows loading, failed load and retries rule retrieval', async () => {
  m.rules.mockReturnValue({ ...rules, isLoading: true });
  await render(<EscalationRulesSection isAdmin />);
  expect(host.textContent).toContain('Đang tải cấu hình');
  m.rules.mockReturnValue({ ...rules, error: 'Offline' });
  await render(<EscalationRulesSection isAdmin />);
  expect(host.textContent).toContain('Offline');
  await click('Thử lại');
  expect(m.reload).toHaveBeenCalledOnce();
});
it('uses draft values and forwards all rule actions', async () => {
  m.rules.mockReturnValue({
    ...rules,
    drafts: { FALL_DETECTED: { tLow: 0.4 } },
    errorMap: { FALL_DETECTED: 'Invalid' },
    successMap: { FALL_DETECTED: 'Saved' },
    savingMap: { FALL_DETECTED: true },
  });
  await render(<EscalationRulesSection isAdmin household compact={false} />);
  expect(m.rules).toHaveBeenCalledWith(true);
  expect(host.textContent).toContain('threshold:0.4');
  expect(host.textContent).toContain('Invalid');
  expect(host.textContent).toContain('Saved');
  await click('Update');
  expect(m.update).toHaveBeenCalledWith('FALL_DETECTED', 'tLow', 0.5);
  await click('Cancel');
  expect(m.cancel).toHaveBeenCalledWith('FALL_DETECTED');
  await click('Save');
  expect(m.save).toHaveBeenCalledWith('FALL_DETECTED');
  await click('Reload');
  expect(m.reload).toHaveBeenCalledOnce();
});
