BEGIN;

CREATE TABLE user_email_alert_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  registration_id uuid NOT NULL UNIQUE,
  topic_arn text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL,
  requests_today integer NOT NULL DEFAULT 1 CHECK (requests_today BETWEEN 1 AND 5),
  confirmation_sent boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  verified_at timestamptz,
  CHECK (verified_at IS NULL OR (enabled AND confirmation_sent))
);
CREATE INDEX user_email_alert_settings_pending_idx
  ON user_email_alert_settings (checked_at, requested_at)
  WHERE enabled AND confirmation_sent AND verified_at IS NULL;

CREATE TABLE user_phone_alert_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sms_enabled boolean NOT NULL,
  call_enabled boolean NOT NULL,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  registration_id uuid NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL,
  requests_today integer NOT NULL DEFAULT 1 CHECK (requests_today BETWEEN 1 AND 5),
  code_hash text,
  code_attempts integer NOT NULL DEFAULT 0 CHECK (code_attempts BETWEEN 0 AND 5),
  verified_at timestamptz,
  CHECK (code_hash IS NULL OR (code_hash ~ '^[0-9a-f]{64}$' AND verified_at IS NULL))
);
CREATE INDEX user_phone_alert_settings_phone_idx ON user_phone_alert_settings (phone, requested_at);

COMMIT;
