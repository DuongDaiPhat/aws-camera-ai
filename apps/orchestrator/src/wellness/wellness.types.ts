export type WellnessCheckRunStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SKIPPED_ACTIVITY'
  | 'SKIPPED_AWAY'
  | 'SKIPPED_DISABLED'
  | 'SKIPPED_SUPERSEDED'
  | 'MISSED'
  | 'ALERT_CREATED';

export type WellnessPresenceState = 'HOME' | 'AWAY' | 'UNKNOWN';

export type WellnessObservationKind = 'MOTION' | 'ARRIVAL' | 'DEPARTURE';

export interface WellnessScheduleRecord {
  id: string;
  owner_user_id: string | null;
  resident_user_id: string;
  name: string;
  check_at: string;
  days_of_week: number[];
  lookback_hours: number;
  grace_seconds: number;
  camera_ids: string[];
  timezone: string;
  is_enabled: boolean;
  version: number;
  activation_started_at: Date;
  last_materialized_at: Date | null;
  last_checked_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WellnessCheckRunRecord {
  id: string;
  schedule_id: string;
  owner_user_id: string;
  resident_user_id: string;
  local_date: string;
  scheduled_for: Date;
  schedule_version: number;
  schedule_snapshot: Record<string, unknown>;
  lookback_started_at: Date;
  lookback_ended_at: Date;
  last_activity_at: Date | null;
  presence_state: WellnessPresenceState;
  presence_observation_id: string | null;
  grace_seconds: number;
  status: WellnessCheckRunStatus;
  decision_reason: string | null;
  evaluated_at: Date | null;
  event_id: string | null;
  request_sent_at: Date | null;
  confirmation_deadline_at: Date | null;
  delivery_deadline_at: Date | null;
  attempt_count: number;
  available_at: Date;
  leased_until: Date | null;
  lease_token: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  event_status?: string | null;
}

export interface WellnessObservationRecord {
  observation_id: string;
  owner_user_id: string;
  resident_user_id: string;
  known_face_id: string | null;
  camera_id: string | null;
  identity_event_id: string | null;
  source_session_id: string;
  track_id: string;
  kind: WellnessObservationKind;
  observed_at: Date;
  received_at: Date;
  payload_hash: string;
  evidence: Record<string, unknown>;
}

export interface WellnessPresenceRecord {
  owner_user_id: string;
  resident_user_id: string;
  state: 'HOME' | 'AWAY';
  observation_id: string;
  observed_at: Date;
  valid_until: Date;
  updated_at: Date;
}
