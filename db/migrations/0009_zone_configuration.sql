-- =====================================================================
-- Migration 0009: Hoan thien cau hinh zone va dong bo Frigate (US-12)
-- =====================================================================

BEGIN;

ALTER TABLE zones
    ADD CONSTRAINT zones_min_dwell_hop_le
        CHECK (min_dwell_seconds BETWEEN 0 AND 300),
    ADD CONSTRAINT zones_ten_khong_rong
        CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    ADD CONSTRAINT zones_lich_khong_trung_hai_dau
        CHECK (active_from IS NULL OR active_from <> active_to);

ALTER TABLE events
    ADD COLUMN zone_name TEXT NULL;

UPDATE events e
SET zone_name = z.name
FROM zones z
WHERE e.zone_id = z.id
  AND e.zone_name IS NULL;

COMMENT ON COLUMN events.zone_name IS
    'Snapshot ten zone tai thoi diem su kien duoc nang thanh RESTRICTED_ZONE; khong doi khi zone bi doi ten hoac xoa.';

ALTER TABLE camera_frigate_settings
    ADD COLUMN managed_zone_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE frigate_config_sync_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id       UUID NOT NULL UNIQUE REFERENCES cameras (id) ON DELETE CASCADE,
    target_version  INTEGER NOT NULL CHECK (target_version >= 1),
    status          frigate_sync_status_enum NOT NULL DEFAULT 'PENDING',
    attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error_code TEXT NULL,
    last_error_message TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_frigate_sync_jobs_ready
    ON frigate_config_sync_jobs (next_attempt_at, updated_at)
    WHERE status = 'PENDING';

CREATE TRIGGER trg_frigate_config_sync_jobs_updated_at
    BEFORE UPDATE ON frigate_config_sync_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE frigate_config_sync_jobs IS
    'Cong viec dong bo cau hinh Frigate ben vung; mot camera chi giu version mong muon moi nhat.';

COMMIT;
