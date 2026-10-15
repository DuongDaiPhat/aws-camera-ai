import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmWellnessCheckDto {
  @ApiProperty({
    example: '33333333-3333-4333-8333-333333333333',
    description: 'UUID duy nhất của lệnh xác nhận (idempotency key)',
  })
  @IsUUID()
  commandId!: string;

  @ApiProperty({
    example: 'IM_OK',
    description: 'Phản hồi của người được giám sát',
    enum: ['IM_OK', 'NEED_HELP'],
  })
  @IsIn(['IM_OK', 'NEED_HELP'])
  response!: 'IM_OK' | 'NEED_HELP';

  @ApiPropertyOptional({
    example: 'Tôi vừa thức dậy và đang uống nước',
    description: 'Ghi chú thêm (tối đa 500 ký tự)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
