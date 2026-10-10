-- US-18: durable fire episodes, camera latch and pending AI submissions.
BEGIN;

CREATE TABLE fire_incidents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id             UUID NOT NULL REFERENCES cameras (id) ON DELETE CASCADE,
    source_session_id     TEXT NOT NULL,
    episode_id            UUID NOT NULL,
    event_id              UUID NOT NULL UNIQUE REFERENCES events (id) ON DELETE RESTRICT,
    first_qualified_at    TIMESTAMPTZ NOT NULL,
    confirmed_at          TIMESTAMPTZ NOT NULL,
    observed_clear_at     TIMESTAMPTZ,
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
    CONSTRAINT fire_incidents_episode_unique UNIQUE (camera_id, source_session_id, episode_id),
    CONSTRAINT fire_incidents_identity_valid CHECK (
        char_length(source_session_id) BETWEEN 1 AND 128 AND char_length(model_version) BETWEEN 1 AND 128
    ),
    CONSTRAINT fire_incidents_time_order CHECK (
        confirmed_at > first_qualified_at AND
        (observed_clear_at IS NULL OR observed_clear_at >= confirmed_at)
    ),
    CONSTRAINT fire_incidents_snapshot_object CHECK (jsonb_typeof(rule_snapshot) = 'object'),
    CONSTRAINT fire_incidents_payload_object CHECK (jsonb_typeof(pending_payload) = 'object'),
    CONSTRAINT fire_incidents_attempt_nonnegative CHECK (attempt_count >= 0),
    CONSTRAINT fire_incidents_delivery_valid CHECK (
        delivery_status IN ('PENDING', 'PROCESSING', 'APPLIED') AND
        ((delivery_status = 'PROCESSING') = (leased_until IS NOT NULL)) AND
        ((delivery_status = 'PROCESSING') = (lease_token IS NOT NULL)) AND
        ((delivery_status = 'APPLIED') = (applied_at IS NOT NULL))
    )
);

-- The latch survives AI restarts and user resolution of the associated event.
CREATE UNIQUE INDEX idx_fire_incidents_one_active_camera ON fire_incidents (camera_id)
    WHERE observed_clear_at IS NULL;
CREATE INDEX idx_fire_incidents_pending ON fire_incidents (available_at, created_at)
    WHERE delivery_status = 'PENDING';
CREATE INDEX idx_fire_incidents_expired_lease ON fire_incidents (leased_until)
    WHERE delivery_status = 'PROCESSING';

CREATE FUNCTION preserve_fire_incident_evidence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.camera_id, NEW.source_session_id, NEW.episode_id, NEW.event_id,
           NEW.first_qualified_at, NEW.confirmed_at, NEW.model_version,
           NEW.rule_snapshot, NEW.result_id, NEW.pending_payload)
       IS DISTINCT FROM
       ROW(OLD.camera_id, OLD.source_session_id, OLD.episode_id, OLD.event_id,
           OLD.first_qualified_at, OLD.confirmed_at, OLD.model_version,
           OLD.rule_snapshot, OLD.result_id, OLD.pending_payload) THEN
        RAISE EXCEPTION 'Confirmed fire evidence and pending submission are immutable';
    END IF;
    IF OLD.observed_clear_at IS NOT NULL AND NEW.observed_clear_at IS DISTINCT FROM OLD.observed_clear_at THEN
        RAISE EXCEPTION 'A cleared fire episode cannot be reopened';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_fire_incidents_preserve_evidence BEFORE UPDATE ON fire_incidents
    FOR EACH ROW EXECUTE FUNCTION preserve_fire_incident_evidence();
CREATE TRIGGER trg_fire_incidents_updated_at BEFORE UPDATE ON fire_incidents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fire_incidents IS
    'Create atomically with a separate FIRE_SMOKE_DETECTED P0 event; one active detector episode per camera, independent of event status.';
COMMENT ON COLUMN fire_incidents.observed_clear_at IS
    'Set once after a continuous validated negative-frame interval; silence, model errors and user confirmation cannot clear the latch.';
COMMENT ON COLUMN fire_incidents.event_id IS
    'Retention must remove cleared, applied incident rows before deleting their events; active incidents block event deletion.';
COMMIT;
