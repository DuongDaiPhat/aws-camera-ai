import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EscalationRulesService } from './escalation-rules.service';
import { MANAGED_ALERT_EVENT_TYPES } from './escalation-rule-policy';
import { UpdateEscalationThresholdsDto } from './dto/update-escalation-thresholds.dto';
import {
  EscalationRuleDto,
  ListEscalationRulesResponseDto,
} from './dto/escalation-rule-response.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';

@ApiTags('escalation-rules')
@ApiBearerAuth('bearer')
@Controller('escalation-rules')
export class EscalationRulesController {
  constructor(private readonly escalationRulesService: EscalationRulesService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách quy tắc leo thang theo loại sự kiện',
    description: 'ADMIN và các người dùng đã xác thực đều có thể đọc cấu hình.',
  })
  @ApiResponse({ status: 200, type: ListEscalationRulesResponseDto })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async listRules(): Promise<ListEscalationRulesResponseDto> {
    const data = await this.escalationRulesService.listRules();
    return { data };
  }

  @Get(':eventType')
  @ApiOperation({
    summary: 'Chi tiết một quy tắc leo thang theo loại sự kiện',
  })
  @ApiParam({
    name: 'eventType',
    enum: MANAGED_ALERT_EVENT_TYPES,
    description: 'Loại sự kiện cần xem cấu hình',
    example: 'FIRE_SMOKE_DETECTED',
  })
  @ApiResponse({ status: 200, type: EscalationRuleDto })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy loại sự kiện' })
  async getRule(@Param('eventType') eventType: string): Promise<EscalationRuleDto> {
    return await this.escalationRulesService.getRuleByEventType(eventType);
  }

  @Patch(':eventType')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Update thresholds only (US-15)',
    description:
      'Chỉ ADMIN mới có quyền sửa. Cập nhật T_low, T_high, T_wait_seconds với kiểm tra version chống ghi đè song song.',
  })
  @ApiParam({
    name: 'eventType',
    enum: MANAGED_ALERT_EVENT_TYPES,
    description: 'Loại sự kiện cần cấu hình ngưỡng',
    example: 'FIRE_SMOKE_DETECTED',
  })
  @ApiBody({ type: UpdateEscalationThresholdsDto })
  @ApiResponse({ status: 200, type: EscalationRuleDto })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Chỉ dành cho ADMIN' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy loại sự kiện' })
  @ApiResponse({ status: 409, description: 'Xung đột version' })
  async updateThresholds(
    @Param('eventType') eventType: string,
    @Body() dto: UpdateEscalationThresholdsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EscalationRuleDto> {
    const actorUserId = req.auth?.sub ?? '';
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || null;
    const userAgent = req.headers['user-agent'] || null;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;

    return await this.escalationRulesService.updateThresholds(eventType, dto, {
      userId: actorUserId,
      ipAddress: clientIp,
      userAgent,
      correlationId,
    });
  }

  @Put(':eventType')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Cập nhật ngưỡng và thời gian chờ (Tương thích OpenAPI)',
    description: 'Chỉ ADMIN mới có quyền sửa. Cập nhật T_low, T_high, T_wait_seconds với kiểm tra version chống ghi đè song song.',
  })
  @ApiParam({
    name: 'eventType',
    enum: MANAGED_ALERT_EVENT_TYPES,
    description: 'Loại sự kiện cần cấu hình ngưỡng',
    example: 'FIRE_SMOKE_DETECTED',
  })
  @ApiBody({ type: UpdateEscalationThresholdsDto })
  @ApiResponse({ status: 200, type: EscalationRuleDto })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Chỉ dành cho ADMIN' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy loại sự kiện' })
  @ApiResponse({ status: 409, description: 'Xung đột version' })
  async updateRule(
    @Param('eventType') eventType: string,
    @Body() dto: UpdateEscalationThresholdsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EscalationRuleDto> {
    return await this.updateThresholds(eventType, dto, req);
  }
}

