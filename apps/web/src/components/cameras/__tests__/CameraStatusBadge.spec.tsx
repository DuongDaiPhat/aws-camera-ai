import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraStatusBadge } from '../CameraStatusBadge';

describe('CameraStatusBadge component', () => {
  it('hien thi badge Online khi runtimeStatus la ONLINE', () => {
    const html = renderToStaticMarkup(
      <CameraStatusBadge isEnabled={true} runtimeStatus="ONLINE" />,
    );
    expect(html).toContain('Online');
    expect(html).toContain('badgeOnline');
  });

  it('hien thi badge Loi ket noi khi runtimeStatus la FAILED', () => {
    const html = renderToStaticMarkup(
      <CameraStatusBadge isEnabled={true} runtimeStatus="FAILED" />,
    );
    expect(html).toContain('Lỗi kết nối');
    expect(html).toContain('badgeError');
  });

  it('hien thi badge cau hinh khi showConfigBadge la true', () => {
    const html = renderToStaticMarkup(
      <CameraStatusBadge isEnabled={true} runtimeStatus="ONLINE" showConfigBadge={true} />,
    );
    expect(html).toContain('Đã bật');
    expect(html).toContain('badgeConfigOn');
  });

  it('hien thi Da tat khi isEnabled la false', () => {
    const html = renderToStaticMarkup(
      <CameraStatusBadge isEnabled={false} runtimeStatus="DISABLED" showConfigBadge={true} />,
    );
    expect(html).toContain('Đã tắt');
    expect(html).toContain('badgeConfigOff');
  });
});
