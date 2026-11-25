import { Module } from '@nestjs/common';
import { CamerasModule } from '../cameras/cameras.module';
import { EscalationRulesModule } from '../escalation-rules/escalation-rules.module';
import { AccountController, HouseholdController } from './household.controller';
import { HouseholdAccessService } from './household-access.service';
import { HouseholdAiModulesController } from './household-ai-modules.controller';
import { HouseholdAiModulesService } from './household-ai-modules.service';
import { HouseholdMembersService } from './household-members.service';
import { HouseholdService } from './household.service';
import { AccountService } from './account.service';
import { HouseholdRulesService } from './household-rules.service';

@Module({
  imports: [CamerasModule, EscalationRulesModule],
  controllers: [HouseholdController, AccountController, HouseholdAiModulesController],
  providers: [
    HouseholdAccessService,
    HouseholdAiModulesService,
    HouseholdMembersService,
    HouseholdService,
    AccountService,
    HouseholdRulesService,
  ],
})
export class HouseholdModule {}
