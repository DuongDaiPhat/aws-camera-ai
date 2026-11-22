import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { readNonEmptyConfigString, readPositiveConfigNumber } from '../config/env-config';
import {
  IStorageService,
  S3_EXPIRE_7D_TAG,
  STORAGE_SERVICE,
  UploadOptions,
} from '../storage/storage.interface';
import { EventMediaRecord, EventMediaRepository } from './event-media.repository';
import { EventMediaResponseDto } from './dto/event-media-response.dto';

const DEFAULT_CLIP_DURATION_MS = 10_000;
const PRESIGNED_URL_TTL_SECONDS = 900;
const DEFAULT_EVENT_MEDIA_LIST_LIMIT = 100;

function toNumberOrNull(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly frigateBaseUrl: string;
  private readonly storageProvider: string;
  private readonly storageBucket: string;
  private readonly defaultClipDurationMs: number;
  private readonly presignedUrlTtlSeconds: number;
  private readonly eventMediaListLimit: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventMediaRepository: EventMediaRepository,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
  ) {
    this.frigateBaseUrl = readNonEmptyConfigString(
      this.configService,
      'FRIGATE_URL',
      'http://localhost:5000',
    );
    this.storageProvider = readNonEmptyConfigString(
      this.configService,
      'STORAGE_PROVIDER',
      'MINIO',
    ).toUpperCase();
    this.storageBucket = readNonEmptyConfigString(
      this.configService,
      'STORAGE_BUCKET',
      'camerai-media',
    );
    this.defaultClipDurationMs = readPositiveConfigNumber(
      this.configService,
      'FRIGATE_DEFAULT_CLIP_DURATION_MS',
      DEFAULT_CLIP_DURATION_MS,
    );
    this.presignedUrlTtlSeconds = readPositiveConfigNumber(
      this.configService,
      'STORAGE_PRESIGN_TTL_SECONDS',
      PRESIGNED_URL_TTL_SECONDS,
    );
    this.eventMediaListLimit = readPositiveConfigNumber(
      this.configService,
      'EVENT_MEDIA_LIST_LIMIT',
      DEFAULT_EVENT_MEDIA_LIST_LIMIT,
    );
  }

  /**
   * Tạo đường dẫn object_key chuẩn: events/{yyyy}/{mm}/{dd}/{event_id}/{filename}
   */
  private buildObjectKey(eventDate: Date, eventId: string, filename: string): string {
    const yyyy = eventDate.getUTCFullYear();
    const mm = String(eventDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(eventDate.getUTCDate()).padStart(2, '0');
    return `events/${yyyy}/${mm}/${dd}/${eventId}/${filename}`;
  }

  private retentionUploadOptions(retain?: boolean): UploadOptions {
    return retain ? { retain: true } : { tags: S3_EXPIRE_7D_TAG };
  }

  /** Store the exact full-camera confirmation frame without a person track. */
  async storeCameraSnapshot(
    eventId: string,
    observedAt: Date,
    image: Buffer,
    width: number,
    height: number,
    options?: { retain?: boolean },
  ): Promise<EventMediaRecord | null> {
    const objectKey = this.buildObjectKey(observedAt, eventId, 'snapshot.jpg');
    try {
      await this.storageService.upload(
        objectKey,
        image,
        'image/jpeg',
        this.retentionUploadOptions(options?.retain),
      );
      return await this.eventMediaRepository.createEventMedia({
        eventId,
        mediaType: 'SNAPSHOT',
        storageProvider: this.storageProvider,
        bucket: this.storageBucket,
        objectKey,
        contentType: 'image/jpeg',
        sizeBytes: image.length,
        checksumSha256: createHash('sha256').update(image).digest('hex'),
        width,
        height,
      });
    } catch (error) {
      this.logger.error(
        {
          eventId,
          error: error instanceof Error ? error.message : 'Unknown snapshot storage error',
        },
        'Camera snapshot storage failed; incident remains persisted',
      );
      return null;
    }
  }

  /**
   * Tải snapshot từ Frigate và lưu vào MinIO/S3 + bảng event_media.
   */
  async downloadAndStoreSnapshot(
    eventId: string,
    trackId: string,
    eventDate: Date,
    options?: { retain?: boolean },
  ): Promise<EventMediaRecord | null> {
    const existingMedia = await this.eventMediaRepository.findMediaByEventIdAndType(
      eventId,
      'SNAPSHOT',
    );
    if (existingMedia) {
      return existingMedia;
    }

    const snapshotUrl = `${this.frigateBaseUrl}/api/events/${trackId}/snapshot.jpg`;
    const objectKey = this.buildObjectKey(eventDate, eventId, 'snapshot.jpg');

    try {
      const response = await fetch(snapshotUrl);
      if (!response.ok) {
        this.logger.warn(`Khong the tai snapshot tu Frigate (${response.status}: ${snapshotUrl})`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await this.storageService.upload(
        objectKey,
        buffer,
        'image/jpeg',
        this.retentionUploadOptions(options?.retain),
      );

      return await this.eventMediaRepository.createEventMedia({
        eventId,
        mediaType: 'SNAPSHOT',
        storageProvider: this.storageProvider,
        bucket: this.storageBucket,
        objectKey,
        contentType: 'image/jpeg',
        sizeBytes: buffer.length,
      });
    } catch (error) {
      this.logger.error(`Loi khi tai/luu snapshot cho event ${eventId}`, error);
      return null;
    }
  }

  /**
   * Lưu snapshot trực tiếp từ buffer ảnh vào MinIO/S3 + bảng event_media.
   * Dùng cho các sự kiện AI pipeline (như FALL_DETECTED) có sẵn frame ảnh JPEG.
   */
  async storeBufferSnapshot(
    eventId: string,
    buffer: Buffer,
    eventDate: Date,
    filename = 'snapshot.jpg',
    options?: { retain?: boolean },
  ): Promise<EventMediaRecord | null> {
    const existingMedia = await this.eventMediaRepository.findMediaByEventIdAndType(
      eventId,
      'SNAPSHOT',
    );
    if (existingMedia) {
      return existingMedia;
    }

    const objectKey = this.buildObjectKey(eventDate, eventId, filename);

    try {
      await this.storageService.upload(
        objectKey,
        buffer,
        'image/jpeg',
        this.retentionUploadOptions(options?.retain),
      );

      return await this.eventMediaRepository.createEventMedia({
        eventId,
        mediaType: 'SNAPSHOT',
        storageProvider: this.storageProvider,
        bucket: this.storageBucket,
        objectKey,
        contentType: 'image/jpeg',
        sizeBytes: buffer.length,
      });
    } catch (error) {
      this.logger.error(`Loi khi luu buffer snapshot cho event ${eventId}`, error);
      return null;
    }
  }

  /**
   * Tải video clip từ Frigate và lưu vào MinIO/S3 + bảng event_media (cho P0/P1).
   */
  async downloadAndStoreClip(
    eventId: string,
    trackId: string,
    eventDate: Date,
    durationMs?: number,
    options?: { retain?: boolean },
  ): Promise<EventMediaRecord | null> {
    const existingMedia = await this.eventMediaRepository.findMediaByEventIdAndType(
      eventId,
      'CLIP',
    );
    if (existingMedia) {
      return existingMedia;
    }

    const clipUrl = `${this.frigateBaseUrl}/api/events/${trackId}/clip.mp4`;
    const objectKey = this.buildObjectKey(eventDate, eventId, 'clip.mp4');

    try {
      const response = await fetch(clipUrl);
      if (!response.ok) {
        this.logger.warn(`Khong the tai clip tu Frigate (${response.status}: ${clipUrl})`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await this.storageService.upload(
        objectKey,
        buffer,
        'video/mp4',
        this.retentionUploadOptions(options?.retain),
      );

      return await this.eventMediaRepository.createEventMedia({
        eventId,
        mediaType: 'CLIP',
        storageProvider: this.storageProvider,
        bucket: this.storageBucket,
        objectKey,
        contentType: 'video/mp4',
        sizeBytes: buffer.length,
        durationMs: durationMs && durationMs > 0 ? durationMs : this.defaultClipDurationMs,
      });
    } catch (error) {
      this.logger.error(`Loi khi tai/luu clip cho event ${eventId}`, error);
      return null;
    }
  }

  /**
   * Lấy danh sách media của sự kiện kèm Presigned URL có thời hạn 15 phút (FR-EVT-07).
   */
  async listEventMediaWithUrls(eventId: string): Promise<EventMediaResponseDto[]> {
    const event = await this.eventMediaRepository.findEventById(eventId);
    if (!event) {
      throw new NotFoundException(`Khong tim thay su kien co id ${eventId}`);
    }

    const records = await this.eventMediaRepository.findMediaByEventId(
      eventId,
      this.eventMediaListLimit,
    );
    const results: EventMediaResponseDto[] = [];

    for (const record of records) {
      const { url, expiresAt } = await this.storageService.getPresignedUrl(
        record.object_key,
        this.presignedUrlTtlSeconds,
      );
      results.push({
        id: record.id,
        mediaType: record.media_type,
        url,
        expiresAt: expiresAt.toISOString(),
        contentType: record.content_type,
        // Driver pg tra BIGINT duoi dang chuoi, hop dong API khai bao integer.
        sizeBytes: toNumberOrNull(record.size_bytes),
        width: record.width,
        height: record.height,
        durationMs: record.duration_ms,
        createdAt: record.created_at.toISOString(),
      });
    }

    return results;
  }
}
