import type { components } from '@cam/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { TokenClaims } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { CamerasService } from '../cameras/cameras.service';
import { HouseholdAccessService } from './household-access.service';
import type { EmergencyContactDto, HouseholdSettingsDto } from './household.dto';

@Injectable()
export class HouseholdService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: HouseholdAccessService,
    private readonly cameras: CamerasService,
    private readonly config: ConfigService,
  ) {}
  async summary(actor: TokenClaims): Promise<components['schemas']['HouseholdSnapshot']> {
    const owner = await this.access.manager(actor);
    const [members, cameras, contacts, settings, storage] = await Promise.all([
      this.db.query<components['schemas']['HouseholdMember']>(
        `SELECT id,email,full_name AS "fullName",role,is_active AS "isActive",telegram_linked_at IS NOT NULL AS "telegramLinked",
        COALESCE((SELECT json_agg(json_build_object('cameraId',camera_id,'canLive',can_live,'canPlayback',can_playback)) FROM camera_access_grants WHERE user_id=u.id),'[]') AS grants
        FROM users u WHERE COALESCE(household_owner_id,id)=$1 AND is_active AND role IN ('VIEWER','CAREGIVER') ORDER BY role,full_name,id`,
        [owner],
      ),
      this.db.query<components['schemas']['HouseholdSnapshot']['cameras'][number]>(
        `SELECT c.id,c.name,c.is_enabled AS "isEnabled",COALESCE(f.recording_enabled,FALSE) AS "recordingEnabled"
        FROM cameras c JOIN devices d ON d.id=c.device_id LEFT JOIN camera_frigate_settings f ON f.camera_id=c.id
        WHERE shares_camera_household($1,d.owner_user_id) ORDER BY c.created_at,c.id`,
        [actor.sub],
      ),
      this.db.query<components['schemas']['HouseholdContact']>(
        `SELECT id,name,phone_e164 AS phone,priority_order AS priority,is_enabled AS "isEnabled",is_verified AS "isVerified"
        FROM emergency_contacts WHERE owner_user_id=$1 ORDER BY priority_order`,
        [owner],
      ),
      this.db.query<HouseholdSettingsDto>(
        `SELECT retention_days AS "retentionDays",storage_quota_gb AS "storageQuotaGb" FROM household_settings WHERE owner_user_id=$1`,
        [owner],
      ),
      this.db.query<components['schemas']['HouseholdSnapshot']['storage']>(
        `SELECT COALESCE(sum(m.size_bytes),0)::text AS "alertMediaBytes" FROM event_media m JOIN events e ON e.id=m.event_id
        JOIN cameras c ON c.id=e.camera_id JOIN devices d ON d.id=c.device_id WHERE shares_camera_household($1,d.owner_user_id)`,
        [actor.sub],
      ),
    ]);
    return {
      ownerId: owner,
      members: members.rows,
      cameras: cameras.rows,
      contacts: contacts.rows,
      settings: settings.rows[0] ?? { retentionDays: 30, storageQuotaGb: 100 },
      storage: storage.rows[0],
      authProvider: this.config.get('AUTH_PROVIDER', 'jwt'),
    };
  }
  async contact(
    actor: TokenClaims,
    input: EmergencyContactDto,
    id?: string,
  ): Promise<{ id: string }> {
    const owner = await this.access.manager(actor);
    try {
      return await this.db.transaction(async (client) => {
        const result = id
          ? await client.query<{ id: string }>(
              `UPDATE emergency_contacts SET name=$1,phone_e164=$2,priority_order=$3,is_enabled=$4,
          is_verified=CASE WHEN phone_e164=$2 THEN is_verified ELSE FALSE END WHERE id=$5 AND owner_user_id=$6 RETURNING id`,
              [input.name.trim(), input.phone, input.priority, input.isEnabled, id, owner],
            )
          : await client.query<{ id: string }>(
              `INSERT INTO emergency_contacts(owner_user_id,name,phone_e164,priority_order,is_enabled)
          VALUES($1,$2,$3,$4,$5) RETURNING id`,
              [owner, input.name.trim(), input.phone, input.priority, input.isEnabled],
            );
        if (!result.rows[0]) throw new NotFoundException('Không tìm thấy liên hệ trong hộ.');
        await this.access.audit(client, actor.sub, 'HOUSEHOLD_CONTACT_SAVED', result.rows[0].id);
        return result.rows[0];
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new ConflictException('Thứ tự liên hệ đã có người sử dụng.');
      throw error;
    }
  }
  async removeContact(actor: TokenClaims, id: string): Promise<void> {
    const owner = await this.access.manager(actor);
    await this.db.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        'DELETE FROM emergency_contacts WHERE id=$1 AND owner_user_id=$2 RETURNING id',
        [id, owner],
      );
      if (!result.rows[0]) throw new NotFoundException('Không tìm thấy liên hệ trong hộ.');
      await this.access.audit(client, actor.sub, 'HOUSEHOLD_CONTACT_REMOVED', id);
    });
  }
  async settings(
    actor: TokenClaims,
    input: HouseholdSettingsDto,
  ): Promise<HouseholdSettingsDto & { syncFailures: string[] }> {
    const owner = await this.access.manager(actor);
    await this.db.transaction(async (client) => {
      await client.query<{ id: string }>(
        `INSERT INTO household_settings(owner_user_id,retention_days,storage_quota_gb) VALUES($1,$2,$3)
        ON CONFLICT(owner_user_id) DO UPDATE SET retention_days=$2,storage_quota_gb=$3,updated_at=now()`,
        [owner, input.retentionDays, input.storageQuotaGb],
      );
      await this.access.audit(client, actor.sub, 'HOUSEHOLD_SETTINGS_UPDATED', owner, input);
    });
    const cameraIds = await this.db.query<{ id: string }>(
      `SELECT c.id FROM cameras c JOIN devices d ON d.id=c.device_id WHERE shares_camera_household($1,d.owner_user_id)`,
      [actor.sub],
    );
    const syncFailures: string[] = [];
    for (const camera of cameraIds.rows) {
      try {
        const updated = await this.cameras.updateCamera(
          camera.id,
          { retentionDays: input.retentionDays, detectionRetentionDays: input.retentionDays },
          actor.role,
        );
        if (updated?.syncStatus === 'FAILED') syncFailures.push(camera.id);
      } catch {
        syncFailures.push(camera.id);
      }
    }
    return { ...input, syncFailures };
  }
  async createCamera(actor: TokenClaims, name: string): ReturnType<CamerasService['getCamera']> {
    const owner = await this.access.manager(actor);
    if (!name.trim() || name.trim().length > 120)
      throw new BadRequestException('Tên camera phải có 1–120 ký tự.');
    const id = randomUUID(),
      slug = 'cam_' + id.replaceAll('-', '');
    await this.db.transaction(async (client) => {
      const device = await client.query<{ id: string }>(
        `INSERT INTO devices(owner_user_id,name) VALUES($1,$2) RETURNING id`,
        [owner, 'Camera ' + name.trim()],
      );
      await client.query<{ id: string }>(
        `INSERT INTO cameras(id,device_id,name,slug,rtsp_url,is_enabled,retention_days)
        VALUES($1,$2,$3,$4,$5,FALSE,COALESCE((SELECT retention_days FROM household_settings WHERE owner_user_id=$6),30))`,
        [id, device.rows[0].id, name.trim(), slug, 'rtsp://mediamtx:8554/' + slug, owner],
      );
      await client.query<{ id: string }>(
        `INSERT INTO camera_sources(camera_id,source_type,status) VALUES($1,'BROWSER_WEBCAM','NOT_CONFIGURED')`,
        [id],
      );
      await client.query(`INSERT INTO camera_frigate_settings(camera_id) VALUES($1)`, [id]);
      await this.access.audit(client, actor.sub, 'CAMERA_CREATED', id);
    });
    return this.cameras.getCamera(id, actor.role);
  }
}
