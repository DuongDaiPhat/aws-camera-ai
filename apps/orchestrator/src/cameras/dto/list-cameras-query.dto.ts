import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListCamerasQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo ID thiết bị edge/NVR', format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'deviceId phải là UUID v4' })
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái kích hoạt (isEnabled)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean({ message: 'isEnabled phải là boolean' })
  isEnabled?: boolean;
}
