import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TokenClaims } from '../auth/auth.types';
import { WellnessRepository } from './wellness.repository';
import type {
  CreateWellnessScheduleDto,
  UpdateWellnessScheduleDto,
  ListWellnessChecksQueryDto,
  ConfirmWellnessCheckDto,
  WellnessObservationDto,
} from './dto';
import type { WellnessScheduleRecord, WellnessCheckRunRecord } from './wellness.types';

@Injectable()
export class WellnessService {
  constructor(private readonly repository: WellnessRepository) {}

  // -------------------------------------------------------------
  // SCHEDULES
  // -------------------------------------------------------------

  async listSchedules(
    user: TokenClaims,
    residentUserId?: string,
  ): Promise<WellnessScheduleRecord[]> {
    return await this.repository.listSchedules(user.sub, user.role, residentUserId);
  }

  async getScheduleById(user: TokenClaims, scheduleId: string): Promise<WellnessScheduleRecord> {
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule) {
      throw new NotFoundException('Không tìm thấy lịch kiểm tra');
    }

    if (user.role === 'CAREGIVER' && schedule.owner_user_id !== user.sub) {
      throw new ForbiddenException('Bạn không có quyền xem lịch kiểm tra này');
    }
    if (user.role === 'VIEWER' && schedule.resident_user_id !== user.sub) {
      throw new ForbiddenException('Bạn chỉ có thể xem lịch của chính mình');
    }

    return schedule;
  }

  async createSchedule(
    user: TokenClaims,
    dto: CreateWellnessScheduleDto,
  ): Promise<WellnessScheduleRecord> {
    if (user.role !== 'ADMIN' && user.role !== 'CAREGIVER') {
      throw new ForbiddenException('Chỉ Caregiver hoặc Admin mới có quyền tạo lịch');
    }

    const isValidResident = await this.repository.verifyResidentHouseholdLink(
      user.sub,
      dto.residentUserId,
    );
    if (!isValidResident) {
      throw new BadRequestException('Người được giám sát không hợp lệ');
    }

    const conflict = await this.repository.findConflictingSchedule(dto.residentUserId, dto.checkAt);
    if (conflict) {
      throw new ConflictException(`Đã tồn tại lịch kiểm tra vào lúc ${dto.checkAt} cho người này`);
    }

    return await this.repository.createSchedule({
      ownerUserId: user.sub,
      residentUserId: dto.residentUserId,
      name: dto.name,
      checkAt: dto.checkAt,
      daysOfWeek: dto.daysOfWeek,
      lookbackHours: dto.lookbackHours ?? 6,
      graceSeconds: dto.graceSeconds ?? 300,
      cameraIds: dto.cameraIds ?? [],
      timezone: dto.timezone ?? 'Asia/Ho_Chi_Minh',
      isEnabled: dto.isEnabled ?? true,
    });
  }

  async updateSchedule(
    user: TokenClaims,
    scheduleId: string,
    dto: UpdateWellnessScheduleDto,
  ): Promise<WellnessScheduleRecord> {
    if (user.role !== 'ADMIN' && user.role !== 'CAREGIVER') {
      throw new ForbiddenException('Chỉ Caregiver hoặc Admin mới có quyền sửa lịch');
    }

    const existing = await this.repository.getScheduleById(scheduleId);
    if (!existing) {
      throw new NotFoundException('Không tìm thấy lịch kiểm tra');
    }

    if (user.role === 'CAREGIVER' && existing.owner_user_id !== user.sub) {
      throw new ForbiddenException('Bạn không có quyền sửa lịch kiểm tra này');
    }

    const targetResidentId = dto.residentUserId ?? existing.resident_user_id;
    const targetCheckAt = dto.checkAt ?? existing.check_at;

    if (dto.residentUserId !== undefined || dto.checkAt !== undefined) {
      const conflict = await this.repository.findConflictingSchedule(
        targetResidentId,
        targetCheckAt,
        scheduleId,
      );
      if (conflict) {
        throw new ConflictException(
          `Đã tồn tại lịch kiểm tra vào lúc ${targetCheckAt} cho người này`,
        );
      }
    }

    const updated = await this.repository.updateSchedule(scheduleId, dto);
    if (!updated) {
      throw new NotFoundException('Không tìm thấy lịch kiểm tra để cập nhật');
    }
    return updated;
  }

  async deleteSchedule(user: TokenClaims, scheduleId: string): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CAREGIVER') {
      throw new ForbiddenException('Chỉ Caregiver hoặc Admin mới có quyền xóa lịch');
    }

    const existing = await this.repository.getScheduleById(scheduleId);
    if (!existing) {
      throw new NotFoundException('Không tìm thấy lịch kiểm tra');
    }

    if (user.role === 'CAREGIVER' && existing.owner_user_id !== user.sub) {
      throw new ForbiddenException('Bạn không có quyền xóa lịch kiểm tra này');
    }

    const deleted = await this.repository.deleteSchedule(scheduleId);
    if (!deleted) {
      throw new NotFoundException('Không tìm thấy lịch kiểm tra');
    }
  }

  // -------------------------------------------------------------
  // CHECKS & CONFIRMATION
  // -------------------------------------------------------------

  async listChecks(
    user: TokenClaims,
    query: ListWellnessChecksQueryDto,
  ): Promise<{ data: WellnessCheckRunRecord[]; total: number }> {
    return await this.repository.listChecks(user.sub, user.role, {
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
  ): Promise<{
    id: string;
    eventId: string;
    response: string;
    respondedAt: string;
    isAuthoritative: boolean;
  }> {
    const client = await this.repository.getPoolClient();
    try {
      await client.query('BEGIN');

      const check = await this.repository.getCheckById(checkId, client);
      if (!check) {
        throw new NotFoundException('Không tìm thấy yêu cầu kiểm tra');
      }

      // Chỉ đúng resident được chỉ định mới được xác nhận qua endpoint này (US-20)
      if (check.resident_user_id !== user.sub) {
        throw new ForbiddenException(
          'Chỉ người được giám sát của lượt kiểm tra này mới có quyền xác nhận',
        );
      }

      if (!check.event_id) {
        throw new BadRequestException('Lượt kiểm tra không có sự kiện cảnh báo liên kết');
      }

      // Kiểm tra request đã được gửi tới resident chưa
      if (!check.request_sent_at) {
        throw new ConflictException({
          error: {
            code: 'REQUEST_NOT_SENT',
            message: 'Yêu cầu kiểm tra chưa được gửi tới thiết bị của người nhà.',
          },
        });
      }

      // Khóa bản ghi event để tránh race condition
      const eventRes = await client.query(
        `SELECT id, status, version, escalation_deadline_at FROM events WHERE id = $1 FOR UPDATE`,
        [check.event_id],
      );
      if (eventRes.rows.length === 0) {
        throw new NotFoundException('Không tìm thấy sự kiện tương ứng');
      }
      const event = eventRes.rows[0];

      // Kiểm tra idempotency: đã có confirmation với commandId này chưa
      const existingConf = await client.query(
        `SELECT id, event_id, response, responded_at, is_authoritative, source_message_id
         FROM confirmations
         WHERE event_id = $1 AND source_message_id = $2`,
        [check.event_id, dto.commandId],
      );

      if (existingConf.rows.length > 0) {
        const conf = existingConf.rows[0];
        if (conf.response === dto.response) {
          await client.query('COMMIT');
          return {
            id: conf.id,
            eventId: conf.event_id,
            response: conf.response,
            respondedAt: new Date(conf.responded_at).toISOString(),
            isAuthoritative: conf.is_authoritative,
          };
        }
        throw new ConflictException('CommandId đã được sử dụng với nội dung phản hồi khác');
      }

      const now = new Date();

      // Kiểm tra quá hạn deadline (5 phút = 300s)
      if (check.confirmation_deadline_at && now >= check.confirmation_deadline_at) {
        // Tự động leo thang nếu sự kiện vẫn còn ở NOTIFIED
        if (event.status === 'NOTIFIED') {
          await client.query(
            `UPDATE events
             SET status = 'ESCALATED', escalated_at = now(), version = version + 1
             WHERE id = $1`,
            [event.id],
          );
          await client.query(
            `INSERT INTO event_status_history (event_id, from_status, to_status, reason, actor_type, metadata)
             VALUES ($1, 'NOTIFIED', 'ESCALATED', 'TIMEOUT', 'SYSTEM', jsonb_build_object('deadlineExpired', true))`,
            [event.id],
          );
          // Gửi thông báo leo thang tới Caregiver
          await client.query(
            `INSERT INTO notifications (event_id, recipient_user_id, channel, status, escalation_level, payload)
             VALUES ($1, $2, 'TELEGRAM', 'PENDING', 1, jsonb_build_object('reason', 'RESIDENT_TIMEOUT_ESCALATED', 'priority', 'P2'))`,
            [event.id, check.owner_user_id],
          );
        }

        await client.query('COMMIT');
        throw new ConflictException({
          error: {
            code: 'DEADLINE_EXPIRED',
            message:
              'Đã hết thời hạn xác nhận (quá hạn 5 phút). Cảnh báo đã được chuyển tới người chăm sóc.',
          },
        });
      }

      // Xử lý phản hồi hợp lệ trước deadline
      const targetStatus = dto.response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED';

      await client.query(
        `UPDATE events
         SET status = $2,
             resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END,
             escalated_at = CASE WHEN $2 = 'ESCALATED' THEN now() ELSE escalated_at END,
             escalation_deadline_at = NULL,
             version = version + 1
         WHERE id = $1`,
        [event.id, targetStatus],
      );

      await client.query(
        `INSERT INTO event_status_history (event_id, from_status, to_status, reason, actor_type, actor_user_id, channel, metadata)
         VALUES ($1, $2, $3, 'USER_CONFIRMED', 'USER', $4, 'DASHBOARD', jsonb_build_object('response', $5, 'note', $6))`,
        [event.id, event.status, targetStatus, user.sub, dto.response, dto.note ?? null],
      );

      const confRes = await client.query(
        `INSERT INTO confirmations (
          event_id, user_id, channel, response, is_authoritative, note, source_message_id, responded_at
        ) VALUES (
          $1, $2, 'DASHBOARD', $3, true, $4, $5, now()
        ) RETURNING id, responded_at`,
        [event.id, user.sub, dto.response, dto.note ?? null, dto.commandId],
      );

      // Nếu người nhà bấm "Cần giúp đỡ" (NEED_HELP) -> Escalate khẩn cấp tới Caregiver
      if (dto.response === 'NEED_HELP') {
        await client.query(
          `INSERT INTO notifications (event_id, recipient_user_id, channel, status, escalation_level, payload)
           VALUES ($1, $2, 'TELEGRAM', 'PENDING', 1, jsonb_build_object('reason', 'RESIDENT_REQUESTED_HELP', 'priority', 'P2', 'note', $3))`,
          [event.id, check.owner_user_id, dto.note ?? null],
        );
      }

      await client.query('COMMIT');

      const confRow = confRes.rows[0];
      return {
        id: confRow.id,
        eventId: event.id,
        response: dto.response,
        respondedAt: new Date(confRow.responded_at).toISOString(),
        isAuthoritative: true,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------
  // OBSERVATIONS & PRESENCE
  // -------------------------------------------------------------

  async submitObservation(dto: WellnessObservationDto): Promise<{
    observationId: string;
    status: 'ACCEPTED' | 'DUPLICATE';
    presenceUpdated: boolean;
  }> {
    const payloadHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');

    const existing = await this.repository.findObservationById(dto.observationId);
    if (existing) {
      if (existing.payload_hash === payloadHash) {
        return {
          observationId: dto.observationId,
          status: 'DUPLICATE',
          presenceUpdated: false,
        };
      }
      throw new ConflictException('ObservationId đã tồn tại với nội dung dữ liệu khác');
    }

    const observedAtDate = new Date(dto.observedAt);
    const validUntilDate = new Date(observedAtDate.getTime() + 24 * 60 * 60 * 1000); // 24h TTL

    try {
      await this.repository.saveObservation({
        observation_id: dto.observationId,
        owner_user_id: dto.ownerUserId,
        resident_user_id: dto.residentUserId,
        known_face_id: dto.knownFaceId ?? null,
        camera_id: dto.cameraId ?? null,
        identity_event_id: dto.identityEventId ?? null,
        source_session_id: dto.sourceSessionId,
        track_id: dto.trackId,
        kind: dto.kind,
        observed_at: observedAtDate,
        received_at: new Date(),
        payload_hash: payloadHash,
        evidence: (dto.directionalEvidence as unknown as Record<string, unknown>) ?? {},
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23503') {
        const detail = (err as { detail?: string }).detail ?? '';
        throw new BadRequestException(
          `Khóa ngoại không hợp lệ: ${detail || 'identityEventId, cameraId hoặc knownFaceId không tồn tại'}`,
        );
      }
      throw err;
    }

    let newState: 'HOME' | 'AWAY' | null = null;
    if (dto.kind === 'ARRIVAL' || dto.kind === 'MOTION') {
      newState = 'HOME';
    } else if (dto.kind === 'DEPARTURE') {
      newState = 'AWAY';
    }

    if (newState) {
      await this.repository.updatePresence({
        owner_user_id: dto.ownerUserId,
        resident_user_id: dto.residentUserId,
        state: newState,
        observation_id: dto.observationId,
        observed_at: observedAtDate,
        valid_until: validUntilDate,
        updated_at: new Date(),
      });
    }

    return {
      observationId: dto.observationId,
      status: 'ACCEPTED',
      presenceUpdated: newState !== null,
    };
  }
}
