import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { components, operations } from '@cam/contracts';
import { AUTH_SETTINGS, type AuthSettings } from './auth.config';
import { UsersRepository } from './users.repository';

type User = components['schemas']['User'];
type UsersPage = operations['listUsers']['responses'][200]['content']['application/json'];

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  list(page: number, pageSize: number, role?: User['role']): Promise<UsersPage> {
    const issuer = this.settings.provider === 'cognito' ? this.settings.cognito.authority : null;
    return this.users.list(page, pageSize, role, issuer);
  }

  async changeRole(actorId: string | undefined, userId: string, role: User['role']): Promise<User> {
    if (!actorId) throw new UnauthorizedException();
    if (this.settings.provider !== 'cognito') {
      throw new ConflictException('Tính năng đổi vai trò yêu cầu đăng nhập bằng Cognito.');
    }
    const targetId = userId.toLowerCase();
    if (actorId === targetId) {
      throw new ConflictException('Bạn không thể đổi vai trò của tài khoản đang đăng nhập.');
    }
    const { actorIsAdmin, user } = await this.users.changeRole(actorId, targetId, role);
    if (!actorIsAdmin) throw new ForbiddenException('Bạn không có quyền đổi vai trò.');
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');
    return user;
  }

  async create(input: components['schemas']['CreateUserRequest'], actorId?: string): Promise<User> {
    if (!actorId) throw new UnauthorizedException();
    if (this.settings.provider !== 'cognito') {
      throw new ConflictException('Tính năng tạo tài khoản yêu cầu đăng nhập bằng Cognito.');
    }
    const user = await this.users.create(input, actorId, this.settings.cognito.authority);
    if (!user) throw new ConflictException('Email hoặc mã người dùng Cognito đã được liên kết.');
    return user;
  }
}
