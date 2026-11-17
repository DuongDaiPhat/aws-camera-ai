import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { ROLES_KEY } from './roles.decorator';
import type { UserRole } from './auth.types';
import { isSystemAdmin, SYSTEM_ADMIN_REQUIRED } from './system-admin';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const systemAdminRequired = this.reflector.getAllAndOverride<boolean>(SYSTEM_ADMIN_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!systemAdminRequired && !requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRole = request.auth?.role;

    if (
      (systemAdminRequired && !isSystemAdmin(request.auth)) ||
      (requiredRoles?.length && (!userRole || !requiredRoles.includes(userRole)))
    ) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền thực hiện hành động này.',
        },
      });
    }

    return true;
  }
}
