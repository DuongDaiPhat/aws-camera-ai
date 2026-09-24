import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';
import { CamerasRepository } from './cameras.repository';
import type {
  CameraAggregateRecord,
  CameraDto,
  CameraSourceDetail,
  CameraSourceRecord,
} from './cameras.types';
import type { UserRole } from '../auth/auth.types';
import type {
  ApplyFrigateConfigCommandV1,
  ApplyFrigateConfigResultV1,
  CameraConfigPortV1,
  CameraContextV1,
  CameraPreviewV1,
} from '../contracts/vertical-slice.ports';
import type { ListCamerasQueryDto } from './dto/list-cameras-query.dto';
import type { UpdateCameraDto } from './dto/update-camera.dto';
import type { UpdateCameraSourceDto } from './dto/update-camera-source.dto';

import { CameraSourcesService } from '../camera-sources/camera-sources.service';
import { FrigateSyncService } from '../frigate/frigate-sync.service';

const DEFAULT_PREVIEW_WIDTH = 1280;
const DEFAULT_PREVIEW_HEIGHT = 720;
const PRESIGNED_URL_TTL_SECONDS = 900;

@Injectable()
export class CamerasService implements CameraConfigPortV1 {
  private readonly logger = new Logger(CamerasService.name);

  constructor(
    private readonly camerasRepository: CamerasRepository,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
    private readonly cameraSourcesService: CameraSourcesService,
    private readonly frigateSyncService: FrigateSyncService,
  ) {}

  // -------------------------------------------------------------------
  // Triển khai CameraConfigPortV1 (bàn giao cho Thành viên C - US-12 Zone)
  // -------------------------------------------------------------------

  async getCameraContext(cameraId: string): Promise<CameraContextV1> {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    return {
      schemaVersion: 1,
      cameraId: camera.id,
      deviceId: camera.device_id,
      slug: camera.slug,
      name: camera.name,
      timezone: camera.timezone,
      detectWidth: camera.detect_width,
      detectHeight: camera.detect_height,
      fps: camera.fps,
      isEnabled: camera.is_enabled,
      detectionEnabled: camera.detection_enabled,
      sourceType: camera.source_type_val ?? 'RTSP',
      runtimeStatus: camera.source_status ?? (camera.is_enabled ? 'ONLINE' : 'STOPPED'),
      configVersion: camera.config_version ?? 1,
    };
  }

  async getPreview(cameraId: string): Promise<CameraPreviewV1> {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    const latestSnapshotKey = await this.camerasRepository.findLatestSnapshotKey(cameraId);
    let previewUrl: string;

    if (latestSnapshotKey) {
      const presigned = await this.storageService.getPresignedUrl(
        latestSnapshotKey,
        PRESIGNED_URL_TTL_SECONDS,
      );
      previewUrl = presigned.url;
    } else {
      // Khi camera chưa có snapshot thật, trả placeholder URL an toàn
      previewUrl = `http://localhost:5000/api/${camera.slug}/latest.jpg`;
    }

    const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000).toISOString();

    return {
      url: previewUrl,
      expiresAt,
      cameraId: camera.id,
      width: camera.detect_width || DEFAULT_PREVIEW_WIDTH,
      height: camera.detect_height || DEFAULT_PREVIEW_HEIGHT,
      capturedAt: camera.updated_at ? camera.updated_at.toISOString() : new Date().toISOString(),
    };
  }

  async applyConfiguration(
    command: ApplyFrigateConfigCommandV1,
  ): Promise<ApplyFrigateConfigResultV1> {
    this.logger.log(
      `Đồng bộ cấu hình Frigate cho camera ${command.cameraId}, lý do: ${command.reason}, version kỳ vọng: ${command.expectedConfigVersion}`,
    );

    const camera = await this.camerasRepository.findById(command.cameraId);
    if (!camera) {
      return {
        cameraId: command.cameraId,
        configVersion: command.expectedConfigVersion,
        status: 'FAILED',
        appliedAt: null,
        errorCode: 'CAMERA_NOT_FOUND',
      };
    }

    const currentSettings = await this.camerasRepository.findFrigateSettingsByCameraId(command.cameraId);
    const currentVersion = currentSettings?.config_version ?? 1;

    // Version conflict check
    if (command.expectedConfigVersion < currentVersion) {
      this.logger.warn(
        `Xung đột version cấu hình camera ${command.cameraId}: kỳ vọng ${command.expectedConfigVersion} < hiện tại ${currentVersion}`,
      );
      return {
        cameraId: command.cameraId,
        configVersion: currentVersion,
        status: 'FAILED',
        appliedAt: null,
        errorCode: 'CONFIG_VERSION_CONFLICT',
      };
    }

    const syncResult = await this.frigateSyncService.syncCamera(
      command.cameraId,
      command.expectedConfigVersion,
    );

    if (syncResult.success) {
      return {
        cameraId: command.cameraId,
        configVersion: syncResult.configVersion,
        status: 'APPLIED',
        appliedAt: new Date().toISOString(),
        errorCode: null,
      };
    }

    return {
      cameraId: command.cameraId,
      configVersion: syncResult.configVersion,
      status: 'FAILED',
      appliedAt: null,
      errorCode: syncResult.errorCode ?? 'FRIGATE_SYNC_FAILED',
    };
  }

  // -------------------------------------------------------------------
  // Các hàm nghiệp vụ REST API
  // -------------------------------------------------------------------

  async listCameras(query: ListCamerasQueryDto, role: UserRole): Promise<{ data: CameraDto[] }> {
    const records = await this.camerasRepository.findAll(query);
    const data = records.map((r) => this.mapToCameraDto(r, role));
    return { data };
  }

  async getCamera(id: string, role: UserRole): Promise<CameraDto> {
    const record = await this.camerasRepository.findById(id);
    if (!record) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${id}` },
      });
    }
    return this.mapToCameraDto(record, role);
  }

  async updateCameraState(id: string, isEnabled: boolean, role: UserRole): Promise<CameraDto> {
    this.assertAdmin(role);
    const existing = await this.camerasRepository.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${id}` },
      });
    }

    const updated = await this.camerasRepository.updateState(id, isEnabled);
    if (!updated) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${id}` },
      });
    }

    if (isEnabled) {
      await this.cameraSourcesService.startCameraSource(
        id,
        existing.slug,
        existing.source_type_val ?? 'RTSP',
        {
          videoKey: existing.source_video_key,
          loop: existing.source_video_loop ?? true,
          rtspUrl: existing.rtsp_url,
        },
      );
    } else {
      await this.cameraSourcesService.stopCameraSource(id);
    }

    await this.frigateSyncService.syncCamera(id).catch((err) => {
      this.logger.warn(`Đồng bộ Frigate khi updateCameraState cho camera ${id} thất bại:`, err);
    });

    this.logger.log(`Camera ${existing.slug} (${id}) đã chuyển trạng thái isEnabled = ${isEnabled}`);
    return this.mapToCameraDto(updated, role);
  }

  async updateCamera(id: string, dto: UpdateCameraDto, role: UserRole): Promise<CameraDto> {
    this.assertAdmin(role);
    const existing = await this.camerasRepository.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${id}` },
      });
    }

    const updated = await this.camerasRepository.update(id, {
      name: dto.name,
      rtsp_url: dto.rtspUrl,
      fps: dto.fps,
      is_enabled: dto.isEnabled,
      detection_enabled: dto.detectionEnabled,
      retention_days: dto.retentionDays,
    });

    return this.mapToCameraDto(updated ?? existing, role);
  }

  async deleteCamera(id: string, role: UserRole): Promise<void> {
    this.assertAdmin(role);
    const existing = await this.camerasRepository.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${id}` },
      });
    }

    await this.camerasRepository.delete(id);
    this.logger.log(`Đã xóa camera ${existing.slug} (${id})`);
  }

  async getCameraSource(cameraId: string, role: UserRole): Promise<CameraSourceDetail> {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    let source = await this.camerasRepository.findSourceByCameraId(cameraId);
    if (!source) {
      source = await this.camerasRepository.upsertSource(cameraId, {
        source_type: 'RTSP',
        rtsp_url: camera.rtsp_url,
        status: camera.is_enabled ? 'ONLINE' : 'STOPPED',
      });
    }

    return this.mapToSourceDetail(source, role);
  }

  async updateCameraSource(
    cameraId: string,
    dto: UpdateCameraSourceDto,
    role: UserRole,
  ): Promise<CameraSourceDetail> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    const updatedSource = await this.camerasRepository.upsertSource(cameraId, {
      source_type: dto.sourceType,
      rtsp_url: dto.rtspUrl,
      video_object_key: dto.videoObjectId,
      video_loop: dto.videoLoop,
      transport: dto.transport ?? 'TCP',
      webcam_device_label: dto.webcamDeviceLabel,
      status: 'NOT_CONFIGURED',
    });

    this.logger.log(`Cập nhật nguồn phát cho camera ${camera.slug} sang ${dto.sourceType}`);
    return this.mapToSourceDetail(updatedSource, role);
  }

  async createBrowserPublishSession(
    cameraId: string,
    role: UserRole,
  ): Promise<{ publishUrl: string; streamKey: string; expiresAt: string }> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    return this.cameraSourcesService.createBrowserSession(camera.slug);
  }

  async retryFrigateSync(
    cameraId: string,
    role: UserRole,
  ): Promise<{ cameraId: string; configVersion: number; syncStatus: 'PENDING' | 'SYNCED' | 'FAILED' }> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    const syncResult = await this.frigateSyncService.syncCamera(cameraId);

    return {
      cameraId,
      configVersion: syncResult.configVersion,
      syncStatus: syncResult.syncStatus,
    };
  }

  async getCameraZones(cameraId: string): Promise<
    Array<{
      id: string;
      cameraId: string;
      name: string;
      slug: string;
      zoneType: string;
      polygon: number[][];
      isEnabled: boolean;
    }>
  > {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    return await this.camerasRepository.findZonesByCameraId(cameraId);
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private assertAdmin(role: UserRole): void {
    if (role !== 'ADMIN') {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Chỉ Quản trị viên (ADMIN) mới có quyền thực hiện thao tác này.',
        },
      });
    }
  }

  private mapToCameraDto(r: CameraAggregateRecord, role: UserRole): CameraDto {
    const isMasked = role !== 'ADMIN';
    const maskedRtsp = isMasked
      ? null
      : r.rtsp_url
        ? r.rtsp_url.replace(/(rtsp:\/\/[^:]+:)[^@]+(@.*)/, '$1***$2')
        : null;

    return {
      id: r.id,
      deviceId: r.device_id,
      name: r.name,
      slug: r.slug,
      rtspUrl: maskedRtsp,
      detectWidth: r.detect_width,
      detectHeight: r.detect_height,
      fps: r.fps,
      timezone: r.timezone,
      isEnabled: r.is_enabled,
      detectionEnabled: r.detection_enabled,
      retentionDays: r.retention_days,
      sourceType: r.source_type_val ?? 'RTSP',
      runtimeStatus: r.source_status ?? (r.is_enabled ? 'ONLINE' : 'STOPPED'),
      configVersion: r.config_version ?? 1,
      syncStatus: r.sync_status === 'SYNCED' ? 'APPLIED' : (r.sync_status ?? 'PENDING'),
      zoneCount: Number(r.zone_count ?? 0),
      createdAt: r.created_at ? r.created_at.toISOString() : new Date().toISOString(),
    };
  }

  private mapToSourceDetail(s: CameraSourceRecord, role: UserRole): CameraSourceDetail {
    const isMasked = role !== 'ADMIN';
    const maskedRtsp = isMasked
      ? null
      : s.rtsp_url
        ? s.rtsp_url.replace(/(rtsp:\/\/[^:]+:)[^@]+(@.*)/, '$1***$2')
        : null;

    return {
      id: s.id,
      cameraId: s.camera_id,
      sourceType: s.source_type,
      rtspUrl: maskedRtsp,
      videoOriginalName: s.video_original_name,
      videoLoop: s.video_loop,
      transport: s.transport,
      inputFormat: s.input_format,
      webcamDeviceLabel: s.webcam_device_label,
      status: s.status,
      lastErrorCode: s.last_error_code,
      lastErrorMessage: s.last_error_message,
      startedAt: s.started_at ? s.started_at.toISOString() : null,
      stoppedAt: s.stopped_at ? s.stopped_at.toISOString() : null,
      updatedAt: s.updated_at ? s.updated_at.toISOString() : new Date().toISOString(),
    };
  }
}
