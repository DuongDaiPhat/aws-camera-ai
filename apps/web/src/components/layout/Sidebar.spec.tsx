import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import type { CurrentUser } from '@/types';
import { Sidebar } from './Sidebar';
const user: CurrentUser = {
  id: 'user',
  fullName: 'Test',
  email: 'test@example.test',
  role: 'ADMIN',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-11-17T00:00:00Z',
};
describe('Merged sidebar navigation', () => {
  const render = (role: CurrentUser['role']) =>
    renderToStaticMarkup(
      <Sidebar
        expanded
        user={{ ...user, role }}
        activeNav="dashboard"
        onToggle={() => {}}
        onSelectNav={() => {}}
        onLogout={() => {}}
      />,
    );
  it('keeps playback and exposes the incoming account page to administrators', () => {
    const html = render('ADMIN');
    expect(html).toContain('Xem lại thời gian');
    expect(html).toContain('Quản lý tài khoản');
  });
  it('keeps account management hidden for CAREGIVER', () => {
    const html = render('CAREGIVER');
    expect(html).toContain('Xem lại thời gian');
    expect(html).not.toContain('>Quản lý tài khoản<');
  });
  it('shows only Viewer pages and hides Caregiver/Admin pages for VIEWER', () => {
    const html = render('VIEWER');
    expect(html).toContain('Trang của tôi');
    expect(html).toContain('Xem lại');
    expect(html).toContain('Thông báo của tôi');
    expect(html).toContain('Cài đặt cá nhân');
    expect(html).not.toContain('>Camera trực tiếp<');
    expect(html).not.toContain('>Quản lý tài khoản<');
    expect(html).not.toContain('>Người quen<');
    expect(html).not.toContain('>Khu vực<');
    expect(html).not.toContain('>Sức khỏe<');
  });
});
