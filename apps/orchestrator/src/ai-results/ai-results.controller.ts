import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { AiResultsService } from './ai-results.service';
import { AiResultAcceptedDto, SubmitAiResultDto } from './dto/submit-ai-result.dto';
import { InternalTokenGuard } from './internal-token.guard';

@ApiTags('internal')
@Controller('internal/events')
export class AiResultsController {
  constructor(private readonly aiResultsService: AiResultsService) {}

  @Public()
  @UseGuards(InternalTokenGuard)
  @Post(':eventId/ai-result')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Tiếp nhận bền vững kết quả AI cho sự kiện (US-11)' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 202, type: AiResultAcceptedDto })
  @ApiResponse({ status: 400, description: 'Payload hoặc score policy không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Internal token không hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sự kiện' })
  @ApiResponse({ status: 409, description: 'resultId đã được dùng với nội dung khác' })
  async submit(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SubmitAiResultDto,
  ): Promise<AiResultAcceptedDto> {
    return await this.aiResultsService.submit(eventId, dto);
  }
}
