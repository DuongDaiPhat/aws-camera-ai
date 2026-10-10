-- US-20: scoped schedules, resident observations, presence and durable check runs.
-- Additive migration: historical rules, events and schedule timing are unchanged.
BEGIN;

ALTER TABLE wellness_schedules
    ADD COLUMN owner_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN activation_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN last_materialized_at TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD CONSTRAINT wellness_schedules_version_positive CHECK (version >= 1);

-- Only backfill unambiguous registered-resident ownership. Legacy schedules
-- without a unique household link remain visible for explicit configuration.
WITH resident_owners AS (
    SELECT linked_user_id AS resident_user_id,
           (array_agg(DISTINCT owner_user_id))[1] AS owner_user_id
    FROM known_faces
    WHERE linked_user_id IS NOT NULL AND is_active = TRUE
    GROUP BY linked_user_id
    HAVING count(DISTINCT owner_user_id) = 1
)
UPDATE wellness_schedules AS schedule
SET owner_user_id = resident.owner_user_id
FROM resident_owners AS resident
WHERE schedule.resident_user_id = resident.resident_user_id;

CREATE INDEX idx_wellness_schedules_due ON wellness_schedules (owner_user_id, check_at)
    WHERE is_enabled = TRUE AND deleted_at IS NULL;

-- Preserve duplicate protection for live schedules while allowing a deleted
-- schedule time to be reused without removing historical check runs.
ALTER TABLE wellness_schedules DROP CONSTRAINT wellness_lich_duy_nhat;
CREATE UNIQUE INDEX uq_wellness_schedules_active_resident_time
    ON wellness_schedules (resident_user_id, check_at) WHERE deleted_at IS NULL;

ALTER TABLE events
    ADD COLUMN wellness_owner_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN wellness_resident_user_id UUID REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX idx_events_wellness_resident ON events (wellness_resident_user_id, detected_at DESC)
    WHERE event_type = 'WELLNESS_TIMEOUT';
CREATE UNIQUE INDEX idx_events_one_active_wellness_resident
    ON events (wellness_owner_user_id, wellness_resident_user_id)
    WHERE event_type = 'WELLNESS_TIMEOUT' AND status IN ('DETECTED', 'NOTIFIED', 'ESCALATED');

CREATE TABLE resident_wellness_observations (
    observation_id     UUID PRIMARY KEY,
    owner_user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resident_user_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    known_face_id      UUID REFERENCES known_faces (id) ON DELETE SET NULL,
    camera_id          UUID REFERENCES cameras (id) ON DELETE SET NULL,
    identity_event_id  UUID REFERENCES events (id) ON DELETE SET NULL,
    source_session_id  TEXT NOT NULL,
    track_id           TEXT NOT NULL,
    kind               TEXT NOT NULL,
    observed_at        TIMESTAMPTZ NOT NULL,
    received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_hash       CHAR(64) NOT NULL,
    evidence           JSONB NOT NULL,
    CONSTRAINT wellness_observation_kind_valid CHECK (kind IN ('MOTION', 'ARRIVAL', 'DEPARTURE')),
    CONSTRAINT wellness_observation_identity_valid CHECK (
        char_length(source_session_id) BETWEEN 1 AND 128 AND char_length(track_id) BETWEEN 1 AND 128
    ),
    CONSTRAINT wellness_observation_hash_valid CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT wellness_observation_evidence_object CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE INDEX idx_wellness_observations_activity
    ON resident_wellness_observations (owner_user_id, resident_user_id, observed_at DESC)
    WHERE kind IN ('MOTION', 'ARRIVAL');
CREATE INDEX idx_wellness_observations_presence
    ON resident_wellness_observations (owner_user_id, resident_user_id, observed_at DESC);

CREATE TABLE resident_wellness_presence (
    owner_user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resident_user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    state               TEXT NOT NULL,
    observation_id      UUID NOT NULL REFERENCES resident_wellness_observations (observation_id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    observed_at         TIMESTAMPTZ NOT NULL,
    valid_until         TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, resident_user_id),
    CONSTRAINT wellness_presence_state_valid CHECK (state IN ('HOME', 'AWAY')),
    CONSTRAINT wellness_presence_expiry_valid CHECK (valid_until > observed_at)
);
CREATE TRIGGER trg_wellness_presence_updated_at BEFORE UPDATE ON resident_wellness_presence
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wellness_check_runs (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id                UUID NOT NULL REFERENCES wellness_schedules (id) ON DELETE RESTRICT,
    owner_user_id              UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resident_user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    local_date                 DATE NOT NULL,
    scheduled_for              TIMESTAMPTZ NOT NULL,
    schedule_version           INTEGER NOT NULL,
    schedule_snapshot          JSONB NOT NULL,
    lookback_started_at        TIMESTAMPTZ NOT NULL,
    lookback_ended_at           TIMESTAMPTZ NOT NULL,
    last_activity_at           TIMESTAMPTZ,
    presence_state             TEXT NOT NULL DEFAULT 'UNKNOWN',
    presence_observation_id    UUID REFERENCES resident_wellness_observations (observation_id) ON DELETE SET NULL,
    grace_seconds              INTEGER NOT NULL,
    status                     TEXT NOT NULL DEFAULT 'PENDING',
    decision_reason            TEXT,
    evaluated_at               TIMESTAMPTZ,
    event_id                   UUID UNIQUE REFERENCES events (id) ON DELETE RESTRICT,
    request_sent_at            TIMESTAMPTZ,
    confirmation_deadline_at   TIMESTAMPTZ,
    delivery_deadline_at       TIMESTAMPTZ,
    attempt_count              INTEGER NOT NULL DEFAULT 0,
    available_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    leased_until               TIMESTAMPTZ,
    lease_token                UUID,
    last_error                 TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wellness_run_once_per_local_day UNIQUE (schedule_id, local_date),
    CONSTRAINT wellness_run_version_positive CHECK (schedule_version >= 1),
    CONSTRAINT wellness_run_snapshot_object CHECK (jsonb_typeof(schedule_snapshot) = 'object'),
    CONSTRAINT wellness_run_window_valid CHECK (
        lookback_started_at < lookback_ended_at AND lookback_ended_at = scheduled_for AND
        (last_activity_at IS NULL OR last_activity_at BETWEEN lookback_started_at AND lookback_ended_at)
    ),
    CONSTRAINT wellness_run_presence_valid CHECK (presence_state IN ('HOME', 'AWAY', 'UNKNOWN')),
    CONSTRAINT wellness_run_grace_valid CHECK (grace_seconds BETWEEN 60 AND 3600),
    CONSTRAINT wellness_run_attempt_nonnegative CHECK (attempt_count >= 0),
    CONSTRAINT wellness_run_status_valid CHECK (
        status IN ('PENDING', 'PROCESSING', 'SKIPPED_ACTIVITY', 'SKIPPED_AWAY',
                   'SKIPPED_DISABLED', 'SKIPPED_SUPERSEDED', 'MISSED', 'ALERT_CREATED') AND
        ((status = 'PROCESSING') = (leased_until IS NOT NULL)) AND
        ((status = 'PROCESSING') = (lease_token IS NOT NULL)) AND
        ((status = 'ALERT_CREATED') = (event_id IS NOT NULL)) AND
        ((status IN ('PENDING', 'PROCESSING')) = (evaluated_at IS NULL))
    ),
    CONSTRAINT wellness_run_confirmation_window_valid CHECK (
        (request_sent_at IS NULL AND confirmation_deadline_at IS NULL) OR
        (request_sent_at IS NOT NULL AND confirmation_deadline_at IS NOT NULL AND
         confirmation_deadline_at = request_sent_at + grace_seconds * INTERVAL '1 second')
    ),
    CONSTRAINT wellness_run_delivery_time_valid CHECK (
        (request_sent_at IS NULL OR event_id IS NOT NULL) AND
        (delivery_deadline_at IS NULL OR (event_id IS NOT NULL AND delivery_deadline_at >= evaluated_at))
    )
);
CREATE INDEX idx_wellness_runs_pending ON wellness_check_runs (available_at, scheduled_for)
    WHERE status = 'PENDING';
CREATE INDEX idx_wellness_runs_expired_lease ON wellness_check_runs (leased_until)
    WHERE status = 'PROCESSING';
CREATE INDEX idx_wellness_runs_resident ON wellness_check_runs (resident_user_id, scheduled_for DESC);
CREATE INDEX idx_wellness_runs_delivery_deadline ON wellness_check_runs (delivery_deadline_at)
    WHERE status = 'ALERT_CREATED' AND request_sent_at IS NULL;
CREATE TRIGGER trg_wellness_runs_updated_at BEFORE UPDATE ON wellness_check_runs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION preserve_wellness_run_occurrence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.schedule_id, NEW.owner_user_id, NEW.resident_user_id, NEW.local_date,
           NEW.scheduled_for, NEW.schedule_version, NEW.schedule_snapshot,
           NEW.lookback_started_at, NEW.lookback_ended_at, NEW.grace_seconds)
       IS DISTINCT FROM
       ROW(OLD.schedule_id, OLD.owner_user_id, OLD.resident_user_id, OLD.local_date,
           OLD.scheduled_for, OLD.schedule_version, OLD.schedule_snapshot,
           OLD.lookback_started_at, OLD.lookback_ended_at, OLD.grace_seconds) THEN
        RAISE EXCEPTION 'Wellness occurrence and configuration snapshot are immutable';
    END IF;
    IF OLD.evaluated_at IS NOT NULL AND
       ROW(NEW.status, NEW.event_id, NEW.evaluated_at, NEW.last_activity_at,
           NEW.presence_state, NEW.decision_reason)
       IS DISTINCT FROM
       ROW(OLD.status, OLD.event_id, OLD.evaluated_at, OLD.last_activity_at,
           OLD.presence_state, OLD.decision_reason) THEN
        RAISE EXCEPTION 'A completed wellness decision cannot be rewritten';
    END IF;
    IF OLD.request_sent_at IS NOT NULL AND
       ROW(NEW.request_sent_at, NEW.confirmation_deadline_at)
       IS DISTINCT FROM ROW(OLD.request_sent_at, OLD.confirmation_deadline_at) THEN
        RAISE EXCEPTION 'Wellness delivery retries cannot restart the response window';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_wellness_runs_preserve_occurrence BEFORE UPDATE ON wellness_check_runs
    FOR EACH ROW EXECUTE FUNCTION preserve_wellness_run_occurrence();

COMMENT ON COLUMN wellness_schedules.owner_user_id IS
    'Required by new application writes; unresolved legacy ownership must be repaired explicitly before scheduler admission.';
COMMENT ON COLUMN wellness_schedules.deleted_at IS
    'DELETE API soft-deletes the schedule; historical occurrences and alerts remain auditable.';
COMMENT ON COLUMN wellness_schedules.activation_started_at IS
    'New or re-enabled schedules do not create occurrences predating activation. Existing rows start at migration time.';
COMMENT ON COLUMN wellness_schedules.last_materialized_at IS
    'Durable admission cursor, separate from last_checked_at evaluation history; advance atomically with occurrence insertion.';
COMMENT ON TABLE resident_wellness_observations IS
    'Trusted M1 identity plus motion/directional evidence; a face match alone, unknown person or camera silence is not activity/departure.';
COMMENT ON TABLE resident_wellness_presence IS
    'Latest ordered trusted presence observation. Expired or absent projection means UNKNOWN; only fresh explicit AWAY skips a check.';
COMMENT ON TABLE wellness_check_runs IS
    'One immutable scheduled occurrence per schedule/local date, claimed with a recoverable lease. Create alert and notification intents atomically.';
COMMENT ON COLUMN wellness_check_runs.request_sent_at IS
    'First successfully dispatched resident request; retries must not restart the snapshotted confirmation window.';
COMMENT ON COLUMN events.wellness_owner_user_id IS
    'Household scope for camera-less M5 events; other event authorization and notification routing remain unchanged.';
COMMIT;
