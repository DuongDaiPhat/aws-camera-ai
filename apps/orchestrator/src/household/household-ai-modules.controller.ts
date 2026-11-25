import { Body, Controller, Get, Header, Put, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { HouseholdAiModulesService } from './household-ai-modules.service';
import { HouseholdAiModulesDto } from './household.dto';

@Controller('household/ai-modules')
@Roles('CAREGIVER')
export class HouseholdAiModulesController {
  constructor(private readonly aiModules: HouseholdAiModulesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Req() req: AuthenticatedRequest): ReturnType<HouseholdAiModulesService['get']> {
    return this.aiModules.get(req.auth);
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  update(
    @Req() req: AuthenticatedRequest,
    @Body() dto: HouseholdAiModulesDto,
  ): ReturnType<HouseholdAiModulesService['update']> {
    return this.aiModules.update(req.auth, dto);
  }
}
