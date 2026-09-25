import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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

  @ApiPropertyOptional({ minimum: 160, maximum: 7680 })
  @IsOptional()
  @IsInt()
  @Min(160)
  @Max(7680)
  detectWidth?: number;

  @ApiPropertyOptional({ minimum: 120, maximum: 4320 })
  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(4320)
  detectHeight?: number;

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

  @ApiPropertyOptional({ minimum: 1, maximum: 300 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  minInitializedFrames?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 300 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  maxDisappearedFrames?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  personMinScore?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  personThreshold?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  personMinArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  snapshotsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  snapshotBoundingBox?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  detectionRetentionDays?: number;
}
