// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '@/lib/admin-client';
import { AdminAccountsView } from './AdminAccountsView';
import { AdminResourcesView } from './AdminResourcesView';
import { AdminSettingsView } from './AdminSettingsView';
import { AdminAuditLogsView } from './AdminAuditLogsView';
import { AdminServicesView } from './AdminServicesView';
import { AdminOverviewView } from './AdminOverviewView';
import { AdminStatusStrip } from './AdminStatusStrip';
vi.mock('@/lib/admin-client', async (original) => ({
  ...(await original<typeof api>()),
  fetchAdminOverview: vi.fn(),
  fetchAdminHouseholds: vi.fn(),
  updateAdminHouseholdQuota: vi.fn(),
  updateAdminUserStatus: vi.fn(),
  fetchAdminResources: vi.fn(),
  updateAdminResources: vi.fn(),
  fetchAdminSystemSettings: vi.fn(),
  updateAdminSystemSettings: vi.fn(),
  fetchAdminAuditLogs: vi.fn(),
  fetchAdminServices: vi.fn(),
}));
vi.mock('@/components/users/UsersView', () => ({
  UsersView: ({ currentUserId }: { currentUserId: string }) => <div>Accounts: {currentUserId}</div>,
}));
let host: HTMLDivElement, root: Root;
const household = {
  ownerId: 'owner',
  ownerEmail: 'owner@test',
  ownerFullName: 'Owner',
  ownerRole: 'CAREGIVER',
  ownerActive: true,
  memberCount: 2,
  cameraCount: 1,
  enabledCameraCount: 1,
  storageUsedBytes: 1024,
  maxCameras: 8,
  storageQuotaGb: 100,
  retentionDays: 30,
  servicePlan: 'STANDARD',
  createdAt: '2026-01-01',
};
const resources = {
  defaults: {
    defaultMaxCameras: 8,
    defaultStorageQuotaGb: 100,
    allowedRetentionDays: [7, 30],
    defaultRetentionDays: 30,
  },
  households: [household, { ...household, ownerId: 'empty', storageQuotaGb: 0 }],
};
const settings = {
  integrations: {
    authProvider: 'jwt',
    storageProvider: 's3',
    faceProvider: 'local',
    telegramEnabled: true,
    frigateUrl: 'local',
  },
  loginPolicy: {
    sessionTimeoutMinutes: 60,
    requireMfaForAdmin: false,
    allowSelfSignup: false,
    maxLoginAttempts: 5,
  },
  technicalLimits: { aiConfidenceFloor: 0.5, maxUploadMb: 10 },
  adminAccounts: [
    {
      id: 'admin',
      email: 'admin@test',
      fullName: 'Admin',
      isActive: true,
      createdAt: '2026-01-01',
    },
    {
      id: 'locked',
      email: 'locked@test',
      fullName: 'Locked',
      isActive: false,
      createdAt: '2026-01-01',
    },
  ],
  updatedAt: '2026-01-01',
};
const incidents = [
  {
    id: 'i',
    subsystem: 'AI',
    code: 'AI_TIMEOUT',
    summary: 'Request timed out',
    occurredAt: '2026-01-01',
  },
];
const services = {
  checkedAt: '2026-01-01',
  connections: [
    { id: 'api', label: 'API', status: 'ok', detail: 'healthy' },
    { id: 'db', label: 'DB', status: 'error', detail: 'offline' },
  ],
  frigateSync: { pending: 1, synced: 2, failed: 3 },
  notificationChannels: [{ channel: 'Telegram', sent24h: 4, failed24h: 1, pending24h: 2 }],
  incidents: { items: incidents, total: 10, page: 1, pageSize: 5 },
};
const overview = {
  generatedAt: '2026-01-01',
  overallStatus: 'ok',
  services: [
    { key: 'orchestrator', name: 'API', status: 'ok', detail: 'healthy' },
    { key: 'database', name: 'Database', status: 'error', detail: 'offline' },
  ],
  counts: {
    householdCount: 2,
    totalAccounts: 3,
    activeAccounts: 2,
    inactiveAccounts: 1,
    adminAccounts: 1,
    totalCameras: 3,
    enabledCameras: 2,
    disabledCameras: 1,
    storageUsedBytes: 1024,
    allocatedStorageQuotaGb: 100,
    recordingErrors24h: 1,
    aiErrors24h: 2,
    notificationErrors24h: 3,
  },
  trends: [
    {
      date: '2026-01-01',
      storageAddedBytes: 1024,
      errorsCount: 2,
      notificationTotal: 4,
      notificationSuccessRate: 0.75,
    },
  ],
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  vi.mocked(api.fetchAdminHouseholds).mockResolvedValue([
    household,
    { ...household, ownerId: 'SELF', ownerRole: 'ADMIN' },
    { ...household, ownerId: 'locked', ownerActive: false },
  ] as never);
  vi.mocked(api.fetchAdminResources).mockResolvedValue(resources as never);
  vi.mocked(api.fetchAdminSystemSettings).mockResolvedValue(settings);
  vi.mocked(api.fetchAdminServices).mockResolvedValue(services as never);
  vi.mocked(api.fetchAdminOverview).mockResolvedValue(overview as never);
  vi.mocked(api.fetchAdminAuditLogs).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 5,
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
}
function button(text: string) {
  const b = [...host.querySelectorAll('button')].find((n) => n.textContent?.trim() === text);
  if (!b) throw Error(`Missing ${text}: ${host.textContent}`);
  return b;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
function input(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
async function select(node: HTMLSelectElement, value: string) {
  await act(async () => {
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('edits quotas, cancels drafts and protects the current account from suspension', async () => {
  await render(<AdminAccountsView currentUserId="self" />);
  expect(host.textContent).toContain('owner@test');
  expect(host.querySelectorAll('button').length).toBeGreaterThan(2);
  const selfRow = [...host.querySelectorAll('tr')].find((n) => n.textContent?.includes('ADMIN'))!;
  expect(selfRow.querySelector('button')).toBeNull();
  await click(button('Sửa hạn mức'));
  expect(host.querySelectorAll('input')).toHaveLength(3);
  input(host.querySelectorAll('input')[0], '12');
  input(host.querySelectorAll('input')[1], '200');
  input(host.querySelectorAll('input')[2], '7');
  await select(host.querySelector('select')!, 'PREMIUM');
  await click(button('Lưu'));
  expect(api.updateAdminHouseholdQuota).toHaveBeenCalledWith('owner', {
    maxCameras: 12,
    storageQuotaGb: 200,
    retentionDays: 7,
    servicePlan: 'PREMIUM',
  });
  expect(host.textContent).toContain('Đã cập nhật hạn mức');
  await click(button('Sửa hạn mức'));
  await click(button('Hủy'));
  expect(host.querySelector('input')).toBeNull();
  await click(button('Khóa'));
  expect(api.updateAdminUserStatus).toHaveBeenLastCalledWith('owner', false);
  expect(host.textContent).toContain('Đã tạm khóa');
  await click(button('Mở khóa'));
  expect(api.updateAdminUserStatus).toHaveBeenLastCalledWith('locked', true);
  expect(host.textContent).toContain('Đã kích hoạt lại');
  await click(button('Danh sách tài khoản & Vai trò'));
  expect(host.textContent).toContain('Accounts: self');
  await click(button('Hộ gia đình & Hạn mức'));
  expect(host.textContent).toContain('owner@test');
});
it.each([new Error('Denied'), 'bad'])(
  'shows quota and account mutation failures',
  async (error) => {
    await render(<AdminAccountsView currentUserId="self" />);
    vi.mocked(api.updateAdminHouseholdQuota).mockRejectedValueOnce(error);
    await click(button('Sửa hạn mức'));
    await click(button('Lưu'));
    expect(host.textContent).toContain(
      error instanceof Error ? 'Denied' : 'Không thể cập nhật hạn mức',
    );
    await click(button('Hủy'));
    vi.mocked(api.updateAdminUserStatus).mockRejectedValueOnce(error);
    await click(button('Khóa'));
    expect(host.textContent).toContain(
      error instanceof Error ? 'Denied' : 'Không thể đổi trạng thái',
    );
  },
);
it('updates resource defaults and rejects invalid retention tiers', async () => {
  await render(<AdminResourcesView />);
  expect(host.textContent).toContain('Owner');
  const fields = host.querySelectorAll('input');
  input(fields[0], '10');
  input(fields[1], '150');
  input(fields[2], '14');
  input(fields[3], '7,14,not-a-number,0,366,3.5');
  await submit();
  expect(api.updateAdminResources).toHaveBeenCalledWith({
    defaultMaxCameras: 10,
    defaultStorageQuotaGb: 150,
    defaultRetentionDays: 14,
    allowedRetentionDays: [7, 14],
  });
  expect(host.textContent).toContain('Đã cập nhật giới hạn');
  input(host.querySelectorAll('input')[3], '0,999,bad');
  await submit();
  expect(host.textContent).toContain('Cần ít nhất 1 mức');
  expect(api.updateAdminResources).toHaveBeenCalledTimes(1);
});
it.each([new Error('Denied'), 'bad'])('shows resource save failures', async (error) => {
  await render(<AdminResourcesView />);
  vi.mocked(api.updateAdminResources).mockRejectedValueOnce(error);
  await submit();
  expect(host.textContent).toContain(
    error instanceof Error ? 'Denied' : 'Cập nhật hạn mức thất bại',
  );
});
it('updates login and technical policies with explicit booleans', async () => {
  await render(<AdminSettingsView />);
  expect(host.textContent).toContain('Đã cấu hình token');
  expect(host.textContent).toContain('Locked');
  const fields = host.querySelectorAll<HTMLInputElement>('input[type="number"]');
  ['120', '8', '0.8', '25'].forEach((v, i) => input(fields[i], v));
  for (const checkbox of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    await click(checkbox);
  await submit();
  expect(api.updateAdminSystemSettings).toHaveBeenCalledWith({
    sessionTimeoutMinutes: 120,
    maxLoginAttempts: 8,
    aiConfidenceFloor: 0.8,
    maxUploadMb: 25,
    requireMfaForAdmin: true,
    allowSelfSignup: true,
  });
  expect(host.textContent).toContain('Đã lưu cấu hình');
});
it.each([new Error('Denied'), 'bad'])(
  'shows system save failures and disabled Telegram',
  async (error) => {
    vi.mocked(api.fetchAdminSystemSettings).mockResolvedValue({
      ...settings,
      integrations: { ...settings.integrations, telegramEnabled: false },
    });
    await render(<AdminSettingsView />);
    expect(host.textContent).toContain('Chưa bật token');
    vi.mocked(api.updateAdminSystemSettings).mockRejectedValueOnce(error);
    await submit();
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thể lưu cài đặt');
  },
);

it('filters audit logs, formats system actors and navigates pages', async () => {
  const log = {
    id: 'log',
    actorUserId: null,
    actorEmail: 'admin@test',
    actorFullName: 'Admin',
    actorRole: 'ADMIN',
    action: 'USER_CREATED',
    entityType: 'USER',
    entityId: '123456789',
    ipAddress: null,
    metadata: { ok: true },
    createdAt: '2026-01-01',
  };
  vi.mocked(api.fetchAdminAuditLogs).mockResolvedValue({
    items: [
      log,
      {
        ...log,
        id: 'system',
        actorEmail: null,
        actorFullName: null,
        actorRole: null,
        entityId: null,
        metadata: {},
      },
    ],
    total: 10,
    page: 1,
    pageSize: 5,
  });
  await render(<AdminAuditLogsView />);
  expect(host.textContent).toContain('Hệ thống');
  expect(host.textContent).toContain('USER:12345678');
  expect(host.textContent).toContain('Thành công');
  input(host.querySelector('input')!, ' admin ');
  await submit();
  expect(api.fetchAdminAuditLogs).toHaveBeenLastCalledWith({
    page: 1,
    pageSize: 5,
    action: undefined,
    search: 'admin',
  });
  await select(host.querySelector('select')!, 'USER_CREATED');
  expect(api.fetchAdminAuditLogs).toHaveBeenLastCalledWith({
    page: 1,
    pageSize: 5,
    action: 'USER_CREATED',
    search: 'admin',
  });
  await click(button('Làm mới'));
  expect(api.fetchAdminAuditLogs).toHaveBeenCalledTimes(4);
});
it('shows an empty audit result', async () => {
  await render(<AdminAuditLogsView />);
  expect(host.textContent).toContain('Không tìm thấy bản ghi');
});
it('displays service health, notifications and incident detail then refreshes', async () => {
  await render(<AdminServicesView />);
  expect(host.textContent).toContain('Kết nối tốt');
  expect(host.textContent).toContain('Mất kết nối');
  expect(host.textContent).toContain('AI_TIMEOUT');
  expect(host.textContent).toContain('Telegram');
  await click(button('Kiểm tra lại'));
  expect(api.fetchAdminServices).toHaveBeenCalledTimes(2);
});
it.each([[], undefined, incidents])('supports empty and legacy incident formats', async (value) => {
  vi.mocked(api.fetchAdminServices).mockResolvedValue({
    ...services,
    notificationChannels: [],
    incidents: value,
  } as never);
  await render(<AdminServicesView />);
  expect(host.textContent).toContain('Chưa có lượt gửi');
  expect(host.textContent).toContain(value?.length ? 'AI_TIMEOUT' : 'Không ghi nhận sự cố');
});
it.each([
  [<AdminAccountsView currentUserId="self" />, api.fetchAdminHouseholds],
  [<AdminResourcesView />, api.fetchAdminResources],
  [<AdminSettingsView />, api.fetchAdminSystemSettings],
  [<AdminServicesView />, api.fetchAdminServices],
  [<AdminOverviewView onNavigate={vi.fn()} />, api.fetchAdminOverview],
  [<AdminAuditLogsView />, api.fetchAdminAuditLogs],
] as const)('shows load failures and a retry action', async (element, fetcher) => {
  vi.mocked(fetcher).mockRejectedValueOnce(new Error('Server unavailable'));
  await render(element);
  expect(host.textContent).toContain('Server unavailable');
  expect(host.querySelector('button')).not.toBeNull();
});
it.each([
  [
    <AdminAccountsView currentUserId="self" />,
    api.fetchAdminHouseholds,
    'Không tải được danh sách',
  ],
  [<AdminResourcesView />, api.fetchAdminResources, 'Không tải được tài nguyên'],
  [<AdminSettingsView />, api.fetchAdminSystemSettings, 'Không tải được cài đặt'],
  [<AdminServicesView />, api.fetchAdminServices, 'Không tải được tình trạng'],
  [<AdminOverviewView onNavigate={vi.fn()} />, api.fetchAdminOverview, 'Không tải được tổng quan'],
  [<AdminAuditLogsView />, api.fetchAdminAuditLogs, 'Không tải được nhật ký'],
] as const)('provides fallback messages for non-Error failures', async (element, fetcher, text) => {
  vi.mocked(fetcher).mockRejectedValueOnce('bad');
  await render(element);
  expect(host.textContent).toContain(text);
});
it('shows overview counts and navigation actions', async () => {
  const navigate = vi.fn();
  await render(<AdminOverviewView onNavigate={navigate} />);
  expect(host.textContent).toContain('Hệ thống ổn định');
  expect(host.textContent).toContain('API');
  for (const b of [...host.querySelectorAll('button')]) await click(b);
  expect(api.fetchAdminOverview).toHaveBeenCalledTimes(2);
  expect(navigate).toHaveBeenCalled();
});
it('shows degraded overview and empty trends', async () => {
  vi.mocked(api.fetchAdminOverview).mockResolvedValue({
    ...overview,
    overallStatus: 'degraded',
    trends: [],
  } as never);
  await render(<AdminOverviewView onNavigate={vi.fn()} />);
  expect(host.textContent).toContain('Có dịch vụ suy giảm');
});
it('polls infrastructure status and retains the previous data on network failure', async () => {
  vi.useFakeTimers();
  await render(<AdminStatusStrip />);
  expect(host.textContent).toContain('API: OK');
  expect(host.textContent).toContain('DB: ERR');
  expect(host.textContent).toContain('Lỗi 24h: 6');
  vi.mocked(api.fetchAdminOverview).mockRejectedValueOnce(new Error('offline'));
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(host.textContent).toContain('API: OK');
  expect(api.fetchAdminOverview).toHaveBeenCalledTimes(2);
});
