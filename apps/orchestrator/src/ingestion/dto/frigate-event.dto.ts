import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class FrigateEventAfterDto {
  @IsString()
  id!: string;

  @IsString()
  camera!: string;

  @IsNumber()
  frame_time!: number;

  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  sub_label?: string | null;

  @IsOptional()
  @IsNumber()
  top_score?: number;

  @IsNumber()
  score!: number;

  @IsOptional()
  @IsArray()
  box?: number[];

  @IsOptional()
  @IsArray()
  current_zones?: string[];

  @IsOptional()
  @IsArray()
  entered_zones?: string[];

  @IsOptional()
  @IsBoolean()
  has_snapshot?: boolean;

  @IsOptional()
  @IsBoolean()
  has_clip?: boolean;

  @IsOptional()
  @IsNumber()
  start_time?: number;

  @IsOptional()
  @IsNumber()
  end_time?: number | null;
}

export class FrigateEventMessageDto {
  @IsString()
  type!: string; // 'new' | 'update' | 'end'

  @ValidateNested()
  @Type(() => FrigateEventAfterDto)
  after!: FrigateEventAfterDto;

  @IsOptional()
  before?: unknown;
}
