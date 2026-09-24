import { Injectable, Logger } from '@nestjs/common';
import YAML from 'yaml';
import type { CameraAggregateRecord } from '../cameras/cameras.types';

export interface CameraFrigateData {
  camera: CameraAggregateRecord;
  mediamtxRtspBaseUrl?: string;
}

@Injectable()
export class FrigateConfigService {
  private readonly logger = new Logger(FrigateConfigService.name);

  generateUpdatedConfig(rawYaml: string, data: CameraFrigateData): string {
    const { camera, mediamtxRtspBaseUrl = 'rtsp://mediamtx:8554' } = data;
    const slug = camera.slug;

    const parsedConfig = this.parseConfig(rawYaml);
    if (!parsedConfig.cameras || typeof parsedConfig.cameras !== 'object') {
      parsedConfig.cameras = {};
    }

    const cameras = parsedConfig.cameras as Record<string, Record<string, unknown>>;
    const existingCamera = cameras[slug] ?? {};
    const preservedZones = existingCamera.zones ?? {};
    const streamUrl = this.resolveStreamUrl(camera, mediamtxRtspBaseUrl);

    // 4. Sinh cấu hình mới cho camera mà không ghi đè zone
    cameras[slug] = {
      ...existingCamera,
      enabled: camera.is_enabled,
      ffmpeg: {
        inputs: [
          {
            path: streamUrl,
            roles: ['detect', 'record'],
          },
        ],
      },
      detect: {
        width: camera.detect_width || 1280,
        height: camera.detect_height || 720,
        fps: camera.fps || 5,
      },
      zones: preservedZones, // Bảo toàn 100% zones của Thành viên C
    };

    return YAML.stringify(parsedConfig);
  }

  private parseConfig(rawYaml: string): Record<string, unknown> {
    try {
      const parsed = YAML.parse(rawYaml) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      this.logger.error('Lỗi khi phân tích cú pháp YAML cấu hình Frigate:', err);
      throw new Error('YAML cấu hình Frigate không hợp lệ');
    }
  }

  private resolveStreamUrl(camera: CameraAggregateRecord, mediamtxRtspBaseUrl: string): string {
    if (camera.source_type_val === 'RTSP' && camera.rtsp_url) {
      return camera.rtsp_url;
    }
    return `${mediamtxRtspBaseUrl}/${camera.slug}`;
  }
}
