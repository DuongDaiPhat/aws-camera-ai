import { Controller, Get, Query, Sse, MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { Public } from '../auth/public.decorator';
import { EventsService } from './events.service';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { PaginatedEventsResponseDto } from './dto/event-summary-response.dto';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách sự kiện có lọc và phân trang (US-06, US-21)',
    description: 'Mặc định sắp xếp theo detectedAt giảm dần, trả về 20 sự kiện mới nhất.',
  })
  @ApiResponse({ status: 200, type: PaginatedEventsResponseDto })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async listEvents(@Query() query: ListEventsQueryDto): Promise<PaginatedEventsResponseDto> {
    return await this.eventsService.listEvents(query);
  }

  @Public()
  @Sse('stream')
  @ApiOperation({
    summary: 'Luồng sự kiện thời gian thực Server-Sent Events (US-06)',
    description:
      'Dashboard tự cập nhật khi có sự kiện mới không cần F5. Nhận token qua query ?token=',
  })
  @ApiResponse({ status: 200, description: 'Luồng SSE' })
  @ApiResponse({ status: 401, description: 'Token không hợp lệ hoặc thiếu' })
  streamEvents(@Query('token') token?: string): Observable<MessageEvent> {
    return this.eventsService.streamEvents(token);
  }
}
