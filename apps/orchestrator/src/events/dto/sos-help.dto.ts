import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SosHelpDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Lời nhắn kèm theo khi người dùng bấm Yêu cầu trợ giúp',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
