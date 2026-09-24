import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';
import { CamerasRepository } from './cameras.repository';
import type {
  CameraAggregateRecord,
  CameraDebugStream,
  CameraDto,
  CameraFrigateSyncInfo,
  CameraRuntimeStatus,
  CameraRuntimeStatusResponse,
  CameraSourceDetail,
  CameraSourceInfo,
  CameraSourceRecord,
  UploadedVideoFile,
} from './cameras.types';
import type { BrowserSessionResult } from '../camera-sources/media-mtx.service';
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
  private readonly transitioningCameras = new Set<string>();

  constructor(
    private readonly camerasRepository: CamerasRepository,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
    private readonly cameraSourcesService: CameraSourcesService,
    private readonly frigateSyncService: FrigateSyncService,
    private readonly configService: ConfigService,
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
      runtimeStatus: this.calculateRuntimeStatus(camera.is_enabled, camera.source_status),
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

    const currentSettings = await this.camerasRepository.findFrigateSettingsByCameraId(
      command.cameraId,
    );
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

    if (this.transitioningCameras.has(id)) {
      throw new ConflictException({
        error: {
          code: 'CAMERA_ALREADY_TRANSITIONING',
          message: 'Camera đang trong quá trình chuyển trạng thái, vui lòng thử lại sau.',
        },
      });
    }

    this.transitioningCameras.add(id);
    try {
      const existing = await this.camerasRepository.findById(id);
      if (!existing) {
        throw new NotFoundException({
          error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${id}` },
        });
      }

      if (isEnabled) {
        this.assertValidSourceForStartup(existing);
      }

      await this.camerasRepository.updateState(id, isEnabled);
      await this.camerasRepository.bumpFrigateConfigVersion(id);

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
      }

      const syncResult = await this.frigateSyncService.syncCamera(id).catch((err) => {
        this.logger.warn(`Đồng bộ Frigate khi updateCameraState cho camera ${id} thất bại:`, err);
        return null;
      });
      if (isEnabled && syncResult?.success && existing.source_type_val !== 'BROWSER_WEBCAM') {
        if (await this.frigateSyncService.waitForCameraFrames(existing.slug)) {
          await this.cameraSourcesService.markCameraOnline(id);
        } else {
          await this.cameraSourcesService.markCameraFailed(
            id,
            'SOURCE_UNAVAILABLE',
            'Frigate chưa nhận được frame từ nguồn camera trong thời gian chờ.',
          );
        }
      }
      if (!isEnabled) {
        await this.cameraSourcesService.stopCameraSource(id);
      }

      this.logger.log(
        `Camera ${existing.slug} (${id}) đã chuyển trạng thái isEnabled = ${isEnabled}`,
      );
      const refreshed = await this.camerasRepository.findById(id);
      return this.mapToCameraDto(refreshed ?? existing, role);
    } finally {
      this.transitioningCameras.delete(id);
    }
  }

  private assertValidSourceForStartup(existing: CameraAggregateRecord): void {
    if (existing.source_type_val === 'VIDEO_FILE' && !existing.source_video_key) {
      throw new BadRequestException({
        error: {
          code: 'SOURCE_NOT_CONFIGURED',
          message: 'Chưa tải lên file video nguồn phát cho camera này.',
        },
      });
    }
    if (existing.source_type_val === 'RTSP' && !existing.rtsp_url && !existing.source_rtsp_url) {
      throw new BadRequestException({
        error: {
          code: 'SOURCE_NOT_CONFIGURED',
          message: 'Chưa cấu hình URL RTSP cho camera này.',
        },
      });
    }
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

    await this.camerasRepository.bumpFrigateConfigVersion(id);

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
        status: camera.is_enabled ? 'STARTING' : 'STOPPED',
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
    await this.camerasRepository.bumpFrigateConfigVersion(cameraId);

    this.logger.log(`Cập nhật nguồn phát cho camera ${camera.slug} sang ${dto.sourceType}`);
    return this.mapToSourceDetail(updatedSource, role);
  }

  async createBrowserPublishSession(
    cameraId: string,
    role: UserRole,
  ): Promise<BrowserSessionResult> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    return this.cameraSourcesService.createBrowserSession(camera.slug, cameraId);
  }

  async revokeBrowserPublishSession(cameraId: string, role: UserRole): Promise<void> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    this.cameraSourcesService.revokeBrowserSession(cameraId);
    await this.camerasRepository.upsertSource(cameraId, { status: 'OFFLINE' });
  }

  async getCameraRuntimeStatus(cameraId: string): Promise<CameraRuntimeStatusResponse> {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    let runtimeStatus = this.calculateRuntimeStatus(camera.is_enabled, camera.source_status);
    if (
      runtimeStatus === 'STARTING' &&
      (await this.frigateSyncService.isCameraReceivingFrames(camera.slug))
    ) {
      await this.cameraSourcesService.markCameraOnline(cameraId);
      runtimeStatus = 'ONLINE';
    }

    return {
      cameraId: camera.id,
      runtimeStatus,
      isPublishing: camera.is_enabled && runtimeStatus === 'ONLINE',
      frigateSyncStatus: this.calculateSyncStatus(camera.sync_status),
      lastCheckedAt: new Date().toISOString(),
      details: {
        sourceType: camera.source_type_val ?? 'RTSP',
        errorCode: camera.source_error_code ?? null,
        errorMessage: camera.source_error_msg ?? null,
      },
    };
  }

  async uploadCameraVideo(
    cameraId: string,
    file: UploadedVideoFile,
    loop: boolean = true,
    role: UserRole = 'ADMIN',
  ): Promise<CameraSourceDetail> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    this.validateVideoUpload(file);

    const ext = path.extname(file.originalname).toLowerCase();
    const fileUuid = `${randomUUID()}${ext}`;
    const storagePath = path.resolve(
      this.configService.get('CAMERA_VIDEO_STORAGE_PATH', './storage/videos'),
    );

    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    const newPath = path.resolve(storagePath, fileUuid);
    await fs.promises.writeFile(newPath, file.buffer);

    let updated: CameraSourceRecord;
    try {
      updated = await this.camerasRepository.upsertSource(cameraId, {
        source_type: 'VIDEO_FILE',
        video_object_key: fileUuid,
        video_original_name: file.originalname,
        video_loop: loop,
        status: camera.is_enabled ? 'STARTING' : 'OFFLINE',
      });
      await this.camerasRepository.bumpFrigateConfigVersion(cameraId);
    } catch (error) {
      await fs.promises.unlink(newPath).catch(() => undefined);
      throw error;
    }

    if (camera.source_video_key) {
      const oldPath = path.resolve(storagePath, path.basename(camera.source_video_key));
      if (fs.existsSync(oldPath)) {
        await fs.promises.unlink(oldPath).catch(() => undefined);
      }
    }

    if (camera.is_enabled) {
      await this.cameraSourcesService.startCameraSource(cameraId, camera.slug, 'VIDEO_FILE', {
        videoKey: fileUuid,
        loop,
      });
    }

    const refreshed = await this.camerasRepository.findSourceByCameraId(cameraId);
    return this.mapToSourceDetail(refreshed ?? updated, role);
  }

  private validateVideoUpload(file?: UploadedVideoFile): void {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        error: { code: 'VIDEO_NOT_FOUND', message: 'Vui lòng chọn file video nguồn phát.' },
      });
    }

    const maxBytes = Number(this.configService.get('CAMERA_VIDEO_MAX_BYTES', 524288000));
    if (file.size > maxBytes) {
      throw new BadRequestException({
        error: {
          code: 'VIDEO_TOO_LARGE',
          message: `Dung lượng video vượt quá giới hạn (${Math.round(maxBytes / (1024 * 1024))}MB)`,
        },
      });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.mp4', '.mkv'].includes(ext)) {
      throw new BadRequestException({
        error: {
          code: 'VIDEO_INVALID_FORMAT',
          message: 'Định dạng video không được hỗ trợ. Chỉ chấp nhận MP4 hoặc MKV',
        },
      });
    }
  }

  async deleteCameraVideo(cameraId: string, role: UserRole): Promise<void> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    await this.cameraSourcesService.stopCameraSource(cameraId);

    if (camera.source_video_key) {
      const storagePath = path.resolve(
        this.configService.get('CAMERA_VIDEO_STORAGE_PATH', './storage/videos'),
      );
      const targetPath = path.resolve(storagePath, path.basename(camera.source_video_key));
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch {
          /* ignore */
        }
      }
    }

    await this.camerasRepository.upsertSource(cameraId, {
      video_object_key: null,
      video_original_name: null,
      status: 'NOT_CONFIGURED',
    });
    await this.camerasRepository.bumpFrigateConfigVersion(cameraId);
  }

  async startCameraSource(cameraId: string, role: UserRole): Promise<CameraSourceDetail> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    const source = await this.camerasRepository.findSourceByCameraId(cameraId);
    if (!source) {
      throw new NotFoundException({
        error: {
          code: 'CAMERA_SOURCE_NOT_FOUND',
          message: 'Chưa cấu hình nguồn phát cho camera này',
        },
      });
    }

    if (source.source_type === 'VIDEO_FILE' && !source.video_object_key) {
      throw new BadRequestException({
        error: { code: 'SOURCE_NOT_CONFIGURED', message: 'Chưa tải lên file video nguồn phát' },
      });
    }

    if (source.source_type === 'RTSP' && !source.rtsp_url) {
      throw new BadRequestException({
        error: { code: 'SOURCE_NOT_CONFIGURED', message: 'Chưa cấu hình URL RTSP' },
      });
    }

    await this.cameraSourcesService.startCameraSource(cameraId, camera.slug, source.source_type, {
      videoKey: source.video_object_key,
      loop: source.video_loop,
      rtspUrl: source.rtsp_url,
    });

    const refreshed = await this.camerasRepository.findSourceByCameraId(cameraId);
    return this.mapToSourceDetail(refreshed ?? source, role);
  }

  async stopCameraSource(cameraId: string, role: UserRole): Promise<CameraSourceDetail> {
    this.assertAdmin(role);
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    await this.cameraSourcesService.stopCameraSource(cameraId);

    const refreshed = await this.camerasRepository.findSourceByCameraId(cameraId);
    if (!refreshed) {
      throw new NotFoundException({
        error: { code: 'CAMERA_SOURCE_NOT_FOUND', message: 'Không tìm thấy nguồn phát' },
      });
    }

    return this.mapToSourceDetail(refreshed, role);
  }

  async getCameraDebugStream(cameraId: string): Promise<CameraDebugStream> {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }

    const latestSnapshotKey = await this.camerasRepository.findLatestSnapshotKey(cameraId);

    const webrtcBaseUrl = this.configService.get('MEDIAMTX_WEBRTC_URL', 'http://localhost:8889');
    const streamUrl = `${webrtcBaseUrl}/${camera.slug}`;

    const snapshotResult = latestSnapshotKey
      ? await this.storageService.getPresignedUrl(latestSnapshotKey).catch(() => null)
      : null;

    return {
      cameraId: camera.id,
      streamUrl,
      snapshotUrl: snapshotResult?.url ?? null,
      detections: [],
      activeZones: [],
    };
  }

  async retryFrigateSync(
    cameraId: string,
    role: UserRole,
  ): Promise<{
    cameraId: string;
    configVersion: number;
    syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
  }> {
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

  private calculateRuntimeStatus(
    isEnabled: boolean,
    sourceStatus: string | null,
  ): CameraRuntimeStatus {
    if (!isEnabled) return 'DISABLED';
    if (sourceStatus === 'ONLINE') return 'ONLINE';
    if (sourceStatus === 'STARTING') return 'STARTING';
    if (sourceStatus === 'FAILED') return 'FAILED';
    return 'OFFLINE';
  }

  private calculateSyncStatus(status: string | null): 'PENDING' | 'SYNCED' | 'FAILED' {
    if (status === 'SYNCED' || status === 'FAILED') return status;
    return 'PENDING';
  }

  private buildSourceInfo(r: CameraAggregateRecord): CameraSourceInfo {
    const isPublishing = r.is_enabled && r.source_status === 'ONLINE';
    // A source URL can contain credentials. Keep it out of display metadata for every role.
    const displayName = r.source_video_name ?? (r.source_type_val ? r.name : null);
    return {
      type: r.source_type_val ?? 'RTSP',
      displayName,
      isPublishing,
      lastError: r.source_error_msg ?? null,
      requiresBrowserPublisher: r.source_type_val === 'BROWSER_WEBCAM',
    };
  }

  private buildFrigateSyncInfo(
    r: CameraAggregateRecord,
    syncStatus: 'PENDING' | 'SYNCED' | 'FAILED',
  ): CameraFrigateSyncInfo {
    const configVer = r.config_version ?? 1;
    return {
      status: syncStatus,
      configVersion: configVer,
      appliedVersion: r.applied_version ?? null,
      errorCode: r.sync_error_code ?? null,
      errorMessage: r.sync_error_message ?? null,
    };
  }

  private mapToCameraDto(r: CameraAggregateRecord, role: UserRole): CameraDto {
    const isMasked = role !== 'ADMIN';
    const maskedRtsp = isMasked
      ? null
      : r.rtsp_url
        ? r.rtsp_url.replace(/(rtsp:\/\/[^:]+:)[^@]+(@.*)/, '$1***$2')
        : null;

    const runtimeStatus = this.calculateRuntimeStatus(r.is_enabled, r.source_status);
    const syncStatus = this.calculateSyncStatus(r.sync_status);

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
      runtimeStatus,
      source: this.buildSourceInfo(r),
      frigateSync: this.buildFrigateSyncInfo(r, syncStatus),
      debugCapabilities: {
        personBoundary: true,
        zoneBoundary: true,
      },
      configVersion: r.config_version ?? 1,
      syncStatus,
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
