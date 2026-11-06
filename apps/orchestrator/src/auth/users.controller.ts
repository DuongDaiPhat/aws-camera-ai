import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { USER_ROLES, type components, type operations } from '@cam/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { UsersService } from './users.service';

type CreateUserRequest = components['schemas']['CreateUserRequest'];
type User = components['schemas']['User'];
type ChangeUserRoleRequest =
  operations['changeUserRole']['requestBody']['content']['application/json'];

class ListUsersQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: User['role'];
}

class ChangeUserRoleDto implements ChangeUserRoleRequest {
  @IsIn(USER_ROLES)
  role!: User['role'];
}

class CreateUserDto implements CreateUserRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  fullName!: string;

  @IsIn(USER_ROLES)
  role!: CreateUserRequest['role'];

  @IsString()
  @Length(1, 128)
  @Matches(/^\S+$/)
  cognitoSub!: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách tài khoản CameraAI' })
  list(@Query() { page, pageSize, role }: ListUsersQueryDto): ReturnType<UsersService['list']> {
    return this.users.list(page, pageSize, role);
  }

  @Patch(':userId/role')
  @ApiOperation({ summary: 'Đổi vai trò của tài khoản CameraAI' })
  changeRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() { role }: ChangeUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<User> {
    return this.users.changeRole(request.auth?.sub, userId, role);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo tài khoản ứng dụng từ người dùng Cognito' })
  create(@Body() input: CreateUserDto, @Req() request: AuthenticatedRequest): Promise<User> {
    return this.users.create(input, request.auth?.sub);
  }
}
