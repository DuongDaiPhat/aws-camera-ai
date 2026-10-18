import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
    example: '33333333-3333-4333-8333-444444444401',
    description: 'UUID duy nhất của quan sát (chống trùng lặp)',
  })
  @Matches(UUID_PATTERN, { message: 'observationId must be a UUID' })
  observationId!: string;

  @ApiProperty({
    example: '11111111-1111-4111-8111-111111111111',
    description: 'ID chủ hộ (owner/caregiver/admin)',
  })
  @Matches(UUID_PATTERN, { message: 'ownerUserId must be a UUID' })
  ownerUserId!: string;

  @ApiProperty({
    example: '22222222-2222-4222-8222-222222222222',
    description: 'ID người được giám sát (resident)',
  })
  @Matches(UUID_PATTERN, { message: 'residentUserId must be a UUID' })
  residentUserId!: string;

  @ApiProperty({
    example: 'dd3657f8-dc20-4b90-8848-057c96849502',
    description: 'ID khuôn mặt đã nhận diện trong known_faces',
  })
  @Matches(UUID_PATTERN, { message: 'knownFaceId must be a UUID' })
  knownFaceId!: string;

  @ApiProperty({
    description: 'ID sự kiện nhận diện danh tính (PERSON_DETECTED)',
  })
  @Matches(UUID_PATTERN, { message: 'identityEventId must be a UUID' })
  identityEventId!: string;

  @ApiProperty({
    example: '22222222-2222-2222-2222-222222222221',
    description: 'ID camera ghi nhận',
  })
  @Matches(UUID_PATTERN, { message: 'cameraId must be a UUID' })
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
