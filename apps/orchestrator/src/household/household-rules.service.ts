import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { TokenClaims } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { EscalationRulesService } from '../escalation-rules/escalation-rules.service';
import {
  validateThresholdUpdate,
  computeEffectiveHighWaitSeconds,
} from '../escalation-rules/escalation-rule-policy';
import type { UpdateEscalationThresholdsDto } from '../escalation-rules/dto/update-escalation-thresholds.dto';
import { HouseholdAccessService } from './household-access.service';

@Injectable()
export class HouseholdRulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: HouseholdAccessService,
    private readonly rules: EscalationRulesService,
  ) {}
  async list(
    actor: TokenClaims,
  ): Promise<{ data: Awaited<ReturnType<EscalationRulesService['listRules']>> }> {
    const owner = await this.access.manager(actor);
    const global = await this.rules.listRules();
    const result = await this.db.query<{
      event_type: string;
      t_low: string | null;
      t_high: string | null;
      t_wait_seconds: number;
      high_wait_seconds: number | null;
      version: number;
      updated_at: Date;
      updated_by_name: string | null;
    }>(
      `SELECT h.*,u.full_name AS updated_by_name FROM household_escalation_rules h LEFT JOIN users u ON u.id=h.updated_by_user_id WHERE h.owner_user_id=$1`,
      [owner],
    );
    return {
      data: global.map((rule) => {
        const local = result.rows.find((row) => row.event_type === rule.eventType);
        if (!local) return rule;
        return {
          ...rule,
          tLow: local.t_low === null ? null : Number(local.t_low),
          tHigh: local.t_high === null ? null : Number(local.t_high),
          tWaitSeconds: local.t_wait_seconds,
          highWaitSeconds: local.high_wait_seconds,
          effectiveHighWaitSeconds: computeEffectiveHighWaitSeconds(
            local.t_wait_seconds,
            local.high_wait_seconds,
          ),
          version: local.version,
          updatedAt: local.updated_at.toISOString(),
          updatedByName: local.updated_by_name,
        };
      }),
    };
  }
  async save(
    actor: TokenClaims,
    eventType: string,
    input: UpdateEscalationThresholdsDto,
  ): ReturnType<EscalationRulesService['getRuleByEventType']> {
    const owner = await this.access.manager(actor);
    const validation = validateThresholdUpdate({ eventType, ...input });
    if (!validation.isValid) throw new BadRequestException(validation.message);
    const base = await this.rules.getRuleByEventType(eventType);

    await this.db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
      const current = await client.query<{ version: number; high_wait_seconds: number | null }>(
        'SELECT version, high_wait_seconds FROM household_escalation_rules WHERE owner_user_id=$1 AND event_type=$2',
        [owner, eventType],
      );
      const version = current.rows[0]?.version ?? base.version;
      const high =
        input.highWaitSeconds === undefined
          ? current.rows[0]
            ? current.rows[0].high_wait_seconds
            : base.highWaitSeconds
          : input.highWaitSeconds;
      const effectiveValidation = validateThresholdUpdate({
        eventType,
        ...input,
        highWaitSeconds: high,
      });
      if (!effectiveValidation.isValid) throw new BadRequestException(effectiveValidation.message);
      if (version !== input.expectedVersion)
        throw new ConflictException('Cấu hình hộ đã thay đổi. Hãy tải lại trước khi lưu.');
      await client.query(
        `INSERT INTO household_escalation_rules(owner_user_id,event_type,t_low,t_high,t_wait_seconds,high_wait_seconds,version,updated_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_user_id,event_type) DO UPDATE SET t_low=$3,t_high=$4,t_wait_seconds=$5,high_wait_seconds=$6,version=$7,updated_by_user_id=$8,updated_at=now()`,
        [
          owner,
          eventType,
          input.tLow,
          input.tHigh,
          input.tWaitSeconds,
          high,
          version + 1,
          actor.sub,
        ],
      );
      await this.access.audit(client, actor.sub, 'HOUSEHOLD_RULE_UPDATED', owner, {
        eventType,
        version: version + 1,
      });
    });
    return (await this.list(actor)).data.find((rule) => rule.eventType === eventType)!;
  }
}
