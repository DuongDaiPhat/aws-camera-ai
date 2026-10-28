import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { AiComponents } from '@cam/contracts';

export class FireFrameHeaderDto {
  @IsIn([1]) schemaVersion!: 1;
  @IsString() @MinLength(1) @MaxLength(128) cameraSlug!: string;
  @IsString() @MinLength(1) @MaxLength(128) sourceSessionId!: string;
  @IsString() @MinLength(1) @MaxLength(128) frameId!: string;
  @IsISO8601({ strict: true }) frameTimestamp!: string;
  @IsInt() @Min(1) frameWidth!: number;
  @IsInt() @Min(1) frameHeight!: number;
}

export class FireBoxDto {
  @IsNumber() @Min(0) @Max(1) x!: number;
  @IsNumber() @Min(0) @Max(1) y!: number;
  @IsNumber() @Min(0.000000001) @Max(1) width!: number;
  @IsNumber() @Min(0.000000001) @Max(1) height!: number;
}

type FireDetection = AiComponents['schemas']['FireDetection'];
export class FireDetectionDto implements FireDetection {
  @IsIn(['fire', 'smoke']) label!: 'fire' | 'smoke';
  @IsNumber() @Min(0) @Max(1) confidence!: number;
  @ValidateNested() @IsDefined() @Type(() => FireBoxDto) boundingBox!: FireBoxDto;
}

export class FireErrorDto {
  @IsString() @MaxLength(100) code!: string;
  @IsString() @MaxLength(500) message!: string;
}

export class FireResponseDto {
  @IsBoolean() confirmed!: boolean;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FireDetectionDto)
  detections!: FireDetectionDto[];
  @IsString() @MinLength(1) @MaxLength(128) modelVersion!: string;
  @IsISO8601({ strict: true }) processedAt!: string;
  @IsString() @MinLength(1) @MaxLength(128) cameraSlug!: string;
  @IsString() @MinLength(1) @MaxLength(128) sourceSessionId!: string;
  @IsString() @MinLength(1) @MaxLength(128) frameId!: string;
  @IsISO8601({ strict: true }) observedAt!: string;
  @IsBoolean() isReplay!: boolean;
  @IsInt() @Min(0) @Max(60) consecutiveFrames!: number;
  @IsInt() @Min(3) @Max(60) requiredFrames!: number;
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  maxConfidence!: number | null;
  @IsDefined() @ValidateIf((_object, value: unknown) => value !== null) @IsUUID() episodeId!:
    string | null;
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  firstQualifiedAt!: string | null;
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  confirmedAt!: string | null;
  @IsNumber() @Min(0.001) windowSeconds!: number;
  @IsNumber() @Min(0.001) maxFrameGapSeconds!: number;
  @IsNumber() @Min(0) @Max(1) thresholdUsed!: number;
  @IsArray()
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsString({ each: true })
  qualifyingFrameIds!: string[];
  @IsArray()
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsISO8601({ strict: true }, { each: true })
  qualifyingFrameTimestamps!: string[];
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  incidentConfidence!: number | null;
  @IsIn(['fire-temporal-min-v1']) confidencePolicyVersion!: 'fire-temporal-min-v1';
  @IsIn([
    'NEGATIVE',
    'INSUFFICIENT_FRAMES',
    'CONFIRMED',
    'REPLAY',
    'BELOW_THRESHOLD',
    'FRAME_GAP',
    'WINDOW_EXPIRED',
    'STALE_FRAME',
    'OUT_OF_ORDER',
    'INFERENCE_ERROR',
    'ACTIVE_EPISODE',
  ])
  reason!: NonNullable<AiComponents['schemas']['FireResponse']['reason']>;
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => FireErrorDto)
  error!: FireErrorDto | null;
}

export type ConfirmedFireResponse = FireResponseDto & {
  episodeId: string;
  firstQualifiedAt: string;
  confirmedAt: string;
  incidentConfidence: number;
};

export interface FireFrame {
  header: FireFrameHeaderDto;
  image: Buffer;
}
