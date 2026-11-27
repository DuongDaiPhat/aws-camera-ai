import type { components } from '@cam/contracts';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenClaims } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { HouseholdAccessService } from './household-access.service';
import type { HouseholdAiModulesDto } from './household.dto';

export type HouseholdAiModulesSettings = components['schemas']['HouseholdAiModulesSettings'];

interface AiModulesRow {
  m1_face_enabled: boolean;
  m2a_fall_enabled: boolean;
  m3_fire_enabled: boolean;
  m4_zone_enabled: boolean;
  m5_wellness_enabled: boolean;
  updated_at: Date;
}

@Injectable()
export class HouseholdAiModulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: HouseholdAccessService,
    private readonly config: ConfigService,
  ) {}

  private availability(): HouseholdAiModulesSettings['availability'] {
    return {
      m1Face: true,
      m2aFall: String(this.config.get('M2A_ENABLED', 'false')).toLowerCase() === 'true',
      m3Fire: String(this.config.get('M3_ENABLED', 'false')).toLowerCase() === 'true',
      m4Zone: true,
      m5Wellness: String(this.config.get('M5_ENABLED', 'false')).toLowerCase() === 'true',
    };
  }

  private async requireCaregiverOwner(
    actor?: TokenClaims,
  ): Promise<{ owner: string; userId: string }> {
    if (!actor) throw new UnauthorizedException();
    if (actor.role !== 'CAREGIVER') {
      throw new ForbiddenException('Chỉ tài khoản Caregiver mới có quyền quản lý các module AI.');
    }
    const { rows } = await this.db.query<{ owner: string }>(
      `SELECT COALESCE(household_owner_id, id) AS owner
       FROM users
       WHERE id = $1 AND is_active AND role = 'CAREGIVER'`,
      [actor.sub],
    );
    if (!rows[0]) {
      throw new ForbiddenException('Tài khoản Caregiver không còn quyền quản lý hộ.');
    }
    return { owner: rows[0].owner, userId: actor.sub };
  }

  private toResponse(row?: AiModulesRow): HouseholdAiModulesSettings {
    return {
      m1Face: row?.m1_face_enabled ?? true,
      m2aFall: row?.m2a_fall_enabled ?? true,
      m3Fire: row?.m3_fire_enabled ?? true,
      m4Zone: row?.m4_zone_enabled ?? true,
      m5Wellness: row?.m5_wellness_enabled ?? true,
      availability: this.availability(),
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  }

  async get(actor?: TokenClaims): Promise<HouseholdAiModulesSettings> {
    const { owner } = await this.requireCaregiverOwner(actor);
    const { rows } = await this.db.query<AiModulesRow>(
      `SELECT m1_face_enabled, m2a_fall_enabled, m3_fire_enabled, m4_zone_enabled, m5_wellness_enabled, updated_at
       FROM household_ai_module_settings
       WHERE owner_user_id = $1`,
      [owner],
    );
    return this.toResponse(rows[0]);
  }

  async update(
    actor: TokenClaims | undefined,
    input: HouseholdAiModulesDto,
  ): Promise<HouseholdAiModulesSettings> {
    const { owner, userId } = await this.requireCaregiverOwner(actor);
    const saved = await this.db.transaction(async (client) => {
      const { rows } = await client.query<AiModulesRow>(
        `INSERT INTO household_ai_module_settings (
           owner_user_id, m1_face_enabled, m2a_fall_enabled, m3_fire_enabled,
           m4_zone_enabled, m5_wellness_enabled, updated_by_user_id, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
         ON CONFLICT (owner_user_id) DO UPDATE SET
           m1_face_enabled = EXCLUDED.m1_face_enabled,
           m2a_fall_enabled = EXCLUDED.m2a_fall_enabled,
           m3_fire_enabled = EXCLUDED.m3_fire_enabled,
           m4_zone_enabled = EXCLUDED.m4_zone_enabled,
           m5_wellness_enabled = EXCLUDED.m5_wellness_enabled,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = clock_timestamp()
         RETURNING m1_face_enabled, m2a_fall_enabled, m3_fire_enabled, m4_zone_enabled, m5_wellness_enabled, updated_at`,
        [owner, input.m1Face, input.m2aFall, input.m3Fire, input.m4Zone, input.m5Wellness, userId],
      );
      await this.access.audit(client, userId, 'HOUSEHOLD_AI_MODULES_UPDATED', owner, input);
      return rows[0];
    });
    return this.toResponse(saved);
  }
}
