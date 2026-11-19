import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import {
  ListAuditLogsQueryDto,
  UpdateHouseholdQuotaDto,
  UpdateResourceLimitsDto,
  UpdateSystemSettingsDto,
  UpdateUserStatusDto,
} from './admin.dto';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Tổng quan hệ thống cho quản trị viên (không chứa hình ảnh camera)' })
  getOverview() {
    return this.admin.getOverview();
  }

  @Get('households')
  @ApiOperation({ summary: 'Danh sách hộ gia đình, trạng thái dịch vụ và hạn mức' })
  listHouseholds() {
    return this.admin.listHouseholds();
  }

  @Patch('users/:userId/status')
  @ApiOperation({ summary: 'Kích hoạt hoặc tạm khóa tài khoản' })
  updateUserStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() { isActive }: UpdateUserStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.updateUserStatus(request.auth?.sub, userId, isActive);
  }

  @Patch('households/:ownerId/quota')
  @ApiOperation({ summary: 'Cập nhật gói dịch vụ và hạn mức của hộ gia đình' })
  updateHouseholdQuota(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: UpdateHouseholdQuotaDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.updateHouseholdQuota(request.auth?.sub, ownerId, dto);
  }

  @Get('services')
  @ApiOperation({
    summary: 'Tình trạng dịch vụ, kết nối, lỗi ghi hình/AI/thông báo (đã loại dữ liệu nhạy cảm)',
  })
  getServicesStatus() {
    return this.admin.getServicesStatus();
  }

  @Get('resources')
  @ApiOperation({ summary: 'Tài nguyên & Hạn mức hệ thống (không duyệt file video)' })
  getResourcesAndQuotas() {
    return this.admin.getResourcesAndQuotas();
  }

  @Patch('resources')
  @ApiOperation({ summary: 'Cập nhật giới hạn mặc định và các mức thời gian lưu' })
  updateResourceLimits(@Body() dto: UpdateResourceLimitsDto, @Req() request: AuthenticatedRequest) {
    return this.admin.updateResourceLimits(request.auth?.sub, dto);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Nhật ký quản trị hệ thống' })
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.admin.listAuditLogs(query);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Cài đặt hệ thống, chính sách đăng nhập và tài khoản quản trị' })
  getSystemSettings() {
    return this.admin.getSystemSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Cập nhật chính sách đăng nhập và giới hạn kỹ thuật' })
  updateSystemSettings(@Body() dto: UpdateSystemSettingsDto, @Req() request: AuthenticatedRequest) {
    return this.admin.updateSystemSettings(request.auth?.sub, dto);
  }
}
