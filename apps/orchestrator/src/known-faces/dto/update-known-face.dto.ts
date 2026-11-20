import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
export class UpdateKnownFaceDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  personName!: string;
  @IsOptional() @IsString() @Length(0, 60) relationship?: string;
  @IsOptional() @IsUUID() linkedUserId?: string | null;
}
