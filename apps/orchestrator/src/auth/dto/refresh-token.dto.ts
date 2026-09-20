import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Refresh token để cấp token mới (nếu không truyền qua cookie)',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
