import { NotificationCloudModule } from '../notification-cloud/notification-cloud.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EscalationRulesModule } from '../escalation-rules/escalation-rules.module';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { EscalationRepository } from './escalation.repository';
import { EscalationEngineService } from './escalation-engine.service';
import { EscalationDeadlineWorkerService } from './escalation-deadline-worker.service';
import { DeadlineRepository } from './deadline.repository';
import { DeadlineCommandService } from './deadline-command.service';
import { DeadlineController } from './deadline.controller';
import { DeadlineStepFunctionsService } from './deadline-stepfunctions.service';

@Module({
  imports: [DatabaseModule, EscalationRulesModule, NotificationCloudModule],
  controllers: [DeadlineController],
  providers: [
    InternalTokenGuard,
    EscalationRepository,
    DeadlineRepository,
    DeadlineCommandService,
    DeadlineStepFunctionsService,
    EscalationEngineService,
    EscalationDeadlineWorkerService,
  ],
  exports: [
    EscalationRepository,
    DeadlineRepository,
    DeadlineCommandService,
    DeadlineStepFunctionsService,
    EscalationEngineService,
    EscalationDeadlineWorkerService,
  ],
})
export class EscalationModule {}
