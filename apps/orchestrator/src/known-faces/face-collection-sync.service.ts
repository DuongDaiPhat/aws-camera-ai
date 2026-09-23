import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FACE_INFERENCE, type IFaceInference } from './face-inference.interface';
import { KnownFacesRepository } from './known-faces.repository';

@Injectable()
export class FaceCollectionSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaceCollectionSyncService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly repository: KnownFacesRepository,
    @Inject(FACE_INFERENCE) private readonly inference: IFaceInference,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Resend cả snapshot đã sync để phục hồi khi riêng AI restart.
    this.timer = setInterval(
      () => {
        void this.tick();
      },
      Number(this.config.get('FACE_SYNC_INTERVAL_MS', 10000)),
    );
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sync();
    } finally {
      this.running = false;
    }
  }

  async sync(owner?: string): Promise<boolean> {
    try {
      const snapshots = await this.repository.snapshots(owner);
      let complete = true;
      for (const snapshot of snapshots) {
        try {
          await this.inference.sync(snapshot);
          await this.repository.markSynced(snapshot);
        } catch {
          complete = false;
          this.logger.warn({
            code: 'FACE_SYNC_PENDING',
            ownerScopeId: snapshot.ownerScopeId,
            version: snapshot.version,
          });
        }
      }
      return complete && (owner ? await this.repository.isReady(owner) : true);
    } catch {
      this.logger.warn({ code: 'FACE_SYNC_RETRY', message: 'Collection sync chưa hoàn tất' });
      return false;
    }
  }
}
