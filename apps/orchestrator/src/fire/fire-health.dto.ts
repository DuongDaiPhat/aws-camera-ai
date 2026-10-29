import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { AiComponents } from '@cam/contracts';

type FireRuntimeHealth = AiComponents['schemas']['FireRuntimeHealth'];
export class FireAiHealthDto implements FireRuntimeHealth {
  @IsIn(['DISABLED', 'STARTING', 'READY', 'DEGRADED']) status!:
    'DISABLED' | 'STARTING' | 'READY' | 'DEGRADED';
  @IsUUID() instanceId!: string;
  @IsString() @MaxLength(128) modelVersion!: string;
  @IsBoolean() modelLoaded!: boolean;
  @IsInt() @Min(0) requestCount!: number;
  @IsInt() @Min(0) errorCount!: number;
  @IsInt() @Min(0) staleFrameCount!: number;
  @IsInt() @Min(0) capacityRejectedCount!: number;
  @IsInt() @Min(0) inFlight!: number;
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  lastRequestAt!: string | null;
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  lastSuccessAt!: string | null;
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(100)
  lastErrorCode!: string | null;
  @ValidateIf((_object, value: unknown) => value !== null) @IsNumber() @Min(0) lastDurationMs!:
    number | null;
}
