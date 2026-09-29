import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateKnownFaceDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  personName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationship?: string;

  @IsOptional()
  @IsUUID()
  linkedUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  faceSelections?: string;
}
