import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export const SLUG_REGEX = /^[a-z][a-z0-9_]{2,63}$/;

export interface BrowserSessionResult {
  publishUrl: string;
  streamKey: string;
  token: string;
  expiresAt: string;
}

interface ActiveSessionEntry {
  token: string;
  slug: string;
  cameraId: string;
  expiresAt: Date;
}

@Injectable()
export class MediaMtxService {
  private readonly logger = new Logger(MediaMtxService.name);
  private readonly webrtcBaseUrl: string;
  private readonly rtspBaseUrl: string;
  private readonly publishUsername: string;
  private readonly publishPassword: string;
  private readonly activeSessions = new Map<string, ActiveSessionEntry>();
  private readonly tokenMap = new Map<string, ActiveSessionEntry>();

  constructor(private readonly configService: ConfigService) {
    this.webrtcBaseUrl = this.configService.get<string>(
      'MEDIAMTX_WEBRTC_URL',
      'http://localhost:8889',
    );
    this.rtspBaseUrl = this.configService.get<string>('MEDIAMTX_RTSP_URL', 'rtsp://localhost:8554');
    this.publishUsername = this.configService.get<string>(
      'MEDIAMTX_PUBLISH_USERNAME',
      'cam-internal',
    );
    this.publishPassword = this.configService.get<string>(
      'MEDIAMTX_PUBLISH_PASSWORD',
      'local-dev-password',
    );
  }

  createBrowserSession(slug: string, cameraId?: string): BrowserSessionResult {
    this.assertValidSlug(slug);

    const effectiveId = cameraId ?? slug;
    // Thu hồi session cũ nếu tồn tại
    this.revokeBrowserSession(effectiveId);

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const publishUrl = `${this.webrtcBaseUrl}/${slug}/whip`;

    const entry: ActiveSessionEntry = {
      token,
      slug,
      cameraId: effectiveId,
      expiresAt,
    };

    this.activeSessions.set(effectiveId, entry);
    this.tokenMap.set(token, entry);

    this.logger.log(
      `Tạo phiên publish WHIP cho slug: ${slug} (hết hạn: ${expiresAt.toISOString()})`,
    );

    return {
      publishUrl,
      streamKey: slug,
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  revokeBrowserSession(cameraIdOrSlug: string): boolean {
    const entry = this.activeSessions.get(cameraIdOrSlug);
    if (!entry) return false;

    this.activeSessions.delete(cameraIdOrSlug);
    this.tokenMap.delete(entry.token);
    this.logger.log(`Thu hồi phiên publish WHIP của camera: ${entry.slug}`);
    return true;
  }

  verifyBrowserSession(slug: string, token: string): boolean {
    const entry = this.tokenMap.get(token);
    if (!entry) return false;

    if (entry.slug !== slug) return false;

    if (entry.expiresAt.getTime() <= Date.now()) {
      this.revokeBrowserSession(entry.cameraId);
      return false;
    }

    return true;
  }

  hasActiveSession(cameraIdOrSlug: string): boolean {
    const entry = this.activeSessions.get(cameraIdOrSlug);
    if (!entry) return false;
    if (entry.expiresAt.getTime() <= Date.now()) {
      this.revokeBrowserSession(cameraIdOrSlug);
      return false;
    }
    return true;
  }

  getPublishRtspUrl(slug: string): string {
    this.assertValidSlug(slug);
    const url = new URL(`${this.rtspBaseUrl.replace(/\/$/, '')}/${slug}`);
    url.username = this.publishUsername;
    url.password = this.publishPassword;
    return url.toString();
  }

  verifyInternalStreamCredentials(username: string, password: string): boolean {
    return username === this.publishUsername && password === this.publishPassword;
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
