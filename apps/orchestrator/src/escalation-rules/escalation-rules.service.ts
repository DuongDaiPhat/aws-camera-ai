import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EscalationRulesRepository,
  RuleNotFoundError,
  RuleVersionConflictError,
  type EscalationRuleRecord,
} from './escalation-rules.repository';
import {
  computeEffectiveHighWaitSeconds,
  validateThresholdUpdate,
  EVENT_TYPE_DISPLAY_NAMES,
} from './escalation-rule-policy';
import type { UpdateEscalationThresholdsDto } from './dto/update-escalation-thresholds.dto';
import type { EscalationRuleDto } from './dto/escalation-rule-response.dto';
import type { EventType } from '@cam/contracts';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string;
}

@Injectable()
export class EscalationRulesService {
  constructor(private readonly repository: EscalationRulesRepository) {}

  async listRules(): Promise<EscalationRuleDto[]> {
    const records = await this.repository.findAll();
    return records.map((record) => this.mapRecordToDto(record));
  }

  async getRuleByEventType(eventType: string): Promise<EscalationRuleDto> {
    const record = await this.repository.findByEventType(eventType);
    if (!record) {
      throw new NotFoundException({
        error: {
          code: 'RULE_NOT_FOUND',
          message: 'Không tìm thấy cấu hình cho loại sự kiện.',
        },
      });
    }
    return this.mapRecordToDto(record);
  }

  async updateThresholds(
    eventType: string,
    dto: UpdateEscalationThresholdsDto,
    actor: ActorContext,
  ): Promise<EscalationRuleDto> {
    const validation = validateThresholdUpdate({
      eventType,
      tLow: dto.tLow,
      tHigh: dto.tHigh,
      tWaitSeconds: dto.tWaitSeconds,
    });

    if (!validation.isValid) {
      if (validation.errorCode === 'RULE_NOT_FOUND') {
        throw new NotFoundException({
          error: {
            code: validation.errorCode,
            message: validation.message,
          },
        });
      }
      throw new BadRequestException({
        error: {
          code: validation.errorCode,
          message: validation.message,
        },
      });
    }

    try {
      const updated = await this.repository.updateThresholdsAtomic({
        eventType,
        tLow: dto.tLow,
        tHigh: dto.tHigh,
        tWaitSeconds: dto.tWaitSeconds,
        expectedVersion: dto.expectedVersion,
        actorUserId: actor.userId,
        clientIp: actor.ipAddress,
        userAgent: actor.userAgent,
        correlationId: actor.correlationId,
      });

      return this.mapRecordToDto(updated);
    } catch (error: unknown) {
      if (error instanceof RuleNotFoundError) {
        throw new NotFoundException({
          error: {
            code: 'RULE_NOT_FOUND',
            message: error.message,
          },
        });
      }
      if (error instanceof RuleVersionConflictError) {
        throw new ConflictException({
          error: {
            code: 'RULE_VERSION_CONFLICT',
            message: error.message,
          },
        });
      }
      throw error;
    }
  }

  private mapRecordToDto(record: EscalationRuleRecord): EscalationRuleDto {
    return {
      version: record.version,
      effectiveHighWaitSeconds: computeEffectiveHighWaitSeconds(record.t_wait_seconds),
      eventType: record.event_type as EventType,
      displayName:
        EVENT_TYPE_DISPLAY_NAMES[record.event_type as EventType] ?? record.event_type,
      priority: record.priority,
      tLow: record.t_low !== null ? Number(record.t_low) : null,
      tHigh: record.t_high !== null ? Number(record.t_high) : null,
      tWaitSeconds: record.t_wait_seconds,
      skipLoggedOnly: record.skip_logged_only,
      notifyChannels: record.notify_channels,
      escalateChannels: record.escalate_channels,
      maxEscalationLevel: record.max_escalation_level,
      isEnabled: record.is_enabled,
      updatedAt: record.updated_at instanceof Date ? record.updated_at.toISOString() : new Date(record.updated_at).toISOString(),
      updatedByName: record.updated_by_name,
    };
  }
}
