import { CustomDecorator, SetMetadata } from '@nestjs/common';
import type { UserRole } from './auth.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
