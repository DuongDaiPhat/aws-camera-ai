import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';
import { Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TelegramLinkService } from './telegram-link.service';

@ApiTags('auth')
@Controller('auth/telegram')
export class TelegramLinkController {
  constructor(private readonly links: TelegramLinkService) {}

  @Post('link')
  @HttpCode(201)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Tạo mã liên kết Telegram một lần' })
  @ApiResponse({ status: 201, description: 'Mã liên kết có hiệu lực 10 phút' })
  async create(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ linkToken: string; expiresAt: string }> {
    const userId = request.auth?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.links.create(userId);
  }
}
