import { ApiProperty } from '@nestjs/swagger';
import type {
  EventStatus,
  NotificationChannel,
  ConfirmationResponse,
  ConfirmationPhase,
} from '@cam/contracts';

export class ConfirmationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ enum: ['INITIAL', 'EMERGENCY'] })
  phase!: ConfirmationPhase;

  @ApiProperty({ enum: ['IM_OK', 'NEED_HELP', 'ACKNOWLEDGED'] })
  response!: ConfirmationResponse;

  @ApiProperty({ enum: ['TELEGRAM', 'SNS_EMAIL', 'SNS_SMS', 'CONNECT_CALL', 'DASHBOARD'] })
  channel!: NotificationChannel;

  @ApiProperty({ nullable: true })
  confirmedByName!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  respondedAt!: string;

  @ApiProperty({ enum: ['DETECTED', 'LOGGED_ONLY', 'NOTIFIED', 'ESCALATED', 'RESOLVED', 'CLOSED', 'AI_FAILED'] })
  resultingStatus!: EventStatus;
}
