import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IStorageService,
  STORAGE_SERVICE,
} from '../storage/storage.interface';
import {
  EventMediaRecord,
  EventMediaRepository,
} from './event-media.repository';
import { EventMediaResponseDto } from './dto/event-media-response.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly frigateBaseUrl: string;
  private readonly storageProvider: string;
  private readonly storageBucket: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventMediaRepository: EventMediaRepository,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
  ) {
    this.frigateBaseUrl = this.configService.get<string>('FRIGATE_URL', 'http://localhost:5000');
    this.storageProvider = this.configService.get<string>('STORAGE_PROVIDER', 'MINIO').toUpperCase();
    this.storageBucket = this.configService.get<string>('STORAGE_BUCKET', 'camerai-media');
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

  /**
   * Tải snapshot từ Frigate và lưu vào MinIO/S3 + bảng event_media.
   */
  async downloadAndStoreSnapshot(
    eventId: string,
    trackId: string,
    eventDate: Date,
  ): Promise<EventMediaRecord | null> {
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

      await this.storageService.upload(objectKey, buffer, 'image/jpeg');

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
   * Tải video clip từ Frigate và lưu vào MinIO/S3 + bảng event_media (cho P0/P1).
   */
  async downloadAndStoreClip(
    eventId: string,
    trackId: string,
    eventDate: Date,
    durationMs?: number,
  ): Promise<EventMediaRecord | null> {
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

      await this.storageService.upload(objectKey, buffer, 'video/mp4');

      return await this.eventMediaRepository.createEventMedia({
        eventId,
        mediaType: 'CLIP',
        storageProvider: this.storageProvider,
        bucket: this.storageBucket,
        objectKey,
        contentType: 'video/mp4',
        sizeBytes: buffer.length,
        durationMs: durationMs && durationMs > 0 ? durationMs : 10000,
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

    const records = await this.eventMediaRepository.findMediaByEventId(eventId);
    const results: EventMediaResponseDto[] = [];

    for (const record of records) {
      const { url, expiresAt } = await this.storageService.getPresignedUrl(record.object_key, 900);
      results.push({
        id: record.id,
        mediaType: record.media_type,
        url,
        expiresAt: expiresAt.toISOString(),
        contentType: record.content_type,
        sizeBytes: record.size_bytes,
        width: record.width,
        height: record.height,
        durationMs: record.duration_ms,
        createdAt: record.created_at.toISOString(),
      });
    }

    return results;
  }
}
