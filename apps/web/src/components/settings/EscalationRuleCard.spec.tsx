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
    highWaitSeconds: null,
    effectiveHighWaitSeconds: 30,
    skipLoggedOnly: true,
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
    highWaitSeconds: null,
    effectiveHighWaitSeconds: 300,
    updatedAt: '2026-09-25T08:00:00.000Z',
    updatedByName: 'Admin User',
  };

  const noop = () => {};

  it.each([null, -1, 60, 61, 1.5, NaN])(
    'khóa lưu khi nhánh khẩn cấp không hợp lệ %s',
    (highWaitSeconds) => {
      const html = renderToStaticMarkup(
        <EscalationRuleCard
          rule={{
            ...mockAlertRule,
            eventType: 'RESTRICTED_ZONE',
            skipLoggedOnly: false,
            tWaitSeconds: 60,
            highWaitSeconds: 30,
          }}
          draft={{ tLow: 0.6, tHigh: 0.8, tWaitSeconds: 60, highWaitSeconds }}
          isDirty={true}
          isSaving={false}
          isAdmin={true}
          errorMessage={null}
          successMessage={null}
          onUpdateDraft={noop}
          onCancelDraft={noop}
          onSaveRule={noop}
          onReload={noop}
        />,
      );
      expect(html).toContain('Nhánh khẩn cấp phải là số nguyên không âm và nhỏ hơn T_wait.');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Lưu thay đổi<\/button>/);
    },
  );

  it('cho lưu và báo bản nháp khi chỉ đổi nhánh khẩn cấp thành số hợp lệ', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={{
          ...mockAlertRule,
          eventType: 'RESTRICTED_ZONE',
          skipLoggedOnly: false,
          tWaitSeconds: 60,
          highWaitSeconds: 30,
        }}
        draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: 60, highWaitSeconds: 17 }}
        isDirty={true}
        isSaving={false}
        isAdmin={true}
        errorMessage={null}
        successMessage={null}
        onUpdateDraft={noop}
        onCancelDraft={noop}
        onSaveRule={noop}
        onReload={noop}
      />,
    );
    expect(html).toContain('Chưa áp dụng');
    expect(html).toContain('17 giây');
    expect(html).toMatch(/<button[^>]*>Lưu thay đổi<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Lưu thay đổi<\/button>/);
  });

  it.each([0, 3601, 1.5, NaN])('không cho lưu thời gian không hợp lệ %s', (seconds) => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockAlertRule}
        draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: seconds, highWaitSeconds: null }}
        isDirty={true}
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
    expect(html).toContain('Thời gian chờ phải là số nguyên từ 1 đến 3600 giây.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Lưu thay đổi<\/button>/);
  });

  it('hiển thị đầy đủ thông tin rule cảnh báo và computed high wait time', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockAlertRule}
        draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: 30, highWaitSeconds: null }}
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
    expect(html).toContain('30 giây'); // FIRE dùng T_wait, không chia đôi
    expect(html).not.toContain('15 giây');
    expect(html).toContain('Lưu thay đổi');
  });

  it('hiển thị thông báo đặc biệt và ẩn inputs threshold đối với WELLNESS_TIMEOUT', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockWellnessRule}
        draft={{ tLow: null, tHigh: null, tWaitSeconds: 300, highWaitSeconds: null }}
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
    expect(html).toContain('300 giây'); // WELLNESS dùng T_wait, không chia đôi
    expect(html).not.toContain('150 giây');
  });

  it('hiển thị lỗi xung đột phiên bản kèm nút tải lại', () => {
    const html = renderToStaticMarkup(
      <EscalationRuleCard
        rule={mockAlertRule}
        draft={{ tLow: 0.5, tHigh: 0.7, tWaitSeconds: 30, highWaitSeconds: null }}
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
