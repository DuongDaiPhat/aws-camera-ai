import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListWellnessSchedulesQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo ID người được giám sát',
    example: '22222222-2222-4222-8222-222222222222',
  })
  @IsOptional()
  @IsUUID()
  residentUserId?: string;
}
