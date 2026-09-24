import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  SOURCE_RUNNER,
  type ISourceRunner,
} from './source-runner.interface';
import { MediaMtxService, type BrowserSessionResult } from './media-mtx.service';
import { CameraSourcesRepository } from './camera-sources.repository';
import type { CameraSourceType } from '../cameras/cameras.types';

@Injectable()
export class CameraSourcesService implements OnModuleInit {
  private readonly logger = new Logger(CameraSourcesService.name);

  constructor(
    @Inject(SOURCE_RUNNER) private readonly sourceRunner: ISourceRunner,
    private readonly mediaMtxService: MediaMtxService,
    private readonly repository: CameraSourcesRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.restoreActiveSources();
  }

  async startCameraSource(
    cameraId: string,
    slug: string,
    sourceType: CameraSourceType,
    options?: { videoKey?: string | null; loop?: boolean; rtspUrl?: string | null },
  ): Promise<void> {
    this.logger.log(`Bắt đầu chạy nguồn phát cho camera ${slug} (${sourceType})`);

    if (sourceType === 'VIDEO_FILE') {
      const res = await this.sourceRunner.start({
        cameraId,
        slug,
        videoPath: options?.videoKey ?? undefined,
        loop: options?.loop ?? true,
      });

      if (res.success) {
        await this.repository.updateRuntimeStatus(cameraId, 'ONLINE', res.pid);
      } else {
        await this.repository.updateRuntimeStatus(cameraId, 'FAILED', null, {
          code: res.errorCode,
          message: res.errorMessage,
        });
      }
    } else if (sourceType === 'BROWSER_WEBCAM') {
      // Khi bật camera webcam, đặt trạng thái STARTING chờ trình duyệt publish WHIP
      await this.repository.updateRuntimeStatus(cameraId, 'STARTING', null);
    } else if (sourceType === 'RTSP') {
      await this.repository.updateRuntimeStatus(cameraId, 'ONLINE', null);
    }
  }

  async stopCameraSource(cameraId: string): Promise<void> {
    this.logger.log(`Dừng nguồn phát cho camera ${cameraId}`);
    if (this.sourceRunner.isRunning(cameraId)) {
      await this.sourceRunner.stop(cameraId);
    }
    await this.repository.updateRuntimeStatus(cameraId, 'STOPPED', null);
  }

  createBrowserSession(slug: string): BrowserSessionResult {
    return this.mediaMtxService.createBrowserSession(slug);
  }

  async restoreActiveSources(): Promise<void> {
    try {
      const activeVideos = await this.repository.findActiveVideoSources();
      if (activeVideos.length === 0) return;

      this.logger.log(`Khôi phục ${activeVideos.length} nguồn video publisher sau khi khởi động server...`);

      for (const item of activeVideos) {
        await this.startCameraSource(item.cameraId, item.slug, 'VIDEO_FILE', {
          videoKey: item.videoObjectKey,
          loop: item.videoLoop,
        });
      }
    } catch (error) {
      this.logger.error('Lỗi khi khôi phục các nguồn phát video hoạt động:', error);
    }
  }
}
