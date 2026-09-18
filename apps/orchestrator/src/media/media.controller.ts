import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { ListEventMediaResponseDto } from './dto/event-media-response.dto';

@ApiTags('media')
@Controller('events')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':eventId/media')
  @ApiOperation({
    summary: 'Danh sach media cua su kien kem presigned URL',
    description: 'FR-EVT-07 — URL het han sau 15 phut, khong lo credential bucket.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ListEventMediaResponseDto })
  @ApiResponse({ status: 404, description: 'Khong tim thay su kien' })
  async listEventMedia(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<ListEventMediaResponseDto> {
    const data = await this.mediaService.listEventMediaWithUrls(eventId);
    return { data };
  }
}
