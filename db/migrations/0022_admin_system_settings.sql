BEGIN;

ALTER TABLE household_settings
    ADD COLUMN IF NOT EXISTS max_cameras INTEGER NOT NULL DEFAULT 8 CHECK (max_cameras BETWEEN 1 AND 256);

ALTER TABLE household_settings
    ADD COLUMN IF NOT EXISTS service_plan TEXT NOT NULL DEFAULT 'STANDARD';

CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    default_max_cameras INTEGER NOT NULL DEFAULT 8 CHECK (default_max_cameras BETWEEN 1 AND 256),
    default_storage_quota_gb INTEGER NOT NULL DEFAULT 100 CHECK (default_storage_quota_gb BETWEEN 1 AND 100000),
    allowed_retention_days INTEGER[] NOT NULL DEFAULT ARRAY[7, 14, 30, 60, 90],
    default_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (default_retention_days BETWEEN 1 AND 365),
    session_timeout_minutes INTEGER NOT NULL DEFAULT 60 CHECK (session_timeout_minutes BETWEEN 5 AND 1440),
    require_mfa_for_admin BOOLEAN NOT NULL DEFAULT FALSE,
    allow_self_signup BOOLEAN NOT NULL DEFAULT FALSE,
    max_login_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_login_attempts BETWEEN 1 AND 20),
    ai_confidence_floor NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (ai_confidence_floor >= 0.050 AND ai_confidence_floor <= 0.990),
    max_upload_mb INTEGER NOT NULL DEFAULT 10 CHECK (max_upload_mb BETWEEN 1 AND 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id UUID REFERENCES users(id)
);

INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMIT;
