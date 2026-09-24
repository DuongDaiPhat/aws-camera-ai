import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCameraStateDto {
  @ApiProperty({ description: 'Trạng thái mong muốn của camera (bật/tắt)', example: true })
  @IsBoolean({ message: 'isEnabled phải là boolean' })
  isEnabled!: boolean;
}
