import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListWellnessSchedulesQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo ID người được giám sát',
  })
  @IsOptional()
  @IsUUID()
  residentUserId?: string;
}
