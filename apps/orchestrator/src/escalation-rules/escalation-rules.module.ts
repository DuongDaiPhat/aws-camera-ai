import { Module } from '@nestjs/common';
import { EscalationRulesController } from './escalation-rules.controller';
import { EscalationRulesService } from './escalation-rules.service';
import { EscalationRulesRepository } from './escalation-rules.repository';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [EscalationRulesController],
  providers: [EscalationRulesService, EscalationRulesRepository, RolesGuard],
  exports: [EscalationRulesService, EscalationRulesRepository],
})
export class EscalationRulesModule {}
