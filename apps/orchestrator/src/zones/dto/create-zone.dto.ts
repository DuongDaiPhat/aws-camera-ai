import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import { ZonePolygonConstraint } from '../zone-geometry.validator';

const TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export class CreateZoneDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,63}$/)
  slug!: string;

  @IsIn(['RESTRICTED', 'REST_AREA', 'NORMAL'])
  zoneType!: 'RESTRICTED' | 'REST_AREA' | 'NORMAL';

  @IsArray()
  @Validate(ZonePolygonConstraint)
  polygon!: number[][];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  minDwellSeconds?: number;

  @IsOptional()
  @Matches(TIME_PATTERN)
  activeFrom?: string | null;

  @IsOptional()
  @Matches(TIME_PATTERN)
  activeTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
