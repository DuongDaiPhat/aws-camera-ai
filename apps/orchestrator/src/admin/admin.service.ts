import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readAuthSettings } from '../auth/auth.config';
import { SmokeService } from '../health/smoke.service';
import type {
  ListAuditLogsQueryDto,
  UpdateHouseholdQuotaDto,
  UpdateResourceLimitsDto,
  UpdateSystemSettingsDto,
} from './admin.dto';
import { AdminRepository } from './admin.repository';

const SENSITIVE_KEY_PATTERN = /(password|token|secret|credential|authorization|cookie)/i;

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeMetadata(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly smoke: SmokeService,
    private readonly config: ConfigService,
  ) {}

  private async checkAiService(): Promise<{ status: 'ok' | 'error'; detail?: string }> {
    const baseUrl = this.config
      .get<string>('AI_SERVICE_URL', 'http://ai-service:8000')
      .replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      if (!res.ok) {
        return { status: 'error', detail: `HTTP ${res.status}` };
      }
      return { status: 'ok', detail: 'FastAPI AI Service sẵn sàng' };
    } catch {
      return { status: 'error', detail: 'Không kết nối được AI Service' };
    } finally {
      clearTimeout(timer);
    }
  }

  async getOverview() {
    const [counts, smoke, aiService] = await Promise.all([
      this.repo.getOverviewCounts(),
      this.smoke.check(),
      this.checkAiService(),
    ]);

    const services = [
      {
        key: 'orchestrator',
        name: 'Orchestrator API',
        status: 'ok' as const,
        detail: `Uptime ${Math.floor(process.uptime())}s`,
      },
      {
        key: 'database',
        name: 'PostgreSQL',
        status: smoke.checks.database.status,
        detail: smoke.checks.database.detail ?? smoke.checks.database.reason ?? '',
      },
      {
        key: 'storage',
        name: 'Lưu trữ (MinIO/S3)',
        status: smoke.checks.storage.status,
        detail: smoke.checks.storage.detail ?? smoke.checks.storage.reason ?? '',
      },
      {
        key: 'auth',
        name: 'Xác thực (Auth)',
        status: smoke.checks.auth.status,
        detail: smoke.checks.auth.detail ?? smoke.checks.auth.reason ?? '',
      },
      { key: 'ai', name: 'AI Service', status: aiService.status, detail: aiService.detail ?? '' },
      {
        key: 'queue',
        name: 'Hàng đợi Cloud',
        status: smoke.checks.cloudQueue.status,
        detail: smoke.checks.cloudQueue.detail ?? smoke.checks.cloudQueue.reason ?? '',
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      overallStatus: services.every((s) => s.status === 'ok') ? 'ok' : 'degraded',
      services,
      counts,
    };
  }

  listHouseholds() {
    return this.repo.listHouseholds();
  }

  async updateUserStatus(actorId: string | undefined, targetUserId: string, isActive: boolean) {
    if (!actorId) throw new UnauthorizedException();
    if (actorId.toLowerCase() === targetUserId.toLowerCase() && !isActive) {
      throw new ConflictException('Không thể tự khóa tài khoản quản trị đang đăng nhập.');
    }
    const updated = await this.repo.updateUserActiveStatus(actorId, targetUserId, isActive);
    if (!updated) throw new NotFoundException('Không tìm thấy tài khoản.');
    return updated;
  }

  async updateHouseholdQuota(
    actorId: string | undefined,
    ownerId: string,
    dto: UpdateHouseholdQuotaDto,
  ) {
    if (!actorId) throw new UnauthorizedException();
    const updated = await this.repo.updateHouseholdQuota(actorId, ownerId, dto);
    if (!updated) throw new NotFoundException('Không tìm thấy hộ gia đình.');
    return updated;
  }

  async getServicesStatus() {
    const [smoke, aiService, diagnostics] = await Promise.all([
      this.smoke.check(),
      this.checkAiService(),
      this.repo.getServiceDiagnostics(),
    ]);

    return {
      checkedAt: new Date().toISOString(),
      connections: [
        {
          id: 'database',
          label: 'Cơ sở dữ liệu PostgreSQL',
          status: smoke.checks.database.status,
          detail:
            smoke.checks.database.status === 'ok' ? 'Kết nối ổn định' : 'Lỗi kết nối cơ sở dữ liệu',
        },
        {
          id: 'storage',
          label: 'Kho lưu trữ đối tượng (MinIO/S3)',
          status: smoke.checks.storage.status,
          detail:
            smoke.checks.storage.status === 'ok' ? 'Bucket sẵn sàng' : 'Không thể truy cập bucket',
        },
        {
          id: 'ai',
          label: 'Dịch vụ AI (Face / Pose / Fire)',
          status: aiService.status,
          detail: aiService.detail ?? '',
        },
        {
          id: 'auth',
          label: 'Nhà cung cấp xác thực',
          status: smoke.checks.auth.status,
          detail: smoke.checks.auth.detail ?? 'Lỗi cấu hình xác thực',
        },
        {
          id: 'queue',
          label: 'Hàng đợi sự kiện Cloud',
          status: smoke.checks.cloudQueue.status,
          detail: smoke.checks.cloudQueue.detail ?? 'Chưa kết nối hàng đợi',
        },
      ],
      frigateSync: diagnostics.frigateSync,
      notificationChannels: diagnostics.notificationChannels,
      incidents: diagnostics.incidents,
    };
  }

  async getResourcesAndQuotas() {
    const [settings, households] = await Promise.all([
      this.repo.getSystemSettings(),
      this.repo.listHouseholds(),
    ]);

    return {
      defaults: {
        defaultMaxCameras: settings.defaultMaxCameras,
        defaultStorageQuotaGb: settings.defaultStorageQuotaGb,
        allowedRetentionDays: settings.allowedRetentionDays,
        defaultRetentionDays: settings.defaultRetentionDays,
      },
      households: households
        .filter((h) => h.ownerRole !== 'ADMIN')
        .map((h) => ({
          ownerId: h.ownerId,
          ownerFullName: h.ownerFullName,
          ownerEmail: h.ownerEmail,
          servicePlan: h.servicePlan,
          cameraCount: h.cameraCount,
          maxCameras: h.maxCameras,
          storageUsedBytes: h.storageUsedBytes,
          storageQuotaGb: h.storageQuotaGb,
          retentionDays: h.retentionDays,
        })),
    };
  }

  updateResourceLimits(actorId: string | undefined, dto: UpdateResourceLimitsDto) {
    if (!actorId) throw new UnauthorizedException();
    return this.repo.updateResourceLimits(actorId, dto);
  }

  async listAuditLogs(query: ListAuditLogsQueryDto) {
    const result = await this.repo.listAuditLogs(query);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        metadata: sanitizeMetadata(item.metadata),
      })),
    };
  }

  async getSystemSettings() {
    const [settings, adminAccounts] = await Promise.all([
      this.repo.getSystemSettings(),
      this.repo.listAdminAccounts(),
    ]);
    const auth = readAuthSettings(this.config);

    return {
      integrations: {
        authProvider: auth.provider,
        storageProvider: this.config.get<string>('STORAGE_PROVIDER', 'minio'),
        faceProvider: this.config.get<string>('FACE_PROVIDER', 'local'),
        telegramEnabled: Boolean(this.config.get<string>('TELEGRAM_BOT_TOKEN')),
        frigateUrl: this.config.get<string>('FRIGATE_URL', 'http://frigate:5000'),
      },
      loginPolicy: {
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        requireMfaForAdmin: settings.requireMfaForAdmin,
        allowSelfSignup: settings.allowSelfSignup,
        maxLoginAttempts: settings.maxLoginAttempts,
      },
      technicalLimits: {
        aiConfidenceFloor: settings.aiConfidenceFloor,
        maxUploadMb: settings.maxUploadMb,
      },
      adminAccounts,
      updatedAt: settings.updatedAt,
    };
  }

  updateSystemSettings(actorId: string | undefined, dto: UpdateSystemSettingsDto) {
    if (!actorId) throw new UnauthorizedException();
    return this.repo.updateSystemSettings(actorId, dto);
  }
}
