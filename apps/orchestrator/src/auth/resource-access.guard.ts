import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { isSystemAdmin } from './system-admin';

const RESOURCE_ID = Symbol('resource-id');
type ResourceId = 'cameraId' | 'eventId' | 'zoneId';

export const CheckResourceAccess = (parameter: ResourceId) => SetMetadata(RESOURCE_ID, parameter);

export function eventVisibilityPredicate(actor: string): string {
  return `(CASE WHEN e.event_type = 'WELLNESS_TIMEOUT'
    THEN shares_camera_household(${actor}, e.wellness_owner_user_id)
      OR shares_camera_household(${actor}, e.wellness_resident_user_id)
    ELSE EXISTS (
      SELECT 1 FROM cameras camera JOIN devices d ON d.id = camera.device_id
      WHERE camera.id = e.camera_id AND shares_camera_household(${actor}, d.owner_user_id)
    ) END)`;
}

@Injectable()
export class ResourceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const parameter = this.reflector.getAllAndOverride<ResourceId>(RESOURCE_ID, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!parameter) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.params[parameter];
    if (id === undefined) return true;
    if (!request.auth) throw new UnauthorizedException();
    if (isSystemAdmin(request.auth)) return true;
    if (!isUUID(id)) throw new BadRequestException('Validation failed (uuid is expected)');

    const queries: Record<ResourceId, string> = {
      cameraId: `SELECT shares_camera_household($2, d.owner_user_id) AS allowed
                FROM cameras c JOIN devices d ON d.id = c.device_id WHERE c.id = $1`,
      zoneId: `SELECT shares_camera_household($2, d.owner_user_id) AS allowed
              FROM zones z JOIN cameras c ON c.id = z.camera_id
              JOIN devices d ON d.id = c.device_id WHERE z.id = $1`,
      eventId: `SELECT ${eventVisibilityPredicate('$2')} AS allowed FROM events e WHERE e.id = $1`,
    };
    const { rows } = await this.database.query<{ allowed: boolean | null }>(queries[parameter], [
      id,
      request.auth.sub,
    ]);
    if (!rows[0]) throw new NotFoundException();
    if (!rows[0].allowed) throw new ForbiddenException('Bạn không có quyền truy cập dữ liệu này.');
    return true;
  }
}
