import { Body, Controller, Get, Header, HttpCode, Post, Put, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, Matches, MaxLength } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { EmailNotificationSettingsService } from './email-notification-settings.service';
import {
  ALERT_PHONE,
  PhoneNotificationSettingsService,
} from './phone-notification-settings.service';

class EmailAlertSettingsDto {
  @IsBoolean() enabled!: boolean;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email?: string;
}
class PhoneAlertSettingsDto {
  @IsBoolean() smsEnabled!: boolean;
  @IsBoolean() callEnabled!: boolean;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @Matches(ALERT_PHONE)
  phone?: string;
}
class VerifyPhoneAlertSettingsDto {
  @Matches(/^[0-9]{6}$/) code!: string;
}

@Controller('account/alert-delivery')
export class NotificationSettingsController {
  constructor(
    private readonly email: EmailNotificationSettingsService,
    private readonly phone: PhoneNotificationSettingsService,
  ) {}

  @Get('email')
  @Header('Cache-Control', 'no-store')
  getEmail(@Req() req: AuthenticatedRequest): ReturnType<EmailNotificationSettingsService['get']> {
    return this.email.get(req.auth!.sub);
  }

  @Put('email')
  setEmail(
    @Req() req: AuthenticatedRequest,
    @Body() input: EmailAlertSettingsDto,
  ): ReturnType<EmailNotificationSettingsService['set']> {
    return this.email.set(req.auth!.sub, input);
  }

  @Get('phone')
  @Header('Cache-Control', 'no-store')
  getPhone(@Req() req: AuthenticatedRequest): ReturnType<PhoneNotificationSettingsService['get']> {
    return this.phone.get(req.auth!.sub);
  }

  @Put('phone')
  setPhone(
    @Req() req: AuthenticatedRequest,
    @Body() input: PhoneAlertSettingsDto,
  ): ReturnType<PhoneNotificationSettingsService['set']> {
    return this.phone.set(req.auth!.sub, input);
  }

  @Post('phone/verify')
  @HttpCode(200)
  verifyPhone(
    @Req() req: AuthenticatedRequest,
    @Body() input: VerifyPhoneAlertSettingsDto,
  ): ReturnType<PhoneNotificationSettingsService['verify']> {
    return this.phone.verify(req.auth!.sub, input.code);
  }
}
