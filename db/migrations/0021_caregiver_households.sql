BEGIN;

CREATE TABLE household_settings (
    owner_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 90),
    storage_quota_gb INTEGER NOT NULL DEFAULT 100 CHECK (storage_quota_gb BETWEEN 1 AND 100000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE camera_access_grants (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    can_live BOOLEAN NOT NULL DEFAULT FALSE,
    can_playback BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, camera_id)
);
CREATE TABLE user_notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    in_app_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    sound_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    telegram_alerts BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE household_escalation_rules (
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_type event_type NOT NULL,
    t_low NUMERIC(5,4),
    t_high NUMERIC(5,4),
    t_wait_seconds INTEGER NOT NULL CHECK (t_wait_seconds BETWEEN 1 AND 86400),
    high_wait_seconds INTEGER CHECK (high_wait_seconds BETWEEN 0 AND 86400),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id UUID REFERENCES users(id),
    PRIMARY KEY (owner_user_id,event_type)
);

CREATE FUNCTION camera_household_root(actor_id UUID) RETURNS UUID LANGUAGE SQL STABLE AS $$
    SELECT COALESCE(household_owner_id,id) FROM users WHERE id=actor_id;
$$;
CREATE FUNCTION can_access_camera(actor_id UUID, target_camera_id UUID, history BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users actor JOIN cameras c ON c.id=target_camera_id
        JOIN devices d ON d.id=c.device_id
        LEFT JOIN camera_access_grants g ON g.user_id=actor.id AND g.camera_id=c.id
        WHERE actor.id=actor_id AND actor.is_active
          AND shares_camera_household(actor.id,d.owner_user_id)
          AND (actor.role IN ('ADMIN','CAREGIVER') OR
            CASE WHEN history THEN COALESCE(g.can_playback,FALSE) ELSE COALESCE(g.can_live,FALSE) END)
    );
$$;

-- Preserve existing Viewer access when upgrading; new members start without camera grants.
INSERT INTO camera_access_grants(user_id,camera_id,can_live,can_playback)
SELECT u.id,c.id,TRUE,TRUE FROM users u CROSS JOIN cameras c JOIN devices d ON d.id=c.device_id
WHERE u.role='VIEWER' AND shares_camera_household(u.id,d.owner_user_id);

COMMIT;
