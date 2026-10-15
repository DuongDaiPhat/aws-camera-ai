import { Module } from '@nestjs/common';
import { WellnessController } from './wellness.controller';
import { WellnessService } from './wellness.service';
import { WellnessRepository } from './wellness.repository';
import { WellnessSchedulerService } from './wellness-scheduler.service';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [WellnessController],
  providers: [WellnessRepository, WellnessService, WellnessSchedulerService, InternalTokenGuard],
  exports: [WellnessRepository, WellnessService, WellnessSchedulerService],
})
export class WellnessModule {}
