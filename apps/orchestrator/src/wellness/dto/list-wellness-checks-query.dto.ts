import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListWellnessChecksQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo ID người được giám sát',
    example: '22222222-2222-4222-8222-222222222222',
  })
  @IsOptional()
  @IsUUID()
  residentUserId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo ID lịch kiểm tra',
  })
  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @ApiPropertyOptional({
    description: 'Số trang (bắt đầu từ 1)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Kích thước trang (1 - 100)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
