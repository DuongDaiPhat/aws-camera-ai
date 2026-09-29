import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EscalationRuleCard } from './EscalationRuleCard';
import type { EscalationRule } from '@/lib/escalation-rules-client';

describe('EscalationRuleCard component', () => {
  const mockAlertRule: EscalationRule = {
    eventType: 'FIRE_SMOKE_DETECTED',
    displayName: 'Phát hiện cháy / khói',
    priority: 'P0',
    tLow: 0.5,
    tHigh: 0.7,
    tWaitSeconds: 30,
    version: 1,
    isEnabled: true,
    effectiveHighWaitSeconds: 15,
    updatedAt: '2026-09-25T08:00:00.000Z',
    updatedByName: 'Admin User',
  };

  const mockWellnessRule: EscalationRule = {
    eventType: 'WELLNESS_TIMEOUT',
    displayName: 'Quá hạn an sinh',
    priority: 'P2',
    tLow: null,
    tHigh: null,
    tWaitSeconds: 300,
    version: 1,
    isEnabled: true,
    effectiveHighWaitSeconds: 150,
    updatedAt: '2026-09-25T08:00:00.000Z',
    updatedByName: 'Admin User',
  };

  const noop = () => {};

  it('hiển thị đầy đủ thông tin rule cảnh báo và computed high wait time', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockAlertRule}
        draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: 30 }}
        isDirty={false}
        isSaving={false}
        errorMessage={null}
        successMessage={null}
        isAdmin={true}
        onUpdateDraft={noop}
        onCancelDraft={noop}
        onSaveRule={noop}
        onReload={noop}
      />,
    );

    expect(html).toContain('Phát hiện cháy / khói');
    expect(html).toContain('FIRE_SMOKE_DETECTED');
    expect(html).toContain('Ưu tiên P0');
    expect(html).toContain('v1');
    expect(html).toContain('Ngưỡng tối thiểu (T_low)');
    expect(html).toContain('Ngưỡng tin cậy cao (T_high)');
    expect(html).toContain('15 giây'); // computed wait
    expect(html).toContain('Lưu thay đổi');
  });

  it('hiển thị thông báo đặc biệt và ẩn inputs threshold đối với WELLNESS_TIMEOUT', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockWellnessRule}
        draft={{ tLow: null, tHigh: null, tWaitSeconds: 300 }}
        isDirty={false}
        isSaving={false}
        errorMessage={null}
        successMessage={null}
        isAdmin={true}
        onUpdateDraft={noop}
        onCancelDraft={noop}
        onSaveRule={noop}
        onReload={noop}
      />,
    );

    expect(html).toContain('Quá hạn an sinh');
    expect(html).toContain('không sử dụng ngưỡng confidence');
    expect(html).not.toContain('Ngưỡng tối thiểu (T_low)');
    expect(html).toContain('150 giây'); // ceil(300/2)
  });

  it('hiển thị lỗi xung đột phiên bản kèm nút tải lại', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockAlertRule}
        draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: 30 }}
        isDirty={true}
        isSaving={false}
        errorMessage="Cấu hình đã thay đổi bởi người khác. Hãy bấm tải lại trước khi lưu."
        successMessage={null}
        isAdmin={true}
        onUpdateDraft={noop}
        onCancelDraft={noop}
        onSaveRule={noop}
        onReload={noop}
      />,
    );

    expect(html).toContain('Cấu hình đã thay đổi bởi người khác');
    expect(html).toContain('Tải lại ngay');
  });
});
