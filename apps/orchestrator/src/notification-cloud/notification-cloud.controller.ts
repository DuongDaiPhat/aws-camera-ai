import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Equals, IsInt, IsUUID, Min } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { NotificationCloudService } from './notification-cloud.service';
import type { ClaimRequest } from './notification-cloud.types';

class NotificationClaimDto implements ClaimRequest {
  @Equals(1)
  schemaVersion!: 1;

  @IsUUID()
  claimId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  expectedEventVersion!: number;
}

@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/notifications')
export class NotificationCloudController {
  constructor(private readonly notifications: NotificationCloudService) {}

  @Get(':id')
  context(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.context(id);
  }

  @Post(':id/claim')
  @HttpCode(200)
  claim(@Param('id', ParseUUIDPipe) id: string, @Body() body: NotificationClaimDto) {
    return this.notifications.claim(id, body);
  }

  @Put(':id/result')
  cache(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.notifications.cacheResult(id, body);
  }

  @Post(':id/outcome')
  @HttpCode(202)
  outcome(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.notifications.submitOutcome(id, body);
  }
}
