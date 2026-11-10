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

const RESOURCE_ID = Symbol('resource-id');
type ResourceId = 'cameraId' | 'eventId';

export const CheckResourceAccess = (parameter: ResourceId) => SetMetadata(RESOURCE_ID, parameter);

export function eventVisibilityPredicate(actor: string): string {
  return `(CASE WHEN e.event_type = 'WELLNESS_TIMEOUT'
    THEN e.wellness_owner_user_id = ${actor} OR e.wellness_resident_user_id = ${actor}
    ELSE EXISTS (
      SELECT 1 FROM cameras camera JOIN devices d ON d.id = camera.device_id
      WHERE camera.id = e.camera_id AND d.owner_user_id = ${actor}
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
    if (request.auth.role === 'ADMIN') return true;
    if (!isUUID(id)) throw new BadRequestException('Validation failed (uuid is expected)');

    const query =
      parameter === 'cameraId'
        ? `SELECT d.owner_user_id = $2 AS allowed
           FROM cameras c JOIN devices d ON d.id = c.device_id WHERE c.id = $1`
        : `SELECT ${eventVisibilityPredicate('$2')} AS allowed FROM events e WHERE e.id = $1`;
    const { rows } = await this.database.query<{ allowed: boolean | null }>(query, [
      id,
      request.auth.sub,
    ]);
    if (!rows[0]) throw new NotFoundException();
    if (!rows[0].allowed) throw new ForbiddenException('Bạn không có quyền truy cập dữ liệu này.');
    return true;
  }
}
