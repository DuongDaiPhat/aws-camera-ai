import { playbackLimit } from './playback-config';
import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ArchiveInterval, RecordingArchive } from './playback.types';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
@Injectable()
export class FrigateRecordingAdapter implements RecordingArchive {
  private stats: Promise<Record<string, { camera_fps?: number }>> | null = null;
  private statsAt = 0;
  constructor(private readonly config: ConfigService) {}
  async receivingFrames(slug: string): Promise<boolean> {
    if (!this.stats || Date.now() - this.statsAt > 2000) {
      this.statsAt = Date.now();
      this.stats = this.response('stats').then(async (response) => {
        const value = (await response.json()) as {
          cameras?: Record<string, { camera_fps?: number }>;
        };
        return value.cameras ?? {};
      });
    }
    return ((await this.stats)[slug]?.camera_fps ?? 0) > 0;
  }
  private limit(name: string, fallback: number): number {
    return playbackLimit(this.config, name, fallback);
  }
  private async response(path: string): Promise<Response> {
    try {
      const base = this.config.get<string>('FRIGATE_URL', 'http://frigate:5000').replace(/\/$/, '');
      const response = await fetch(base + '/api/' + path, {
        signal: AbortSignal.timeout(this.limit('PLAYBACK_TIMEOUT_MS', 15000)),
      });
      if (response.status === 404) throw new NotFoundException('Bản ghi không còn được lưu.');
      if (!response.ok) throw new ServiceUnavailableException('Không thể tải kho ghi hình.');
      return response;
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof ServiceUnavailableException)
        throw error;
      throw new ServiceUnavailableException('Dịch vụ ghi hình chưa sẵn sàng. Vui lòng thử lại.');
    }
  }
  async list(slug: string, start: number, end: number): Promise<ArchiveInterval[]> {
    const response = await this.response(
      encodeURIComponent(slug) + '/recordings?after=' + start + '&before=' + end,
    );
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ServiceUnavailableException('Dữ liệu bản ghi không hợp lệ.');
    }
    if (!Array.isArray(data) || data.length > this.limit('PLAYBACK_MAX_RECORDINGS', 12000))
      throw new ServiceUnavailableException('Danh sách bản ghi vượt giới hạn hoặc không hợp lệ.');
    return data
      .map((item: unknown) => {
        if (
          !isRecord(item) ||
          typeof item.start_time !== 'number' ||
          typeof item.end_time !== 'number' ||
          !Number.isFinite(item.start_time) ||
          !Number.isFinite(item.end_time) ||
          item.end_time <= item.start_time
        )
          throw new ServiceUnavailableException('Mốc thời gian bản ghi không hợp lệ.');
        return {
          start: item.start_time,
          end: item.end_time,
          motion: typeof item.motion === 'number' && item.motion > 0,
        };
      })
      .sort((a, b) => a.start - b.start);
  }
  async clip(slug: string, start: number, end: number): Promise<Buffer> {
    const response = await this.response(
      encodeURIComponent(slug) + '/start/' + start + '/end/' + end + '/clip.mp4',
    );
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('video/mp4') && !type.includes('application/octet-stream')) {
      await response.body?.cancel();
      throw new ServiceUnavailableException('Kho ghi hình chưa trả về video hợp lệ.');
    }
    const max = this.limit('PLAYBACK_MAX_CLIP_BYTES', 67108864);
    if (Number(response.headers.get('content-length')) > max) {
      await response.body?.cancel();
      throw new PayloadTooLargeException('Đoạn video quá lớn.');
    }
    return this.readVideo(response, max);
  }
  private async readVideo(response: Response, max: number): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) throw new ServiceUnavailableException('Không nhận được nội dung video.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new PayloadTooLargeException('Đoạn video quá lớn.');
        }
        chunks.push(part.value);
      }
    } catch (error: unknown) {
      if (error instanceof PayloadTooLargeException) throw error;
      throw new ServiceUnavailableException('Tải video bị gián đoạn. Vui lòng thử lại.');
    }
    if (!size) throw new NotFoundException('Đoạn video không còn được lưu.');
    return Buffer.concat(chunks, size);
  }
}
