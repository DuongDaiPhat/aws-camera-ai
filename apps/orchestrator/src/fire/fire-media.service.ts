import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_SERVICE, type IStorageService } from '../storage/storage.interface';
import { EventMediaRepository } from '../media/event-media.repository';
import { EventsService } from '../events/events.service';
import { FireIncidentsRepository, type FireMediaWork } from './fire-incidents.repository';

function positive(config: ConfigService, key: string, fallback: number): number {
  const value = Number(config.get<string | number>(key, fallback));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${key}`);
  return value;
}

@Injectable()
export class FireMediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FireMediaService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly readySeconds: number;
  private readonly retrySeconds: number;
  private readonly maxAgeDays: number;

  constructor(
    private readonly config: ConfigService,
    private readonly incidents: FireIncidentsRepository,
    private readonly media: EventMediaRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    private readonly events: EventsService,
  ) {
    this.readySeconds = positive(config, 'FIRE_MEDIA_READY_DELAY_SECONDS', 15);
    this.retrySeconds = positive(config, 'FIRE_MEDIA_RETRY_SECONDS', 30);
    this.maxAgeDays = positive(config, 'FIRE_MEDIA_MAX_AGE_DAYS', 7);
  }

  onModuleInit(): void {
    this.timer = setInterval(
      () => {
        void this.dispatch().catch((error) =>
          this.logger.error({ err: error }, 'Fire media recovery failed'),
        );
      },
      positive(this.config, 'FIRE_DELIVERY_POLL_MS', 1000),
    );
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const work = await this.incidents.claimMedia(
        this.readySeconds,
        this.retrySeconds,
        this.maxAgeDays,
      );
      if (!work) return;
      await this.recoverSnapshotRecord(work);
      const existing = await this.media.findMediaByEventIdAndType(work.event_id, 'CLIP');
      if (!existing) await this.storeClip(work);
    } finally {
      this.busy = false;
    }
  }

  private key(work: FireMediaWork, filename: string): string {
    const date = new Date(work.confirmed_at).toISOString().slice(0, 10).replaceAll('-', '/');
    return `events/${date}/${work.event_id}/${filename}`;
  }

  private async recoverSnapshotRecord(work: FireMediaWork): Promise<void> {
    if (await this.media.findMediaByEventIdAndType(work.event_id, 'SNAPSHOT')) return;
    const key = this.key(work, 'snapshot.jpg');
    let image: Buffer;
    try {
      // An upload may have committed before the process lost its DB media record.
      image = await this.storage.download(key);
    } catch {
      this.logger.debug({ eventId: work.event_id }, 'Exact confirmation snapshot is unavailable');
      return;
    }
    await this.createRecord(work, key, image, 'SNAPSHOT', 'image/jpeg');
  }

  private async storeClip(work: FireMediaWork): Promise<void> {
    const before = positive(this.config, 'FIRE_CLIP_PRE_SECONDS', 5);
    const after = positive(this.config, 'FIRE_CLIP_POST_SECONDS', 5);
    const at = new Date(work.confirmed_at).getTime() / 1000;
    const first = new Date(work.first_qualified_at).getTime() / 1000;
    const base = this.config.get<string>('FRIGATE_URL', 'http://localhost:5000');
    const url = `${base}/api/${encodeURIComponent(work.camera_slug)}/start/${first - before}/end/${at + after}/clip.mp4`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(positive(this.config, 'FIRE_CLIP_TIMEOUT_MS', 10000)),
    });
    if (!response.ok || !response.body) throw new Error(`Fire camera clip HTTP ${response.status}`);
    const body = await this.readClip(
      response.body,
      positive(this.config, 'FIRE_CLIP_MAX_BYTES', 33554432),
    );
    if (body.length < 12 || body.subarray(4, 8).toString('ascii') !== 'ftyp')
      throw new Error('Invalid fire camera MP4');
    const key = this.key(work, 'clip.mp4');
    await this.storage.upload(key, body, 'video/mp4');
    await this.createRecord(
      work,
      key,
      body,
      'CLIP',
      'video/mp4',
      Math.round((before + at - first + after) * 1000),
    );
  }

  private async readClip(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new Error('Fire clip exceeds configured size limit');
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks);
    } finally {
      await reader.cancel();
    }
  }

  private async createRecord(
    work: FireMediaWork,
    objectKey: string,
    body: Buffer,
    mediaType: 'SNAPSHOT' | 'CLIP',
    contentType: string,
    durationMs?: number,
  ): Promise<void> {
    await this.media.createEventMedia({
      eventId: work.event_id,
      mediaType,
      storageProvider: this.config.get<string>('STORAGE_PROVIDER', 'MINIO').toUpperCase(),
      bucket: this.config.get<string>('STORAGE_BUCKET', 'camerai-media'),
      objectKey,
      contentType,
      sizeBytes: body.length,
      durationMs,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
    });
    await this.events.publishCommittedUpdate(work.event_id);
  }
}
