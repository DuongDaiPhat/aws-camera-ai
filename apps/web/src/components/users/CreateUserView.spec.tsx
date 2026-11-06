import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import type { CurrentUser } from '@/lib/auth-client';
import { CreateUserView } from './CreateUserView';

describe('account creation', () => {
  it.each([
    ['ADMIN', true],
    ['CAREGIVER', false],
    ['VIEWER', false],
  ] as const)('shows account management for %s only when authorized', (role, visible) => {
    const user: CurrentUser = {
      id: 'user',
      email: 'user@example.test',
      fullName: 'Người dùng',
      role,
      isActive: true,
      createdAt: '2026-11-06T00:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <Sidebar user={user} activeNav="dashboard" onSelectNav={() => {}} onLogout={() => {}} />,
    );
    expect(html.includes('Quản lý tài khoản')).toBe(visible);
  });

  it('defaults to VIEWER and offers the other two roles explicitly', () => {
    const html = renderToStaticMarkup(<CreateUserView />);
    expect(html).toContain('<option value="VIEWER" selected=""');
    expect(html).toContain('<option value="CAREGIVER"');
    expect(html).toContain('<option value="ADMIN"');
    expect(html).toContain('name="cognitoSub"');
    expect(html).not.toContain('type="password"');
  });
});
