-- US-16/US-17: durable confirmed fall incidents and pending AI submissions.
-- Candidate pose history stays in the AI tracker; only confirmed incidents persist.
BEGIN;

CREATE TABLE fall_incidents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id             UUID NOT NULL REFERENCES cameras (id) ON DELETE CASCADE,
    source_session_id     TEXT NOT NULL,
    track_id              TEXT NOT NULL,
    episode_id            UUID NOT NULL,
    event_id              UUID NOT NULL UNIQUE REFERENCES events (id) ON DELETE CASCADE,
    candidate_started_at  TIMESTAMPTZ NOT NULL,
    confirmed_at          TIMESTAMPTZ NOT NULL,
    model_version         TEXT NOT NULL,
    rule_snapshot         JSONB NOT NULL,
    result_id             UUID NOT NULL UNIQUE,
    pending_payload       JSONB NOT NULL,
    delivery_status       TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count         INTEGER NOT NULL DEFAULT 0,
    available_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    leased_until          TIMESTAMPTZ,
    lease_token           UUID,
    applied_at            TIMESTAMPTZ,
    last_error            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fall_incidents_episode_unique
        UNIQUE (camera_id, source_session_id, track_id, episode_id),
    CONSTRAINT fall_incidents_identity_valid CHECK (
        char_length(source_session_id) BETWEEN 1 AND 128 AND
        char_length(track_id) BETWEEN 1 AND 128 AND char_length(model_version) BETWEEN 1 AND 128
    ),
    CONSTRAINT fall_incidents_time_order CHECK (confirmed_at > candidate_started_at),
    CONSTRAINT fall_incidents_snapshot_object CHECK (jsonb_typeof(rule_snapshot) = 'object'),
    CONSTRAINT fall_incidents_payload_object CHECK (jsonb_typeof(pending_payload) = 'object'),
    CONSTRAINT fall_incidents_attempt_nonnegative CHECK (attempt_count >= 0),
    CONSTRAINT fall_incidents_delivery_valid CHECK (
        delivery_status IN ('PENDING', 'PROCESSING', 'APPLIED') AND
        ((delivery_status = 'PROCESSING') = (leased_until IS NOT NULL)) AND
        ((delivery_status = 'PROCESSING') = (lease_token IS NOT NULL)) AND
        ((delivery_status = 'APPLIED') = (applied_at IS NOT NULL))
    )
);

CREATE INDEX idx_fall_incidents_pending ON fall_incidents (available_at, created_at)
    WHERE delivery_status = 'PENDING';
CREATE INDEX idx_fall_incidents_expired_lease ON fall_incidents (leased_until)
    WHERE delivery_status = 'PROCESSING';

CREATE FUNCTION preserve_fall_incident_evidence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.camera_id, NEW.source_session_id, NEW.track_id, NEW.episode_id,
           NEW.event_id, NEW.candidate_started_at, NEW.confirmed_at, NEW.model_version,
           NEW.rule_snapshot, NEW.result_id, NEW.pending_payload)
       IS DISTINCT FROM
       ROW(OLD.camera_id, OLD.source_session_id, OLD.track_id, OLD.episode_id,
           OLD.event_id, OLD.candidate_started_at, OLD.confirmed_at, OLD.model_version,
           OLD.rule_snapshot, OLD.result_id, OLD.pending_payload) THEN
        RAISE EXCEPTION 'Confirmed fall evidence and pending submission are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_fall_incidents_preserve_evidence BEFORE UPDATE ON fall_incidents
    FOR EACH ROW EXECUTE FUNCTION preserve_fall_incident_evidence();
CREATE TRIGGER trg_fall_incidents_updated_at BEFORE UPDATE ON fall_incidents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fall_incidents IS
    'Create atomically with a separate FALL_DETECTED P1 event. Retry the immutable result until its receipt is ACCEPTED or DUPLICATE.';
COMMENT ON COLUMN fall_incidents.pending_payload IS
    'Validated schemaVersion=1 M2A_FALL submission; no image bytes, tokens or RTSP credentials.';
COMMIT;
