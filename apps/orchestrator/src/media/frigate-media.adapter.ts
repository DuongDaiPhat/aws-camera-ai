import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FrigateMediaAdapter {
  private readonly logger = new Logger(FrigateMediaAdapter.name);
  private readonly frigateBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.frigateBaseUrl = this.configService.get<string>('FRIGATE_URL', 'http://localhost:5000');
  }

  /**
   * Lấy ảnh crop khuôn mặt/người từ Frigate API.
   * Tham số crop=1 giúp Frigate trả về ảnh đã crop sát bounding box,
   * rất quan trọng để AI nhận diện khuôn mặt chính xác (US-10).
   */
  async getCroppedSnapshot(trackId: string): Promise<Buffer | null> {
    const url = `${this.frigateBaseUrl}/api/events/${trackId}/snapshot.jpg?crop=1&quality=100`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Không thể lấy ảnh crop từ Frigate cho trackId=${trackId} (${response.status})`,
        );
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.error(`Lỗi kết nối Frigate khi lấy ảnh crop cho trackId=${trackId}`, error);
      return null;
    }
  }
}
