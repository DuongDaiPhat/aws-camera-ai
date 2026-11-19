import { apiFetch } from './api-client';

export interface AdminServiceCheck {
  key: string;
  name: string;
  status: 'ok' | 'error';
  detail: string;
}

export interface AdminOverviewData {
  generatedAt: string;
  overallStatus: 'ok' | 'degraded';
  services: AdminServiceCheck[];
  counts: {
    householdCount: number;
    totalAccounts: number;
    activeAccounts: number;
    inactiveAccounts: number;
    adminAccounts: number;
    totalCameras: number;
    enabledCameras: number;
    disabledCameras: number;
    storageUsedBytes: number;
    allocatedStorageQuotaGb: number;
    recordingErrors24h: number;
    aiErrors24h: number;
    notificationErrors24h: number;
  };
}

export interface AdminHouseholdItem {
  ownerId: string;
  ownerEmail: string;
  ownerFullName: string;
  ownerRole: string;
  ownerActive: boolean;
  memberCount: number;
  cameraCount: number;
  enabledCameraCount: number;
  storageUsedBytes: number;
  maxCameras: number;
  storageQuotaGb: number;
  retentionDays: number;
  servicePlan: 'BASIC' | 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';
  createdAt: string;
}

export interface AdminServicesData {
  checkedAt: string;
  connections: Array<{
    id: string;
    label: string;
    status: 'ok' | 'error';
    detail: string;
  }>;
  frigateSync: {
    pending: number;
    synced: number;
    failed: number;
  };
  notificationChannels: Array<{
    channel: string;
    sent24h: number;
    failed24h: number;
    pending24h: number;
  }>;
  incidents: Array<{
    id: string;
    subsystem: 'RECORDING' | 'AI' | 'NOTIFICATION';
    code: string;
    summary: string;
    occurredAt: string;
  }>;
}

export interface AdminResourcesData {
  defaults: {
    defaultMaxCameras: number;
    defaultStorageQuotaGb: number;
    allowedRetentionDays: number[];
    defaultRetentionDays: number;
  };
  households: Array<{
    ownerId: string;
    ownerFullName: string;
    ownerEmail: string;
    servicePlan: string;
    cameraCount: number;
    maxCameras: number;
    storageUsedBytes: number;
    storageQuotaGb: number;
    retentionDays: number;
  }>;
}

export interface AdminAuditLogItem {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorFullName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditLogsPage {
  items: AdminAuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminSystemSettingsData {
  integrations: {
    authProvider: string;
    storageProvider: string;
    faceProvider: string;
    telegramEnabled: boolean;
    frigateUrl: string;
  };
  loginPolicy: {
    sessionTimeoutMinutes: number;
    requireMfaForAdmin: boolean;
    allowSelfSignup: boolean;
    maxLoginAttempts: number;
  };
  technicalLimits: {
    aiConfidenceFloor: number;
    maxUploadMb: number;
  };
  adminAccounts: Array<{
    id: string;
    email: string;
    fullName: string;
    isActive: boolean;
    createdAt: string;
  }>;
  updatedAt: string;
}

export function fetchAdminOverview() {
  return apiFetch<AdminOverviewData>('/admin/overview');
}

export function fetchAdminHouseholds() {
  return apiFetch<AdminHouseholdItem[]>('/admin/households');
}

export function updateAdminUserStatus(userId: string, isActive: boolean) {
  return apiFetch<{ id: string; email: string; isActive: boolean }>(
    `/admin/users/${userId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
  );
}

export function updateAdminHouseholdQuota(
  ownerId: string,
  payload: {
    maxCameras?: number;
    storageQuotaGb?: number;
    retentionDays?: number;
    servicePlan?: 'BASIC' | 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';
  },
) {
  return apiFetch(`/admin/households/${ownerId}/quota`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchAdminServices() {
  return apiFetch<AdminServicesData>('/admin/services');
}

export function fetchAdminResources() {
  return apiFetch<AdminResourcesData>('/admin/resources');
}

export function updateAdminResources(payload: {
  defaultMaxCameras?: number;
  defaultStorageQuotaGb?: number;
  defaultRetentionDays?: number;
  allowedRetentionDays?: number[];
}) {
  return apiFetch('/admin/resources', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchAdminAuditLogs(params: {
  page?: number;
  pageSize?: number;
  action?: string;
  search?: string;
}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.action) qs.set('action', params.action);
  if (params.search) qs.set('search', params.search);
  const query = qs.toString();
  return apiFetch<AdminAuditLogsPage>(`/admin/audit-logs${query ? `?${query}` : ''}`);
}

export function fetchAdminSystemSettings() {
  return apiFetch<AdminSystemSettingsData>('/admin/settings');
}

export function updateAdminSystemSettings(payload: {
  sessionTimeoutMinutes?: number;
  requireMfaForAdmin?: boolean;
  allowSelfSignup?: boolean;
  maxLoginAttempts?: number;
  aiConfidenceFloor?: number;
  maxUploadMb?: number;
}) {
  return apiFetch('/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}
