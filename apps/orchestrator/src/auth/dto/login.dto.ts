import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'admin@camerai.local',
    description: 'Email người dùng',
  })
  @IsEmail({}, { message: 'Email không đúng định dạng.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Admin@12345',
    description: 'Mật khẩu (ít nhất 8 ký tự)',
  })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  @MaxLength(128)
  password!: string;
}
