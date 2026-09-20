import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService, HealthStatus } from './health.service';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Kiểm tra sức khỏe dịch vụ Orchestrator',
    description: 'Trả về trạng thái hoạt động, uptime và timestamp.',
  })
  @ApiResponse({ status: 200, description: 'Dịch vụ hoạt động bình thường' })
  check(): HealthStatus {
    return this.healthService.check();
  }
}
