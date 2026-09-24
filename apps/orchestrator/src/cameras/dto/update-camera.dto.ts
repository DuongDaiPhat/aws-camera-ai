import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCameraDto {
  @ApiPropertyOptional({ description: 'Tên hiển thị của camera', example: 'Phòng khách mới' })
  @IsOptional()
  @IsString({ message: 'name phải là chuỗi ký tự' })
  name?: string;

  @ApiPropertyOptional({ description: 'URL RTSP (chỉ gửi lên, không bao giờ trả về nguyên vẹn)' })
  @IsOptional()
  @IsString({ message: 'rtspUrl phải là chuỗi ký tự' })
  rtspUrl?: string;

  @ApiPropertyOptional({ description: 'Số khung hình trên giây (1-30)', minimum: 1, maximum: 30 })
  @IsOptional()
  @IsInt({ message: 'fps phải là số nguyên' })
  @Min(1, { message: 'fps tối thiểu là 1' })
  @Max(30, { message: 'fps tối đa là 30' })
  fps?: number;

  @ApiPropertyOptional({ description: 'Bật/tắt camera' })
  @IsOptional()
  @IsBoolean({ message: 'isEnabled phải là boolean' })
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Bật/tắt nhận diện AI' })
  @IsOptional()
  @IsBoolean({ message: 'detectionEnabled phải là boolean' })
  detectionEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Thời gian lưu trữ dữ liệu (ngày)', minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt({ message: 'retentionDays phải là số nguyên' })
  @Min(1, { message: 'retentionDays tối thiểu là 1' })
  @Max(90, { message: 'retentionDays tối đa là 90' })
  retentionDays?: number;
}
