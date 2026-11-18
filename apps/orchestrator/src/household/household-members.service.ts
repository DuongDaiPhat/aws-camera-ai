import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'argon2';
import type { TokenClaims } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { HouseholdAccessService } from './household-access.service';
import type { CreateMemberDto, UpdateCameraGrantsDto } from './household.dto';

@Injectable()
export class HouseholdMembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: HouseholdAccessService,
    private readonly config: ConfigService,
  ) {}
  async create(
    actor: TokenClaims,
    input: CreateMemberDto,
  ): Promise<{ id: string; email: string; fullName: string }> {
    const owner = await this.access.manager(actor);
    if (!input.fullName.trim())
      throw new BadRequestException('Tên thành viên không được để trống.');
    const cognito = this.config.get('AUTH_PROVIDER', 'jwt') === 'cognito';
    if (cognito && !input.cognitoSub)
      throw new BadRequestException(
        'Tạo người dùng Viewer trên Cognito trước, sau đó nhập mã liên kết.',
      );
    if (!cognito && !input.password)
      throw new BadRequestException('Vui lòng cấp mật khẩu ít nhất 10 ký tự cho Viewer.');
    const passwordHash = !cognito && input.password ? await hash(input.password) : null;
    try {
      return await this.db.transaction(async (client) => {
        const result = await client.query<{ id: string; email: string; fullName: string }>(
          `INSERT INTO users(email,full_name,role,password_hash,cognito_sub,cognito_issuer,cognito_email,household_owner_id)
           VALUES($1,$2,'VIEWER',$3,$4,$5,$6,$7) RETURNING id,email,full_name AS "fullName"`,
          [
            input.email.trim().toLowerCase(),
            input.fullName.trim(),
            passwordHash,
            cognito ? input.cognitoSub : null,
            cognito
              ? 'https://cognito-idp.' +
                this.config.getOrThrow<string>('COGNITO_USER_POOL_ID').split('_')[0] +
                '.amazonaws.com/' +
                this.config.getOrThrow<string>('COGNITO_USER_POOL_ID')
              : null,
            cognito ? input.email.trim().toLowerCase() : null,
            owner,
          ],
        );
        const member = result.rows[0];
        await this.access.audit(client, actor.sub, 'HOUSEHOLD_MEMBER_CREATED', member.id);
        return member;
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new ConflictException(
          'Email hoặc tài khoản Cognito đã tồn tại. Không thể tự chuyển người từ hộ khác.',
        );
      throw error;
    }
  }
  async grants(
    actor: TokenClaims,
    memberId: string,
    input: UpdateCameraGrantsDto,
  ): Promise<{ saved: boolean }> {
    const owner = await this.access.manager(actor);
    await this.db.transaction(async (client) => {
      await this.access.viewer(client, owner, memberId);
      const ids = input.grants.map((grant) => grant.cameraId);
      const cameras = await client.query(
        `SELECT c.id FROM cameras c JOIN devices d ON d.id=c.device_id
        WHERE c.id=ANY($1::uuid[]) AND shares_camera_household($2,d.owner_user_id) FOR SHARE OF c`,
        [ids, actor.sub],
      );
      if (cameras.rows.length !== ids.length)
        throw new BadRequestException('Camera cấp quyền phải thuộc hộ của bạn.');
      await client.query('DELETE FROM camera_access_grants WHERE user_id=$1', [memberId]);
      for (const grant of input.grants)
        await client.query(
          `INSERT INTO camera_access_grants(user_id,camera_id,can_live,can_playback) VALUES($1,$2,$3,$4)`,
          [memberId, grant.cameraId, grant.canLive, grant.canPlayback],
        );
      await this.access.audit(client, actor.sub, 'HOUSEHOLD_CAMERA_GRANTS_UPDATED', memberId, {
        grants: input.grants,
      });
    });
    return { saved: true };
  }
  async remove(actor: TokenClaims, memberId: string): Promise<void> {
    const owner = await this.access.manager(actor);
    await this.db.transaction(async (client) => {
      await this.access.viewer(client, owner, memberId);
      await client.query('DELETE FROM camera_access_grants WHERE user_id=$1', [memberId]);
      await client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [memberId]);
      await client.query('DELETE FROM auth_refresh_tokens WHERE user_id=$1', [memberId]);
      await client.query(
        'UPDATE wellness_schedules SET is_enabled=FALSE WHERE resident_user_id=$1',
        [memberId],
      );
      await this.access.audit(client, actor.sub, 'HOUSEHOLD_MEMBER_REMOVED', memberId);
    });
  }
}
