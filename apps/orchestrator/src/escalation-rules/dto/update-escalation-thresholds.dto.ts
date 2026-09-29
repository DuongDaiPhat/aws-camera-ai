import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateEscalationThresholdsDto {
  @ApiProperty({
    example: 0.55,
    description: 'Ngưỡng tối thiểu (0.00 – 1.00). Null đối với sự kiện WELLNESS_TIMEOUT.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  tLow!: number | null;

  @ApiProperty({
    example: 0.75,
    description: 'Ngưỡng tin cậy cao (0.00 – 1.00). Null đối với sự kiện WELLNESS_TIMEOUT.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  tHigh!: number | null;

  @ApiProperty({
    example: 60,
    description: 'Thời gian chờ phản hồi tính bằng giây (1 – 3600 giây).',
    minimum: 1,
    maximum: 3600,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3600)
  tWaitSeconds!: number;

  @ApiProperty({
    example: 1,
    description: 'Phiên bản cấu hình hiện tại trong DB (chống ghi đè đồng thời).',
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
