import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { CloudQueueService } from './cloud-queue.service';
@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/cloud/face-jobs')
export class CloudQueueController {
  constructor(private readonly queues: CloudQueueService) {}
  @Get(':id')
  context(@Param('id', ParseUUIDPipe) id: string) {
    return this.queues.faceContext(id);
  }
  @Put(':id/result')
  cache(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.queues.cacheFaceResult(id, body);
  }
}
