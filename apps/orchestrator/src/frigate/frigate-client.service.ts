import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FrigateClientService {
  private readonly logger = new Logger(FrigateClientService.name);
  private readonly frigateUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.frigateUrl = this.configService.get<string>(
      'FRIGATE_URL',
      'http://localhost:5000',
    );
  }

  async getRawConfig(): Promise<string> {
    try {
      const response = await fetch(`${this.frigateUrl}/api/config/raw`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Frigate trả về mã lỗi: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      this.logger.warn(`Không thể lấy cấu hình từ Frigate API (${this.frigateUrl}):`, error);
      throw error;
    }
  }

  async saveConfig(rawYaml: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.frigateUrl}/api/config/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: rawYaml,
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`Lưu cấu hình Frigate thất bại: ${response.status}`);
      }

      return true;
    } catch (error) {
      this.logger.error(`Lỗi khi gửi cấu hình mới tới Frigate:`, error);
      throw error;
    }
  }

  async restart(): Promise<boolean> {
    try {
      const response = await fetch(`${this.frigateUrl}/api/restart`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch (error) {
      this.logger.warn(`Khởi động lại Frigate không thành công:`, error);
      return false;
    }
  }

  async setCameraDetection(slug: string, enabled: boolean): Promise<boolean> {
    const action = enabled ? 'enable' : 'disable';
    try {
      const response = await fetch(`${this.frigateUrl}/api/${slug}/detect/${action}`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
