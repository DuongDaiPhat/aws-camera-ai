import { Body, Controller, Get, Header, HttpCode, Post, Put, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, Matches, MaxLength } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ALERT_PHONE, INVALID_PHONE_MESSAGE, normalizePhoneE164Input } from '../common/phone';
import { EmailNotificationSettingsService } from './email-notification-settings.service';
import { PhoneNotificationSettingsService } from './phone-notification-settings.service';

class EmailAlertSettingsDto {
  @IsBoolean() enabled!: boolean;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsEmail({ allow_utf8_local_part: false }, { message: 'Vui lòng nhập địa chỉ email hợp lệ.' })
  @MaxLength(254, { message: 'Địa chỉ email không được vượt quá 254 ký tự.' })
  email?: string;
}
class PhoneAlertSettingsDto {
  @IsBoolean() smsEnabled!: boolean;
  @IsBoolean() callEnabled!: boolean;
  @Transform(({ value }: { value: unknown }) => normalizePhoneE164Input(value, null))
  @IsOptional()
  @Matches(ALERT_PHONE, { message: INVALID_PHONE_MESSAGE })
  phone?: string | null;
}
class VerifyPhoneAlertSettingsDto {
  @Matches(/^[0-9]{6}$/, { message: 'Mã xác minh phải gồm 6 chữ số.' }) code!: string;
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
