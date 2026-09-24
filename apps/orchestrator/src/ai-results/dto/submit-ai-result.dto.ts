import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AI_MODULES, type AiModule } from '../ai-result.types';

export class BoundingBoxDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  x!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  y!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  width!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  height!: number;
}

export class AiResultErrorDto {
  @IsString()
  @MaxLength(100)
  code!: string;

  @IsString()
  @MaxLength(500)
  message!: string;
}

export class AiResultItemDto {
  @IsIn(AI_MODULES)
  module!: AiModule;

  @IsString()
  @MaxLength(100)
  label!: string;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  confidence!: number | null;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  boundingBox!: BoundingBoxDto | null;

  @IsObject()
  metadata!: Record<string, unknown>;
}

export class SubmitAiResultDto {
  @IsInt()
  @IsIn([1])
  schemaVersion!: 1;

  @IsUUID()
  resultId!: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsUUID()
  eventId!: string;

  @IsString()
  @MaxLength(200)
  observationId!: string;

  @IsInt()
  @Min(1)
  revision!: number;

  @IsIn(AI_MODULES)
  module!: AiModule;

  @IsString()
  @MaxLength(120)
  modelVersion!: string;

  @IsISO8601({ strict: true })
  processedAt!: string;

  @IsOptional()
  @IsUUID()
  matchedKnownFaceId?: string | null;

  @IsOptional()
  @IsIn(['KNOWN', 'UNKNOWN', 'UNDETERMINED'])
  personStatus?: 'KNOWN' | 'UNKNOWN' | 'UNDETERMINED';

  @IsOptional()
  @IsInt()
  @Min(1)
  collectionVersion?: number;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AiResultItemDto)
  results!: AiResultItemDto[];

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => AiResultErrorDto)
  error!: AiResultErrorDto | null;
}

export class AiResultAcceptedDto {
  resultId!: string;
  disposition!: 'ACCEPTED' | 'DUPLICATE' | 'STALE';
  aggregateVersion!: number;
}
