import { Body, Controller, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { MediaMtxService } from './media-mtx.service';
import { CameraSourcesRepository } from './camera-sources.repository';

interface MediaMtxAuthRequest {
  action?: string;
  path?: string;
  protocol?: string;
  query?: string;
  token?: string;
  user?: string;
  password?: string;
}

@Controller('mediamtx')
export class MediaMtxAuthController {
  private readonly logger = new Logger(MediaMtxAuthController.name);

  constructor(
    private readonly mediaMtxService: MediaMtxService,
    private readonly cameraSourcesRepository: CameraSourcesRepository,
  ) {}

  @Post('authorize')
  @Public()
  @HttpCode(204)
  async authorize(@Body() body: MediaMtxAuthRequest): Promise<void> {
    const slug = body.path?.split('/')[0] ?? '';
    if (await this.isBrowserPublish(body, slug)) return;
    if (await this.isBrowserRead(body, slug)) return;
    if (await this.isInternalRtspRequest(body, slug)) return;
    this.logger.warn(
      `MediaMTX auth denied action=${body.action ?? ''} protocol=${body.protocol ?? ''} path=${slug} hasToken=${Boolean(body.token)} hasQuery=${Boolean(body.query)}`,
    );
    throw new UnauthorizedException();
  }

  private async isBrowserRead(body: MediaMtxAuthRequest, slug: string): Promise<boolean> {
    const token = this.getBrowserToken(body);
    if (body.action !== 'read' || body.protocol !== 'webrtc' || !token) return false;
    if (!this.mediaMtxService.verifyBrowserReadSession(slug, token)) return false;
    return await this.cameraSourcesRepository.isEnabledMediaPath(slug, 'read');
  }

  private async isBrowserPublish(body: MediaMtxAuthRequest, slug: string): Promise<boolean> {
    const token = this.getBrowserToken(body);
    if (body.action !== 'publish' || body.protocol !== 'webrtc' || !token) return false;
    if (!this.mediaMtxService.verifyBrowserSession(slug, token)) return false;
    return await this.cameraSourcesRepository.isEnabledMediaPath(slug, 'publish_browser');
  }

  private async isInternalRtspRequest(body: MediaMtxAuthRequest, slug: string): Promise<boolean> {
    if (body.protocol !== 'rtsp' || !['publish', 'read'].includes(body.action ?? '')) return false;
    if (
      !this.mediaMtxService.verifyInternalStreamCredentials(body.user ?? '', body.password ?? '')
    ) {
      return false;
    }
    return await this.cameraSourcesRepository.isEnabledMediaPath(slug, body.action ?? '');
  }

  private getBrowserToken(body: MediaMtxAuthRequest): string {
    const directToken = body.token?.trim();
    if (directToken) return directToken;
    return new URLSearchParams(body.query ?? '').get('token')?.trim() ?? '';
  }
}
