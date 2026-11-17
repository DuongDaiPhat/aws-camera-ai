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
  it.each(['CAREGIVER', 'VIEWER'] as const)('keeps account management hidden for %s', (role) => {
    const html = render(role);
    expect(html).toContain('Xem lại thời gian');
    expect(html).not.toContain('>Quản lý tài khoản<');
  });
});
