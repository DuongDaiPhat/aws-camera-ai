import { DATABASE_UUID_PATTERN } from '../auth/database-uuid';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMemberDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 120) fullName!: string;
  @IsOptional() @IsString() @Length(10, 128) password?: string;
  @IsOptional() @IsString() @Length(1, 128) cognitoSub?: string;
}
export class CameraGrantDto {
  @Matches(DATABASE_UUID_PATTERN) cameraId!: string;
  @IsBoolean() canLive!: boolean;
  @IsBoolean() canPlayback!: boolean;
}
export class UpdateCameraGrantsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique((grant: CameraGrantDto) => grant.cameraId)
  @ValidateNested({ each: true })
  @Type(() => CameraGrantDto)
  grants!: CameraGrantDto[];
}
const INVALID_PHONE_MESSAGE = 'Nhập số điện thoại có mã quốc gia, ví dụ +84901234567.';

export class EmergencyContactDto {
  @IsString() @Length(1, 120) name!: string;
  @Matches(/^\+[1-9][0-9]{7,14}$/, { message: INVALID_PHONE_MESSAGE }) phone!: string;
  @IsInt() @Min(1) @Max(3) priority!: number;
  @IsBoolean() isEnabled!: boolean;
}
export class HouseholdSettingsDto {
  @IsInt() @Min(1) @Max(90) retentionDays!: number;
  @IsInt() @Min(1) @Max(100000) storageQuotaGb!: number;
}
export class NotificationPreferencesDto {
  @IsBoolean() inAppAlerts!: boolean;
  @IsBoolean() soundAlerts!: boolean;
  @IsBoolean() telegramAlerts!: boolean;
}
export class ProfileDto {
  @IsString() @Length(1, 120) fullName!: string;
  @IsOptional() @Matches(/^\+[1-9][0-9]{7,14}$/, { message: INVALID_PHONE_MESSAGE }) phone?: string;
}
export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword!: string;
  @IsString() @Length(10, 128) newPassword!: string;
}
export class CreateHouseholdCameraDto {
  @IsString() @Length(1, 120) name!: string;
}
export class HouseholdAiModulesDto {
  @IsBoolean() m1Face!: boolean;
  @IsBoolean() m2aFall!: boolean;
  @IsBoolean() m3Fire!: boolean;
  @IsBoolean() m4Zone!: boolean;
  @IsBoolean() m5Wellness!: boolean;
}
