// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { EscalationRuleCard } from './EscalationRuleCard';
import type { EscalationRule } from '@/lib/escalation-rules-client';

describe('Compact rule editor', () => {
  it('keeps a draft when collapsing and only saves after the explicit save action', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const save = vi.fn(),
      cancel = vi.fn();
    const rule: EscalationRule = {
      eventType: 'FIRE_SMOKE_DETECTED',
      displayName: 'Phát hiện lửa',
      priority: 'P0',
      tLow: 0.5,
      tHigh: 0.7,
      tWaitSeconds: 30,
      highWaitSeconds: null,
      effectiveHighWaitSeconds: 30,
      skipLoggedOnly: true,
      version: 1,
      isEnabled: true,
    };
    try {
      await act(async () =>
        root.render(
          <EscalationRuleCard
            compact
            rule={rule}
            draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: 45, highWaitSeconds: null }}
            isDirty
            isSaving={false}
            isAdmin
            errorMessage={null}
            successMessage={null}
            onUpdateDraft={vi.fn()}
            onCancelDraft={cancel}
            onSaveRule={save}
            onReload={vi.fn()}
          />,
        ),
      );
      const details = host.querySelector('details')!;
      const summary = host.querySelector('summary')!;
      expect(details.open).toBe(false);
      expect(summary.textContent).toContain('Chưa lưu');
      await act(async () => summary.click());
      expect(details.open).toBe(true);
      const input = host.querySelector<HTMLInputElement>('#tWait-FIRE_SMOKE_DETECTED')!;
      expect(input.value).toBe('45');
      await act(async () => summary.click());
      await act(async () => summary.click());
      expect(input.value).toBe('45');
      expect(save).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      const button = Array.from(host.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Lưu thay đổi',
      )!;
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      expect(save).toHaveBeenCalledWith('FIRE_SMOKE_DETECTED');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
