import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { TokenClaims } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HouseholdAccessService {
  constructor(private readonly db: DatabaseService) {}
  async manager(actor?: TokenClaims): Promise<string> {
    if (!actor) throw new UnauthorizedException();
    if (!['ADMIN', 'CAREGIVER'].includes(actor.role))
      throw new ForbiddenException('Chỉ chủ hộ được quản lý gia đình.');
    const result = await this.db.query<{ owner: string }>(
      `SELECT COALESCE(household_owner_id,id) AS owner FROM users
       WHERE id=$1 AND is_active AND role IN ('ADMIN','CAREGIVER')`,
      [actor.sub],
    );
    if (!result.rows[0]) throw new ForbiddenException('Tài khoản không còn quyền quản lý hộ.');
    return result.rows[0].owner;
  }
  async viewer(client: PoolClient, owner: string, memberId: string): Promise<void> {
    const result = await client.query(
      `SELECT id FROM users WHERE id=$1 AND role='VIEWER' AND household_owner_id=$2 AND is_active FOR UPDATE`,
      [memberId, owner],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy thành viên Viewer trong hộ.');
  }
  async audit(
    client: PoolClient,
    actorId: string,
    action: string,
    entityId: string,
    metadata: object = {},
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'household',$3,$4::jsonb)`,
      [actorId, action, entityId, JSON.stringify(metadata)],
    );
  }
}
