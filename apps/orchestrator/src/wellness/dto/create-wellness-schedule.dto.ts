import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWellnessScheduleDto {
  @ApiProperty({
    example: '22222222-2222-4222-8222-222222222222',
    description: 'ID người được giám sát (resident/VIEWER)',
  })
  @IsUUID()
  residentUserId!: string;

  @ApiProperty({
    example: 'Kiểm tra buổi sáng',
    description: 'Tên lịch kiểm tra',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiProperty({
    example: '09:00',
    description: 'Giờ kiểm tra (HH:mm theo timezone)',
  })
  @IsString()
  @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'checkAt phải có định dạng HH:mm (00:00 - 23:59)',
  })
  checkAt!: string;

  @ApiProperty({
    example: [1, 2, 3, 4, 5, 6, 7],
    description: 'Các ngày trong tuần (1 = Thứ Hai ... 7 = Chủ Nhật theo ISO 8601)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({
    example: 6,
    description: 'Khoảng thời gian nhìn lại tìm hoạt động (1 - 24 giờ, mặc định 6)',
    default: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  lookbackHours?: number;

  @ApiPropertyOptional({
    example: 300,
    description: 'Thời gian chờ người nhà xác nhận (60 - 3600 giây, mặc định 300 = 5 phút)',
    default: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3600)
  graceSeconds?: number;

  @ApiPropertyOptional({
    example: [],
    description: 'Danh sách ID camera áp dụng (rỗng = mọi camera được bật của hộ)',
    default: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  cameraIds?: string[];

  @ApiPropertyOptional({
    example: 'Asia/Ho_Chi_Minh',
    description: 'Tên múi giờ IANA (mặc định Asia/Ho_Chi_Minh)',
    default: 'Asia/Ho_Chi_Minh',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  timezone?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Trạng thái kích hoạt lịch',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
