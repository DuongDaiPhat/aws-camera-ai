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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { WellnessService } from './wellness.service';
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
    return { data };
  }

  @Post('wellness-schedules')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Tạo lịch wellness cho người đã đăng ký (US-20)',
    description: 'Chỉ Caregiver hoặc Admin. 09:00 và 18:00 là hai bản ghi riêng biệt.',
  })
  @ApiResponse({ status: 201, description: 'Lịch đã tạo thành công' })
  async createSchedule(@Req() req: AuthenticatedRequest, @Body() dto: CreateWellnessScheduleDto) {
    return await this.wellnessService.createSchedule(req.auth!, dto);
  }

  @Patch('wellness-schedules/:scheduleId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Cập nhật từng phần lịch wellness (US-20)',
  })
  async updateSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateWellnessScheduleDto,
  ) {
    return await this.wellnessService.updateSchedule(req.auth!, scheduleId, dto);
  }

  @Delete('wellness-schedules/:scheduleId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Xóa mềm lịch wellness và giữ lịch sử kiểm tra (US-20)',
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
    return await this.wellnessService.listChecks(req.auth!, query);
  }

  @Post('wellness-checks/:checkId/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Người được giám sát xác nhận "Tôi ổn" hoặc "Cần giúp đỡ" (US-20)',
    description:
      'Chỉ tài khoản người được giám sát của lượt kiểm tra này mới có quyền xác nhận trong 5 phút.',
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

  @Post('internal/wellness-observations')
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary: 'Gửi bằng chứng quan sát nội bộ từ Module 1 (US-20)',
    description:
      'Bảo vệ bằng X-Internal-Token. Nhận diện chuyển động, đến (ARRIVAL) hoặc rời nhà (DEPARTURE).',
  })
  async submitObservation(@Body() dto: WellnessObservationDto) {
    return await this.wellnessService.submitObservation(dto);
  }
}
