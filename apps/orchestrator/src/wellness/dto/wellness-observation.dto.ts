import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DirectionalEvidenceDto {
  @ApiProperty({
    example: 'main_entrance_boundary',
    description: 'ID của ranh giới xác định hướng di chuyển',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  boundaryId!: string;

  @ApiProperty({
    example: 'ENTER',
    description: 'Hướng di chuyển qua ranh giới',
    enum: ['ENTER', 'EXIT'],
  })
  @IsIn(['ENTER', 'EXIT'])
  direction!: 'ENTER' | 'EXIT';

  @ApiProperty({
    example: 'boundary-v1',
    description: 'Phiên bản chính sách ranh giới',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  policyVersion!: string;
}

export class WellnessObservationDto {
  @ApiProperty({
    example: '44444444-4444-4444-4444-444444444444',
    description: 'UUID duy nhất của quan sát (chống trùng lặp)',
  })
  @IsUUID()
  observationId!: string;

  @ApiProperty({
    example: '11111111-1111-4111-8111-111111111111',
    description: 'ID chủ hộ (owner/caregiver/admin)',
  })
  @IsUUID()
  ownerUserId!: string;

  @ApiProperty({
    example: '22222222-2222-4222-8222-222222222222',
    description: 'ID người được giám sát (resident)',
  })
  @IsUUID()
  residentUserId!: string;

  @ApiProperty({
    example: '33333333-3333-4333-8333-333333333333',
    description: 'ID khuôn mặt đã nhận diện trong known_faces',
  })
  @IsUUID()
  knownFaceId!: string;

  @ApiProperty({
    example: '55555555-5555-4555-8555-555555555555',
    description: 'ID sự kiện nhận diện danh tính (PERSON_DETECTED)',
  })
  @IsUUID()
  identityEventId!: string;

  @ApiProperty({
    example: '66666666-6666-4666-8666-666666666666',
    description: 'ID camera ghi nhận',
  })
  @IsUUID()
  cameraId!: string;

  @ApiProperty({
    example: 'session_cam_living_room_01',
    description: 'Session nguồn Frigate/MediaMTX',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sourceSessionId!: string;

  @ApiProperty({
    example: 'track_12345',
    description: 'Track ID người được nhận diện',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  trackId!: string;

  @ApiProperty({
    example: 'MOTION',
    description: 'Loại quan sát',
    enum: ['MOTION', 'ARRIVAL', 'DEPARTURE'],
  })
  @IsIn(['MOTION', 'ARRIVAL', 'DEPARTURE'])
  kind!: 'MOTION' | 'ARRIVAL' | 'DEPARTURE';

  @ApiProperty({
    example: '2026-10-14T08:30:00Z',
    description: 'Thời điểm quan sát được ghi nhận (ISO 8601)',
  })
  @IsISO8601()
  observedAt!: string;

  @ApiPropertyOptional({
    description: 'Bằng chứng định hướng (bắt buộc với ARRIVAL/DEPARTURE)',
    type: DirectionalEvidenceDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DirectionalEvidenceDto)
  directionalEvidence?: DirectionalEvidenceDto;
}
