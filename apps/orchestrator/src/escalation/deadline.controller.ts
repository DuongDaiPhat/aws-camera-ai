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
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { DeadlineCommandService } from './deadline-command.service';
import { DeadlineCommandDto, DeadlineCommandResponseDto } from './dto/deadline-command.dto';

@ApiTags('internal')
@Controller('internal/events')
export class DeadlineController {
  constructor(private readonly deadlineCommandService: DeadlineCommandService) {}

  @Public()
  @UseGuards(InternalTokenGuard)
  @Post(':eventId/deadline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thực thi lệnh deadline leo thang từ Step Functions (US-13 / AWS-06)' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DeadlineCommandResponseDto })
  @ApiResponse({ status: 400, description: 'Payload không hợp lệ hoặc eventId không khớp path' })
  @ApiResponse({ status: 401, description: 'Internal token không hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sự kiện' })
  @ApiResponse({
    status: 409,
    description: 'Chưa đến hạn (NOT_DUE) hoặc trùng commandId khác nội dung (COMMAND_CONFLICT)',
  })
  async applyDeadline(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: DeadlineCommandDto,
  ): Promise<DeadlineCommandResponseDto> {
    return this.deadlineCommandService.applyCommand(eventId, body);
  }
}
