import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamerasRepository } from '../cameras/cameras.repository';
import { FrigateClientService } from './frigate-client.service';
import { FrigateConfigService } from './frigate-config.service';

export interface FrigateSyncResult {
  success: boolean;
  cameraId: string;
  configVersion: number;
  syncStatus: 'SYNCED' | 'FAILED';
  errorCode?: string | null;
  errorMessage?: string | null;
}

@Injectable()
export class FrigateSyncService {
  private readonly logger = new Logger(FrigateSyncService.name);
  private readonly syncLocks = new Set<string>();
  private readonly mediamtxRtspBaseUrl: string;
  private readonly frigateInstanceKey: string;
  private readonly mediaMtxPublishUsername: string;
  private readonly mediaMtxPublishPassword: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly camerasRepository: CamerasRepository,
    private readonly frigateClient: FrigateClientService,
    private readonly frigateConfig: FrigateConfigService,
  ) {
    this.mediamtxRtspBaseUrl = this.configService.get<string>(
      'MEDIAMTX_RTSP_URL',
      'rtsp://localhost:8554',
    );
    this.frigateInstanceKey = this.configService.get<string>(
      'FRIGATE_URL',
      'http://localhost:5000',
    );
    this.mediaMtxPublishUsername = this.configService.get<string>(
      'MEDIAMTX_PUBLISH_USERNAME',
      'cam-internal',
    );
    this.mediaMtxPublishPassword = this.configService.get<string>(
      'MEDIAMTX_PUBLISH_PASSWORD',
      'local-dev-password',
    );
  }

  async syncCamera(cameraId: string, expectedVersion?: number): Promise<FrigateSyncResult> {
    if (this.syncLocks.has(this.frigateInstanceKey)) {
      return {
        success: false,
        cameraId,
        configVersion: expectedVersion ?? 1,
        syncStatus: 'FAILED',
        errorCode: 'CAMERA_ALREADY_TRANSITIONING',
        errorMessage: 'Camera đang trong quá trình đồng bộ, vui lòng thử lại sau',
      };
    }

    this.syncLocks.add(this.frigateInstanceKey);
    try {
      return await this.executeSync(cameraId, expectedVersion);
    } finally {
      this.syncLocks.delete(this.frigateInstanceKey);
    }
  }

  async waitForCameraFrames(slug: string): Promise<boolean> {
    const timeoutMs = Number(this.configService.get('CAMERA_SOURCE_START_TIMEOUT_MS', 10000));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.frigateClient.isCameraReceivingFrames(slug)) return true;
      } catch {
        // Frigate may need a few seconds to apply the camera configuration.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  async isCameraReceivingFrames(slug: string): Promise<boolean> {
    try {
      return await this.frigateClient.isCameraReceivingFrames(slug);
    } catch {
      return false;
    }
  }

  private async executeSync(
    cameraId: string,
    expectedVersion?: number,
  ): Promise<FrigateSyncResult> {
    const camera = await this.camerasRepository.findById(cameraId);
    if (!camera) {
      return {
        success: false,
        cameraId,
        configVersion: expectedVersion ?? 1,
        syncStatus: 'FAILED',
        errorCode: 'CAMERA_NOT_FOUND',
        errorMessage: `Không tìm thấy camera với ID: ${cameraId}`,
      };
    }

    const currentSettings = await this.camerasRepository.findFrigateSettingsByCameraId(cameraId);
    const targetVersion = expectedVersion ?? currentSettings?.config_version ?? 1;

    if (
      expectedVersion !== undefined &&
      expectedVersion !== (currentSettings?.config_version ?? 1)
    ) {
      return {
        success: false,
        cameraId,
        configVersion: currentSettings?.config_version ?? 1,
        syncStatus: 'FAILED',
        errorCode: 'CONFIG_VERSION_CONFLICT',
        errorMessage: 'Camera config version has changed; reload before retrying sync.',
      };
    }

    try {
      // 1. Lấy cấu hình thô hiện tại từ Frigate
      const rawConfig = await this.frigateClient.getRawConfig();

      const latestSettings = await this.camerasRepository.findFrigateSettingsByCameraId(cameraId);
      if ((latestSettings?.config_version ?? 1) !== targetVersion) {
        return {
          success: false,
          cameraId,
          configVersion: latestSettings?.config_version ?? 1,
          syncStatus: 'FAILED',
          errorCode: 'CONFIG_VERSION_CONFLICT',
          errorMessage: 'Camera config changed while Frigate config was being prepared.',
        };
      }

      // 2. Sinh cấu hình mới bảo toàn toàn bộ polygon zones của Thành viên C
      const updatedConfig = this.frigateConfig.generateUpdatedConfig(rawConfig, {
        camera,
        settings: currentSettings,
        mediamtxRtspBaseUrl: this.getMediaMtxCameraUrl(camera.source_type_val, camera.slug),
      });

      // 3. Gửi cấu hình đã cập nhật xuống Frigate
      await this.frigateClient.saveConfig(updatedConfig);

      // 4. Cập nhật trạng thái thành công trong Database
      const updatedSettings = await this.camerasRepository.updateFrigateSettings(cameraId, {
        sync_status: 'SYNCED',
        applied_version: targetVersion,
        sync_error_code: null,
        sync_error_message: null,
      });

      this.logger.log(
        `Đồng bộ cấu hình Frigate thành công cho camera ${camera.slug} (Version ${updatedSettings.config_version})`,
      );

      return {
        success: true,
        cameraId,
        configVersion: updatedSettings.config_version,
        syncStatus: 'SYNCED',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Lỗi đồng bộ cấu hình Frigate';
      this.logger.error(`Đồng bộ Frigate thất bại cho camera ${camera.slug}:`, msg);

      // Đánh dấu FAILED và lưu mã lỗi để người dùng có thể bấm Thử lại
      await this.camerasRepository.updateFrigateSettings(cameraId, {
        sync_status: 'FAILED',
        sync_error_code: 'FRIGATE_SYNC_FAILED',
        sync_error_message: msg,
      });

      return {
        success: false,
        cameraId,
        configVersion: targetVersion,
        syncStatus: 'FAILED',
        errorCode: 'FRIGATE_SYNC_FAILED',
        errorMessage: msg,
      };
    }
  }

  private getMediaMtxCameraUrl(sourceType: string | null, slug: string): string {
    if (sourceType === 'RTSP') return this.mediamtxRtspBaseUrl;
    const url = new URL(`${this.mediamtxRtspBaseUrl.replace(/\/$/, '')}/${slug}`);
    url.username = this.mediaMtxPublishUsername;
    url.password = this.mediaMtxPublishPassword;
    return url.toString().replace(/\/$/, '');
  }
}
