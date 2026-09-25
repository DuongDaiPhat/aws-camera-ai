import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { TelegramWebhookGuard } from './telegram-webhook.guard';
import { TelegramWebhookService } from './telegram-webhook.service';

@ApiTags('internal')
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly webhook: TelegramWebhookService) {}

  @Public()
  @UseGuards(TelegramWebhookGuard)
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Nhận Telegram update đã ký bằng webhook secret' })
  @ApiResponse({ status: 200, description: 'Update đã được ghi và xử lý' })
  receive(@Body() body: unknown): Promise<{ ok: true }> {
    return this.webhook.receive(body);
  }
}
