import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { WellnessService } from './wellness.service';
import { scheduleResponse, checkResponse } from './wellness-policy';
import {
  CreateWellnessScheduleDto,
  UpdateWellnessScheduleDto,
  ListWellnessSchedulesQueryDto,
  ListWellnessChecksQueryDto,
  ConfirmWellnessCheckDto,
  WellnessObservationDto,
} from './dto';

@ApiTags('wellness')
@Controller()
export class WellnessController {
  constructor(private readonly wellnessService: WellnessService) {}

  // -------------------------------------------------------------
  // SCHEDULES
  // -------------------------------------------------------------

  @Get('wellness-schedules')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Danh sách lịch wellness theo quyền truy cập (US-20)',
    description: 'Caregiver xem lịch của hộ; Resident (VIEWER) xem lịch của mình.',
  })
  async listSchedules(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListWellnessSchedulesQueryDto,
  ) {
    const data = await this.wellnessService.listSchedules(req.auth!, query.residentUserId);
    return { data: data.map(scheduleResponse) };
  }

  @Post('wellness-schedules')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Tạo lịch wellness cho người đã đăng ký (US-20)',
    description: 'Chỉ Caregiver hoặc Admin. 09:00 và 18:00 là hai bản ghi riêng biệt.',
  })
  @ApiBody({
    type: CreateWellnessScheduleDto,
    description: 'Thông tin lịch kiểm tra wellness định kỳ',
    schema: {
      example: {
        residentUserId: '22222222-2222-4222-8222-222222222222',
        name: 'Kiểm tra buổi sáng',
        checkAt: '09:00',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        lookbackHours: 6,
        graceSeconds: 300,
        cameraIds: [],
        timezone: 'Asia/Ho_Chi_Minh',
        isEnabled: true,
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Lịch đã tạo thành công' })
  async createSchedule(@Req() req: AuthenticatedRequest, @Body() dto: CreateWellnessScheduleDto) {
    return scheduleResponse(await this.wellnessService.createSchedule(req.auth!, dto));
  }

  @Patch('wellness-schedules/:scheduleId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Cập nhật từng phần lịch wellness (US-20)',
  })
  @ApiParam({
    name: 'scheduleId',
    description: 'ID của lịch kiểm tra (lấy từ GET /wellness-schedules)',
    example: '30a0cf81-b97c-41fb-8b85-03fd7080517d',
  })
  @ApiBody({
    type: UpdateWellnessScheduleDto,
    description: 'Các trường cần cập nhật',
    schema: {
      example: {
        name: 'Kiểm tra buổi tối',
        checkAt: '18:00',
        isEnabled: true,
      },
    },
  })
  async updateSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateWellnessScheduleDto,
  ) {
    return scheduleResponse(await this.wellnessService.updateSchedule(req.auth!, scheduleId, dto));
  }

  @Delete('wellness-schedules/:scheduleId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Xóa mềm lịch wellness và giữ lịch sử kiểm tra (US-20)',
  })
  @ApiParam({
    name: 'scheduleId',
    description: 'ID của lịch kiểm tra cần xóa',
    example: '30a0cf81-b97c-41fb-8b85-03fd7080517d',
  })
  async deleteSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ) {
    await this.wellnessService.deleteSchedule(req.auth!, scheduleId);
  }

  // -------------------------------------------------------------
  // CHECKS & CONFIRMATION
  // -------------------------------------------------------------

  @Get('wellness-checks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Lịch sử và yêu cầu wellness đang chờ xác nhận (US-20)',
  })
  async listChecks(@Req() req: AuthenticatedRequest, @Query() query: ListWellnessChecksQueryDto) {
    const result = await this.wellnessService.listChecks(req.auth!, query);
    return { ...result, data: result.data.map(checkResponse) };
  }

  @Post('wellness-checks/:checkId/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Người được giám sát xác nhận "Tôi ổn" hoặc "Cần giúp đỡ" (US-20)',
    description:
      'Chỉ tài khoản người được giám sát của lượt kiểm tra này mới có quyền xác nhận trong 5 phút.',
  })
  @ApiParam({
    name: 'checkId',
    description: 'ID lượt kiểm tra (lấy từ GET /wellness-checks)',
    example: '55555555-5555-4555-8555-555555555555',
  })
  @ApiBody({
    type: ConfirmWellnessCheckDto,
    description: 'Xác nhận của người được giám sát',
    schema: {
      example: {
        commandId: '44444444-4444-4444-8444-444444444444',
        response: 'IM_OK',
        note: 'Con vừa ngủ dậy, con ổn ạ',
      },
    },
  })
  async confirmCheck(
    @Req() req: AuthenticatedRequest,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() dto: ConfirmWellnessCheckDto,
  ) {
    return await this.wellnessService.confirmCheck(req.auth!, checkId, dto);
  }

  // -------------------------------------------------------------
  // INTERNAL OBSERVATIONS
  // -------------------------------------------------------------

  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('internal/wellness-observations')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({
    name: 'X-Internal-Token',
    required: true,
    description:
      'Token dịch vụ nội bộ (giá trị mặc định dev: dev-internal-token-change-me-at-least-32)',
    schema: {
      default: 'dev-internal-token-change-me-at-least-32',
    },
  })
  @ApiOperation({
    summary: 'Gửi bằng chứng quan sát nội bộ từ Module 1 (US-20)',
    description:
      'Bảo vệ bằng X-Internal-Token. Nhận diện chuyển động, đến (ARRIVAL) hoặc rời nhà (DEPARTURE).',
  })
  @ApiBody({
    type: WellnessObservationDto,
    description: 'Payload bằng chứng quan sát từ camera / AI Module 1',
    schema: {
      example: {
        observationId: '33333333-3333-4333-8333-444444444401',
        ownerUserId: '11111111-1111-4111-8111-111111111111',
        residentUserId: '22222222-2222-4222-8222-222222222222',
        sourceSessionId: 'sess-1',
        trackId: 'trk-1',
        kind: 'DEPARTURE',
        observedAt: '2026-10-16T08:30:00.000Z',
        directionalEvidence: {
          boundaryId: 'door_front',
          direction: 'EXIT',
          policyVersion: 'v1',
        },
      },
    },
  })
  async submitObservation(@Body() dto: WellnessObservationDto) {
    return await this.wellnessService.submitObservation(dto);
  }
}
