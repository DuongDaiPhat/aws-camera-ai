import { ApiProperty } from '@nestjs/swagger';
import type { EventType, PriorityLevel, NotificationChannel } from '@cam/contracts';

export class EscalationRuleDto {
  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ example: 15, description: 'Thời gian chờ ưu tiên cho nhánh confidence >= T_high' })
  effectiveHighWaitSeconds!: number;

  @ApiProperty({
    example: 'FIRE_SMOKE_DETECTED',
    enum: [
      'FIRE_SMOKE_DETECTED',
      'FALL_DETECTED',
      'RESTRICTED_ZONE',
      'UNKNOWN_PERSON',
      'WELLNESS_TIMEOUT',
    ],
  })
  eventType!: EventType;

  @ApiProperty({ example: 'Phát hiện cháy / khói' })
  displayName!: string;

  @ApiProperty({ example: 'P0', enum: ['P0', 'P1', 'P2', 'P3'] })
  priority!: PriorityLevel;

  @ApiProperty({ example: 0.5, nullable: true })
  tLow!: number | null;

  @ApiProperty({ example: 0.7, nullable: true })
  tHigh!: number | null;

  @ApiProperty({ example: 30 })
  tWaitSeconds!: number;

  @ApiProperty({ example: true })
  skipLoggedOnly!: boolean;

  @ApiProperty({ example: ['TELEGRAM', 'SNS_SMS'] })
  notifyChannels!: NotificationChannel[];

  @ApiProperty({ example: ['CONNECT_CALL', 'SNS_SMS'] })
  escalateChannels!: NotificationChannel[];

  @ApiProperty({ example: 3 })
  maxEscalationLevel!: number;

  @ApiProperty({ example: true })
  isEnabled!: boolean;

  @ApiProperty({ example: '2026-09-25T08:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ example: 'Quản trị CameraAI', nullable: true })
  updatedByName!: string | null;
}

export class ListEscalationRulesResponseDto {
  @ApiProperty({ type: [EscalationRuleDto] })
  data!: EscalationRuleDto[];
}
