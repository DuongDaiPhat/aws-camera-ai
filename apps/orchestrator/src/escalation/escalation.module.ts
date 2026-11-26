import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { NotificationCloudModule } from '../notification-cloud/notification-cloud.module';
import { EscalationRulesModule } from '../escalation-rules/escalation-rules.module';
import { EscalationRepository } from './escalation.repository';
import { EscalationEngineService } from './escalation-engine.service';
import { EscalationDeadlineWorkerService } from './escalation-deadline-worker.service';

@Module({
  imports: [
    DatabaseModule,
    EscalationRulesModule,
    NotificationCloudModule,
    forwardRef(() => EventsModule),
  ],
  providers: [EscalationRepository, EscalationEngineService, EscalationDeadlineWorkerService],
  exports: [EscalationRepository, EscalationEngineService, EscalationDeadlineWorkerService],
})
export class EscalationModule {}
