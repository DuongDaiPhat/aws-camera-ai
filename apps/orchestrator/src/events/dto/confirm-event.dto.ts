import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { ConfirmationResponse } from '@cam/contracts';

export class ConfirmEventDto {
  @ApiProperty({
    enum: ['IM_OK', 'NEED_HELP'],
    description: 'IM_OK chuyển sang RESOLVED, NEED_HELP chuyển sang ESCALATED',
    example: 'IM_OK',
  })
  @IsEnum(['IM_OK', 'NEED_HELP'], {
    message: 'Phản hồi chỉ chấp nhận IM_OK hoặc NEED_HELP trong giai đoạn ban đầu',
  })
  response!: ConfirmationResponse;

  @ApiPropertyOptional({
    description: 'Ghi chú thêm của người xác nhận',
    maxLength: 500,
    example: 'Người cao tuổi đã đứng dậy an toàn',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'ID định danh lệnh tránh gửi trùng lặp',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  commandId?: string;
}

export class CloseEventDto {
  @ApiPropertyOptional({
    description: 'Ghi chú thêm khi đóng sự kiện khẩn cấp',
    maxLength: 500,
    example: 'Đã liên hệ người thân và xử lý xong',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'ID định danh lệnh tránh gửi trùng lặp',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  commandId?: string;
}
