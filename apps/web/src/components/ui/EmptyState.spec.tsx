import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './EmptyState';

describe('EmptyState component', () => {
  it('hiển thị trạng thái an toàn thân thiện khi hệ thống chưa có sự kiện nào', () => {
    const html = renderToStaticMarkup(<EmptyState />);

    expect(html).toContain('Hệ thống an toàn · 4 Camera trực tuyến');
    expect(html).toContain('Hiện chưa có sự kiện cảnh báo nào');
    expect(html).toContain('Tất cả camera và AI giám sát đang hoạt động ổn định');
    expect(html).toContain('Ngôi nhà của bạn đang được bảo vệ an toàn 24/7');
    expect(html).not.toContain('Đặt lại bộ lọc');
  });

  it('hiển thị nút đặt lại bộ lọc khi có onResetFilter', () => {
    const onReset = vi.fn();
    const html = renderToStaticMarkup(
      <EmptyState
        title="Không tìm thấy sự kiện phù hợp"
        message="Không có sự kiện nào khớp với bộ lọc."
        onResetFilter={onReset}
      />,
    );

    expect(html).toContain('Hệ thống an toàn · 4 Camera trực tuyến');
    expect(html).toContain('Không tìm thấy sự kiện phù hợp');
    expect(html).toContain('Không có sự kiện nào khớp với bộ lọc.');
    expect(html).toContain('Đặt lại bộ lọc');
  });
});
