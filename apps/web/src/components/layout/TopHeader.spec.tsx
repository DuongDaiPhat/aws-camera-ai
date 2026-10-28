import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopHeader } from './TopHeader';

function render(pendingCount: number | null): string {
  return renderToStaticMarkup(
    <TopHeader
      selectedZone="ALL"
      onSelectZone={() => {}}
      onSimulateNewEvent={() => {}}
      pendingCount={pendingCount}
    />,
  );
}

describe('dashboard alert status', () => {
  it('shows pending alerts instead of claiming that the house is safe', () => {
    expect(render(1)).toContain('1 cảnh báo đang chờ xử lý.');
    expect(render(1)).not.toContain('Mọi thứ trong nhà đang an toàn');
  });
  it('describes the absence of pending alerts without guaranteeing physical safety', () => {
    expect(render(0)).toContain('Không có cảnh báo đang chờ xử lý.');
  });
  it('reports unknown status while statistics are unavailable', () => {
    expect(render(null)).toContain('Đang đồng bộ trạng thái cảnh báo.');
    expect(render(null)).not.toContain('Không có cảnh báo đang chờ xử lý.');
  });
});
