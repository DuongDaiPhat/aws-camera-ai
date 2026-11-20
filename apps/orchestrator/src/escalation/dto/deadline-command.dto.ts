import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsString, IsUUID, Matches, Min } from 'class-validator';

export const DEADLINE_NO_OP_REASONS = [
  'ACKNOWLEDGED',
  'RESOLVED',
  'STALE_DEADLINE',
  'ALREADY_APPLIED',
] as const;

export type DeadlineDisposition = 'APPLIED' | 'NO_OP';
export type DeadlineNoOpReason = (typeof DEADLINE_NO_OP_REASONS)[number];
export type DeadlineReason = 'ESCALATED' | DeadlineNoOpReason;

export interface DeadlineCommandPayload {
  schemaVersion: 1;
  commandId: string;
  eventId: string;
  deadlineVersion: number;
  expectedDeadlineAt: string;
}

export interface ValidatedDeadlineCommand {
  command: DeadlineCommandPayload;
  expectedDeadlineDate: Date;
  payloadHash: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const ALLOWED_COMMAND_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'eventId',
  'deadlineVersion',
  'expectedDeadlineAt',
]);

export class DeadlineCommandDto implements DeadlineCommandPayload {
  @ApiProperty({ example: 1, enum: [1] })
  @Equals(1)
  schemaVersion!: 1;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  commandId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  deadlineVersion!: number;

  @ApiProperty({ format: 'date-time', example: '2026-11-05T03:01:00Z' })
  @IsString()
  @Matches(UTC_ISO_PATTERN, {
    message: 'expectedDeadlineAt must be a UTC ISO-8601 timestamp ending with Z',
  })
  expectedDeadlineAt!: string;
}

export class DeadlineCommandResponseDto {
  @ApiProperty({ format: 'uuid' })
  commandId!: string;

  @ApiProperty({ enum: ['APPLIED', 'NO_OP'] })
  disposition!: DeadlineDisposition;

  @ApiProperty({
    enum: ['ESCALATED', 'ACKNOWLEDGED', 'RESOLVED', 'STALE_DEADLINE', 'ALREADY_APPLIED'],
  })
  reason!: DeadlineReason;

  @ApiProperty({ minimum: 1 })
  aggregateVersion!: number;
}

export function buildDeadlineCommandPayload(input: {
  commandId: string;
  eventId: string;
  deadlineVersion: number;
  expectedDeadlineAt: Date | string;
}): DeadlineCommandPayload {
  const expectedDeadlineAt =
    input.expectedDeadlineAt instanceof Date
      ? input.expectedDeadlineAt.toISOString()
      : input.expectedDeadlineAt;

  return {
    schemaVersion: 1,
    commandId: input.commandId,
    eventId: input.eventId,
    deadlineVersion: input.deadlineVersion,
    expectedDeadlineAt,
  };
}

export function hashDeadlineCommand(command: DeadlineCommandPayload): string {
  const canonical = JSON.stringify({
    schemaVersion: command.schemaVersion,
    commandId: command.commandId,
    eventId: command.eventId,
    deadlineVersion: command.deadlineVersion,
    expectedDeadlineAt: command.expectedDeadlineAt,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function parseStrictUtcTimestamp(value: string): Date | null {
  const match = UTC_ISO_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const millisecond = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const date = new Date(utcMs);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date;
}

export function parseDeadlineCommand(
  pathEventId: string,
  rawBody: unknown,
): ValidatedDeadlineCommand {
  if (!UUID_PATTERN.test(pathEventId)) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'eventId trên đường dẫn không phải UUID hợp lệ.',
    });
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'Payload deadline command phải là JSON object.',
    });
  }

  const record = rawBody as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_COMMAND_KEYS.has(key)) {
      throw new BadRequestException({
        code: 'INVALID_DEADLINE_COMMAND',
        message: `Trường không được phép trong deadline command: ${key}`,
      });
    }
  }

  const { schemaVersion, commandId, eventId, deadlineVersion, expectedDeadlineAt } = record;

  if (schemaVersion !== 1) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'schemaVersion phải bằng 1.',
    });
  }

  if (typeof commandId !== 'string' || !UUID_PATTERN.test(commandId)) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'commandId phải là UUID hợp lệ.',
    });
  }

  if (typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'eventId trong body phải là UUID hợp lệ.',
    });
  }

  if (eventId.toLowerCase() !== pathEventId.toLowerCase()) {
    throw new BadRequestException({
      code: 'EVENT_ID_MISMATCH',
      message: 'eventId trong body phải khớp với eventId trên đường dẫn.',
    });
  }

  if (
    typeof deadlineVersion !== 'number' ||
    !Number.isInteger(deadlineVersion) ||
    deadlineVersion < 1
  ) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'deadlineVersion phải là số nguyên dương >= 1.',
    });
  }

  if (typeof expectedDeadlineAt !== 'string') {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'expectedDeadlineAt phải là chuỗi UTC ISO-8601 hậu tố Z.',
    });
  }

  const expectedDeadlineDate = parseStrictUtcTimestamp(expectedDeadlineAt);
  if (!expectedDeadlineDate) {
    throw new BadRequestException({
      code: 'INVALID_DEADLINE_COMMAND',
      message: 'expectedDeadlineAt không phải timestamp UTC ISO-8601 hậu tố Z hợp lệ.',
    });
  }

  const command: DeadlineCommandPayload = {
    schemaVersion: 1,
    commandId,
    eventId,
    deadlineVersion,
    expectedDeadlineAt,
  };

  return {
    command,
    expectedDeadlineDate,
    payloadHash: hashDeadlineCommand(command),
  };
}
