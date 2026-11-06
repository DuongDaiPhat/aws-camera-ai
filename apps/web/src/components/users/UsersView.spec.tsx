// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import { UsersView } from './UsersView';

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));

describe('account management', () => {
  it('shows the list first and saves only the selected account', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const admin = {
      id: 'admin',
      email: 'admin@example.org',
      fullName: 'Admin',
      role: 'ADMIN',
      isActive: true,
    };
    const viewer = {
      id: 'viewer',
      email: 'viewer@example.org',
      fullName: 'Người dùng',
      role: 'VIEWER',
      isActive: true,
    };
    const updated = { ...viewer, role: 'CAREGIVER' };
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [admin, viewer], meta: { page: 1, pageSize: 20, total: 2 } })
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce({ data: [admin, updated], meta: { page: 1, pageSize: 20, total: 2 } });

    try {
      await act(async () => root.render(<UsersView currentUserId={admin.id} />));
      expect(host.querySelector('form')).toBeNull();
      const [adminRow, viewerRow] = host.querySelectorAll('tbody tr');
      expect(adminRow.textContent).toContain('Tài khoản của bạn');
      expect(adminRow.querySelector('button')).toBeNull();

      act(() => viewerRow.querySelector('button')!.click());
      const role = viewerRow.querySelector('select')!;
      act(() => {
        role.value = 'CAREGIVER';
        role.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => viewerRow.querySelector('button')!.click());

      expect(apiFetch).toHaveBeenCalledWith('/users/viewer/role', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'CAREGIVER' }),
      });
      expect(viewerRow.textContent).toContain('Người giám sát');
      expect(adminRow.textContent).toContain('Quản trị viên');
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
