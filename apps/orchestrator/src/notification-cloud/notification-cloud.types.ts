import type { components } from '@cam/contracts';
import type { Envelope, NotificationJob } from '../cloud-queue/queue-contract';

type Schemas = components['schemas'];
export type ClaimRequest = Schemas['NotificationClaimRequest'];
export type ClaimResponse = Schemas['NotificationClaimResponse'];
export type ClaimReason = Schemas['NotificationClaimNoOp']['reason'];
export type Delivery = Schemas['NotificationDelivery'];
export type OutcomeReceipt = Schemas['NotificationOutcomeReceipt'];
export type JobEnvelope = Extract<Envelope, { type: 'notification.job' }>;
export type OutcomeEnvelope = Extract<Envelope, { type: 'notification.outcome' }>;

export interface JobRow {
  envelope: JobEnvelope;
  cached_result: OutcomeEnvelope | null;
  owner_user_id: string;
  job_event_id: string;
  job_camera_id: string;
  event_id: string;
  channel: NotificationJob['channel'];
  delivery_driver: 'local' | 'sqs';
  status: string;
}

export interface ClaimJobRow extends JobRow {
  event_status: string;
  event_version: number;
  camera_id: string;
  current_owner: string;
  recipient_user_id: string | null;
  emergency_contact_id: string | null;
  cloud_contact_required: boolean;
  claim_reason: ClaimReason | null;
  current_driver: 'local' | 'sqs';
  expired: boolean;
}

export interface AttemptRow {
  attempt_id: string;
  claim_id: string;
  notification_id: string;
  owner_user_id: string;
  recipient_ref: string;
  channel: NotificationJob['channel'];
  mode: 'DRY_RUN' | 'REAL';
  blocked_provider: boolean;
  lease_until: Date;
  uncertain_at: Date | null;
}
