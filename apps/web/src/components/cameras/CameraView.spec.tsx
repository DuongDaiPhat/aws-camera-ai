import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraView } from './CameraView';

describe('CameraView component', () => {
  it('hiển thị đầy đủ tiêu đề, các thẻ tóm tắt và danh sách camera mẫu', () => {
    const html = renderToStaticMarkup(
      <CameraView
        user={{
          id: '1',
          email: 'admin@camerai.local',
          fullName: 'Admin User',
          role: 'ADMIN',
          isActive: true,
          createdAt: '2026-09-24T00:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Quản lý Camera &amp; Nguồn phát');
    expect(html).toContain('Phòng khách');
    expect(html).toContain('Camera thử nghiệm');
    expect(html).toContain('Bếp');
    expect(html).toContain('Tổng số camera');
    expect(html).toContain('Thêm camera');
  });

  it('ẩn nút thêm camera khi người dùng không phải là ADMIN', () => {
    const html = renderToStaticMarkup(
      <CameraView
        user={{
          id: '2',
          email: 'viewer@camerai.local',
          fullName: 'Viewer User',
          role: 'VIEWER',
          isActive: true,
          createdAt: '2026-09-24T00:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Quản lý Camera &amp; Nguồn phát');
    expect(html).not.toContain('Thêm camera');
  });
});
