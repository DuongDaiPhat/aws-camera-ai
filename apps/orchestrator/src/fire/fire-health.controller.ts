import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { Public } from '../auth/public.decorator';
import { FireHealthService, type FireHealth } from './fire-health.service';

@Controller('internal/fire')
@UseGuards(InternalTokenGuard)
export class FireHealthController {
  constructor(private readonly health: FireHealthService) {}

  @Get('health')
  @Public()
  check(): Promise<FireHealth> {
    return this.health.check();
  }
}
