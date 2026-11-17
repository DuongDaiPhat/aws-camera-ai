import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaybackFramesRepository } from './playback-frames.repository';
import { archiveFrame, personBoxes, type ArchiveFrame } from './playback-frame.codec';
import { playbackLimit } from './playback-config';
@Injectable()
export class PlaybackFramesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaybackFramesService.name);
  private readonly pending = new Map<string, ArchiveFrame>();
  private readonly last = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private refreshed = 0;
  private pruned = 0;
  private geometries: Awaited<ReturnType<PlaybackFramesRepository['cameras']>> = [];
  constructor(
    private readonly repo: PlaybackFramesRepository,
    private readonly config: ConfigService,
  ) {}
  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.flush(),
      playbackLimit(this.config, 'PLAYBACK_METADATA_SAMPLE_MS', 500),
    );
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.pending.clear();
  }
  enqueue(value: unknown): void {
    const frame = archiveFrame(
      value,
      Date.now(),
      playbackLimit(this.config, 'PLAYBACK_METADATA_MAX_AGE_MS', 3000),
    );
    if (!frame) return;
    if (
      frame.at - (this.last.get(frame.slug) ?? 0) <
      playbackLimit(this.config, 'PLAYBACK_METADATA_SAMPLE_MS', 500)
    )
      return;
    if (
      !this.pending.has(frame.slug) &&
      this.pending.size >= playbackLimit(this.config, 'PLAYBACK_MAX_CAMERAS', 1000)
    )
      return;
    this.pending.set(frame.slug, frame);
  }
  private async flush(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now(),
        refreshMs = playbackLimit(this.config, 'PLAYBACK_METADATA_CACHE_MS', 60000);
      if (now - this.refreshed > refreshMs) {
        this.geometries = await this.repo.cameras(
          playbackLimit(this.config, 'PLAYBACK_MAX_CAMERAS', 1000),
        );
        this.refreshed = now;
      }
      const batch = [...this.pending.values()];
      this.pending.clear();
      for (const frame of batch) {
        const camera = this.geometries.find((c) => c.slug === frame.slug);
        if (!camera) continue;
        const boxes = personBoxes(
          frame,
          camera.width,
          camera.height,
          playbackLimit(this.config, 'PLAYBACK_METADATA_TOLERANCE_MS', 600),
        );
        if (frame.boxes.length > 0 && boxes.length === 0) continue;
        await this.repo.insert(camera.id, frame.at, boxes);
        this.last.set(frame.slug, frame.at);
      }
      if (now - this.pruned > refreshMs) {
        await this.repo.prune(
          playbackLimit(this.config, 'PLAYBACK_METADATA_RETENTION_DAYS', 7),
          playbackLimit(this.config, 'PLAYBACK_METADATA_PRUNE_LIMIT', 10000),
        );
        this.pruned = now;
      }
    } catch (error: unknown) {
      this.logger.warn(
        'Recording geometry archive unavailable: ' +
          (error instanceof Error ? error.message : 'unknown error'),
      );
    } finally {
      this.busy = false;
    }
  }
}
