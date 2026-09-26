import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type {
  EventType,
  EventStatus,
  NotificationChannel,
  ConfirmationResponse,
} from '@cam/contracts';
import { EscalationRepository, type EventRecord } from './escalation.repository';
import { EscalationRulesRepository } from '../escalation-rules/escalation-rules.repository';
import {
  evaluateEscalationPolicy,
  isValidStatusTransition,
  type EscalationEvaluationInput,
  type EscalationRuleLookup,
} from './escalation-policy';

export interface ConfirmationResultDto {
  id: string;
  eventId: string;
  phase: 'INITIAL' | 'EMERGENCY';
  response: ConfirmationResponse;
  channel: NotificationChannel;
  confirmedByName: string | null;
  note: string | null;
  respondedAt: string;
  resultingStatus: EventStatus;
}

@Injectable()
export class EscalationEngineService {
  private readonly logger = new Logger(EscalationEngineService.name);

  constructor(
    private readonly repository: EscalationRepository,
    private readonly rulesRepository: EscalationRulesRepository,
  ) {}

  /**
   * Danh gia su kien theo rule va thuc hien transition neu can
   */
  async evaluateAndTransition(
    eventId: string,
    input: EscalationEvaluationInput,
  ): Promise<EventRecord> {
    const rules = await this.rulesRepository.findAll();
    const rulesMap = new Map<EventType, EscalationRuleLookup>(
      rules.map((r) => [
        r.event_type,
        {
          eventType: r.event_type,
          priority: r.priority,
          tLow: r.t_low !== null ? Number(r.t_low) : null,
          tHigh: r.t_high !== null ? Number(r.t_high) : null,
          tWaitSeconds: r.t_wait_seconds,
          skipLoggedOnly: r.skip_logged_only,
          notifyChannels: r.notify_channels,
          escalateChannels: r.escalate_channels,
          maxEscalationLevel: r.max_escalation_level,
          isEnabled: r.is_enabled,
          version: r.version,
        },
      ]),
    );

    const decision = evaluateEscalationPolicy(input, rulesMap);
    const client = await this.repository.getPoolClient();

    try {
      await client.query('BEGIN');
      const event = await this.repository.findEventForUpdate(client, eventId);
      if (!event) {
        throw new NotFoundException(`Không tìm thấy sự kiện ${eventId}`);
      }

      if (!isValidStatusTransition(event.status, decision.targetStatus)) {
        this.logger.warn(
          `Bỏ qua transition không hợp lệ từ ${event.status} sang ${decision.targetStatus} cho sự kiện ${eventId}`,
        );
        await client.query('ROLLBACK');
        return event;
      }

      const now = new Date();
      const updated = await this.repository.updateEventStatus(client, eventId, event.version, {
        status: decision.targetStatus,
        priority: decision.priority,
        notifiedAt: decision.targetStatus === 'NOTIFIED' ? now : undefined,
        escalationDeadlineAt: decision.deadlineAt,
        ruleSnapshot: decision.ruleSnapshot,
        triggeringResults: decision.triggeringResults,
      });

      await this.repository.createStatusHistory(client, {
        eventId,
        fromStatus: event.status,
        toStatus: decision.targetStatus,
        reason: decision.reason,
        actorType: 'SYSTEM',
        metadata: {
          decision,
          detectedAt: input.detectedAt,
        },
      });

      // Neu chuyen sang NOTIFIED: tao notification intents cho cac kenh caregiver
      if (decision.targetStatus === 'NOTIFIED') {
        const rule = rulesMap.get(input.eventType);
        const channels = rule?.notifyChannels ?? ['TELEGRAM'];
        for (const channel of channels) {
          await this.repository.createNotificationIntent(client, {
            eventId,
            channel,
            status: 'PENDING',
            escalationLevel: 0,
            payload: {
              eventType: input.eventType,
              priority: decision.priority,
              deadlineAt: decision.deadlineAt,
            },
          });
        }
      }

      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Xac nhan su kien giai doan INITIAL ("Toi on" / "Can giup do") - FR-ESC-03/04/09
   */
  async confirmInitial(
    eventId: string,
    actorUserId: string,
    params: {
      response: ConfirmationResponse;
      note?: string;
      channel?: NotificationChannel;
      commandId?: string;
    },
  ): Promise<ConfirmationResultDto> {
    if (params.response !== 'IM_OK' && params.response !== 'NEED_HELP') {
      throw new BadRequestException('Giai đoạn ban đầu chỉ chấp nhận IM_OK hoặc NEED_HELP');
    }

    const client = await this.repository.getPoolClient();
    try {
      await client.query('BEGIN');
      const event = await this.repository.findEventForUpdate(client, eventId);
      if (!event) {
        throw new NotFoundException(`Không tìm thấy sự kiện ${eventId}`);
      }

      // Kiem tra da co xac nhan authoritative INITIAL chua
      const existingAuth = await this.repository.findAuthoritativeConfirmation(
        client,
        eventId,
        'INITIAL',
      );
      if (existingAuth) {
        // Ghi nhan lan bam sau voi is_authoritative = false de phuc vu kiem toan (US-14)
        await this.repository.createConfirmation(client, {
          eventId,
          userId: actorUserId,
          channel: params.channel ?? 'DASHBOARD',
          response: params.response,
          phase: 'INITIAL',
          isAuthoritative: false,
          note: params.note ?? null,
          sourceMessageId: params.commandId ?? null,
        });

        await client.query('COMMIT'); // Commit audit record

        throw new ConflictException({
          code: 'ALREADY_CONFIRMED',
          message: 'Sự kiện đã được xử lý bởi người khác',
          details: {
            canonicalStatus: event.status,
            confirmation: {
              id: existingAuth.id,
              eventId: existingAuth.event_id,
              phase: existingAuth.phase,
              response: existingAuth.response,
              channel: existingAuth.channel,
              confirmedByName: existingAuth.confirmed_by_name ?? null,
              note: existingAuth.note,
              respondedAt: existingAuth.responded_at.toISOString(),
              resultingStatus: existingAuth.response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED',
            },
          },
        });
      }

      // Neu su kien khong o trang thai NOTIFIED (vi du da bi timeout sang ESCALATED)
      if (event.status !== 'NOTIFIED') {
        await client.query('ROLLBACK');
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Sự kiện không còn ở trạng thái chờ phản hồi',
          details: {
            canonicalStatus: event.status,
            confirmation: null,
          },
        });
      }

      const now = new Date();
      const targetStatus: EventStatus = params.response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED';

      const confirmationRecord = await this.repository.createConfirmation(client, {
        eventId,
        userId: actorUserId,
        channel: params.channel ?? 'DASHBOARD',
        response: params.response,
        phase: 'INITIAL',
        isAuthoritative: true,
        note: params.note ?? null,
        sourceMessageId: params.commandId ?? null,
      });

      await this.repository.updateEventStatus(client, eventId, event.version, {
        status: targetStatus,
        resolvedAt: targetStatus === 'RESOLVED' ? now : undefined,
        escalatedAt: targetStatus === 'ESCALATED' ? now : undefined,
        escalationDeadlineAt: null, // Huy deadline khi da xac nhan
      });

      await this.repository.createStatusHistory(client, {
        eventId,
        fromStatus: 'NOTIFIED',
        toStatus: targetStatus,
        reason: params.response === 'IM_OK' ? 'USER_CONFIRMED_IM_OK' : 'USER_CONFIRMED_NEED_HELP',
        actorType: 'USER',
        actorUserId,
        channel: params.channel ?? 'DASHBOARD',
        metadata: {
          note: params.note ?? null,
          commandId: params.commandId ?? null,
        },
      });

      // Neu NEED_HELP: tao ngay notification intents cho lien he khan cap
      if (targetStatus === 'ESCALATED') {
        await this.repository.createNotificationIntent(client, {
          eventId,
          channel: 'CONNECT_CALL',
          status: 'PENDING',
          escalationLevel: 1,
          payload: {
            reason: 'USER_CONFIRMED_NEED_HELP',
            triggeredByUserId: actorUserId,
          },
        });
      }

      await client.query('COMMIT');

      return {
        id: confirmationRecord.id,
        eventId: confirmationRecord.event_id,
        phase: confirmationRecord.phase,
        response: confirmationRecord.response,
        channel: confirmationRecord.channel,
        confirmedByName: confirmationRecord.confirmed_by_name ?? null,
        note: confirmationRecord.note,
        respondedAt: confirmationRecord.responded_at.toISOString(),
        resultingStatus: targetStatus,
      };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          this.logger.debug('Lỗi rollback confirmInitial', rollbackErr);
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Dong su kien khan cap sau khi da tiep nhan va xu ly (FR-ESC-04/09, US-13 Phase EMERGENCY)
   */
  async closeEmergency(
    eventId: string,
    actorUserId: string,
    params: {
      note?: string;
      channel?: NotificationChannel;
      commandId?: string;
    },
  ): Promise<ConfirmationResultDto> {
    const client = await this.repository.getPoolClient();
    try {
      await client.query('BEGIN');
      const event = await this.repository.findEventForUpdate(client, eventId);
      if (!event) {
        throw new NotFoundException(`Không tìm thấy sự kiện ${eventId}`);
      }

      // Kiem tra su kien phai dang o trang thai ESCALATED
      if (event.status !== 'ESCALATED') {
        await client.query('ROLLBACK');
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Chỉ có thể đóng sự kiện đang ở trạng thái leo thang (ESCALATED)',
          details: {
            canonicalStatus: event.status,
            confirmation: null,
          },
        });
      }

      // Kiem tra da co xac nhan authoritative EMERGENCY chua
      const existingAuth = await this.repository.findAuthoritativeConfirmation(
        client,
        eventId,
        'EMERGENCY',
      );
      if (existingAuth) {
        await client.query('ROLLBACK');
        throw new ConflictException({
          code: 'ALREADY_CONFIRMED',
          message: 'Sự kiện khẩn cấp này đã được đóng trước đó',
          details: {
            canonicalStatus: event.status,
            confirmation: {
              id: existingAuth.id,
              eventId: existingAuth.event_id,
              phase: existingAuth.phase,
              response: existingAuth.response,
              channel: existingAuth.channel,
              confirmedByName: existingAuth.confirmed_by_name ?? null,
              note: existingAuth.note,
              respondedAt: existingAuth.responded_at.toISOString(),
              resultingStatus: 'CLOSED',
            },
          },
        });
      }

      const now = new Date();
      const confirmationRecord = await this.repository.createConfirmation(client, {
        eventId,
        userId: actorUserId,
        channel: params.channel ?? 'DASHBOARD',
        response: 'ACKNOWLEDGED',
        phase: 'EMERGENCY',
        isAuthoritative: true,
        note: params.note ?? null,
        sourceMessageId: params.commandId ?? null,
      });

      await this.repository.updateEventStatus(client, eventId, event.version, {
        status: 'CLOSED',
        closedAt: now,
      });

      await this.repository.createStatusHistory(client, {
        eventId,
        fromStatus: 'ESCALATED',
        toStatus: 'CLOSED',
        reason: 'EMERGENCY_ACKNOWLEDGED',
        actorType: 'USER',
        actorUserId,
        channel: params.channel ?? 'DASHBOARD',
        metadata: {
          note: params.note ?? null,
          commandId: params.commandId ?? null,
        },
      });

      await client.query('COMMIT');

      return {
        id: confirmationRecord.id,
        eventId: confirmationRecord.event_id,
        phase: confirmationRecord.phase,
        response: confirmationRecord.response,
        channel: confirmationRecord.channel,
        confirmedByName: confirmationRecord.confirmed_by_name ?? null,
        note: confirmationRecord.note,
        respondedAt: confirmationRecord.responded_at.toISOString(),
        resultingStatus: 'CLOSED',
      };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          this.logger.debug('Lỗi rollback closeEmergency', rollbackErr);
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
