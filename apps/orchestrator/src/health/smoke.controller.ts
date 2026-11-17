import { Controller, Get, HttpStatus, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { Public } from '../auth/public.decorator';
import { SmokeService, type SmokeStatus } from './smoke.service';

@ApiTags('internal')
@ApiSecurity('internalToken')
@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/smoke')
export class SmokeController {
  constructor(private readonly smokeService: SmokeService) {}

  @Get()
  @ApiOperation({
    summary: 'Kiểm tra sẵn sàng API, DB, Auth, Storage và Cloud Queue',
    description:
      'Chạy kiểm tra kết nối thực tế tới PostgreSQL, Auth provider, S3/MinIO và SQS (nếu bật). Yêu cầu X-Internal-Token.',
  })
  @ApiResponse({ status: 200, description: 'Tất cả thành phần hoạt động bình thường' })
  @ApiResponse({ status: 401, description: 'Token nội bộ không hợp lệ' })
  @ApiResponse({ status: 503, description: 'Một hoặc nhiều thành phần phụ thuộc gặp lỗi' })
  async check(@Res({ passthrough: true }) response: Response): Promise<SmokeStatus> {
    const status = await this.smokeService.check();
    response.status(status.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return status;
  }
}
