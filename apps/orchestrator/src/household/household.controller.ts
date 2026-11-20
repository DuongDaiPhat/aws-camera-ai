import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { HouseholdService } from './household.service';
import { HouseholdMembersService } from './household-members.service';
import {
  ChangePasswordDto,
  CreateMemberDto,
  CreateHouseholdCameraDto,
  EmergencyContactDto,
  HouseholdSettingsDto,
  NotificationPreferencesDto,
  ProfileDto,
  UpdateCameraGrantsDto,
} from './household.dto';
import { AccountService } from './account.service';
import { HouseholdRulesService } from './household-rules.service';
import { UpdateEscalationThresholdsDto } from '../escalation-rules/dto/update-escalation-thresholds.dto';

@Controller('household')
@Roles('ADMIN', 'CAREGIVER')
export class HouseholdController {
  constructor(
    private readonly household: HouseholdService,
    private readonly members: HouseholdMembersService,
    private readonly rules: HouseholdRulesService,
  ) {}
  @Get('escalation-rules') rulesList(
    @Req() req: AuthenticatedRequest,
  ): ReturnType<HouseholdRulesService['list']> {
    return this.rules.list(req.auth!);
  }
  @Put('escalation-rules/:eventType') saveRule(
    @Req() req: AuthenticatedRequest,
    @Param('eventType') type: string,
    @Body() dto: UpdateEscalationThresholdsDto,
  ): ReturnType<HouseholdRulesService['save']> {
    return this.rules.save(req.auth!, type, dto);
  }
  @Get() summary(@Req() req: AuthenticatedRequest): ReturnType<HouseholdService['summary']> {
    return this.household.summary(req.auth!);
  }
  @Post('members') createMember(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMemberDto,
  ): ReturnType<HouseholdMembersService['create']> {
    return this.members.create(req.auth!, dto);
  }
  @Put('members/:memberId/cameras') grants(
    @Req() req: AuthenticatedRequest,
    @Param('memberId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCameraGrantsDto,
  ): ReturnType<HouseholdMembersService['grants']> {
    return this.members.grants(req.auth!, id, dto);
  }
  @Delete('members/:memberId') @HttpCode(204) removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('memberId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.members.remove(req.auth!, id);
  }
  @Post('contacts') contact(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EmergencyContactDto,
  ): ReturnType<HouseholdService['contact']> {
    return this.household.contact(req.auth!, dto);
  }
  @Put('contacts/:contactId') updateContact(
    @Req() req: AuthenticatedRequest,
    @Param('contactId', ParseUUIDPipe) id: string,
    @Body() dto: EmergencyContactDto,
  ): ReturnType<HouseholdService['contact']> {
    return this.household.contact(req.auth!, dto, id);
  }
  @Delete('contacts/:contactId') @HttpCode(204) removeContact(
    @Req() req: AuthenticatedRequest,
    @Param('contactId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.household.removeContact(req.auth!, id);
  }
  @Put('settings') settings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: HouseholdSettingsDto,
  ): ReturnType<HouseholdService['settings']> {
    return this.household.settings(req.auth!, dto);
  }
  @Post('cameras') camera(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateHouseholdCameraDto,
  ): ReturnType<HouseholdService['createCamera']> {
    return this.household.createCamera(req.auth!, dto.name);
  }
}

@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}
  @Get() get(@Req() req: AuthenticatedRequest): ReturnType<AccountService['get']> {
    return this.account.get(req.auth!.sub);
  }
  @Patch('profile') profile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ProfileDto,
  ): ReturnType<AccountService['profile']> {
    return this.account.profile(req.auth!.sub, dto);
  }
  @Put('preferences') preferences(
    @Req() req: AuthenticatedRequest,
    @Body() dto: NotificationPreferencesDto,
  ): ReturnType<AccountService['preferences']> {
    return this.account.preferences(req.auth!.sub, dto);
  }
  @Post('password') @HttpCode(200) password(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): ReturnType<AccountService['password']> {
    return this.account.password(req.auth!.sub, dto);
  }
}
