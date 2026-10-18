import type { components } from '@cam/contracts';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { TokenClaims } from '../auth/auth.types';
import { WellnessRepository } from './wellness.repository';
import { canonicalJson, wellnessInteger } from './wellness-policy';
import type {
  CreateWellnessScheduleDto,
  UpdateWellnessScheduleDto,
  ListWellnessChecksQueryDto,
  ConfirmWellnessCheckDto,
  WellnessObservationDto,
} from './dto';
import type { WellnessScheduleRecord, WellnessCheckRunRecord } from './wellness.types';

export interface WellnessConfirmationSource {
  channel: 'TELEGRAM';
  notificationId: string;
  telegramUserId: string;
  chatId: string;
  messageId: string;
  updateId: string;
  ttlSeconds: number;
}
@Injectable()
export class WellnessService {
  constructor(
    private readonly repository: WellnessRepository,
    @Optional() private readonly config: ConfigService = new ConfigService(),
  ) {}
  async listSchedules(
    user: TokenClaims,
    residentUserId?: string,
  ): Promise<WellnessScheduleRecord[]> {
    return this.repository.listSchedules(user.sub, user.role, residentUserId);
  }
  async getScheduleById(user: TokenClaims, id: string): Promise<WellnessScheduleRecord> {
    const row = await this.repository.getScheduleById(id);
    if (!row) throw new NotFoundException('Không tìm thấy lịch kiểm tra');
    this.authorizeSchedule(user, row);
    return row;
  }
  private authorizeSchedule(user: TokenClaims, row: WellnessScheduleRecord): void {
    if (
      (user.role === 'CAREGIVER' && row.owner_user_id !== user.sub) ||
      (user.role === 'VIEWER' && row.resident_user_id !== user.sub)
    )
      throw new ForbiddenException('Bạn không có quyền xem hoặc sửa lịch này');
  }
  private requireManager(user: TokenClaims): void {
    if (!['ADMIN', 'CAREGIVER'].includes(user.role))
      throw new ForbiddenException('Chỉ người giám sát hoặc quản trị viên được quản lý lịch');
  }
  private async validateSchedule(
    owner: string,
    resident: string,
    cameras: string[],
    timezone: string,
    enabled: boolean,
    client?: PoolClient,
  ): Promise<void> {
    if (!(await this.repository.verifyResidentHouseholdLink(owner, resident, client)))
      throw new BadRequestException('Người được giám sát chưa liên kết với hộ này');
    if (!(await this.repository.timezoneExists(timezone, client)))
      throw new BadRequestException('Múi giờ IANA không hợp lệ');
    const available = await this.repository.enabledCameraIds(owner, cameras, client);
    if (cameras.some((id) => !available.includes(id)))
      throw new BadRequestException('Camera không thuộc hộ hoặc đã tắt');
    if (enabled && !(await this.repository.residentCanReceive(resident, client)))
      throw new BadRequestException('Người được giám sát cần liên kết Telegram trước khi bật lịch');
  }
  async createSchedule(
    user: TokenClaims,
    dto: CreateWellnessScheduleDto,
  ): Promise<WellnessScheduleRecord> {
    this.requireManager(user);
    await this.validateSchedule(
      user.sub,
      dto.residentUserId,
      dto.cameraIds ?? [],
      dto.timezone ?? 'Asia/Ho_Chi_Minh',
      dto.isEnabled ?? true,
    );
    if (await this.repository.findConflictingSchedule(dto.residentUserId, dto.checkAt))
      throw new ConflictException('Đã có lịch kiểm tra vào giờ này');
    try {
      return await this.repository.createSchedule({
        ownerUserId: user.sub,
        residentUserId: dto.residentUserId,
        name: dto.name ?? 'Kiểm tra sức khỏe',
        checkAt: dto.checkAt,
        daysOfWeek: dto.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7],
        lookbackHours: dto.lookbackHours ?? 6,
        graceSeconds: dto.graceSeconds ?? 300,
        cameraIds: dto.cameraIds ?? [],
        timezone: dto.timezone ?? 'Asia/Ho_Chi_Minh',
        isEnabled: dto.isEnabled ?? true,
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Đã có lịch kiểm tra vào giờ này');
      throw error;
    }
  }
  async updateSchedule(
    user: TokenClaims,
    id: string,
    dto: UpdateWellnessScheduleDto,
  ): Promise<WellnessScheduleRecord> {
    this.requireManager(user);
    if (!Object.keys(dto).some((key) => dto[key as keyof UpdateWellnessScheduleDto] !== undefined))
      throw new BadRequestException('Cần ít nhất một trường cập nhật');
    return this.repository.transaction(async (client) => {
      await client.query('SELECT id FROM wellness_schedules WHERE id=$1 FOR UPDATE', [id]);
      const existing = await this.repository.getScheduleById(id, client);
      if (!existing) throw new NotFoundException('Không tìm thấy lịch kiểm tra');
      this.authorizeSchedule(user, existing);
      const owner = existing.owner_user_id ?? user.sub,
        resident = dto.residentUserId ?? existing.resident_user_id;
      await this.validateSchedule(
        owner,
        resident,
        dto.cameraIds ?? existing.camera_ids,
        dto.timezone ?? existing.timezone,
        dto.isEnabled ?? existing.is_enabled,
        client,
      );
      if (
        await this.repository.findConflictingSchedule(
          resident,
          dto.checkAt ?? existing.check_at,
          id,
          client,
        )
      )
        throw new ConflictException('Đã có lịch kiểm tra vào giờ này');
      if (!existing.owner_user_id)
        await client.query('UPDATE wellness_schedules SET owner_user_id=$2 WHERE id=$1', [
          id,
          owner,
        ]);
      const result = await this.repository.updateSchedule(id, dto, client);
      if (!result) throw new NotFoundException('Không tìm thấy lịch kiểm tra');
      return result;
    });
  }
  async deleteSchedule(user: TokenClaims, id: string): Promise<void> {
    this.requireManager(user);
    const row = await this.getScheduleById(user, id);
    this.authorizeSchedule(user, row);
    if (!(await this.repository.deleteSchedule(id)))
      throw new NotFoundException('Không tìm thấy lịch kiểm tra');
  }
  async listChecks(
    user: TokenClaims,
    query: ListWellnessChecksQueryDto,
  ): Promise<{ data: WellnessCheckRunRecord[]; total: number }> {
    return this.repository.listChecks(user.sub, user.role, {
      residentUserId: query.residentUserId,
      scheduleId: query.scheduleId,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  async confirmCheck(
    user: TokenClaims,
    checkId: string,
    dto: ConfirmWellnessCheckDto,
    source?: WellnessConfirmationSource,
  ): Promise<components['schemas']['Confirmation'] & { isAuthoritative: boolean }> {
    const outcome = await this.repository.transaction(async (client) => {
      let check = await this.repository.getCheckById(checkId, client);
      if (!check) throw new NotFoundException('Không tìm thấy yêu cầu kiểm tra');
      if (check.resident_user_id !== user.sub)
        throw new ForbiddenException('Chỉ người được giám sát được xác nhận yêu cầu này');
      if (!check.event_id)
        throw new ConflictException({
          error: { code: 'INVALID_STATE', message: 'Lượt kiểm tra không có cảnh báo' },
        });
      const event = (
        await client.query('SELECT id,status,version FROM events WHERE id=$1 FOR UPDATE', [
          check.event_id,
        ])
      ).rows[0];
      await client.query('SELECT id FROM wellness_check_runs WHERE id=$1 FOR UPDATE', [checkId]);
      check = await this.repository.getCheckById(checkId, client);
      if (!check || !event) throw new NotFoundException('Không tìm thấy yêu cầu kiểm tra');
      const now = await this.repository.databaseNow(client);
      if (source) {
        const notification = await client.query(
          `SELECT 1 FROM notifications n JOIN users u ON u.id=n.recipient_user_id
          WHERE n.id=$1 AND n.event_id=$2 AND n.recipient_user_id=$3 AND n.status='SENT'
            AND n.escalation_level=0 AND n.provider_chat_id=$4 AND n.provider_message_id=$5
            AND u.telegram_user_id=$6 AND u.telegram_chat_id=$4 AND u.is_active AND u.telegram_linked_at IS NOT NULL
            AND n.sent_at>$7::timestamptz-($8::int*interval '1 second')`,
          [
            source.notificationId,
            check.event_id,
            user.sub,
            source.chatId,
            source.messageId,
            source.telegramUserId,
            now,
            source.ttlSeconds,
          ],
        );
        if (!notification.rows.length)
          throw new ForbiddenException('Nguồn xác nhận Telegram không hợp lệ hoặc đã hết hạn');
      }
      const existing = await client.query(
        `SELECT id,event_id,response,note,user_id,responded_at,is_authoritative,channel
        FROM confirmations WHERE event_id=$1 AND source_message_id=$2`,
        [check.event_id, dto.commandId],
      );
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (
          row.response !== dto.response ||
          (row.note ?? null) !== (dto.note ?? null) ||
          row.user_id !== user.sub
        )
          throw new ConflictException({
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: 'Mã lệnh đã được dùng với nội dung khác',
            },
          });
        return {
          confirmation: {
            id: row.id,
            eventId: row.event_id,
            phase: 'INITIAL' as const,
            channel: row.channel as components['schemas']['NotificationChannel'],
            note: row.note ?? null,
            resultingStatus: (row.response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED') as
              'RESOLVED' | 'ESCALATED',
            response: row.response as 'IM_OK' | 'NEED_HELP',
            respondedAt: new Date(row.responded_at).toISOString(),
            isAuthoritative: row.is_authoritative as boolean,
          },
        };
      }
      if (!check.request_sent_at)
        throw new ConflictException({
          error: { code: 'REQUEST_NOT_SENT', message: 'Yêu cầu chưa được gửi thành công' },
        });
      if (event.status !== 'NOTIFIED')
        throw new ConflictException({
          error: { code: 'INVALID_STATE', message: 'Sự kiện đã được xử lý' },
          eventStatus: event.status,
        });
      if (!check.confirmation_deadline_at || now >= check.confirmation_deadline_at) {
        await this.repository.escalateWellness(
          check.event_id!,
          check.owner_user_id,
          'TIMEOUT',
          client,
        );
        return { expired: true };
      }
      const previous = await client.query(
        "SELECT id FROM confirmations WHERE event_id=$1 AND is_authoritative AND phase='INITIAL'",
        [check.event_id],
      );
      if (previous.rows.length)
        throw new ConflictException({
          error: { code: 'ALREADY_CONFIRMED', message: 'Yêu cầu đã được xác nhận' },
        });
      const channel: 'TELEGRAM' | 'DASHBOARD' = source ? 'TELEGRAM' : 'DASHBOARD';
      if (dto.response === 'NEED_HELP')
        await this.repository.escalateWellness(
          check.event_id!,
          check.owner_user_id,
          'RESIDENT_REQUESTED_HELP',
          client,
        );
      else {
        await client.query(
          `UPDATE events SET status='RESOLVED',resolved_at=$2,escalation_deadline_at=NULL,
          version=version+1,aggregate_version=aggregate_version+1 WHERE id=$1 AND status='NOTIFIED'`,
          [check.event_id, now],
        );
        await this.repository.enqueueEventUpdate(check.event_id!, client);
      }
      await client.query(
        `INSERT INTO event_status_history(event_id,from_status,to_status,reason,actor_type,actor_user_id,channel,metadata)
        VALUES($1,$2,$3::event_status,'USER_CONFIRMED','USER',$4,$5::notification_channel,
          jsonb_build_object('response',$6::text,'note',$7::text))`,
        [
          check.event_id,
          event.status,
          dto.response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED',
          user.sub,
          channel,
          dto.response,
          dto.note ?? null,
        ],
      );
      const record = (
        await client.query(
          `INSERT INTO confirmations(event_id,user_id,channel,response,phase,is_authoritative,note,
        source_message_id,source_update_id,notification_id,responded_at)
        VALUES($1,$2,$3::notification_channel,$4::confirmation_response,'INITIAL',true,$5,$6,$7,$8,$9) RETURNING id,responded_at`,
          [
            check.event_id,
            user.sub,
            channel,
            dto.response,
            dto.note ?? null,
            dto.commandId,
            source?.updateId ?? null,
            source?.notificationId ?? null,
            now,
          ],
        )
      ).rows[0];
      await client.query(
        `UPDATE notifications SET status='SKIPPED',lease_token=NULL,lease_until=NULL,next_retry_at=NULL
        WHERE event_id=$1 AND escalation_level=0 AND status IN ('PENDING','FAILED')`,
        [check.event_id],
      );
      return {
        confirmation: {
          id: record.id as string,
          eventId: check.event_id!,
          phase: 'INITIAL' as const,
          channel,
          note: dto.note ?? null,
          resultingStatus: (dto.response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED') as
            'RESOLVED' | 'ESCALATED',
          response: dto.response,
          respondedAt: new Date(record.responded_at).toISOString(),
          isAuthoritative: true,
        },
      };
    });
    if ('expired' in outcome)
      throw new ConflictException({
        error: { code: 'DEADLINE_EXPIRED', message: 'Đã hết thời gian phản hồi' },
        eventStatus: 'ESCALATED',
      });
    return outcome.confirmation!;
  }

  async submitObservation(dto: WellnessObservationDto): Promise<{
    observationId: string;
    status: 'ACCEPTED' | 'DUPLICATE';
    presenceUpdated: boolean;
  }> {
    const hash = createHash('sha256').update(canonicalJson(dto)).digest('hex');
    return this.repository.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        dto.observationId,
      ]);
      const existing = await this.repository.findObservationById(dto.observationId, client);
      if (existing) {
        if (existing.payload_hash !== hash)
          throw new ConflictException('Observation ID đã được dùng với nội dung khác');
        return {
          observationId: dto.observationId,
          status: 'DUPLICATE' as const,
          presenceUpdated: false,
        };
      }
      const now = await this.repository.databaseNow(client),
        observed = new Date(dto.observedAt);
      const age = wellnessInteger(this.config, 'WELLNESS_OBSERVATION_MAX_AGE_SECONDS', 86400);
      const skew = wellnessInteger(this.config, 'WELLNESS_CLOCK_SKEW_SECONDS', 5, 60);
      if (
        !Number.isFinite(observed.getTime()) ||
        observed.getTime() > now.getTime() + skew * 1000 ||
        observed.getTime() < now.getTime() - age * 1000
      )
        throw new BadRequestException('Quan sát quá cũ hoặc có thời gian tương lai không hợp lệ');
      if (!dto.knownFaceId || !dto.identityEventId || !dto.cameraId)
        throw new BadRequestException('Thiếu bằng chứng danh tính/camera');
      if (
        dto.kind !== 'MOTION' &&
        (!dto.directionalEvidence ||
          dto.directionalEvidence.direction !== (dto.kind === 'ARRIVAL' ? 'ENTER' : 'EXIT'))
      )
        throw new BadRequestException('Thiếu hoặc sai bằng chứng hướng di chuyển');
      const evidence = await this.repository.verifyObservationSource(dto, client);
      if (!evidence)
        throw new BadRequestException('Quan sát không khớp nguồn M1/Frigate đã xác minh');
      await this.repository.saveObservation(
        {
          observation_id: dto.observationId,
          owner_user_id: dto.ownerUserId,
          resident_user_id: dto.residentUserId,
          known_face_id: dto.knownFaceId,
          camera_id: dto.cameraId,
          identity_event_id: dto.identityEventId,
          source_session_id: dto.sourceSessionId,
          track_id: dto.trackId,
          kind: dto.kind,
          observed_at: observed,
          received_at: now,
          payload_hash: hash,
          evidence,
        },
        client,
      );
      const presenceUpdated = await this.repository.updatePresence(
        {
          owner_user_id: dto.ownerUserId,
          resident_user_id: dto.residentUserId,
          state: dto.kind === 'DEPARTURE' ? 'AWAY' : 'HOME',
          observation_id: dto.observationId,
          observed_at: observed,
          valid_until: new Date(observed.getTime() + this.repository.presenceTtlSeconds * 1000),
          updated_at: now,
        },
        client,
      );
      return { observationId: dto.observationId, status: 'ACCEPTED' as const, presenceUpdated };
    });
  }
}
