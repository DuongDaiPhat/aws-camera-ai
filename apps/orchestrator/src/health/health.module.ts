import { Module } from '@nestjs/common';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SmokeController } from './smoke.controller';
import { SmokeService } from './smoke.service';

@Module({
  controllers: [HealthController, SmokeController],
  providers: [HealthService, SmokeService, InternalTokenGuard],
  exports: [SmokeService],
})
export class HealthModule {}
