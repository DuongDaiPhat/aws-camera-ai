import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { MediaMtxService } from './media-mtx.service';
import { CameraSourcesRepository } from './camera-sources.repository';

interface MediaMtxAuthRequest {
  action?: string;
  path?: string;
  protocol?: string;
  token?: string;
  user?: string;
  password?: string;
}

@Controller('mediamtx')
export class MediaMtxAuthController {
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
    if (await this.isInternalRtspRequest(body, slug)) return;
    throw new UnauthorizedException();
  }

  private async isBrowserPublish(body: MediaMtxAuthRequest, slug: string): Promise<boolean> {
    if (body.action !== 'publish' || body.protocol !== 'webrtc' || !body.token) return false;
    if (!this.mediaMtxService.verifyBrowserSession(slug, body.token)) return false;
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
}
