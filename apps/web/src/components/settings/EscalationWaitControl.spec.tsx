import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EscalationRule } from '@/lib/escalation-rules-client';
import { EscalationWaitControl } from './EscalationWaitControl';

const rule: EscalationRule = {
  eventType: 'RESTRICTED_ZONE',
  priority: 'P1',
  tLow: 0.6,
  tHigh: 0.8,
  tWaitSeconds: 60,
  highWaitSeconds: 17,
  skipLoggedOnly: false,
  isEnabled: true,
};
const noop = () => {};

describe('Điều chỉnh thời gian chờ trên Cài đặt', () => {
  it('hiển thị giá trị đã lưu, bản nháp và cảnh báo deadline không reset', () => {
    const html = renderToStaticMarkup(
      <EscalationWaitControl rule={rule} seconds={600} disabled={false} onChange={noop} />,
    );
    expect(html).toContain('Đã lưu: 60 giây');
    expect(html).toContain('600 giây');
    expect(html).toContain('17 giây');
    expect(html).toContain('Deadline = lúc phát hiện');
    expect(html).toContain('Chưa áp dụng');
    expect(html).toContain('không được gia hạn');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('tự động gọi điện');
  });
  it('không có cảnh báo bản nháp khi chưa đổi giá trị', () => {
    const html = renderToStaticMarkup(
      <EscalationWaitControl rule={rule} seconds={60} disabled={false} onChange={noop} />,
    );
    expect(html).not.toContain('Chưa áp dụng');
  });
  it('khóa input và toàn bộ presets trong chế độ chỉ đọc hoặc đang lưu', () => {
    const html = renderToStaticMarkup(
      <EscalationWaitControl rule={rule} seconds={60} disabled={true} onChange={noop} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(7);
  });
  it('hiển thị input không hợp lệ và không xem trước số giây sai', () => {
    const html = renderToStaticMarkup(
      <EscalationWaitControl rule={rule} seconds={NaN} disabled={false} onChange={noop} />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
  it('hiển thị lỗi nếu nhánh khẩn cấp bằng thời gian cơ sở', () => {
    const html = renderToStaticMarkup(
      <EscalationWaitControl
        rule={{ ...rule, highWaitSeconds: 60 }}
        seconds={60}
        disabled={false}
        onChange={noop}
      />,
    );
    expect(html).toContain('Nhánh khẩn cấp phải là số nguyên không âm và nhỏ hơn T_wait.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('max="59"');
  });
  it('hiện thông báo chưa lưu khi chỉ sửa nhánh khẩn cấp', () => {
    const html = renderToStaticMarkup(
      <EscalationWaitControl
        rule={rule}
        seconds={60}
        disabled={false}
        onChange={noop}
        hasUnsavedChanges={true}
      />,
    );
    expect(html).toContain('Chưa áp dụng');
  });
});
