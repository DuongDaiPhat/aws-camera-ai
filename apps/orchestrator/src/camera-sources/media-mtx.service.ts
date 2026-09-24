import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const SLUG_REGEX = /^[a-z][a-z0-9_]{2,63}$/;

export interface BrowserSessionResult {
  publishUrl: string;
  streamKey: string;
  expiresAt: string;
}

@Injectable()
export class MediaMtxService {
  private readonly logger = new Logger(MediaMtxService.name);
  private readonly webrtcBaseUrl: string;
  private readonly rtspBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.webrtcBaseUrl = this.configService.get<string>(
      'MEDIAMTX_WEBRTC_URL',
      'http://localhost:8889',
    );
    this.rtspBaseUrl = this.configService.get<string>(
      'MEDIAMTX_RTSP_URL',
      'rtsp://localhost:8554',
    );
  }

  createBrowserSession(slug: string): BrowserSessionResult {
    this.assertValidSlug(slug);

    const publishUrl = `${this.webrtcBaseUrl}/${slug}/whip`;
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    this.logger.log(`Tạo phiên publish WHIP cho slug: ${slug} -> ${publishUrl}`);

    return {
      publishUrl,
      streamKey: slug,
      expiresAt,
    };
  }

  getPublishRtspUrl(slug: string): string {
    this.assertValidSlug(slug);
    return `${this.rtspBaseUrl}/${slug}`;
  }

  private assertValidSlug(slug: string): void {
    if (!SLUG_REGEX.test(slug)) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_SLUG',
          message: `Camera slug không hợp lệ: "${slug}". Phải bắt đầu bằng chữ cái thường và chỉ chứa chữ thường, số, dấu gạch dưới (3-64 ký tự).`,
        },
      });
    }
  }
}
