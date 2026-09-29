import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CameraSourceType } from '../cameras.types';

export class UpdateCameraSourceDto {
  @ApiProperty({ description: 'Loại nguồn phát', enum: ['RTSP', 'BROWSER_WEBCAM', 'VIDEO_FILE'] })
  @IsEnum(['RTSP', 'BROWSER_WEBCAM', 'VIDEO_FILE'], { message: 'sourceType không hợp lệ' })
  sourceType!: CameraSourceType;

  @ApiPropertyOptional({ description: 'RTSP URL (chỉ áp dụng cho nguồn RTSP)' })
  @IsOptional()
  @IsString({ message: 'rtspUrl phải là chuỗi ký tự' })
  rtspUrl?: string;

  @ApiPropertyOptional({ description: 'ID của file video đã upload (chỉ áp dụng cho VIDEO_FILE)' })
  @IsOptional()
  @IsUUID('4', { message: 'videoObjectId phải là UUID v4' })
  videoObjectId?: string;

  @ApiPropertyOptional({ description: 'Tự động phát lặp video', default: true })
  @IsOptional()
  @IsBoolean({ message: 'videoLoop phải là boolean' })
  videoLoop?: boolean;

  @ApiPropertyOptional({
    description: 'Giao thức truyền tải (TCP hoặc UDP)',
    enum: ['TCP', 'UDP'],
    default: 'TCP',
  })
  @IsOptional()
  @IsIn(['TCP', 'UDP'], { message: 'transport phải là TCP hoặc UDP' })
  transport?: 'TCP' | 'UDP';

  @ApiPropertyOptional({ description: 'Tên thiết bị webcam trên trình duyệt' })
  @IsOptional()
  @IsString({ message: 'webcamDeviceLabel phải là chuỗi ký tự' })
  webcamDeviceLabel?: string;
}
