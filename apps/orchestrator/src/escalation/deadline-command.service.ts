import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EscalationRepository } from './escalation.repository';
import { DeadlineRepository, type DeadlineReceiptRecord } from './deadline.repository';
import {
  type DeadlineCommandResponseDto,
  type DeadlineNoOpReason,
  parseDeadlineCommand,
} from './dto/deadline-command.dto';

function isUniqueViolationOnReceipt(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === '23505' &&
    (!pgError.constraint || pgError.constraint.includes('deadline_command_receipts'))
  );
}

@Injectable()
export class DeadlineCommandService {
  private readonly logger = new Logger(DeadlineCommandService.name);

  constructor(
    private readonly escalationRepository: EscalationRepository,
    private readonly deadlineRepository: DeadlineRepository,
  ) {}

  /**
   * Single idempotent business operation shared by internal deadline HTTP API and reconciler (G0 §1 & §4).
   */
  async applyCommand(eventId: string, rawBody: unknown): Promise<DeadlineCommandResponseDto> {
    const { command, expectedDeadlineDate, payloadHash } = parseDeadlineCommand(eventId, rawBody);
    const client = await this.deadlineRepository.getPoolClient();

    try {
      await client.query('BEGIN');

      const existingReceipt = await this.deadlineRepository.findReceiptByCommandId(
        client,
        command.commandId,
      );
      if (existingReceipt) {
        const response = this.resolveExistingReceipt(existingReceipt, payloadHash);
        await client.query('COMMIT');
        return response;
      }

      const event = await this.deadlineRepository.findEventForUpdateWithClock(client, eventId);
      if (!event) {
        await client.query('ROLLBACK');
        throw new NotFoundException({
          code: 'EVENT_NOT_FOUND',
          message: `Không tìm thấy sự kiện ${eventId}.`,
        });
      }

      // Re-check after acquiring the event row lock to serialize concurrent retries for the same event.
      const racedReceipt = await this.deadlineRepository.findReceiptByCommandId(
        client,
        command.commandId,
      );
      if (racedReceipt) {
        const response = this.resolveExistingReceipt(racedReceipt, payloadHash);
        await client.query('COMMIT');
        return response;
      }

      const noOpReason = this.determineNoOpReason(
        event.status,
        event.deadline_version,
        event.escalation_deadline_at,
        command.deadlineVersion,
      );
      if (noOpReason) {
        await this.deadlineRepository.insertReceipt(client, {
          commandId: command.commandId,
          eventId: event.id,
          deadlineVersion: command.deadlineVersion,
          expectedDeadlineAt: expectedDeadlineDate,
          payloadHash,
          payload: command,
          disposition: 'NO_OP',
          reason: noOpReason,
          aggregateVersion: event.version,
          notificationId: null,
        });
        await this.deadlineRepository.markDispatchCompletedByCommandId(client, command.commandId);
        await client.query('COMMIT');

        this.logger.log(
          {
            commandId: command.commandId,
            eventId: event.id,
            disposition: 'NO_OP',
            reason: noOpReason,
            aggregateVersion: event.version,
          },
          'Deadline command resolved as NO_OP',
        );

        return {
          commandId: command.commandId,
          disposition: 'NO_OP',
          reason: noOpReason,
          aggregateVersion: event.version,
        };
      }

      const deadlineAt = event.escalation_deadline_at!;
      const dbNow = event.db_now;

      if (dbNow.getTime() < deadlineAt.getTime()) {
        await client.query('ROLLBACK');
        throw new ConflictException({
          code: 'NOT_DUE',
          retryAt: deadlineAt.toISOString(),
          message: 'Sự kiện chưa đến hạn leo thang theo đồng hồ cơ sở dữ liệu.',
        });
      }

      const latenessMs = Math.max(0, dbNow.getTime() - deadlineAt.getTime());
      const updated = await this.escalationRepository.updateEventStatus(
        client,
        event.id,
        event.version,
        {
          status: 'ESCALATED',
          escalatedAt: dbNow,
          escalationDeadlineAt: null,
        },
      );

      await this.escalationRepository.createStatusHistory(client, {
        eventId: event.id,
        fromStatus: 'NOTIFIED',
        toStatus: 'ESCALATED',
        reason: 'TIMEOUT',
        actorType: 'SCHEDULER',
        metadata: {
          commandId: command.commandId,
          deadlineVersion: command.deadlineVersion,
          expectedDeadlineAt: command.expectedDeadlineAt,
          deadlineAt: deadlineAt.toISOString(),
          latenessMs,
          driver: 'stepfunctions',
        },
      });

      const notificationId = await this.escalationRepository.createNotificationIntent(client, {
        eventId: event.id,
        channel: 'CONNECT_CALL',
        status: 'PENDING',
        escalationLevel: 1,
        payload: {
          reason: 'TIMEOUT',
          originalPriority: event.priority,
          deadlineAt: deadlineAt.toISOString(),
          commandId: command.commandId,
          deadlineVersion: command.deadlineVersion,
        },
      });

      await this.deadlineRepository.insertReceipt(client, {
        commandId: command.commandId,
        eventId: event.id,
        deadlineVersion: command.deadlineVersion,
        expectedDeadlineAt: expectedDeadlineDate,
        payloadHash,
        payload: command,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
        aggregateVersion: updated.version,
        notificationId,
      });
      await this.deadlineRepository.markDispatchCompletedByCommandId(client, command.commandId);
      await client.query('COMMIT');

      this.logger.log(
        {
          commandId: command.commandId,
          eventId: event.id,
          notificationId,
          disposition: 'APPLIED',
          reason: 'ESCALATED',
          aggregateVersion: updated.version,
        },
        'Deadline command applied escalation',
      );

      return {
        commandId: command.commandId,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
        aggregateVersion: updated.version,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.debug('Rollback error in applyCommand', rollbackErr);
      }

      if (isUniqueViolationOnReceipt(error)) {
        const concurrentReceipt = await this.deadlineRepository.findReceiptByCommandIdReadOnly(
          command.commandId,
        );
        if (concurrentReceipt) {
          return this.resolveExistingReceipt(concurrentReceipt, payloadHash);
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private resolveExistingReceipt(
    receipt: DeadlineReceiptRecord,
    payloadHash: string,
  ): DeadlineCommandResponseDto {
    if (receipt.payload_hash !== payloadHash) {
      throw new ConflictException({
        code: 'COMMAND_CONFLICT',
        message: `commandId ${receipt.command_id} đã được dùng với nội dung khác.`,
      });
    }
    return {
      commandId: receipt.command_id,
      disposition: receipt.disposition,
      reason: receipt.reason,
      aggregateVersion: receipt.aggregate_version,
    };
  }

  private determineNoOpReason(
    status: string,
    currentDeadlineVersion: number,
    escalationDeadlineAt: Date | null,
    commandDeadlineVersion: number,
  ): DeadlineNoOpReason | null {
    if (status === 'RESOLVED') {
      return 'RESOLVED';
    }
    if (status === 'CLOSED') {
      return 'ACKNOWLEDGED';
    }
    if (status === 'ESCALATED') {
      return 'ALREADY_APPLIED';
    }
    if (
      status !== 'NOTIFIED' ||
      escalationDeadlineAt === null ||
      commandDeadlineVersion !== currentDeadlineVersion
    ) {
      return 'STALE_DEADLINE';
    }
    return null;
  }
}
