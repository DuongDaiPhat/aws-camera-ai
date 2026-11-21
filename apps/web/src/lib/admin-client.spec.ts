import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from './admin-client';
import { apiFetch } from './api-client';

vi.mock('./api-client', () => ({ apiFetch: vi.fn() }));
beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe('admin API requests', () => {
  it.each([
    [client.fetchAdminOverview, '/admin/overview'],
    [client.fetchAdminHouseholds, '/admin/households'],
    [client.fetchAdminResources, '/admin/resources'],
    [client.fetchAdminSystemSettings, '/admin/settings'],
  ] as const)('returns the server response for %s', async (request, path) => {
    const response = { generatedAt: 'now' };
    vi.mocked(apiFetch).mockResolvedValue(response);
    expect(await request()).toBe(response);
    expect(apiFetch).toHaveBeenCalledWith(path);
  });

  it('omits empty filters and serializes incident pagination', async () => {
    await client.fetchAdminServices();
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/services');
    await client.fetchAdminServices({ incidentPage: 2, incidentPageSize: 10 });
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/services?incidentPage=2&incidentPageSize=10');
    await client.fetchAdminAuditLogs({});
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/audit-logs');
    await client.fetchAdminAuditLogs({
      page: 2,
      pageSize: 20,
      action: 'USER UPDATE',
      search: 'a+b',
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/admin/audit-logs?page=2&pageSize=20&action=USER+UPDATE&search=a%2Bb',
    );
  });

  it('sends explicit status and quota updates without dropping false or zero values', async () => {
    await client.updateAdminUserStatus('user-1', false);
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/users/user-1/status', {
      method: 'PATCH',
      body: '{"isActive":false}',
    });
    const quota = {
      maxCameras: 0,
      retentionDays: 7,
      storageQuotaGb: 20,
      servicePlan: 'BASIC' as const,
    };
    await client.updateAdminHouseholdQuota('owner', quota);
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/households/owner/quota', {
      method: 'PATCH',
      body: JSON.stringify(quota),
    });
    const resources = { defaultMaxCameras: 2, allowedRetentionDays: [7, 14] };
    await client.updateAdminResources(resources);
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/resources', {
      method: 'PATCH',
      body: JSON.stringify(resources),
    });
    const settings = { allowSelfSignup: false, requireMfaForAdmin: true };
    await client.updateAdminSystemSettings(settings);
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  });

  it('propagates rejected requests to the caller', async () => {
    const error = new Error('forbidden');
    vi.mocked(apiFetch).mockRejectedValue(error);
    await expect(client.fetchAdminOverview()).rejects.toBe(error);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [-1, '0 B'],
    [NaN, '0 B'],
    [Infinity, '0 B'],
    [1, '1.0 B'],
    [100, '100 B'],
    [1024, '1.0 KB'],
    [1024 ** 2, '1.0 MB'],
    [1024 ** 3, '1.0 GB'],
    [1024 ** 4, '1.0 TB'],
    [1024 ** 5, '1024 TB'],
  ])('formats %s as %s', (bytes, text) => {
    expect(client.formatBytes(bytes as number)).toBe(text);
  });
});
