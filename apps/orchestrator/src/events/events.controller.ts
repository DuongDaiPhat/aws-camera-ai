import { Controller, Get, Param, ParseUUIDPipe, Query, Sse, MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { Public } from '../auth/public.decorator';
import { EventsService } from './events.service';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { GetEventStatsQueryDto } from './dto/get-event-stats-query.dto';
import { PaginatedEventsResponseDto } from './dto/event-summary-response.dto';
import { EventDetailDto } from './dto/event-detail-response.dto';
import { EventStatsResponseDto } from './dto/event-stats-response.dto';

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

  // Phải khai báo TRƯỚC `:eventId`, nếu không Nest sẽ coi "stats" là một eventId.
  @Get('stats')
  @ApiOperation({
    summary: 'Số liệu tổng hợp cho dashboard (US-06)',
    description: 'FR-DSH-01 — đếm sự kiện và camera trong cửa sổ windowHours giờ gần nhất.',
  })
  @ApiResponse({ status: 200, type: EventStatsResponseDto })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async getEventStats(@Query() query: GetEventStatsQueryDto): Promise<EventStatsResponseDto> {
    return await this.eventsService.getStats(query.windowHours);
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

  @Get(':eventId')
  @ApiOperation({
    summary: 'Chi tiết sự kiện kèm media, kết quả AI và lịch sử trạng thái (US-21)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: EventDetailDto })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sự kiện' })
  async getEvent(@Param('eventId', ParseUUIDPipe) eventId: string): Promise<EventDetailDto> {
    return await this.eventsService.getEvent(eventId);
  }
}
