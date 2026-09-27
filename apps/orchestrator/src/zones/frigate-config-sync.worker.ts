import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FrigateSyncService } from '../frigate/frigate-sync.service';
import { ZonesRepository } from './zones.repository';

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_SECONDS = 5;

@Injectable()
export class FrigateConfigSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FrigateConfigSyncWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly zonesRepository: ZonesRepository,
    private readonly frigateSyncService: FrigateSyncService,
  ) {}

  onModuleInit(): void {
    const pollMs = Number(this.configService.get('FRIGATE_SYNC_POLL_MS', DEFAULT_POLL_MS));
    this.timer = setInterval(() => void this.drain(), pollMs);
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueue(cameraId: string): void {
    void this.drain(cameraId);
  }

  private async drain(cameraId?: string): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const job = await this.zonesRepository.claimNextSyncJob(cameraId);
      if (!job) return;

      const result = await this.frigateSyncService.syncCamera(job.camera_id, job.target_version);
      if (result.success) {
        await this.zonesRepository.completeSyncJob(job);
        return;
      }

      const maxAttempts = Number(
        this.configService.get('FRIGATE_SYNC_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS),
      );
      const baseDelaySeconds = Number(
        this.configService.get('FRIGATE_SYNC_RETRY_BASE_SECONDS', DEFAULT_RETRY_BASE_SECONDS),
      );
      const retryDelaySeconds = Math.min(300, baseDelaySeconds * 2 ** (job.attempt_count - 1));
      await this.zonesRepository.failSyncJob(
        job,
        result.errorCode ?? 'FRIGATE_SYNC_FAILED',
        result.errorMessage ?? 'Không thể đồng bộ cấu hình Frigate.',
        maxAttempts,
        retryDelaySeconds,
      );
    } catch (error) {
      this.logger.error(
        `Worker đồng bộ Frigate gặp lỗi: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
