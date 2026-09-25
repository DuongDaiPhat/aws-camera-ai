import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUrl } from 'class-validator';

export class TestRtspSourceDto {
  @ApiProperty({ description: 'URL RTSP chỉ dùng để kiểm tra, không lưu vào database' })
  @IsUrl(
    { protocols: ['rtsp', 'rtsps'], require_protocol: true },
    { message: 'rtspUrl phải là URL RTSP hoặc RTSPS hợp lệ' },
  )
  rtspUrl!: string;

  @ApiProperty({ enum: ['TCP', 'UDP'] })
  @IsIn(['TCP', 'UDP'], { message: 'transport phải là TCP hoặc UDP' })
  transport!: 'TCP' | 'UDP';
}
